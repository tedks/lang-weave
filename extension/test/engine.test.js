import { describe, test, expect } from 'bun:test';
import { buildRequest, callGemini, parseSwapsResponse, API_BASE } from '../src/gemini.js';
import { requestSwaps, timeoutFor } from '../src/engine.js';
import { buildSwapRequest, canonicalSwapBody } from '../src/swap-request.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { createCache, memoryStorage } from '../src/cache.js';
import { hashKey } from '../src/hash.js';
import { capSwaps, legacyGlossForms, legacyInflects, possibleSpanishPromptWords, validateSwaps, wordsForLevel } from '../src/levels.js';
import { buildSystemPrompt, buildUserContent, RESPONSE_SCHEMA, unknownBudget } from '../src/prompt.js';
import { cleanPack } from '../src/languages.js';
import { GUARANI_PACK } from '../src/guarani.js';
import { GUARANI_STARTER } from '../src/language-name.js';

const geminiReply = (tweets) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ tweets }) }] } }] }),
});

// Reference body construction from engine.js at 39b264a, before the extraction.
function previousRequestBody({ level, batch, words, language, density = 'normal', unknownLimit = false, shownToday }) {
  const ordinarySpanish = !unknownLimit && (language === undefined || language === 'es') &&
    words?.every((word) => word.status === 'active');
  const promptWords = ordinarySpanish ? possibleSpanishPromptWords(level, words, batch) : words;
  return JSON.stringify(buildRequest({ system: buildSystemPrompt(level, promptWords, shownToday, language, density,
    unknownLimit ? unknownBudget(batch) : null), user: buildUserContent(batch), schema: RESPONSE_SCHEMA }));
}

describe('shared swap request', () => {
  const batch = [{ id: 'first', text: 'Open the window and listen to the rain.' },
    { id: 'second', text: 'Rain fell when we opened the window.' }];
  const spanish = [{ fr: 'la ventana', en: 'the window', hint: 'lah ven-TAH-nah', status: 'active' },
    { fr: 'la manzana', en: 'the apple', hint: 'lah mahn-SAH-nah', status: 'active' }];
  const guarani = [{ fr: 'okẽ', en: 'door', status: 'active' }];
  const pack = [{ fr: 'mado', en: 'window', status: 'new' }, { fr: 'ame', en: 'rain', status: 'known' }];

  for (const [label, inputs] of Object.entries({
    'ordinary Spanish': { language: 'es', words: spanish, shownToday: ['la ventana'] },
    'gradual Spanish': { language: 'es', words: spanish, unknownLimit: true, density: 'more' },
    'Guaraní': { language: 'gn', words: guarani, density: 'less' },
    'generated pack': { language: 'ja', words: pack, unknownLimit: true, shownToday: ['ame'] },
  })) {
    test(`preserves the pre-extraction request bytes for ${label}`, async () => {
      const args = { ...inputs, batch, level: 2, apiKey: 'synthetic', model: 'gemini-3.5-flash-lite' };
      const expected = previousRequestBody(args);
      const calls = [];
      await requestSwaps({ ...args, fetchImpl: async (url, { method, headers, body }) => {
        calls.push({ url, method, headers, body });
        return geminiReply(batch.map(({ id }) => ({ id, swaps: [] })));
      } });
      expect(JSON.stringify(buildSwapRequest(args))).toBe(expected);
      expect(calls).toEqual([{ url: `${API_BASE}${args.model}:generateContent`, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey }, body: expected }]);
    });
  }

  test('loads and builds in a fresh runtime without a chrome global', () => {
    const moduleUrl = new URL('../src/swap-request.js', import.meta.url).href;
    const child = Bun.spawnSync([process.execPath, '-e', `
      if ('chrome' in globalThis) throw new Error('Unexpected chrome global');
      const { buildSwapRequest } = await import(${JSON.stringify(moduleUrl)});
      buildSwapRequest({ level: 1, batch: [], words: [] });
    `]);
    expect({ exitCode: child.exitCode, stderr: child.stderr.toString() }).toEqual({ exitCode: 0, stderr: '' });
  });

  test('canonical C1 JSON sorts object keys and preserves array order', () => {
    const bytes = '{"passages":[{"id":"b","text":"Rain \\"fell\\"."},{"id":"a","text":"Rain stopped."}],"words":[{"en":"window","fr":"okẽ","source":"bundled"}]}';
    const body = { words: [{ fr: 'okẽ', source: 'bundled', en: 'window' }],
      passages: [{ text: 'Rain "fell".', id: 'b' }, { id: 'a', text: 'Rain stopped.' }] };
    expect(canonicalSwapBody(body)).toBe(bytes);
    expect(canonicalSwapBody(JSON.parse(bytes))).toBe(bytes);
    expect(canonicalSwapBody({ ...body, passages: [...body.passages].reverse() })).not.toBe(bytes);
  });
});

describe('gemini', () => {
  test('request shape: system instruction, json schema, low thinking', () => {
    const body = buildRequest({ system: 'S', user: 'U', schema: { type: 'object' } });
    expect(body.systemInstruction.parts[0].text).toBe('S');
    expect(body.contents[0].parts[0].text).toBe('U');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });
  test('callGemini posts with the key in a header and parses ids', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init }); return geminiReply([{ id: 'a', swaps: [{ o: 'and', f: 'y', g: 'and', h: 'ay', ctx: 'x and y' }] }]); };
    const out = await callGemini({ fetchImpl, apiKey: 'K', model: 'gemini-3.8-flash', body: { x: 1 } });
    expect(calls[0].url).toBe(`${API_BASE}gemini-3.8-flash:generateContent`);
    expect(calls[0].init.headers['x-goog-api-key']).toBe('K');
    expect(calls[0].url).not.toContain('K');
    expect(out.get('a')[0].f).toBe('y');
  });
  test('HTTP error and bad JSON throw', async () => {
    await expect(callGemini({ fetchImpl: async () => ({ ok: false, status: 503 }), apiKey: 'K', model: 'm', body: {} })).rejects.toThrow('Model service is busy');
    expect(() => parseSwapsResponse('not json')).toThrow();
    expect(parseSwapsResponse('{"tweets":[{"id":"a"},{"id":5,"swaps":[]}]}').get('a')).toEqual([]);
  });
});

describe('engine', () => {
  test('QA 2026-10-15: Flash-Lite is the default, and a model with a fallback waits 8 s, not 20', () => {
    expect(DEFAULT_SETTINGS.model).toBe('gemini-3.5-flash-lite');
    const both = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
    expect(timeoutFor('gemini-3.8-flash', both, undefined)).toBe(8000);
    expect(timeoutFor('gemini-3.5-flash-lite', both, undefined)).toBeUndefined();
    expect(timeoutFor('gemini-3.5-flash-lite', ['gemini-3.5-flash-lite'], 20000)).toBe(20000);
    expect(timeoutFor('gemini-3.8-flash', both, 5000)).toBe(5000);
  });
  test('validates swaps per level and falls back to Lite once when 3.8 fails', async () => {
    const models = [];
    const fetchImpl = async (url) => {
      models.push(url.split('/').pop().split(':')[0]);
      if (models.length === 1) return { ok: false, status: 503 };
      return geminiReply([{ id: 'a', swaps: [{ o: 'and', f: 'y', g: 'and', h: 'ay', ctx: 'x and y' }, { o: 'in', f: 'en', g: 'in', h: 'dahn', ctx: 'in y' }] }]);
    };
    const r = await requestSwaps({ apiKey: 'K', model: 'gemini-3.8-flash', level: 1, batch: [{ id: 'a', text: 'x and y in y' }], fetchImpl });
    expect(models).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(r.model).toBe('gemini-3.5-flash-lite');
    expect(r.results.a.map((s) => s.f)).toEqual(['y']);
  });
  test('throws when both models fail; Lite has no fallback', async () => {
    let n = 0;
    const fetchImpl = async () => { n++; return { ok: false, status: 429 }; };
    await expect(requestSwaps({ apiKey: 'K', model: 'gemini-3.8-flash', level: 1, batch: [], fetchImpl })).rejects.toThrow('Model rate limit reached');
    expect(n).toBe(2);
    n = 0;
    await expect(requestSwaps({ apiKey: 'K', model: 'gemini-3.5-flash-lite', level: 1, batch: [], fetchImpl })).rejects.toThrow();
    expect(n).toBe(1);
  });
  test('a rejected key fails without spending a fallback request', async () => {
    let calls = 0;
    const failure = await requestSwaps({ apiKey: 'synthetic', model: 'gemini-3.8-flash', level: 1,
      batch: [], fetchImpl: async () => { calls++; return { ok: false, status: 403 }; } }).catch((e) => e);
    expect(calls).toBe(1);
    expect(failure.category).toBe('key_rejected');
  });
  test('rate-limited models cool down: the next batch skips them, and an all-cooling batch fails fast with a retry time', async () => {
    let clock = 1000;
    const now = () => clock;
    const cooldown = new Map();
    const models = [];
    const fetchImpl = async (url) => {
      const m = url.split('/').pop().split(':')[0];
      models.push(m);
      if (m === 'gemini-3.8-flash') return { ok: false, status: 429, text: async () => '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"36s"}]}}' };
      return geminiReply([{ id: 'a', swaps: [] }]);
    };
    const args = { apiKey: 'K', model: 'gemini-3.8-flash', level: 2, batch: [{ id: 'a', text: 'x' }], fetchImpl, cooldown, now };
    await requestSwaps(args);
    expect(models).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(cooldown.get('gemini-3.8-flash')).toBe(1000 + 36000);
    await requestSwaps(args);
    expect(models.slice(2)).toEqual(['gemini-3.5-flash-lite']);
    cooldown.set('gemini-3.5-flash-lite', 1000 + 5000);
    const error = await requestSwaps(args).catch((e) => e);
    expect(error.message).toContain('cooling down');
    expect(error.retryAfterMs).toBe(5000);
    expect(models).toHaveLength(3);
    clock = 1000 + 36001;
    await requestSwaps(args);
    expect(models.slice(3)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  });
  test('does not dispatch fallback when cooldown persistence fails', async () => {
    const models = [];
    const fetchImpl = async (url) => { models.push(url.split('/').pop().split(':')[0]); return { ok: false, status: 429 }; };
    await expect(requestSwaps({ apiKey: 'K', model: 'gemini-3.8-flash', level: 1, batch: [], fetchImpl,
      onFailure: async () => { throw new Error('quota storage failed'); } })).rejects.toThrow('quota storage failed');
    expect(models).toEqual(['gemini-3.8-flash']);
  });
  test('a daily-quota 429 (retry in hours) keeps that model off for the whole delay, not just 10 minutes', async () => {
    let clock = 0;
    const cooldown = new Map();
    const models = [];
    const fetchImpl = async (url) => {
      const m = url.split('/').pop().split(':')[0];
      models.push(m);
      if (m === 'gemini-3.8-flash') return { ok: false, status: 429, text: async () => '{"error":{"status":"quota_exceeded","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"24281s"}]}}' };
      return geminiReply([{ id: 'a', swaps: [] }]);
    };
    const args = { apiKey: 'K', model: 'gemini-3.8-flash', level: 1, batch: [{ id: 'a', text: 'x' }], fetchImpl, cooldown, now: () => clock };
    await requestSwaps(args);
    expect(cooldown.get('gemini-3.8-flash')).toBe(24281000);
    clock = 3600000; // an hour later the quota is still spent: no wasted request
    await requestSwaps(args);
    expect(models).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash-lite']);
  });
  test('fallback delay cannot move provider guidance beyond the earliest actual cooldown', async () => {
    for (const fallbackDaily of [true, false]) {
      let clock = 1000;
      const cooldown = new Map();
      const fetchImpl = async (url) => {
        if (url.includes('gemini-3.8-flash:')) return { ok: false, status: 429,
          text: async () => '{"error":{"status":"quota_exceeded","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"3600s"}]}}' };
        clock = 5000; // fallback took four seconds after the primary response
        return { ok: false, status: 429,
          text: async () => fallbackDaily ? '{"error":{"status":"quota_exceeded"}}' : '{"error":{"status":"rate_limit_exceeded"}}' };
      };
      const args = { apiKey: 'K', model: 'gemini-3.8-flash', level: 1, batch: [], fetchImpl, cooldown, now: () => clock };
      const first = await requestSwaps(args).catch((e) => e);
      expect(cooldown.get('gemini-3.8-flash')).toBe(3601000);
      expect(first.retryAt).toBe(fallbackDaily ? 3601000 : undefined);
      const repeat = await requestSwaps(args).catch((e) => e);
      expect(repeat.coolingDown).toBe(true);
      expect(repeat.retryAfterMs).toBe(fallbackDaily ? 3596000 : 60000);
    }
  });
  test('ordinary Spanish sends only possible words and validates a fixed reply against the whole pool', async () => {
    const batch = [
      { id: 'a', text: 'I (really) think that the sweater dried.' },
      { id: 'b', text: 'We said oK and later read a bit. The only visitor took a seat.' },
    ];
    const words = wordsForLevel(2).map((word) => ({ ...word, status: 'active' }));
    const shownToday = ['creo que'];
    const reply = [
      { id: 'a', swaps: [{ o: 'I (really) think that', f: 'creo que' },
        { o: 'the sweater', f: 'el sueter' }, { o: 'dried', f: 'la maleta' }] },
      { id: 'b', swaps: [{ o: 'oK', f: 'de acuerdo' }, { o: 'a bit', f: 'un poco' },
        { o: 'only', f: 'solamente' }, { o: 'only', f: 'solo' }] },
    ];
    const sent = [];
    const result = await requestSwaps({ apiKey: 'synthetic', model: 'gemini-3.5-flash-lite',
      level: 2, language: 'es', words, shownToday, batch, fetchImpl: async (_url, init) => {
        sent.push(JSON.parse(init.body));
        return geminiReply(reply);
      } });
    expect(sent).toHaveLength(1);
    const system = sent[0].systemInstruction.parts[0].text;
    expect(system).toContain('creo que = I think that');
    expect(system).toContain('el suéter = the sweater');
    expect(system).toContain('de acuerdo = okay / agreed');
    expect(system).toContain('un poco = a little');
    expect(system).toContain('solamente = only');
    expect(system).toContain('solo = alone / only');
    expect(system).not.toContain('la maleta = the suitcase');
    expect(system.indexOf('el suéter =')).toBeLessThan(system.indexOf('creo que =')); // shown word last
    expect(system).toContain('Keep English noun compounds intact');
    expect(system).toContain('Zero Spanish in passages about health');
    expect(system.length).toBeLessThan(buildSystemPrompt(2, words, shownToday).length * 0.65);
    expect(sent[0].contents[0].parts[0].text).toBe(buildUserContent(batch));
    expect(sent[0].generationConfig.responseSchema).toEqual(RESPONSE_SCHEMA);
    const baseline = Object.fromEntries(batch.map(({ id, text }, i) =>
      [id, capSwaps(2, validateSwaps(2, reply[i].swaps, words, 'es', { text }), text, words)]));
    expect(baseline.a.map(({ word }) => word)).toEqual(['creo que', 'el suéter']);
    expect(baseline.b.map(({ word }) => word)).toEqual(['de acuerdo', 'un poco', 'solamente', 'solo']);
    expect(result.results).toEqual(baseline);
  });

  test('prompt projection retains ordinary Spanish aliases, inflections, explicit anchors and textless batches', () => {
    const words = [
      { fr: 'el objeto', en: 'the an object', hint: 'el ob-HEH-toh' },
      { fr: 'crecer', en: 'to grow', hint: 'kreh-SEHR' },
      { fr: 'frase', en: 'elsewhere', hint: 'FRAH-seh', anchors: ['here'] },
      { fr: 'rojo', en: 'red', hint: 'ROH-hoh' },
    ];
    const text = 'Our object was growing here beside a bright window.';
    expect(validateSwaps(2, [{ o: 'object', f: 'objeto' }, { o: 'growing', f: 'crecer' },
      { o: 'here', f: 'frase' }], words, 'es', { text }).map(({ word }) => word))
      .toEqual(['el objeto', 'crecer', 'frase']);
    expect(possibleSpanishPromptWords(2, words, [{ text }])).toEqual(words.slice(0, 3));
    expect(possibleSpanishPromptWords(2, words, [{ text }, { text: '' }])).toBe(words);

    const collision = [
      { fr: 'el objeto', en: 'the object', hint: 'el ob-HEH-toh' },
      { fr: 'objeto', en: 'artifact', hint: 'ob-HEH-toh' },
    ];
    expect(validateSwaps(2, [{ o: 'object', f: 'el objeto' }], collision, 'es', { text })[0]?.word)
      .toBe('objeto');
    expect(possibleSpanishPromptWords(2, collision, [{ text }])).toEqual(collision);
  });

  test('accepted legacy gloss forms for each Expanded row remain possible', () => {
    for (const word of wordsForLevel(2)) {
      let accepted = 0;
      const words = [word];
      for (const form of legacyGlossForms(word.en, { inflections: legacyInflects(word) })) {
        for (const o of new Set([form, form.replaceAll("'", '’'), form.replace(' ', ' (briefly) ')])) {
          const text = `A reader saw ${o} beside the oldest willow.`;
          if (!validateSwaps(2, [{ o, f: word.fr }], words, 'es', { text }).length) continue;
          expect(possibleSpanishPromptWords(2, words, [{ text }]), `${word.fr}: ${o}`).toEqual(words);
          accepted++;
        }
      }
      expect(accepted, word.fr).toBeGreaterThan(0);
    }
  });

  test('source spans accepted against the full Expanded catalog keep their rows in the prompt', () => {
    const words = wordsForLevel(2);
    const passages = [
      'The book was on a chair near our window. We found a suitcase nearby.',
      'I (really) think that there’s room for a little more. We said oK before leaving.',
      'Somebody likes an idea and somebody else found a small solution today.',
    ];
    for (const text of passages) {
      const tokens = [...text.matchAll(/[^\s.!?]+/g)];
      const replies = tokens.flatMap((start, index) => tokens.slice(index, index + 5).flatMap((end) => {
        const o = text.slice(start.index, end.index + end[0].length);
        return words.map(({ fr: f }) => ({ o, f }));
      }));
      const selected = new Set(possibleSpanishPromptWords(2, words, [{ text }]).map(({ fr }) => fr));
      const accepted = validateSwaps(2, replies, words, 'es', { text });
      expect(accepted.length).toBeGreaterThan(3);
      for (const { word, o } of accepted) expect(selected.has(word), `${o} -> ${word}`).toBe(true);
    }
  });

  test('the default Spanish path handles an empty projection and a missing candidate list', async () => {
    const batch = [{ id: 'a', text: 'Quartz gems glow brightly under moonlight.' }];
    const words = [{ fr: 'la maleta', en: 'the suitcase', hint: 'lah mah-LEH-tah', status: 'active' }];
    const sent = [];
    const args = { apiKey: 'synthetic', model: 'gemini-3.5-flash-lite', level: 2, batch,
      fetchImpl: async (_url, init) => {
        sent.push(JSON.parse(init.body).systemInstruction.parts[0].text);
        return geminiReply([{ id: 'a', swaps: [{ o: 'quartz', f: 'la maleta' }] }]);
      } };
    expect((await requestSwaps({ ...args, words })).results.a).toEqual([]);
    expect((await requestSwaps(args)).results.a).toEqual([]);
    expect(sent[0]).toBe(buildSystemPrompt(2, []));
    expect(sent[0]).toContain('listed most-needed first):\nnone');
    expect(sent[1]).toBe(buildSystemPrompt(2));
    expect(sent[1]).toContain('la ventana = the window');
    expect(sent[1]).toContain('el libro = the book');
  });

  test('gradual Spanish, other status mixes, and non-Spanish requests preserve the full request bytes', async () => {
    const generated = cleanPack({ words: Array.from({ length: 80 }, (_, i) => ({
      fr: `mot${i}`, en: `word${i}`, hint: 'moh', level: i < 40 ? 1 : 2,
    })) }, 'fr');
    const cases = [
      ['es', wordsForLevel(1).slice(0, 4), true, 'The room fell quiet today.'],
      ['es', [{ ...wordsForLevel(1)[0], status: 'new' }], false, 'The room fell quiet today.'],
      [GUARANI_STARTER, GUARANI_PACK.words, false, 'A single large tree stands here.'],
      ['fr', generated.words, false, 'We copied word1 into the notebook today.'],
    ];
    for (const [language, rows, unknownLimit, text] of cases) {
      const batch = [{ id: 'a', text }];
      const words = rows.map((word) => ({ status: 'active', ...word }));
      const shownToday = [words[0].fr];
      const body = buildRequest({ system: buildSystemPrompt(2, words, shownToday, language, 'light',
        unknownLimit ? unknownBudget(batch) : null), user: buildUserContent(batch), schema: RESPONSE_SCHEMA });
      const sent = [];
      await requestSwaps({ apiKey: 'synthetic', model: 'gemini-3.5-flash-lite',
        level: 2, language, words, shownToday, density: 'light', batch, unknownLimit, fetchImpl: async (_url, init) => {
          sent.push(init.body);
          return geminiReply([{ id: 'a', swaps: [] }]);
        } });
      expect(sent).toEqual([JSON.stringify(body)]);
    }
  });

  test('caps density per sentence, one use per word, learning words kept before known filler', async () => {
    const words = [
      { fr: 'grande', en: 'big', hint: 'grahn', status: 'active' },
      { fr: 'y', en: 'and', hint: 'ay', status: 'known' },
      { fr: 'pero', en: 'but', hint: 'meh', status: 'known' },
      { fr: 'muy', en: 'very', hint: 'mwee', status: 'known' },
    ];
    const swaps = [
      { o: 'and', f: 'y', ctx: 'x and' }, { o: 'very', f: 'muy', ctx: 'very' }, { o: 'and', f: 'y', ctx: 'y and' },
      { o: 'but', f: 'pero', ctx: 'but' }, { o: 'big', f: 'grande', ctx: 'a big' },
    ];
    const fetchImpl = async () => geminiReply([{ id: 'a', swaps }]);
    const text = 'It was a big day and a very long one, but fine.';
    const r = await requestSwaps({ apiKey: 'K', model: 'gemini-3.5-flash-lite', level: 1, batch: [{ id: 'a', text }], words, fetchImpl });
    expect(r.results.a.map((s) => s.f)).toEqual(['grande']);
    const two = await requestSwaps({ apiKey: 'K', model: 'gemini-3.5-flash-lite', level: 2, batch: [{ id: 'a', text }], words, fetchImpl });
    expect(two.results.a.map((s) => s.f)).toEqual(['y', 'grande']);
  });
});

describe('cache', () => {
  test('get/set/clear round trip, empty swaps are cached too', async () => {
    const c = createCache(memoryStorage());
    await c.setMany({ a: [{ o: 'and', f: 'y' }], b: [] });
    expect(await c.getMany(['a', 'b', 'c'])).toEqual({ a: [{ o: 'and', f: 'y' }], b: [] });
    expect(await c.clear()).toBe(2);
    expect(await c.getMany(['a'])).toEqual({});
  });
  test('prunes the oldest entries past the cap', async () => {
    const store = memoryStorage({ other: 1 });
    const c = createCache(store, { max: 5, pruneBy: 2, pruneEvery: 100 });
    for (let i = 0; i < 7; i++) {
      await c.setMany({ ['k' + i]: [] });
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(await c.prune()).toBe(4);
    const left = Object.keys(await store.getAll());
    expect(left).toContain('other');
    expect(left.filter((k) => k.startsWith('c:'))).toEqual(['c:k4', 'c:k5', 'c:k6']);
  });
  test('hashKey is stable and distinct', () => {
    expect(hashKey('hello')).toBe(hashKey('hello'));
    expect(hashKey('hello')).not.toBe(hashKey('hello '));
    expect(hashKey('')).toMatch(/^[0-9a-f]{16}$/);
  });
});

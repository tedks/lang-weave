import { test, expect } from 'bun:test';
import { placementSamples } from '../src/placement.js';
import { L1_WORDS, L2_EXTRA } from '../src/vocabulary.js';
import { GUARANI_STARTER } from '../src/language-name.js';
import { createBackup, parseBackup } from '../src/portability.js';
import { hashKey } from '../src/hash.js';

test('placement examples use real forms and meanings, including tiny and empty pools', () => {
  const [beginner, expanded] = placementSamples();
  expect(beginner).toHaveLength(4);
  expect(expanded).toHaveLength(4);
  expect(beginner.every((word) => L1_WORDS.includes(word))).toBe(true);
  expect(expanded.every((word) => L2_EXTRA.includes(word))).toBe(true);
  const basic = { fr: 'hoy', en: 'today' };
  const extra = { fr: 'el árbol', en: 'the tree' };
  expect(placementSamples([basic, basic], [basic, extra])).toEqual([[basic], [extra]]);
  expect(placementSamples([basic], [])).toEqual([[basic], []]);
  expect(placementSamples([], [])).toEqual([[], []]);
});

test('Spanish placement opts in locally, prioritizes real reader matches, and preserves older history', async () => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const legacyCard = { due: 1, interval: 1, reviews: 3, seenDay: '2026-01-01', seenCount: 2 };
  const storage = { settings: { language: 'es', levelOverride: 2, gradual: true, newWordsPerDay: 1, inlineRecall: true },
    recallReview: { version: 1, cards: { 'la ventana': legacyCard }, learning: { day: '', count: 0 } }, consentShown: true,
    readingEvents: [{ day: '2026-01-01', word: 'la ventana', kind: 'seen' }] };
  const listeners = [];
  const on = (list = []) => ({ addListener: (fn) => list.push(fn) });
  const id = 'fw-placement';
  const extension = `chrome-extension://${id}/`;
  const page = { id, tab: { id: 1, title: 'Reading' }, frameId: 0, documentId: 'doc',
    documentLifecycle: 'active', url: 'https://reading.example/story' };
  const sender = (surface) => ({ id, url: `${extension}src/${surface}.html` });
  const send = (msg, surface) => new Promise((reply) => {
    if (!listeners[0](msg, surface ? sender(surface) : page, reply)) reply(undefined);
  });
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        return structuredClone(Object.fromEntries([keys || Object.keys(storage)].flat()
          .filter((key) => Object.hasOwn(storage, key)).map((key) => [key, storage[key]])));
      },
      async set(values) { Object.assign(storage, structuredClone(values)); },
      async remove(keys) { for (const key of [keys].flat()) delete storage[key]; },
    } },
    runtime: { id, getURL: (path) => extension + path, getManifest: () => ({ version: '0.13.0' }),
      onMessage: on(listeners), onInstalled: on(), onStartup: on() },
    tabs: { get: async () => ({ id: 1, title: 'Reading', url: page.url }), query: async () => [], sendMessage: async () => {} },
    action: { setBadgeText: async () => {} }, alarms: { create: async () => {}, onAlarm: on() },
    permissions: { getAll: async () => ({ origins: ['<all_urls>'] }), onAdded: on(), onRemoved: on() },
    scripting: { getRegisteredContentScripts: async () => [], updateContentScripts: async () => {},
      unregisterContentScripts: async () => {}, registerContentScripts: async () => {} },
  };
  const prompts = [];
  globalThis.fetch = async (url, init) => {
    if (url === extension + 'manifest.json') return Response.json({ version: '0.13.0' });
    expect(url).toStartWith('https://generativelanguage.googleapis.com/');
    const request = JSON.parse(init.body);
    const prompt = request.systemInstruction.parts[0].text;
    prompts.push(prompt);
    const passages = JSON.parse(request.contents[0].parts[0].text.replace(/^Passages:\n/, '')).map(({ id }) =>
      ({ id, swaps: prompt.includes('a veces = sometimes') ? [{ o: 'sometimes', f: 'a veces', ctx: 'We sometimes catch' }] : [] }));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] });
  };
  const preview = (surface = 'options') => send({ type: 'placement' }, surface);
  const apply = (choice, snapshot, surface = 'options') => send({ type: 'placement', choice, epoch: snapshot.epoch }, surface);
  const config = () => send({ type: 'config' });
  const ask = (revision, text) => send({ type: 'swaps', revision,
    items: [{ key: `${revision}:${hashKey(text)}`, text }] });
  const select = (language) => send({ type: 'save', settings: { language } }, 'options');
  try {
    await import('../src/background.js?placement');
    const initial = await preview('welcome');
    const oldConfig = await config();
    const settings = structuredClone(storage.settings);
    const legacy = structuredClone(storage.recallReview);
    expect(initial).toMatchObject({ available: true, choice: 0 });
    expect(oldConfig.level).toBe(2);
    expect(storage.spanishPlacement).toBeUndefined();
    expect(await send({ type: 'placement', choice: 2, epoch: initial.epoch })).toBeUndefined();
    expect(await apply('2', initial)).toEqual({ ok: false });
    expect(await apply(2, initial, 'welcome')).toMatchObject({ ok: true, choice: 2 });
    expect(await apply(1, initial)).toEqual({ ok: false });
    expect(storage.settings).toEqual(settings);
    expect(storage.recallReview).toEqual(legacy);
    expect(prompts).toEqual([]);
    expect(storage.apiKey).toBeUndefined();
    expect(parseBackup(createBackup(storage, '0.13.0')).state.preferences.levelOverride).toBe(2);

    await send({ type: 'save', apiKey: 'synthetic-key' }, 'options');
    const expanded = await config();
    const text = 'We sometimes catch up without leaving the room.';
    expect(expanded.level).toBe(2);
    expect(await ask(oldConfig.revision, text)).toMatchObject({ stale: true });
    const { results } = await ask(expanded.revision, text);
    const [swap] = Object.values(results).flat();
    expect(swap.word).toBe('a veces');
    expect(typeof swap.introTicket).toBe('string');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('sin = without');
    expect(storage.recallReview.cards['a veces']).toBeUndefined();
    expect(storage.recallReview.learning.pending).toMatchObject([{ word: swap.word, ticket: swap.introTicket, revision: expanded.revision }]);
    expect((await config()).revision).toBe(expanded.revision);
    expect(await send({ type: 'introAck', word: swap.word, ticket: swap.introTicket, revision: expanded.revision }))
      .toEqual({ ok: true });
    const afterReading = structuredClone(storage.recallReview);
    const beforeRevision = await preview();
    expect(await apply(1, beforeRevision)).toMatchObject({ ok: true, choice: 1 });
    const beginner = await config();
    expect(beginner.level).toBe(1);
    expect(storage.recallReview).toEqual(afterReading);
    expect(storage.recallReview.cards['la ventana']).toEqual(legacyCard);
    expect(storage.recallReview.learning.count).toBe(1);
    expect((await send({ type: 'reviewNext' }, 'review')).card.en).toBe('the window');
    await send({ type: 'save', settings: { newWordsPerDay: 2 } }, 'options');
    const revised = await config();
    expect(Object.values((await ask(revised.revision, 'That documentary explores the world beyond our doorstep.')).results))
      .toEqual([[]]);
    expect(prompts).toHaveLength(1);
    await ask(revised.revision, 'The window looks lovely after a gentle snowfall.');
    expect(prompts.at(-1)).toContain('la ventana = the window');

    const beforeSwitch = await preview();
    await select(GUARANI_STARTER);
    expect(await preview()).toMatchObject({ available: false });
    expect(await apply(2, beforeSwitch)).toEqual({ ok: false });
    expect(await config()).toMatchObject({ language: GUARANI_STARTER, level: 2 });
    expect((await send({ type: 'reviewStatus' }, 'review')).new).toBe(14);
    await select('es');
    expect(await apply(2, beforeSwitch)).toEqual({ ok: false });
    expect(await preview()).toMatchObject({ available: true, choice: 1 });
    const clear = await apply(0, await preview());
    expect(clear).toMatchObject({ ok: true, choice: 0 });
    expect(await apply(0, clear)).toEqual(clear);
    expect((await config()).level).toBe(2);
    expect((await config()).settings).not.toHaveProperty('spanishPlacement');
    expect(storage.readingEvents).toEqual([{ day: '2026-01-01', word: 'la ventana', kind: 'seen' }]);
  } finally {
    Object.assign(globalThis, original);
  }
});

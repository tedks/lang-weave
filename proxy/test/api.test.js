import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_REQUEST_CHARS, selectWorkingSet } from '../../extension/src/adaptive.js';
import { createContext } from '../../extension/src/worker-context.js';
import { policyWords } from '../../extension/src/learning.js';
import { cleanPack } from '../../extension/src/languages.js';
import { memoryStorage } from '../../extension/src/cache.js';
import { requestSwaps } from '../../extension/src/engine.js';
import { GUARANI_PACK } from '../../extension/src/guarani.js';
import { GUARANI_STARTER } from '../../extension/src/language-name.js';
import { requestManagedSwaps } from '../../extension/src/managed.js';
import { cleanReview } from '../../extension/src/review.js';
import { buildSwapRequest } from '../../extension/src/swap-request.js';
import { wordsForLevel } from '../../extension/src/vocabulary.js';
import {
  BETA_EXTENSION_ID, createApi, MANAGED_MODEL, MAX_INBOUND_BYTES,
  MAX_OUTPUT_TOKENS, PROMPT_VERSION, PROVIDER_TIMEOUT_MS, validatedSwapWord,
} from '../src/api.js';
import { createLedger, createSqliteStorage, IN_FLIGHT_MAX, STALE_MS, sha256 } from '../src/ledger.js';
import { createPricing, PRICE_ROWS, quotePriceRow, serializedRequestBytes } from '../src/pricing.js';
import { makeLedger } from './helpers.js';
import { createProvider } from '../src/provider.js';
import { OUTCOMES, stubProvider, VALID_TEXT } from './provider-stub.js';

const origin = `chrome-extension://${BETA_EXTENSION_ID}`;
const base = 'https://proxy.invalid';
const key = '0123456789abcdef'.repeat(2);
const nextKey = 'fedcba9876543210'.repeat(2);
const windowWord = wordsForLevel(2).find((word) => word.fr === 'la ventana');
const bundledWindow = { source: 'bundled', fr: windowWord.fr, en: windowWord.en, status: 'active' };
const reading = {
  promptVersion: PROMPT_VERSION, model: MANAGED_MODEL, language: 'es', level: 2, density: 'normal',
  gradual: false, words: [bundledWindow], shownToday: [],
  passages: [{ id: 'p1', text: 'She looked out the window and watched the street.' }],
};

async function setup({
  outcome, balance = 1_000_000, enrolled = true, at = Date.parse('2026-11-28T23:58:00Z'), priceRows, handleOverage, ...params
} = {}) {
  const alerts = [];
  const context = makeLedger(at, { priceRows, onOverage(event) {
    alerts.push(event);
    handleOverage?.(event);
  } });
  const provider = stubProvider(outcome);
  const config = {
    ledger: context.ledger, provider, now: context.now,
    clientIp: () => '192.0.2.19', ipHashSecret: 'fixture-ip-hash-secret',
    alert: (event) => alerts.push(event), ...params,
  };
  const api = createApi(config);
  const opened = await api(new Request(base + '/v0/accounts', { method: 'POST' }));
  expect(opened.status).toBe(201);
  const { accountId, token } = await opened.json();
  if (enrolled) context.ledger.setEnrolled(accountId);
  if (balance) context.ledger.adjust(accountId, balance, 'fixture', 'credit');
  const getBalance = () => api(new Request(base + '/v0/balance', {
    headers: { Authorization: `Bearer ${token}` },
  }));
  const swap = (value = reading, options = {}) => {
    const { id = key, selectedApi = api, raw = JSON.stringify(value), headers = {} } = options;
    return selectedApi(new Request(base + '/v0/swaps', {
      method: 'POST', body: raw, headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': id, ...headers,
      },
    }));
  };
  const reservation = (idempotency = key) => {
    const original = context.ledger.getIdempotency(accountId, sha256(idempotency));
    return original && context.ledger.getReservation(original.reservationId);
  };
  return { ...context, config, api, accountId, token, provider, alerts, getBalance, swap, reservation };
}

test('accounts start empty, token is only returned at creation, and hourly limit crosses UTC midnight', async () => {
  const fixture = await setup({ balance: 0 });
  const { ledger, token, accountId, api, db, getBalance, tick } = fixture;
  try {
    expect(accountId).toMatch(/^acct_[A-Z2-7]{26}$/);
    expect(token).toMatch(/^lwk_[\w-]{43}$/);
    expect(ledger.authenticate(sha256(token))).toBe(accountId);
    expect(await (await getBalance()).json()).toEqual({ balanceMicros: 0, reservedMicros: 0 });
    const denied = await api(new Request(base + '/v0/balance'));
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: { category: 'managed_unauthorized' } });

    const second = createApi(fixture.config);
    const create = (handler = second) => handler(new Request(base + '/v0/accounts', {
      method: 'POST', headers: { 'x-forwarded-for': '198.51.100.3' },
    }));
    for (let i = 0; i < 4; i++) expect((await create(i % 2 ? api : second)).status).toBe(201);
    tick(4 * 60_000);
    const limited = await create();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: { category: 'rate_limit', retryAfterMs: 56 * 60_000 } });
    tick(56 * 60_000);
    expect((await create()).status).toBe(201);
  } finally { db.close(); }
});

test('only configured extension origins receive CORS and all required headers are allowed', async () => {
  const storeId = 'abcdefghijklmnop'.repeat(2);
  const { api, db } = await setup({ extensionIds: [storeId] });
  try {
    const preflight = (value) => api(new Request(base + '/v0/swaps', {
      method: 'OPTIONS', headers: { Origin: value, 'Access-Control-Request-Method': 'POST' },
    }));
    for (const value of [origin, `chrome-extension://${storeId}`]) {
      const response = await preflight(value);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(value);
      expect(response.headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type, Idempotency-Key');
      expect(response.headers.get('vary')).toBe('Origin');
    }
    expect((await preflight('https://example.invalid')).headers.has('access-control-allow-origin')).toBeFalse();
  } finally { db.close(); }
});

test('every bundled Spanish and Guaraní row and maximum-length pack and personal forms pass word validation', () => {
  for (const [language, catalog] of [['es', wordsForLevel(2)], [GUARANI_STARTER, GUARANI_PACK.words]]) {
    expect(catalog.length).toBeGreaterThan(20);
    for (const { fr, en } of catalog) {
      const word = { source: 'bundled', fr, en, status: 'known' };
      expect(validatedSwapWord(word, language)).toMatchObject({ fr, en, status: 'known' });
      expect(validatedSwapWord({ ...word, en: en + '!' }, language)).toBeNull();
    }
  }
  const pack = { source: 'pack', fr: 'é'.repeat(50), en: 'a'.repeat(60), status: 'due' };
  const personal = { source: 'personal', fr: '𐐀'.repeat(80), en: 'e'.repeat(80), status: 'new' };
  expect(validatedSwapWord(pack, 'fr')).toMatchObject({ fr: pack.fr, en: pack.en });
  expect(validatedSwapWord(personal, 'fr')).toMatchObject({ fr: personal.fr, en: personal.en });
  expect(validatedSwapWord({ ...pack, fr: pack.fr + 'x' }, 'fr')).toBeNull();
  expect(validatedSwapWord({ ...pack, en: pack.en + 'x' }, 'fr')).toBeNull();
  expect(validatedSwapWord({ ...pack, en: '<injected>' }, 'fr')).toBeNull();
  expect(validatedSwapWord({ ...personal, fr: personal.fr + 'x' }, 'fr')).toBeNull();
  expect(validatedSwapWord({ ...personal, en: 'https://example.invalid' }, 'fr')).toBeNull();
});

test('validation, version and inbound byte limits reject before reaching the ledger reservation or provider', async () => {
  const { swap, db, provider, reservation } = await setup();
  try {
    for (const change of [
      { model: 'gemini-3.8-flash' }, { level: 3 }, { language: 'EN' }, { density: 'unknown' },
      { gradual: 1 }, { words: Array(401).fill(bundledWindow) },
      { words: [{ ...bundledWindow, status: 'fake' }] }, { shownToday: ['LA VENTANA'] },
      { passages: [{ id: 'x'.repeat(65), text: 'sample' }] },
      { passages: [{ id: 'p1', text: 'a'.repeat(2001) }] },
      { systemInstruction: 'execute this instead' },
    ]) {
      expect((await swap({ ...reading, ...change })).status).toBe(400);
    }
    expect((await swap(reading, { id: 'too-short' })).status).toBe(400);
    expect((await swap(reading, { headers: { Authorization: 'Bearer missing' } })).status).toBe(401);
    for (const [promptVersion, ahead] of [['0.15', false], ['0.16.1', true], ['0.20', true], ['unknown', false]]) {
      const response = await swap({ ...reading, promptVersion });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { category: 'managed_update_required', ahead } });
    }
    const large = await swap(reading, { raw: 'é'.repeat(MAX_INBOUND_BYTES / 2 + 1) });
    expect(large.status).toBe(413);
    expect(await large.json()).toEqual({ error: { category: 'request_failed', tooLarge: 'body' } });
    expect(provider.calls).toHaveLength(0);
    expect(reservation()).toBeNull();
  } finally { db.close(); }
});

test('built prompt size, including multilingual lists, is distinct from the inbound body cap', async () => {
  const { swap, db, provider, reservation } = await setup();
  try {
    const longPersonal = {
      fr: 'é'.repeat(80), en: 'x'.repeat(80), source: 'personal', status: 'active',
    };
    const body = { ...reading, language: 'fr', words: Array.from({ length: 200 }, () => longPersonal) };
    for (const [count, tooLarge] of [[1, 'words'], [2, 'passages']]) {
      const response = await swap({ ...body, passages: reading.passages.concat(
        count === 2 ? [{ id: 'p2', text: 'hello world' }] : []) });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { category: 'request_failed', tooLarge } });
    }
    expect(provider.calls).toHaveLength(0);
    expect(reservation()).toBeNull();
  } finally { db.close(); }
});

test('the exact built UTF-16 limit accepts a request beyond the superseded 64,000-byte cap', async () => {
  const { swap, db, provider } = await setup();
  try {
    const words = Array.from({ length: 80 }, (_, i) => ({
      source: 'pack', status: 'active', fr: `あ${i}`.padEnd(50, 'あ'), en: 'え'.repeat(60),
    }));
    const passages = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, text: 'あ'.repeat(i === 7 ? 0 : 1500) }));
    const input = { ...reading, language: 'ja', words, passages };
    const measured = JSON.stringify(buildSwapRequest({ ...input, batch: passages })).length;
    const extra = MAX_REQUEST_CHARS - measured;
    expect(extra).toBeGreaterThan(0);
    expect(extra).toBeLessThan(2000);
    passages.at(-1).text = 'あ'.repeat(extra);
    expect((await swap(input)).status).toBe(200);
    expect(serializedRequestBytes(JSON.stringify(provider.calls[0].request))).toBeGreaterThan(64_000);
    passages.at(-1).text += 'あ';
    const denied = await swap(input, { id: nextKey });
    expect(denied.status).toBe(400);
    expect(await denied.json()).toEqual({ error: { category: 'request_failed', tooLarge: 'passages' } });
    expect(provider.calls).toHaveLength(1);
  } finally { db.close(); }
});

test('a proxy prompt equals the BYOK transport body before the output override without a chrome global', async () => {
  const { swap, db, provider, reservation, now } = await setup();
  try {
    expect(globalThis.chrome).toBeUndefined();
    let byok;
    await requestSwaps({
      apiKey: 'byok-fixture-key', model: MANAGED_MODEL, level: reading.level, language: reading.language,
      batch: reading.passages, words: [{ ...windowWord, status: 'active' }], shownToday: [],
      fetchImpl: async (_url, init) => {
        byok = init.body;
        return Response.json({ candidates: [{ content: { parts: [{ text: VALID_TEXT }] } }] });
      },
    });
    expect((await swap()).status).toBe(200);
    const [{ request, timeoutMs, model }] = provider.calls;
    expect(timeoutMs).toBe(PROVIDER_TIMEOUT_MS);
    expect(model).toBe(MANAGED_MODEL);
    expect(request.generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    const bytes = serializedRequestBytes(JSON.stringify(request));
    const pricing = createPricing();
    expect(reservation()).toMatchObject({
      readerWorst: pricing.worst(model, bytes, MAX_OUTPUT_TOKENS, now()).readerMicros,
      providerMax: pricing.worst(model, bytes, MAX_OUTPUT_TOKENS, now()).providerMicros +
        pricing.maxPerCallOverage(PRICE_ROWS[0].id, MAX_OUTPUT_TOKENS),
    });
    const { maxOutputTokens, ...generationConfig } = request.generationConfig;
    expect(JSON.stringify({ ...request, generationConfig })).toBe(byok);
  } finally { db.close(); }
});

test('C1 replay survives JSON key reordering, detects open calls and falls back to durable charged state', async () => {
  let finish;
  let sent;
  const started = new Promise((resolve) => { sent = resolve; });
  const result = new Promise((resolve) => { finish = resolve; });
  const fixture = await setup({ outcome: () => { sent(); return result; } });
  const { swap, db, tick, provider, config, getBalance } = fixture;
  try {
    const first = swap();
    await started;
    const sameOpen = await swap();
    expect(sameOpen.status).toBe(429);
    expect(await sameOpen.json()).toEqual({ error: { category: 'rate_limit', retryAfterMs: 1000 } });
    const different = await swap({ ...reading, density: 'heavy' });
    expect(different.status).toBe(422);
    expect(await different.json()).toEqual({ error: { category: 'request_failed', keyReuse: true } });
    const { reservedMicros } = await (await getBalance()).json();
    expect(reservedMicros).toBeGreaterThan(0);
    finish(OUTCOMES.stop);
    const accepted = await first;
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json();
    const reordered = Object.fromEntries(Object.entries(reading).reverse());
    const replay = await swap(reordered, { raw: JSON.stringify(reordered, null, 2) });
    expect(await replay.json()).toEqual(acceptedBody);
    const otherServer = createApi(config);
    const duplicate = await swap(reading, { selectedApi: otherServer });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: { category: 'request_failed', duplicate: true, charged: true } });
    expect(provider.calls).toHaveLength(1);
    tick(60_000);
    expect((await swap()).status).toBe(200);
    expect(provider.calls).toHaveLength(2);
  } finally { db.close(); }
});

test('section 6.3 orders outcomes before usage and records provider and reader amounts independently', async () => {
  for (const [outcome, status, state, reason, reader, cost, flags] of [
    [OUTCOMES.beforeSend, 502, 'released', 'request_failed', 0, 0],
    [OUTCOMES.httpError, 502, 'released', 'request_failed', 0, 0],
    [OUTCOMES.rateLimit, 429, 'released', 'rate_limit', 0, 0, { retryAfterMs: 2000 }],
    [OUTCOMES.overloaded, 503, 'released', 'overloaded', 0, 0],
    [OUTCOMES.timeout, 504, 'provisional', 'timeout', 'worst', null],
    [{ ...OUTCOMES.safety, blockReason: 'SAFETY' }, 502, 'provisional', 'prompt_blocked', 0, null, { blocked: true }],
    [OUTCOMES.safety, 502, 'settled', 'safety', 60, 30, { blocked: true }],
    [{ ...OUTCOMES.safety, usage: null }, 502, 'provisional', 'safety', 'input', null, { blocked: true }],
    [OUTCOMES.other, 502, 'provisional', 'unclassified', 0, null, { blocked: true }],
    [OUTCOMES.maxTokens, 502, 'settled', 'max_tokens', 360, 180],
    [{ ...OUTCOMES.maxTokens, usage: null }, 502, 'provisional', 'max_tokens', 'worst', null],
    [OUTCOMES.noUsage, 200, 'provisional', 'no_usage', 'worst', null],
    [OUTCOMES.stop, 200, 'settled', 'stop', 360, 180],
  ]) {
    const { swap, db, provider, reservation, alerts, getBalance } = await setup({ outcome });
    try {
      const response = await swap();
      expect(response.status).toBe(status);
      const payload = await response.json();
      const stored = reservation();
      const expectedReader = reader === 'worst' ? stored.readerWorst : reader === 'input'
        ? createPricing().worst(MANAGED_MODEL, serializedRequestBytes(JSON.stringify(provider.calls[0].request)), 0).readerMicros
        : reader;
      expect(stored).toMatchObject({ state, reason, costMicros: expectedReader, providerActual: cost });
      expect(await (await getBalance()).json()).toEqual({ balanceMicros: 1_000_000 - expectedReader, reservedMicros: 0 });
      expect(provider.calls).toHaveLength(1);
      if (flags) expect(payload.error).toMatchObject(flags);
      if (status === 200) {
        expect(payload.costMicros).toBe(expectedReader);
        expect(payload.usage).toEqual(outcome.usage === null ? null : { promptTokens: 100, outputTokens: 50, thoughtTokens: 10 });
      }
      if (['max_tokens', 'unclassified'].includes(reason)) expect(alerts).toEqual([{
        reason, reservationId: stored.reservationId,
      }]);
    } finally { db.close(); }
  }
});

test('a STOP with invalid JSON, invalid schema or unfamiliar passage ID still settles before 502', async () => {
  for (const text of ['!', '{"passages":[{"id":"p1","swaps":[{"o":"example"}]}]}',
    '{"passages":[{"id":"different","swaps":[]}]}']) {
    const { swap, db, reservation } = await setup({ outcome: { ...OUTCOMES.stop, text } });
    try {
      const response = await swap();
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: { category: 'request_failed' } });
      expect(reservation()).toMatchObject({ state: 'settled', costMicros: 360, providerActual: 180 });
    } finally { db.close(); }
  }
});

test('admission errors and maintenance leave the call unsent', async () => {
  for (const [config, freeze, status, category] of [
    [{ balance: 0 }, false, 402, 'managed_balance'],
    [{}, true, 402, 'managed_balance'],
    [{ enrolled: false }, false, 503, 'managed_unavailable'],
    [{ ceilingMicros: 1 }, false, 503, 'managed_unavailable'],
    [{ isInMaintenance: () => true }, false, 503, 'managed_unavailable'],
  ]) {
    const { swap, db, provider, reservation, ledger, accountId } = await setup(config);
    try {
      if (freeze) ledger.freeze(accountId, 'fixture');
      const response = await swap();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: { category } });
      expect(provider.calls).toHaveLength(0);
      expect(reservation()).toBeNull();
    } finally { db.close(); }
  }
});

test('overage is alerted, records the full provider charge and blocks the next call', async () => {
  const { swap, db, provider, alerts, reservation } = await setup({
    outcome: { ...OUTCOMES.stop, usage: { promptTokenCount: 1_000_000 } },
  });
  try {
    const accepted = await swap();
    expect(accepted.status).toBe(200);
    const body = await accepted.json();
    const stored = reservation();
    expect(stored).toMatchObject({ providerActual: 300_000, overage: 1 });
    expect(body.costMicros).toBe(stored.readerWorst);
    expect(alerts).toEqual([{ reason: 'overage', reservationId: stored.reservationId }]);
    expect((await swap(reading, { id: nextKey })).status).toBe(503);
    expect(provider.calls).toHaveLength(1);
  } finally { db.close(); }
});

test('combined maximum sends every passage through the E1 splitter and the E2 endpoint', async () => {
  const makeWords = (source, length, frLength, enLength) => Array.from({ length }, (_, i) => ({
    fr: `${source}${i}`.padEnd(frLength, 'é'), en: `gloss${source}${i}`.padEnd(enLength, 'e'),
    hint: '', ...(source === 'personal' ? { personalId: `fixture-${i}` } : {}),
  }));
  const pack = makeWords('pack', 80, 50, 60).map((word, i) => ({
    ...word, hint: 'h'.repeat(60), level: i < 40 ? 1 : 2,
  }));
  const personal = makeWords('personal', 300, 80, 80);
  const passages = Array.from({ length: 8 }, (_, i) => ({
    id: `passage-${i + 1}`.padEnd(64, 'x'),
    text: `${pack[i].en} ${personal[i].en} `.padEnd(2000, 'é'),
  }));
  const names = passages.map(({ id }) => id);

  for (const gradual of [true, false]) {
    const { api, token, now, provider, db } = await setup({ outcome: ({ request }) => {
      const userContent = request.contents[0].parts[0].text.split('\n', 2)[1];
      const providerPassages = JSON.parse(userContent).map(({ id }) => ({ id, swaps: [] }));
      return { ...OUTCOMES.stop, text: JSON.stringify({ passages: providerPassages }) };
    } });
    try {
      const chrome = globalThis.chrome;
      globalThis.chrome = {
        permissions: { getAll: async () => ({ origins: [] }) }, runtime: { getManifest: () => ({ version: '0.16.1' }) },
      };
      let context;
      try {
        const store = memoryStorage({
          settings: { gradual, language: 'fr', levelOverride: 2, managedProvider: true },
          managedToken: token,
          languagePacks: { fr: { words: pack } },
          personalVocabularyV1: { version: 1, entries: personal.map(({ fr, en }, i) => ({
            language: 'fr', target: fr, source: en, sense: en, direction: 'en-to-target',
            uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          })) },
        });
        context = await createContext({ store, ready: Promise.resolve(), worker: {} }).context();
      } finally {
        if (chrome === undefined) delete globalThis.chrome;
        else globalThis.chrome = chrome;
      }
      expect(context.language).toBe('fr');
      expect(context.words.length).toBe(gradual ? 380 : 80);
      const words = gradual ? selectWorkingSet({
        batch: passages, words: context.words, scope: context.scope, language: 'fr', level: 2,
        state: cleanReview(null, context.words, now()), settings: context.settings,
        now: now(), day: '2026-11-28', revision: context.revision,
      }) : policyWords(context.words, null, context.settings, now());
      expect(words.length).toBeGreaterThan(0);
      const dispatched = [];
      const { results } = await requestManagedSwaps({
        token, level: 2, language: 'fr', unknownLimit: gradual, words, batch: passages,
        keyStore: memoryStorage(), now,
        fetchImpl: async (url, init) => {
          const wire = JSON.parse(init.body);
          const response = await api(new Request(url, init));
          dispatched.push(wire.passages.map(({ id }) => id));
          expect(response.status).toBe(200);
          return response;
        },
      });
      expect(Object.keys(results)).toEqual(names);
      expect(dispatched).toEqual(gradual ? [names] : [names.slice(0, 4), names.slice(4)]);
      expect(provider.calls).toHaveLength(dispatched.length);
      for (const { request: { generationConfig: { maxOutputTokens, ...generationConfig }, ...request } } of provider.calls) {
        expect(JSON.stringify({ ...request, generationConfig }).length).toBeLessThanOrEqual(MAX_REQUEST_CHARS);
      }
    } finally { db.close(); }
  }
});

test.todo('carry and verify a previous-release prompt snapshot once an earlier release contains the shared builder');

test('pack-cleaner and proxy accept and reject the same gloss boundary cases', () => {
  const raw = Array.from({ length: 20 }, (_, i) => ({
    fr: `form${i}`, en: 'e'.repeat(60), hint: 'pronunciation', level: i < 10 ? 1 : 2,
  }));
  for (const [gloss, passes] of [['é'.repeat(60), true], ['e'.repeat(61), false], ['123', false], ['e\u200d', false]]) {
    const words = [{ ...raw[0], en: gloss }, ...raw.slice(1)];
    const { fr, en } = words[0];
    expect(Boolean(cleanPack({ words }, 'fr'))).toBe(passes);
    expect(Boolean(validatedSwapWord({ fr, en, source: 'pack', status: 'active' }, 'fr'))).toBe(passes);
  }
});

test('account opening caps raw streams and uses an explicitly configured transport-proto header', async () => {
  const { api, db, config } = await setup();
  try {
    const bytes = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_INBOUND_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    } });
    const large = new Request(base + '/v0/accounts', { method: 'POST', body: bytes });
    expect(large.headers.has('content-length')).toBeFalse();
    const exceeded = await api(large);
    expect(exceeded.status).toBe(413);
    expect(await exceeded.json()).toEqual({ error: { category: 'request_failed', tooLarge: 'body' } });
    expect(db.transaction((tx) => tx.get('SELECT COUNT(*) AS count FROM accounts').count)).toBe(1);

    const request = (protocol) => new Request('http://proxy.invalid/v0/accounts', {
      method: 'POST', body: new ReadableStream({ start: (controller) => controller.close() }),
      headers: { 'X-Fixture-Proto': protocol },
    });
    expect((await api(request('https'))).status).toBe(400);
    const trusted = createApi({ ...config, forwardedProtoHeader: 'X-Fixture-Proto' });
    expect((await trusted(request('http'))).status).toBe(400);
    expect((await trusted(request('https'))).status).toBe(201);
  } finally { db.close(); }
});

test('safe STOP output serializes only schema fields even when extras contain request text', async () => {
  const echo = reading.passages[0].text;
  const text = JSON.stringify({
    request: echo,
    passages: [{ id: 'p1', sourcePassage: echo, swaps: [
      { o: 'window', f: 'ventana', g: 'window', h: 'ben-tana', ctx: 'out the window', extra: echo },
    ] }],
  });
  const { swap, db } = await setup({ outcome: { ...OUTCOMES.stop, text } });
  try {
    const response = await swap();
    expect(response.status).toBe(200);
    const output = (await response.json()).text;
    expect(output).not.toContain(echo);
    expect(JSON.parse(output)).toEqual({ passages: [{ id: 'p1', swaps: [
      { o: 'window', f: 'ventana', g: 'window', h: 'ben-tana', ctx: 'out the window' },
    ] }] });
  } finally { db.close(); }
});

test('day-cap refusal reports dailyCap through C1 before calling the provider', async () => {
  const { ledger, accountId, swap, db, provider, reservation } = await setup();
  try {
    const held = ledger.reserve(accountId, 0, 900_000, PRICE_ROWS[0].id, 2_000_000, sha256('seed'), sha256('seed body'));
    ledger.settle(held, 0, 900_000, 'fixture');
    const denied = await swap();
    expect(denied.status).toBe(402);
    expect(await denied.json()).toEqual({ error: { category: 'managed_balance', dailyCap: true } });
    expect(provider.calls).toHaveLength(0);
    expect(reservation()).toBeNull();
  } finally { db.close(); }
});

test('C1 refuses the fifth in-flight call even when it belongs to a separate account', async () => {
  const allStarted = Promise.withResolvers();
  const providerResult = Promise.withResolvers();
  let started = 0;
  const { config, ledger, account, db, token, getBalance } = await setup({
    outcome() {
      if (++started === IN_FLIGHT_MAX) allStarted.resolve();
      return providerResult.promise;
    },
  });
  const api = createApi(config);
  const tokens = [token, ...Array.from({ length: IN_FLIGHT_MAX }, () => ledger.rotateToken(account(100_000).id))];
  const dispatch = (bearer) => api(new Request(base + '/v0/swaps', {
    method: 'POST', body: JSON.stringify(reading),
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
  }));
  const inFlight = tokens.slice(0, IN_FLIGHT_MAX).map(dispatch);
  try {
    await allStarted.promise;
    const denied = await dispatch(tokens.at(-1));
    expect(denied.status).toBe(429);
    expect(await denied.json()).toEqual({ error: { category: 'rate_limit', retryAfterMs: 1000 } });
    expect((await (await getBalance()).json()).reservedMicros).toBeGreaterThan(0);
    expect(started).toBe(IN_FLIGHT_MAX);
  } finally {
    providerResult.resolve(OUTCOMES.stop);
    expect((await Promise.all(inFlight)).map((response) => response.status)).toEqual(Array(IN_FLIGHT_MAX).fill(200));
    db.close();
  }
});

test('cached and durable claims precede maintenance, the stop latch and expired pricing', async () => {
  let maintenance = false;
  const { swap, db, provider, ledger, config, tick, accountId } = await setup({
    at: Date.parse('2026-12-28T23:59:50Z'), isInMaintenance: () => maintenance,
  });
  try {
    const original = await (await swap()).json();
    const stop = ledger.reserve(accountId, 0, 100, PRICE_ROWS[0].id, 2_000_000, sha256('seed stop'), sha256('seed body'));
    ledger.settle(stop, 0, 101, 'fixture');
    tick(20_000);
    maintenance = true;
    expect(await (await swap()).json()).toEqual(original);
    expect((await swap({ ...reading, density: 'heavy' })).status).toBe(422);
    const other = await swap(reading, { selectedApi: createApi(config) });
    expect(await other.json()).toEqual({ error: { category: 'request_failed', duplicate: true, charged: true } });
    maintenance = false;
    expect((await swap(reading, { id: nextKey })).status).toBe(503);
    expect(ledger.lookupClaim(accountId, sha256(nextKey), sha256('unknown'))).toBeNull();
    expect(provider.calls).toHaveLength(1);
  } finally { db.close(); }
});

test('midnight reprices from the authoritative row, settles using that row and maps a retry refusal normally', async () => {
  const previous = { ...PRICE_ROWS[0], id: 'fixture-previous', until: '2026-11-29' };
  const effective = { ...PRICE_ROWS[0], id: 'fixture-effective', from: '2026-11-29', input: 60 };
  const beforeMidnight = Date.parse('2026-11-28T23:59:59.999Z');
  for (const balance of [1_000_000, 0]) {
    const { config, swap, db, provider, reservation, ledger } = await setup({
      now: () => beforeMidnight, at: beforeMidnight + 1, balance, priceRows: [previous, effective],
      pricing: createPricing({ rows: [previous] }),
    });
    const attempts = [];
    const selectedApi = createApi({ ...config, ledger: { ...ledger, reserve(...args) {
      const result = ledger.reserve(...args);
      attempts.push({ result, row: args[3] });
      return result;
    } } });
    try {
      const response = await swap(reading, { selectedApi });
      expect(attempts.map(({ row }) => row)).toEqual([previous.id, effective.id]);
      expect(attempts[0].result).toBe('STALE_PRICE');
      if (balance) {
        expect(response.status).toBe(200);
        expect(reservation()).toMatchObject({ dayKey: '2026-11-29', priceRowId: effective.id, providerActual: 210 });
        expect(provider.calls).toHaveLength(1);
      } else {
        expect(response.status).toBe(402);
        expect(attempts[1].result).toBe('BALANCE');
        expect(reservation()).toBeNull();
        expect(provider.calls).toHaveLength(0);
      }
    } finally { db.close(); }
  }
});

test('expiry and key reuse cannot make the original request return the newer outcome', async () => {
  const firstStarted = Promise.withResolvers();
  const delayed = Promise.withResolvers();
  let calls = 0;
  const { swap, db, reservation, tick, ledger, alerts } = await setup({
    outcome() {
      if (++calls !== 1) return OUTCOMES.beforeSend;
      firstStarted.resolve();
      return delayed.promise;
    },
  });
  try {
    const first = swap();
    await firstStarted.promise;
    const oldId = reservation().reservationId;
    tick(STALE_MS + 1);
    expect(ledger.expireStale()[0]).toMatchObject({ reservationId: oldId, state: 'provisional' });
    tick(60_000);
    expect((await swap({ ...reading, density: 'heavy' })).status).toBe(502);
    const newer = reservation();
    expect(newer.reservationId).not.toBe(oldId);
    expect(newer.costMicros).toBe(0);

    delayed.resolve(OUTCOMES.stop);
    const originalReply = await first;
    expect(originalReply.status).toBe(409);
    expect(await originalReply.json()).toEqual({ error: { category: 'request_failed', duplicate: true, charged: true } });
    expect(ledger.getReservation(oldId)).toMatchObject({ providerActual: 180, providerRequestId: 'stub-request' });
    expect(reservation()).toEqual(newer);
    expect(alerts).toEqual([]);
  } finally { db.close(); }
});

test('late transport reconciliation uses the original UTC day after midnight and raises an overage once', async () => {
  const delivery = Promise.withResolvers();
  const alarm = Promise.withResolvers();
  const transport = createProvider({
    baseUrl: 'https://fixture.invalid/models/', credential: 'fixture-only-secret', fetchImpl: () => delivery.promise,
  });
  const { swap, db, reservation, ledger, tick, alerts } = await setup({
    at: Date.parse('2026-11-28T23:59:59Z'), handleOverage: alarm.resolve,
    provider: { call: (args) => transport.call({ ...args, timeoutMs: 12 }) },
  });
  try {
    const first = await swap();
    expect(first.status).toBe(504);
    const original = reservation();
    expect(original).toMatchObject({ dayKey: '2026-11-28', state: 'provisional', providerActual: null });
    tick(2000);
    delivery.resolve(Response.json({
      responseId: 'late-customer-free-id',
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: VALID_TEXT }] } }],
      usageMetadata: { promptTokenCount: 1_000_000 },
    }));
    expect(await alarm.promise).toEqual({ reason: 'overage', reservationId: original.reservationId });
    expect(reservation()).toMatchObject({
      dayKey: '2026-11-28', providerActual: 300_000, overage: 1,
      costMicros: original.costMicros, providerRequestId: 'late-customer-free-id',
    });
    expect((await swap(reading, { id: nextKey })).status).toBe(503);
    ledger.reconcileProviderRequest('late-customer-free-id', 300_000);
    expect(alerts).toHaveLength(1);
  } finally { db.close(); }
});

test('E1 drops an oversized single passage with no proxy request and no charge', async () => {
  const { api, provider, token, getBalance, db } = await setup();
  try {
    const words = Array.from({ length: 250 }, (_, i) => ({
      fr: `personal${i}`.padEnd(80, 'é'), en: 'e'.repeat(80), hint: '', status: 'active', personalId: `word-${i}`,
    }));
    let dispatched = 0;
    const result = await requestManagedSwaps({
      token, words, level: 2, language: 'fr', batch: reading.passages, keyStore: memoryStorage(),
      fetchImpl: (url, init) => {
        dispatched++;
        return api(new Request(url, init));
      },
    }).catch((error) => error);
    expect(result.category).toBe('request_failed');
    expect(result.partialResults).toEqual({});
    expect(dispatched).toBe(0);
    expect(provider.calls).toHaveLength(0);
    expect(await (await getBalance()).json()).toEqual({ balanceMicros: 1_000_000, reservedMicros: 0 });
  } finally { db.close(); }
});

test('Spanish, Guaraní and generated pack proxy prompts match the shared builder', async () => {
  for (const [language, row, source, gradual] of [
    ['es', windowWord, 'bundled', true], [GUARANI_STARTER, GUARANI_PACK.words[0], 'bundled', false],
    ['fr', { fr: 'fenêtre', en: 'window', hint: 'feh-net' }, 'pack', false],
  ]) {
    const { swap, db, provider } = await setup();
    try {
      const status = gradual ? 'due' : 'active';
      const value = { ...reading, language, gradual, words: [{ fr: row.fr, en: row.en, status, source }], shownToday: [row.fr] };
      expect((await swap(value)).status).toBe(200);
      const body = buildSwapRequest({
        ...value, batch: value.passages, words: [{ ...row, status }], unknownLimit: gradual,
      });
      const { generationConfig: { maxOutputTokens, ...generationConfig }, ...built } = provider.calls[0].request;
      expect(JSON.stringify({ ...built, generationConfig })).toBe(JSON.stringify(body));
      expect(maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    } finally { db.close(); }
  }
});

test('an existing key with a different prompt version returns keyReuse before version validation', async () => {
  const { swap, db, provider } = await setup();
  try {
    expect((await swap()).status).toBe(200);
    const repeat = await swap({ ...reading, promptVersion: '0.99' });
    expect(repeat.status).toBe(422);
    expect(await repeat.json()).toEqual({ error: { category: 'request_failed', keyReuse: true } });
    expect((await swap(reading, { raw: 'null' })).status).toBe(422);
    expect((await swap({ ...reading, promptVersion: '0.99' }, { id: nextKey })).status).toBe(409);
    expect(provider.calls).toHaveLength(1);
  } finally { db.close(); }
});

test('when expiry wins the same timeout classification, the afterwards-learned request ID is still stored', async () => {
  const started = Promise.withResolvers();
  const completion = Promise.withResolvers();
  const { swap, db, reservation, tick, ledger } = await setup({
    outcome() {
      started.resolve();
      return completion.promise;
    },
  });
  try {
    const pending = swap();
    await started.promise;
    const original = reservation();
    tick(STALE_MS + 1);
    expect(ledger.expireStale()).toHaveLength(1);
    completion.resolve({ kind: 'no_response', sent: true, providerRequestId: 'fixture-after-expiry' });
    const late = await pending;
    expect(await late.json()).toEqual({ error: { category: 'request_failed', duplicate: true, charged: true } });
    expect(reservation()).toMatchObject({
      providerRequestId: 'fixture-after-expiry', providerActual: null, reservationId: original.reservationId,
    });
    expect(ledger.reconcileProviderRequest('fixture-after-expiry', 123)).toMatchObject({
      providerActual: 123, costMicros: original.readerWorst, dayKey: original.dayKey,
    });
  } finally { db.close(); }
});

test('conflicting caches and a cache miss both use SQLite rates, markup and output bounds', async () => {
  const authoritative = { ...PRICE_ROWS[0], input: 75, output: 320, modelMaxOutputTokens: 70_000, readerMarkup: 3 };
  const { swap, db, config, provider, reservation } = await setup({ priceRows: [authoritative] });
  const cases = [
    [key, createPricing({ rows: [{ ...authoritative, input: 0, output: 1, readerMarkup: 1, modelMaxOutputTokens: 2048 }] })],
    [nextKey, createPricing({ rows: [] })],
  ];
  try {
    for (const [id, pricing] of cases) {
      const selectedApi = createApi({ ...config, pricing });
      const response = await swap(reading, { id, selectedApi });
      expect(response.status).toBe(200);
      const { costMicros } = await response.json();
      const bytes = serializedRequestBytes(JSON.stringify(provider.calls.at(-1).request));
      const quote = quotePriceRow(authoritative, bytes, MAX_OUTPUT_TOKENS);
      expect(reservation(id)).toMatchObject({
        priceRowId: authoritative.id, readerWorst: quote.readerMicros, providerMax: quote.providerMax,
        providerActual: 267, costMicros: 801,
      });
      expect(costMicros).toBe(801);
    }
    expect(provider.calls).toHaveLength(2);
  } finally { db.close(); }
});

test('settlement caps retail in integer arithmetic and latches exact unrepresentable provider costs', async () => {
  for (const candidatesTokenCount of [2_000_000_000_000_000, 4_000_000_000_000_000]) {
    const tooLargeForLedger = candidatesTokenCount === 4_000_000_000_000_000;
    const { swap, db, reservation, alerts, ledger, getBalance, accountId } = await setup({
      outcome: { ...OUTCOMES.stop, usage: { promptTokenCount: 0, candidatesTokenCount } },
    });
    try {
      const response = await swap();
      expect(response.status).toBe(200);
      const result = await response.json();
      const stored = reservation();
      expect(result.costMicros).toBe(stored.readerWorst);
      expect(stored).toMatchObject({
        state: tooLargeForLedger ? 'provisional' : 'settled',
        providerActual: tooLargeForLedger ? null : 5_000_000_000_000_000,
        providerOverflowMicros: tooLargeForLedger ? '10000000000000000' : null,
        outputTokens: candidatesTokenCount, overage: 1,
      });
      expect(alerts).toEqual([{ reason: 'overage', reservationId: stored.reservationId }]);
      expect((await swap(reading, { id: nextKey })).status).toBe(503);
      expect(await (await getBalance()).json()).toEqual({ balanceMicros: 1_000_000 - stored.readerWorst, reservedMicros: 0 });

      if (tooLargeForLedger) {
        expect(ledger.clearStop('fixture-correction')).toBeTrue();
        expect((await swap(reading, { id: nextKey })).status).toBe(503);
        expect(ledger.reserve(accountId, 0, 0, stored.priceRowId, 2_000_000,
          sha256('fixture after overflow'), sha256('fixture body'))).toBe('STOPPED');
        expect(ledger.reconcile(stored.reservationId, 180)).toMatchObject({
          providerActual: 180, providerOverflowMicros: '10000000000000000', costMicros: stored.readerWorst,
        });
      }
    } finally { db.close(); }
  }
});

test('when the ledger also has no current price the API refuses without taking a claim', async () => {
  const { swap, db, provider, reservation } = await setup({ at: Date.parse('2026-12-29T00:00:00Z') });
  try {
    const response = await swap();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { category: 'managed_unavailable' } });
    expect(reservation()).toBeNull();
    expect(provider.calls).toHaveLength(0);
  } finally { db.close(); }
});

test('E2 retains a provisional hold when a 200 body fails with pre-send metadata', async () => {
  const transport = createProvider({
    baseUrl: 'https://fixture.invalid/models/', credential: 'fixture',
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) { controller.error(Object.assign(new Error('body interrupted'), { sent: false })); },
    })),
  });
  const { swap, db, reservation } = await setup({ provider: transport });
  try {
    expect((await swap()).status).toBe(504);
    expect(reservation()).toMatchObject({ state: 'provisional', providerActual: null, providerRequestId: null });
  } finally { db.close(); }
});

test('deep structured JSON is rejected before hashing or admission', async () => {
  const { swap, db, provider, reservation, ledger, config } = await setup();
  try {
    let lookups = 0;
    const selectedApi = createApi({ ...config, ledger: { ...ledger, lookupClaim(...args) {
      lookups++;
      return ledger.lookupClaim(...args);
    } } });
    const raw = '{"invalid":' + '['.repeat(1000) + '0' + ']'.repeat(1000) + '}';
    const response = await swap(reading, { raw, selectedApi });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { category: 'request_failed' } });
    expect(lookups).toBe(0);
    expect(provider.calls).toHaveLength(0);
    expect(reservation()).toBeNull();
  } finally { db.close(); }
});

test('header and late body IDs both survive missing usage and ambiguous export matches are unattributable', async () => {
  const late = Promise.withResolvers();
  let stream;
  const transport = createProvider({
    baseUrl: 'https://fixture.invalid/models/', credential: 'secret-not-in-response',
    fetchImpl: async () => new Response(new ReadableStream({ start(controller) { stream = controller; } }), {
      headers: { 'x-request-id': 'fixture-header-id' },
    }),
  });
  const { swap, ledger, db, reservation, account } = await setup({
    provider: { call: (args) => transport.call({
      ...args, timeoutMs: 12,
      onLateOutcome(outcome) {
        args.onLateOutcome(outcome);
        late.resolve(outcome);
      },
    }) },
  });
  try {
    expect((await swap()).status).toBe(504);
    const original = reservation();
    expect(original.providerRequestId).toBe('fixture-header-id');
    stream.enqueue(Buffer.from(JSON.stringify({
      responseId: 'fixture-body-id',
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: VALID_TEXT }] } }],
    })));
    stream.close();
    expect(await late.promise).toMatchObject({
      providerRequestIds: ['fixture-header-id', 'fixture-body-id'], usage: null,
    });
    const aliases = db.transaction((tx) =>
      tx.all('SELECT requestId FROM provider_request_ids WHERE reservationId = ? ORDER BY requestId', original.reservationId));
    expect(aliases.map(({ requestId }) => requestId)).toEqual(['fixture-body-id', 'fixture-header-id']);

    const second = ledger.reserve(account(1_000).id, 25, 100, PRICE_ROWS[0].id, 2_000_000,
      sha256('independent request'), sha256('second independent body'));
    ledger.settle(second, 0, null, 'no_usage', { providerRequestId: 'fixture-body-id' });
    expect(ledger.reconcileProviderRequest('fixture-body-id', 80)).toBeNull();
    expect(ledger.getReservation(original.reservationId).providerActual).toBeNull();
    expect(ledger.getReservation(second).providerActual).toBeNull();
    expect(ledger.reconcileProviderRequest('fixture-header-id', 180)).toMatchObject({
      reservationId: original.reservationId, providerActual: 180, costMicros: original.costMicros,
    });
  } finally { db.close(); }
});

test('E2 retries a real busy release and overage settlement by reservation ID', async () => {
  for (const overage of [false, true]) {
    const filename = join(mkdtempSync(join(tmpdir(), 'finalization-')), 'ledger.sqlite');
    const at = Date.parse('2026-11-28T23:58:00Z');
    const store = createSqliteStorage(filename, { busyTimeoutMs: 0 });
    const blocked = Promise.withResolvers();
    const classified = Promise.withResolvers();
    const dispatched = Promise.withResolvers();
    const alarms = [];
    const ledger = createLedger({
      ...store,
      transaction(operation, options) {
        try {
          return store.transaction(operation, options);
        } catch (error) {
          if (error.code === 'SQLITE_BUSY') blocked.resolve();
          throw error;
        }
      },
    }, { now: () => at, onOverage: (event) => alarms.push(event) });
    const writer = new Database(filename);
    try {
      const id = ledger.createAccount(sha256('initial fixture'));
      const token = ledger.rotateToken(id);
      ledger.setEnrolled(id);
      ledger.adjust(id, 1_000_000, 'fixture', 'credit');
      const api = createApi({
        ledger, clientIp: () => '192.0.2.4', ipHashSecret: 'fixture', now: () => at,
        provider: { call() { dispatched.resolve(); return classified.promise; } },
      });
      const pending = api(new Request(base + '/v0/swaps', {
        method: 'POST', body: JSON.stringify(reading),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      }));
      await dispatched.promise;
      const claim = ledger.getIdempotency(id, sha256(key));
      writer.exec('BEGIN IMMEDIATE');
      try {
        classified.resolve(overage
          ? { ...OUTCOMES.stop, usage: { promptTokenCount: 1_000_000, extra: 'fixture reading text' } }
          : OUTCOMES.rateLimit);
        await blocked.promise;
        expect(writer.query('SELECT state FROM reservations WHERE reservationId = ?').get(claim.reservationId).state)
          .toBe('open');
        const receipts = store.finalizations.withSnapshot((pendingReceipts) => pendingReceipts);
        expect(receipts.map(({ reservationId }) => reservationId)).toEqual([claim.reservationId]);
        expect(receipts[0].outcome).not.toContain('fixture reading text');
        expect(receipts[0].outcome).not.toContain(VALID_TEXT);
      } finally {
        writer.exec('ROLLBACK');
      }
      const response = await pending;
      const record = ledger.getReservation(claim.reservationId);
      expect(response.status).toBe(overage ? 200 : 429);
      expect(record).toMatchObject(overage
        ? { state: 'settled', providerActual: 300_000, overage: 1 }
        : { state: 'released', providerActual: 0, costMicros: 0 });
      expect(store.finalizations.withSnapshot((receipts) => receipts)).toEqual([]);
      expect(alarms).toEqual(overage ? [{ reason: 'overage', reservationId: claim.reservationId }] : []);
    } finally {
      writer.close();
      store.close();
    }
  }
}, { timeout: 25_000 });

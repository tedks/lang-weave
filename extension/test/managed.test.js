import { expect, test } from 'bun:test';
import { MAX_REQUEST_CHARS } from '../src/adaptive.js';
import { memoryStorage } from '../src/cache.js';
import { MANAGED_BASE, requestManagedSwaps } from '../src/managed.js';
import { MAX_RETRY_MS, STATUS_CATEGORIES, safeModelStatus } from '../src/quota-status.js';
import { buildSwapRequest, canonicalSwapBody } from '../src/swap-request.js';
import manifest from '../manifest.json';

const token = `lwk_${'a'.repeat(43)}`;
const words = [{ fr: 'la ventana', en: 'the window', hint: 'lah ven-TAH-nah', status: 'active' }];
const batch = [{ id: 'one', text: 'I opened the window and looked out.' }];
const proxyError = (status, category, details) => Response.json({ error: { category, ...details } }, { status });
const success = (passages) => Response.json({ text: JSON.stringify({ passages }), usage: null,
  costMicros: 7, balanceMicros: 1000 });

function fixture(respond, inputs = {}) {
  const calls = [];
  const args = { token, level: 2, language: 'es', words, batch, keyStore: memoryStorage(), ...inputs,
    fetchImpl: async (url, init) => {
      expect(url).toBe(`${MANAGED_BASE}/v0/swaps`);
      const wire = JSON.parse(init.body);
      calls.push({ url, init, wire });
      return respond(wire, calls.length, init);
    } };
  return { calls, run: (changes) => requestManagedSwaps({ ...args, ...changes }) };
}

test('one C1 request uses the fixed model and structured input, and returns only validated swaps', async () => {
  const f = fixture(() => success([{ id: 'one', swaps: [
    { o: 'the window', f: 'la ventana' }, { o: 'looked', f: 'invented' },
  ] }]));
  const oldTimeout = AbortSignal.timeout;
  const timeouts = [];
  AbortSignal.timeout = (ms) => { timeouts.push(ms); return oldTimeout.call(AbortSignal, ms); };
  try {
    const result = await f.run({ model: 'gemini-3.8-flash', batch: [{ ...batch[0], title: 'local title' }] });
    expect(result.model).toBe('gemini-3.5-flash-lite');
    expect(result.results.one.map(({ word }) => word)).toEqual(['la ventana']);
  } finally { AbortSignal.timeout = oldTimeout; }
  expect(timeouts).toEqual([30_000]);
  expect(f.calls).toHaveLength(1);
  const [{ init, wire }] = f.calls;
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit' });
  expect(init.headers).toEqual({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    'Idempotency-Key': expect.stringMatching(/^[0-9a-f]{32}$/) });
  expect(wire).toEqual({ promptVersion: '0.16', model: 'gemini-3.5-flash-lite', level: 2, language: 'es',
    density: 'normal', gradual: false, words: [{ fr: 'la ventana', en: 'the window', status: 'active', source: 'bundled' }],
    shownToday: [], passages: batch });
  expect(init.body).toBe(canonicalSwapBody(wire));
  expect(init.body).not.toContain(token);
});

test('C1 errors preserve bounded diagnostics without invoking a fallback or cooldown retry', async () => {
  const cases = [
    [400, 'request_failed', {}],
    [401, 'managed_unauthorized', {}],
    [402, 'managed_balance', {}],
    [402, 'managed_balance', { dailyCap: true }],
    [409, 'managed_update_required', { ahead: true }],
    [409, 'managed_update_required', { ahead: false }],
    [409, 'request_failed', { duplicate: true, charged: true }],
    [409, 'request_failed', { duplicate: true, charged: false }],
    [429, 'daily_quota', { retryAfterMs: 5000 }],
    [429, 'rate_limit', { retryAfterMs: 1234 }],
    [502, 'request_failed', { blocked: true }],
    [503, 'overloaded', { retryAfterMs: 42 }],
    [503, 'managed_unavailable', {}],
    [504, 'request_failed', {}],
    [413, 'request_failed', { tooLarge: 'body' }],
  ];
  for (const [status, category, details] of cases) {
    const f = fixture(() => proxyError(status, category, { ...details, message: 'untrusted proxy text' }));
    await expect(f.run()).rejects.toMatchObject({ status, category, ...details,
      message: 'Managed reading request failed' });
    expect(STATUS_CATEGORIES.has(category)).toBe(true);
    expect(safeModelStatus({ category, ...details })).toEqual({ category,
      ...(typeof details.ahead === 'boolean' ? { ahead: details.ahead } : {}) });
    expect(f.calls).toHaveLength(1);
  }
  for (const retryAfterMs of [-1, 0, 1.5, MAX_RETRY_MS + 1, '5000']) {
    const f = fixture(() => proxyError(503, 'overloaded', { retryAfterMs }));
    const error = await f.run().catch((reason) => reason);
    expect(error.category).toBe('overloaded');
    expect(error.retryAfterMs).toBeUndefined();
  }
  const unknown = fixture(() => proxyError(502, 'future_error', { blocked: 'false' }));
  const error = await unknown.run().catch((reason) => reason);
  expect(error.category).toBe('request_failed');
  expect(error.blocked).toBeUndefined();
  const timeout = fixture(() => { throw new DOMException('Synthetic timeout', 'TimeoutError'); });
  await expect(timeout.run()).rejects.toMatchObject({ category: 'request_failed' });
  expect(timeout.calls).toHaveLength(1);
  const missing = fixture(() => success([]));
  await expect(missing.run()).rejects.toMatchObject({ category: 'request_failed' });
  expect(missing.calls).toHaveLength(1);
});

test('unchanged canonical requests reuse the 128-bit key for 60 seconds, across worker wakes', async () => {
  let at = 1000;
  const keyStore = memoryStorage();
  const first = fixture(() => success([{ id: 'one', swaps: [] }]), { keyStore, now: () => at });
  await first.run();
  const wake = fixture(() => proxyError(409, 'request_failed', { duplicate: true, charged: true }),
    { keyStore, now: () => at });
  at = 60_999;
  await expect(wake.run()).rejects.toMatchObject({ duplicate: true, charged: true });
  const key = (call) => call.init.headers['Idempotency-Key'];
  expect(key(wake.calls[0])).toBe(key(first.calls[0]));
  at = 61_000;
  await expect(wake.run()).rejects.toMatchObject({ duplicate: true });
  expect(key(wake.calls[1])).not.toBe(key(first.calls[0]));
  await expect(wake.run({ shownToday: ['la ventana'] })).rejects.toMatchObject({ duplicate: true });
  expect(key(wake.calls[2])).not.toBe(key(wake.calls[1]));
  const state = JSON.stringify(await keyStore.getAll());
  for (const secret of [token, batch[0].text, words[0].fr]) expect(state).not.toContain(secret);
});

test('proxy-rejected key reuse renews once with identical bytes', async () => {
  const f = fixture(() => proxyError(422, 'request_failed', { keyReuse: true }));
  await expect(f.run()).rejects.toMatchObject({ keyReuse: true });
  expect(f.calls).toHaveLength(2);
  expect(f.calls[0].init.body).toBe(f.calls[1].init.body);
  expect(f.calls[0].init.headers['Idempotency-Key']).not.toBe(f.calls[1].init.headers['Idempotency-Key']);
});

test('400 tooLarge splits once and keeps successful child results if another child fails', async () => {
  const passages = ['one', 'two', 'three', 'four'].map((id) => ({ ...batch[0], id }));
  const f = fixture((wire, number) => number === 2
    ? success(wire.passages.map(({ id }) => ({ id, swaps: [] })))
    : proxyError(400, 'request_failed', { tooLarge: 'passages' }), { batch: passages });
  await expect(f.run()).rejects.toMatchObject({ status: 400, partialResults: { one: [], two: [] } });
  expect(f.calls.map(({ wire }) => wire.passages.map(({ id }) => id)))
    .toEqual([['one', 'two', 'three', 'four'], ['one', 'two'], ['three', 'four']]);
  expect(new Set(f.calls.map(({ init }) => init.headers['Idempotency-Key'])).size).toBe(3);

  const unsplittable = fixture(() => proxyError(400, 'request_failed'), { batch: passages });
  await expect(unsplittable.run()).rejects.toMatchObject({ status: 400 });
  expect(unsplittable.calls).toHaveLength(1);
});

test('an over-cap singleton is dropped with request_failed and no charge opportunity', async () => {
  const syntheticWords = Array.from({ length: 200 }, (_, i) => ({ fr: `target${i}`.padEnd(80, 'a'),
    en: `source${i}`.padEnd(80, 'a'), status: 'due', personalId: `personal:${i}` }));
  const inputs = { level: 2, language: 'ja', unknownLimit: true, words: syntheticWords, batch };
  expect(JSON.stringify(buildSwapRequest(inputs)).length).toBeGreaterThan(MAX_REQUEST_CHARS);
  const f = fixture(() => { throw new Error('no request may be charged'); }, inputs);
  await expect(f.run()).rejects.toMatchObject({ category: 'request_failed', partialResults: {} });
  expect(f.calls).toHaveLength(0);
});

test('the extension declares no managed proxy host permission', () => {
  expect(manifest.host_permissions).toEqual(['https://generativelanguage.googleapis.com/*']);
  expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
  expect(JSON.stringify(manifest)).not.toContain(new URL(MANAGED_BASE).hostname);
});

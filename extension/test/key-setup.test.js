import { test, expect } from 'bun:test';
import { createSettingsHandlers } from '../src/settings-handlers.js';
import { DAILY_MODEL_CALLS } from '../src/quota.js';
import { localDay } from '../src/hostsource.js';

function fixture(initial = {}) {
  const data = { settings: { model: 'gemini-3.5-flash-lite' }, apiKey: 'synthetic-key',
    keyEpoch: 'old-key', epoch: 'old-revision', modelStatus: { category: 'rate_limit' },
    quotaState: { keyEpoch: 'old-key', cooldowns: {} }, ...initial };
  const store = {
    async get(keys) {
      const names = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
      return structuredClone(Object.fromEntries(names.filter((k) => k in data).map((k) => [k, data[k]])));
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of [keys].flat()) delete data[key]; },
  };
  const serial = () => {
    let chain = Promise.resolve();
    return (fn) => { const next = chain.then(fn); chain = next.catch(() => {}); return next; };
  };
  const locked = serial();
  const realQueue = serial();
  let queued = 0;
  const modelCall = (fn) => { queued++; return realQueue(fn); };
  const cooldown = new Map([['gemini-3.5-flash-lite', Date.now() + 60000]]);
  const cooldownKinds = new Map([['gemini-3.5-flash-lite', 'short']]);
  const worker = { settingsGeneration: 0 };
  const handlers = createSettingsHandlers({ store, cache: {}, locked, modelCall, worker,
    cooldown, cooldownKinds, context: async () => ({}), broadcast: async () => {},
    reviewState: async () => ({}), reviewStatus: async () => ({}), checkUpdate: async () => '' });
  return { data, store, handlers, cooldown, cooldownKinds, worker, get queued() { return queued; } };
}

test('Remove key follows key-change path: both epochs rotate and diagnostic/cooldown state clears', async () => {
  const oldChrome = globalThis.chrome;
  const f = fixture();
  globalThis.chrome = { storage: { local: f.store } };
  try {
    expect(await f.handlers.removeKey()).toEqual({ ok: true });
    expect(f.data.apiKey).toBe('');
    expect(f.data.keyEpoch).not.toBe('old-key');
    expect(f.data.epoch).not.toBe('old-revision');
    expect(f.data.quotaState).toEqual({ keyEpoch: f.data.keyEpoch, cooldowns: {} });
    expect(f.data.modelStatus).toBeNull();
    expect(f.cooldown.size).toBe(0);
    expect(f.cooldownKinds.size).toBe(0);
    expect(f.worker.settingsGeneration).toBe(1);
    const firstEpoch = f.data.keyEpoch;
    await f.handlers.removeKey();
    expect(f.data.keyEpoch).not.toBe(firstEpoch);
  } finally { globalThis.chrome = oldChrome; }
});

test('Test key enters modelCall once, spends one capped call, and never sends page text', async () => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  const f = fixture();
  const requests = [];
  globalThis.chrome = { storage: { local: f.store } };
  globalThis.fetch = async (url, init) => { requests.push({ url, init });
    return { ok: true, status: 200 }; };
  try {
    expect(await f.handlers.testKey()).toEqual({ ok: true, category: 'ok' });
    expect(f.queued).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain(':generateContent');
    expect(requests[0].init.headers['x-goog-api-key']).toBe('synthetic-key');
    expect(requests[0].init.body).toContain('Reply OK.');
    expect(requests[0].init.body).not.toContain('page');
    expect(f.data.modelCalls).toEqual({ day: localDay(), count: 1 });
    f.data.modelCalls.count = DAILY_MODEL_CALLS;
    expect(await f.handlers.testKey()).toEqual({ ok: false, category: 'local_budget' });
    expect(requests).toHaveLength(1);
  } finally { globalThis.chrome = oldChrome; globalThis.fetch = oldFetch; }
});

test('Test key reports rejection with fixed category and a removed key cannot receive stale status', async () => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  const f = fixture();
  globalThis.chrome = { storage: { local: f.store } };
  globalThis.fetch = async () => ({ ok: false, status: 403, headers: { get: () => null },
    text: async () => 'provider secret-key explanation' });
  try {
    expect(await f.handlers.testKey()).toEqual({ ok: false, category: 'key_rejected' });
    expect(f.data.modelStatus).toMatchObject({ category: 'key_rejected' });
    expect(JSON.stringify(f.data.modelStatus)).not.toContain('secret-key');
    let release;
    globalThis.fetch = async () => new Promise((done) => { release = done; });
    const pending = f.handlers.testKey();
    while (!release) await new Promise((done) => setTimeout(done, 0));
    await f.handlers.removeKey();
    release({ ok: false, status: 403, headers: { get: () => null }, text: async () => '' });
    expect(await pending).toEqual({ ok: false, category: 'changed' });
    expect(f.data.modelStatus).toBeNull();
  } finally { globalThis.chrome = oldChrome; globalThis.fetch = oldFetch; }
});

test('Test key respects a default 429 cooldown without a second request', async () => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  const f = fixture();
  let calls = 0;
  globalThis.chrome = { storage: { local: f.store } };
  globalThis.fetch = async () => { calls++; return { ok: false, status: 429,
    headers: { get: () => null }, text: async () => '' }; };
  try {
    expect(await f.handlers.testKey()).toEqual({ ok: false, category: 'rate_limit' });
    expect(f.data.quotaState.cooldowns['gemini-3.5-flash-lite'].kind).toBe('short');
    expect(await f.handlers.testKey()).toEqual({ ok: false, category: 'rate_limit' });
    expect(calls).toBe(1);
    expect(f.data.modelCalls.count).toBe(1);
  } finally { globalThis.chrome = oldChrome; globalThis.fetch = oldFetch; }
});

test('a model change during Test key discards the old model result', async () => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  const f = fixture();
  let release;
  globalThis.chrome = { storage: { local: f.store } };
  globalThis.fetch = async () => new Promise((done) => { release = done; });
  try {
    const pending = f.handlers.testKey();
    while (!release) await new Promise((done) => setTimeout(done, 0));
    await f.handlers.save({ settings: { model: 'gemini-3.8-flash' } });
    release({ ok: true, status: 200 });
    expect(await pending).toEqual({ ok: false, category: 'changed' });
    expect(f.data.modelStatus.category).toBe('rate_limit'); // old status is untouched by stale result
  } finally { globalThis.chrome = oldChrome; globalThis.fetch = oldFetch; }
});

import { test, expect } from 'bun:test';
import { statusLabel } from '../src/quota-status.js';
import { cleanPack } from '../src/languages.js';

async function workerFixture({ isolation, initial = {} }) {
  const oldChrome = globalThis.chrome;
  const oldFetch = globalThis.fetch;
  const data = { settings: { enabled: true, newSitesEnabled: true }, ...initial };
  const writes = [];
  const listeners = [];
  const on = (list = []) => ({ addListener: (fn) => list.push(fn) });
  const store = {
    async get(keys) {
      const names = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
      return structuredClone(Object.fromEntries(names.filter((key) => key in data).map((key) => [key, data[key]])));
    },
    async set(patch) { writes.push(structuredClone(patch)); Object.assign(data, structuredClone(patch)); },
    async remove(keys) { for (const key of [keys].flat()) delete data[key]; },
  };
  let releaseIsolation;
  if (isolation) store.setAccessLevel = async ({ accessLevel }) => {
    expect(accessLevel).toBe('TRUSTED_CONTEXTS');
    if (isolation === 'reject') throw new Error('unsupported');
    if (isolation === 'deferred') await new Promise((done) => { releaseIsolation = done; });
  };
  globalThis.chrome = {
    storage: { local: store },
    runtime: { id: 'isolation-test', getURL: (path) => `chrome-extension://isolation-test/${path}`,
      getManifest: () => ({ version: '0.12.15' }), onMessage: on(listeners),
      onInstalled: on(), onStartup: on() },
    action: { setBadgeText: async () => {} },
    tabs: { query: async () => [], sendMessage: async () => {} },
    permissions: { getAll: async () => ({ origins: [] }), onAdded: on(), onRemoved: on() },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  };
  globalThis.fetch = async (url) => {
    expect(url).toBe('chrome-extension://isolation-test/manifest.json');
    return { ok: true, json: async () => ({ version: '0.12.15' }) };
  };
  await import(`../src/background.js?key-isolation-${isolation}-${crypto.randomUUID()}`);
  const popup = { id: 'isolation-test', url: 'chrome-extension://isolation-test/src/popup.html' };
  const options = { id: 'isolation-test', url: 'chrome-extension://isolation-test/src/options.html' };
  const page = { id: 'isolation-test', tab: { id: 1 }, url: 'https://example.com/article' };
  const dispatch = (msg, sender = popup) => new Promise((done) => {
    if (!listeners.some((listener) => listener(msg, sender, done))) done(undefined);
  });
  return { data, writes, dispatch, popup, options, page,
    releaseIsolation() {
      expect(typeof releaseIsolation).toBe('function');
      releaseIsolation();
    },
    restore() { globalThis.chrome = oldChrome; globalThis.fetch = oldFetch; } };
}

test('missing access-level API refuses key saves, keeps an old key for explicit removal, and shows fixed status', async () => {
  const f = await workerFixture({ isolation: false, initial: { apiKey: 'old-secret' } });
  try {
    const before = await f.dispatch({ type: 'status' });
    expect(before.modelStatus).toEqual({ category: 'key_isolation_unavailable' });
    expect(statusLabel(before.modelStatus)).toBe('This browser cannot keep the key private. Update Chrome to 140 or newer.');
    expect(before.pastedKey).toBe(true); // Remove key remains available.
    expect(before.config.hasKey).toBe(false);
    expect(JSON.stringify(await f.dispatch({ type: 'config' }, f.page))).not.toContain('old-secret');
    expect(await f.dispatch({ type: 'save', apiKey: 'new-secret' }, f.options))
      .toEqual({ error: statusLabel(before.modelStatus) });
    expect(await f.dispatch({ type: 'testKey' }, f.options))
      .toEqual({ ok: false, category: 'key_isolation_unavailable' });
    expect(await f.dispatch({ type: 'save', apiKey: '  ' }, f.options))
      .toEqual({ error: 'Use Remove key to delete the saved key.' });
    expect(f.data.apiKey).toBe('old-secret');
    expect(f.writes.every((patch) => !Object.hasOwn(patch, 'apiKey'))).toBe(true);
    expect(await f.dispatch({ type: 'removeKey' }, f.options)).toEqual({ ok: true });
    expect(f.data.apiKey).toBe('');
  } finally { f.restore(); }
});

test('missing access-level API never migrates a legacy key from settings', async () => {
  const f = await workerFixture({ isolation: false, initial: { settings: { apiKey: 'legacy-secret' } } });
  try {
    const status = await f.dispatch({ type: 'status' });
    expect(status.pastedKey).toBe(true);
    expect(status.config.hasKey).toBe(false);
    expect(f.data.settings.apiKey).toBe('legacy-secret');
    expect(f.data.apiKey).toBeUndefined();
    expect(f.writes.every((patch) => !Object.hasOwn(patch, 'apiKey'))).toBe(true);
    expect(await f.dispatch({ type: 'save', settings: { density: 'heavy' } }, f.options)).toEqual({ ok: true });
    expect(f.data.settings.apiKey).toBe('legacy-secret');
    expect((await f.dispatch({ type: 'status' })).pastedKey).toBe(true);
    expect(await f.dispatch({ type: 'save', consentShown: true,
      settings: { newSitesEnabled: false } }, f.options)).toEqual({ ok: true });
    expect(f.data.settings.apiKey).toBe('legacy-secret');
    expect(await f.dispatch({ type: 'removeKey' }, f.options)).toEqual({ ok: true });
    expect(f.data.settings.apiKey).toBeUndefined();
    expect(f.data.apiKey).toBe('');
    expect((await f.dispatch({ type: 'status' })).pastedKey).toBe(false);
  } finally { f.restore(); }
});

test('removing a generated language does not silently erase a legacy key', async () => {
  const pack = cleanPack({ words: Array.from({ length: 20 }, (_, i) => ({
    fr: `mot${i}`, en: `gloss ${i}`, hint: `sound ${i}`, level: i < 10 ? 1 : 2,
  })) }, 'fr');
  const f = await workerFixture({ isolation: false, initial: {
    settings: { language: 'fr', apiKey: 'legacy-secret' }, languagePacks: { fr: pack },
  } });
  try {
    expect(await f.dispatch({ type: 'removeLanguage', code: 'fr' }, f.options)).toEqual({ ok: true });
    expect(f.data.settings.language).toBe('es');
    expect(f.data.settings.apiKey).toBe('legacy-secret');
    expect(f.data.apiKey).toBeUndefined();
  } finally { f.restore(); }
});

test('rejected access-level request is treated like a missing API', async () => {
  const f = await workerFixture({ isolation: 'reject' });
  try {
    const status = await f.dispatch({ type: 'status' });
    expect(status.modelStatus).toEqual({ category: 'key_isolation_unavailable' });
    expect(await f.dispatch({ type: 'save', apiKey: 'new-secret' }, f.options))
      .toEqual({ error: statusLabel(status.modelStatus) });
    expect(f.data.apiKey).toBeUndefined();
  } finally { f.restore(); }
});

test('a key save arriving during startup waits for the isolation probe', async () => {
  const f = await workerFixture({ isolation: 'deferred' });
  try {
    let settled = false;
    const pending = f.dispatch({ type: 'save', apiKey: 'new-secret' }, f.options);
    pending.then(() => { settled = true; });
    await new Promise((done) => setTimeout(done, 0));
    expect(settled).toBe(false);
    f.releaseIsolation();
    expect(await pending).toEqual({ ok: true });
    expect(f.data.apiKey).toBe('new-secret');
  } finally { f.restore(); }
});

test('available access-level API preserves key save and active context', async () => {
  const f = await workerFixture({ isolation: true });
  try {
    expect(await f.dispatch({ type: 'save', apiKey: 'new-secret' }, f.options)).toEqual({ ok: true });
    const status = await f.dispatch({ type: 'status' });
    expect(status.pastedKey).toBe(true);
    expect(status.config.hasKey).toBe(true);
    expect(status.modelStatus).toBeNull();
    expect(f.data.apiKey).toBe('new-secret');
    expect(JSON.stringify(status)).not.toContain('new-secret');
  } finally { f.restore(); }
});

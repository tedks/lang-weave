import { test, expect } from 'bun:test';
import { hashKey } from '../src/hash.js';

// A popup pause takes effect before the next model request; legacy French host state has no authority.
test('popup pause gates Gemini immediately and resume rejects stale requests without native messaging', async () => {
  const saved = Object.fromEntries(['chrome', 'fetch'].map((k) => [k, globalThis[k]]));
  const data = { settings: { enabled: true, newSitesEnabled: true }, apiKey: 'synthetic-key',
    hostKey: 'foreign-key', wordState: { paused: true, words: [{ fr: 'et', en: 'and', status: 'active' }] } };
  const listeners = [];
  const on = (arr = []) => ({ addListener: (fn) => arr.push(fn) });
  let nativeCalls = 0;
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        const pick = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
        return structuredClone(Object.fromEntries(pick.filter((k) => k in data).map((k) => [k, data[k]])));
      },
      async set(values) { for (const [k, v] of Object.entries(values)) data[k] = structuredClone(v); },
      async remove(keys) { for (const k of keys) delete data[k]; },
    } },
    runtime: {
      id: 'fw-test', getURL: (path) => `chrome-extension://fw-test/${path}`, getManifest: () => ({ version: '0.3.0' }),
      onMessage: on(listeners), onInstalled: on(), onStartup: on(),
      sendNativeMessage: async () => { nativeCalls++; throw new Error('native host must never be called'); },
    },
    action: { setBadgeText: async () => {} },
    tabs: { get: async () => ({ id: 1, title: 'Ordinary reading' }), query: async () => [], sendMessage: async () => {} },
    alarms: { create: async () => {}, onAlarm: on() },
    permissions: { getAll: async () => ({ origins: ['<all_urls>'] }), onAdded: on(), onRemoved: on() },
    scripting: { getRegisteredContentScripts: async () => [], updateContentScripts: async () => {},
      unregisterContentScripts: async () => {}, registerContentScripts: async () => {} },
  };
  let geminiCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('manifest.json')) return { ok: true, json: async () => ({ version: '0.3.0' }) };
    geminiCalls++;
    expect(init.headers['x-goog-api-key']).toBe('synthetic-key');
    const items = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
    const passages = items.map(({ id }) => ({ id, swaps: [{ o: 'and', f: 'y', ctx: '' }] }));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] }) };
  };
  const dispatch = (msg, sender) => new Promise((done) => { if (!listeners.some((fn) => fn(msg, sender, done))) done(undefined); });
  const popup = { id: 'fw-test', url: 'chrome-extension://fw-test/src/popup.html' };
  const page = { id: 'fw-test', tab: { id: 1 }, url: 'https://example.com/article' };
  const ask = (text, revision) => dispatch({ type: 'swaps', revision,
    items: [{ key: `${revision}:${hashKey(text)}`, text }] }, page);
  try {
    await import('../src/background.js?pause');
    const before = await dispatch({ type: 'config' }, page);
    expect(before.paused).toBe(false);
    expect(before.hasKey).toBe(true);
    expect((await ask('Cats and dogs sleep all day long here.', before.revision)).results).toBeDefined();
    expect(geminiCalls).toBe(1);

    expect(await dispatch({ type: 'save', settings: { enabled: false } }, popup)).toEqual({ ok: true });
    const paused = await dispatch({ type: 'config' }, page);
    expect(paused.settings.enabled).toBe(false);
    expect(paused.paused).toBe(false); // wire compatibility; enabled is the pause switch
    expect(paused.revision).not.toBe(before.revision);
    expect((await ask('Birds and bees fly over the garden now.', before.revision)).stale).toBe(true);
    expect((await ask('Fish and frogs swim in the old pond.', paused.revision)).stale).toBe(true);
    expect(geminiCalls).toBe(1);

    expect(await dispatch({ type: 'save', settings: { enabled: true } }, popup)).toEqual({ ok: true });
    const resumed = await dispatch({ type: 'config' }, page);
    expect(resumed.settings.enabled).toBe(true);
    expect((await ask('Mice and rats run under the floor today.', paused.revision)).stale).toBe(true);
    expect((await ask('Mice and rats run under the floor today.', resumed.revision)).results).toBeDefined();
    expect(geminiCalls).toBe(2);
    expect(data.hostKey).toBe('foreign-key');
    expect(data.wordState.words[0].fr).toBe('et');
    expect(nativeCalls).toBe(0);
  } finally {
    Object.assign(globalThis, saved);
  }
}, 30000);

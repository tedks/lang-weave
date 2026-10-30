import { test, expect } from 'bun:test';

test('the first routed message waits for registration and retries a transient startup failure', async () => {
  const previous = Object.fromEntries(['chrome', 'fetch'].map((name) => [name, globalThis[name]]));
  const data = { settings: { enabled: true, newSitesEnabled: true }, apiKey: 'synthetic-key' };
  const listeners = [];
  const on = (handlers = []) => ({ addListener: (handler) => handlers.push(handler) });
  let releaseRegistration;
  const heldRegistration = new Promise((done) => { releaseRegistration = done; });
  let registrationStarted = false;
  let registrationFinished = false;
  let registrationAttempts = 0;
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        const selected = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
        return structuredClone(Object.fromEntries(selected.filter((key) => key in data).map((key) => [key, data[key]])));
      },
      async set(values) { Object.assign(data, structuredClone(values)); },
      async remove(keys) { for (const key of [keys].flat()) delete data[key]; },
    } },
    runtime: { id: 'startup-test', getURL: (path) => `chrome-extension://startup-test/${path}`,
      getManifest: () => ({ version: '0.12.11' }), onMessage: on(listeners), onInstalled: on(),
      onStartup: on(), onConnect: on() },
    action: { setBadgeText: async () => {} },
    tabs: { get: async () => ({ id: 1, url: 'https://example.com/article', title: 'Ordinary reading' }),
      query: async () => [], sendMessage: async () => {} },
    permissions: { getAll: async () => ({ origins: ['https://example.com/*'] }), onAdded: on(), onRemoved: on() },
    scripting: { getRegisteredContentScripts: async () => [],
      registerContentScripts: async () => {
        registrationStarted = true;
        registrationAttempts++;
        if (registrationAttempts === 1) {
          await heldRegistration;
          throw new Error('temporary registration failure');
        }
        registrationFinished = true;
      }, updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: '0.12.11' }) });
  const tick = () => new Promise((done) => setTimeout(done, 0));
  try {
    await import('../src/background.js?startup-registration');
    for (let i = 0; i < 50 && !registrationStarted; i++) await tick();
    expect(registrationStarted).toBe(true);
    let answered = false;
    const reply = new Promise((done) => {
      const sender = { id: 'startup-test', tab: { id: 1 }, url: 'https://example.com/article' };
      expect(listeners.some((listener) => listener({ type: 'config' }, sender, (value) => {
        answered = true; done(value);
      }))).toBe(true);
    });
    await tick();
    expect(answered).toBe(false); // a held registration cannot be outrun by the first reply
    releaseRegistration();
    expect((await reply).revision).toBeString();
    expect(registrationFinished).toBe(true);
    expect(registrationAttempts).toBe(2);
  } finally {
    releaseRegistration();
    Object.assign(globalThis, previous);
  }
}, 30000);

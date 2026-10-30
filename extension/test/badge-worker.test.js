import { test, expect } from 'bun:test';

test('worker refreshes tab-local badge on activation, URL, settings, grant, quota and NEW', async () => {
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const events = {};
  const on = (name) => ({ addListener(fn) { (events[name] ||= []).push(fn); } });
  const fire = (name, ...args) => { for (const fn of events[name] || []) fn(...args); };
  const tabs = new Map([[1, { id: 1, url: 'https://example.com/article' }],
    [2, { id: 2, url: 'https://other.example/article' }]]);
  const data = { settings: { enabled: true, newSitesEnabled: true } };
  const appearances = new Map();
  let origins = [];
  let diskVersion = '0.12.8';
  const manifest = { version: '0.12.8' };
  const extensionUrl = (path) => `chrome-extension://badge-test/${path}`;
  const storage = {
    async setAccessLevel() {},
    async get(keys) {
      const chosen = keys == null ? Object.keys(data) : [keys].flat();
      return structuredClone(Object.fromEntries(chosen.filter((key) => key in data).map((key) => [key, data[key]])));
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of [keys].flat()) delete data[key]; },
  };
  globalThis.chrome = {
    runtime: { id: 'badge-test', getURL: extensionUrl, getManifest: () => manifest,
      reload() { throw new Error('synthetic reload failure'); },
      onMessage: on('message'), onInstalled: on('installed'), onStartup: on('startup'), onConnect: on('connect') },
    storage: { local: storage, onChanged: on('storage') },
    action: {
      async setBadgeText({ tabId, text }) { appearances.set(tabId, { ...appearances.get(tabId), text }); },
      async setBadgeBackgroundColor({ tabId, color }) { appearances.set(tabId, { ...appearances.get(tabId), color }); },
      async setBadgeTextColor({ tabId, color }) { appearances.set(tabId, { ...appearances.get(tabId), textColor: color }); },
      async setTitle({ tabId, title }) { appearances.set(tabId, { ...appearances.get(tabId), title }); },
    },
    tabs: { get: async (id) => tabs.get(id), query: async () => [...tabs.values()],
      sendMessage: async () => {} , onActivated: on('activated'), onUpdated: on('updated'), onRemoved: on('removed') },
    permissions: { getAll: async () => ({ origins }), onAdded: on('added'), onRemoved: on('permissionRemoved') },
    alarms: { create() {}, onAlarm: on('alarm') },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    contextMenus: { onClicked: on('clicked'), create() {} },
  };
  globalThis.fetch = async (url) => {
    if (url !== extensionUrl('manifest.json')) throw new Error('unexpected network request');
    return { json: async () => ({ version: diskVersion }) };
  };
  const until = async (condition) => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise((done) => setTimeout(done, 5));
    }
    throw new Error(`badge did not settle: ${JSON.stringify([...appearances])}`);
  };
  try {
    await import('../src/background.js?badge-worker');
    await until(() => appearances.get(1)?.text === '!');
    expect(appearances.get(1).title).toBe('Add your Gemini key');
    data.apiKey = 'synthetic-key';
    fire('storage', { apiKey: { newValue: 'synthetic-key' } }, 'local');
    await until(() => appearances.get(1)?.text === '•');
    expect(appearances.get(1).title).toBe('Click to turn on here');
    origins = ['https://example.com/*'];
    fire('added', { origins });
    await until(() => appearances.get(1)?.text === '');
    expect(appearances.get(2).text).toBe('•');
    origins = [];
    fire('permissionRemoved', { origins: ['https://example.com/*'] });
    await until(() => appearances.get(1)?.text === '•');
    origins = ['https://example.com/*'];
    fire('added', { origins });
    await until(() => appearances.get(1)?.text === '');
    tabs.set(1, { id: 1, url: 'https://mail.google.com/inbox' });
    fire('updated', 1, { url: tabs.get(1).url });
    await until(() => appearances.get(1)?.title === 'Off on sensitive sites; click to turn on here');
    data.settings.enabled = false;
    fire('storage', { settings: { newValue: data.settings } }, 'local');
    await until(() => appearances.get(1)?.title === 'Lang Weave is paused; click to turn it on');
    data.settings.enabled = true;
    tabs.set(1, { id: 1, url: 'https://example.com/article' });
    fire('updated', 1, { url: tabs.get(1).url });
    fire('storage', { settings: { newValue: data.settings } }, 'local');
    await until(() => appearances.get(1)?.text === '');
    const now = Date.now();
    data.modelStatus = { category: 'daily_quota', at: now };
    data.quotaState = { keyEpoch: data.keyEpoch, cooldowns: { 'gemini-3.5-flash-lite': {
      kind: 'daily', setAt: now, durationMs: 60000, until: now + 60000,
    } } };
    fire('storage', { modelStatus: { newValue: data.modelStatus }, quotaState: { newValue: data.quotaState } }, 'local');
    await until(() => appearances.get(1)?.title?.startsWith('Paused until '));
    expect(appearances.get(1).title).toContain('review still works');
    fire('activated', { tabId: 2 });
    await until(() => appearances.get(2)?.text === '•');
    tabs.set(2, { id: 2 }); // Chrome withholds URL and change.url on an ungranted navigation
    fire('updated', 2, { status: 'loading' });
    await until(() => appearances.get(2)?.title === 'Open Lang Weave to check this page');
    diskVersion = '0.12.9';
    fire('alarm', { name: 'updates' });
    await until(() => appearances.get(1)?.text === 'NEW' && appearances.get(2)?.text === 'NEW');
    expect(appearances.get(1).title).toBe('New Lang Weave version available; reload the extension');
    expect(appearances.get(1).textColor).toBe('#ffffff');
  } finally {
    globalThis.chrome = saved.chrome;
    globalThis.fetch = saved.fetch;
  }
}, 30000);

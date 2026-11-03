// Gradual learning starts on, at five new words a day, only for a truly new profile
// (gradual-default-on-install-ruling): no settings object at worker startup, written in that same first
// settings write. Every opt-in case is paired with the nearest case that must stay unchanged.
import { expect, test } from 'bun:test';
import { DEFAULT_SETTINGS, FRESH_INSTALL_SETTINGS } from '../src/settings.js';
import { hashKey } from '../src/hash.js';

const id = 'fw-install';
const welcome = { id, url: `chrome-extension://${id}/src/welcome.html` };
const options = { id, url: `chrome-extension://${id}/src/options.html` };
const backupPage = { id, url: `chrome-extension://${id}/src/backup.html`, documentId: 'backup-document', tab: { id: 10 } };
// A live top-frame document: gradual reading refuses any other sender before it reaches consent.
const page = { id, url: 'https://reading.example/article', frameId: 0, documentId: 'doc-1', tab: { id: 7, title: 'Reading' } };
const pageId = '33333333-3333-4333-8333-333333333333';
const event = () => { const listeners = []; return { listeners, addListener(fn) { listeners.push(fn); } }; };
const tick = () => new Promise((done) => setTimeout(done, 0));
let loads = 0;

function worker(data, { origins = [] } = {}) {
  const message = event(), installed = event(), connect = event();
  const opened = [];
  const state = { fetches: 0, settingsWrites: 0 };
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        const names = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
        return structuredClone(Object.fromEntries(names.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]])));
      },
      async set(values) { if (Object.hasOwn(values, 'settings')) state.settingsWrites++; Object.assign(data, structuredClone(values)); },
      async remove(keys) { for (const key of [keys].flat()) delete data[key]; },
    } },
    runtime: { id, getURL: (path) => `chrome-extension://${id}/${path}`, getManifest: () => ({ version: '0.12.24' }),
      onMessage: message, onInstalled: installed, onStartup: event(), onConnect: connect },
    tabs: { get: async () => ({ id: 7, title: 'Reading', url: page.url }), query: async () => [],
      sendMessage: async () => {}, create: async (tab) => { opened.push(tab.url); }, onRemoved: event() },
    permissions: { getAll: async () => ({ origins, permissions: [] }), onAdded: event(), onRemoved: event() },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    action: { setBadgeText: async () => {} }, alarms: { create: async () => {}, onAlarm: event() },
    contextMenus: { removeAll(callback) { callback?.(); }, create() {}, onClicked: event() },
  };
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('chrome-extension://')) return { ok: true, json: async () => ({ version: '0.12.24' }) };
    state.fetches++;
    const items = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      passages: items.map(({ id: key }) => ({ id: key, swaps: [{ o: 'and', f: 'y', g: 'and', h: '', ctx: '' }] })),
    }) }] } }] }) };
  };
  const send = (msg, sender) => new Promise((resolve) => {
    if (!message.listeners.some((fn) => fn(msg, sender, resolve))) resolve(undefined);
  });
  // Fire one onInstalled event to every listener, then let any async work it starts settle.
  const install = async (details) => {
    for (const fn of installed.listeners) fn(details);
    for (let i = 0; i < 50; i++) await tick();
  };
  const openBackup = () => {
    const onMessage = event(), onDisconnect = event(), replies = [];
    connect.listeners[0]({ name: 'learning-backup-page', sender: backupPage, onMessage, onDisconnect,
      postMessage(value) { replies.push(value); } });
    onMessage.listeners[0]({ pageId });
    expect(replies).toEqual([{ ready: true, pageId }]);
  };
  const load = async () => {
    await import(`../src/background.js?install-defaults-${++loads}`);
    await send({ type: 'status' }, options); // routed handlers run only after startup is ready
  };
  return { data, state, opened, send, install, load, openBackup };
}

async function isolated(fn) {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  try { await fn(); } finally { globalThis.chrome = old.chrome; globalThis.fetch = old.fetch; }
}

test('the shared default stays off, so cleanSettings never opts a stored profile in', () => {
  expect(DEFAULT_SETTINGS.gradual).toBe(false);
  expect(DEFAULT_SETTINGS.newWordsPerDay).toBe(5);
  expect(FRESH_INSTALL_SETTINGS).toEqual({ gradual: true, newWordsPerDay: 5 });
});

test('a new profile starts with gradual on at five words in its first settings write', () => isolated(async () => {
  for (const data of [{}, { apiKey: 'synthetic-key' }]) { // other keys but no settings object is still new
    const fresh = worker(structuredClone(data));
    await fresh.load();
    expect(fresh.data.settings).toMatchObject({ gradual: true, newWordsPerDay: 5 });
    expect(fresh.data.consentShown).toBe(false); // gradual is not a privacy choice
    expect(fresh.state.settingsWrites).toBe(1); // one atomic startup write, nothing left to race
    await fresh.install({ reason: 'install' });
    expect(fresh.opened).toEqual([`chrome-extension://${id}/src/welcome.html`]);
    expect(fresh.state.settingsWrites).toBe(1);
  }
}));

test('a stored settings object of any shape is never opted in, on install, update or plain startup', () => isolated(async () => {
  // Missing fields (an older profile), an explicit off with its own pace, an empty object, and an explicit on.
  const cases = [[{ enabled: true, language: 'es' }, false, 5], [{ gradual: false, newWordsPerDay: 3 }, false, 3],
    [{}, false, 5], [{ gradual: true, newWordsPerDay: 8 }, true, 8]];
  for (const reason of ['install', 'update', 'chrome_update', undefined]) {
    for (const [settings, gradual, pace] of cases) {
      const existing = worker({ settings: structuredClone(settings) });
      await existing.load();
      if (reason) await existing.install({ reason }); else for (let i = 0; i < 50; i++) await tick();
      expect(existing.data.settings).toMatchObject({ gradual, newWordsPerDay: pace });
      expect(existing.data.consentShown).toBeUndefined();
    }
  }
}));

test('a choice written after startup is never reset by the install event', () => isolated(async () => {
  // A page or harness can write settings before Chrome delivers onInstalled; nothing may restore defaults.
  const fresh = worker({});
  await fresh.load();
  expect(await fresh.send({ type: 'save', settings: { gradual: false, newWordsPerDay: 1 } }, options)).toEqual({ ok: true });
  await fresh.install({ reason: 'install' });
  expect(fresh.data.settings).toMatchObject({ gradual: false, newWordsPerDay: 1 });
  // The welcome page's site choice merges with the new profile's defaults.
  const other = worker({});
  await other.load();
  expect(await other.send({ type: 'save', consentShown: true, settings: { newSitesEnabled: false } }, welcome)).toEqual({ ok: true });
  expect(other.data.settings).toMatchObject({ gradual: true, newWordsPerDay: 5, newSitesEnabled: false });
  expect(other.data.consentShown).toBe(true);
}));

test('gradual on does not let a new profile reach Gemini before the welcome choice', () => isolated(async () => {
  const fresh = worker({ apiKey: 'synthetic-key' }, { origins: ['https://reading.example/*'] }); // no settings: new
  await fresh.load();
  await fresh.install({ reason: 'install' });
  expect(fresh.data.settings.gradual).toBe(true);
  const passage = 'We read books and enjoy quiet evenings every week.';
  const request = async () => { const { revision } = await fresh.send({ type: 'config' }, page);
    return fresh.send({ type: 'swaps', revision, items: [{ text: passage, key: `${revision}:${hashKey(passage)}` }] }, page); };
  expect((await request()).error).toContain('Choose site access');
  expect(fresh.state.fetches).toBe(0);
  expect(await fresh.send({ type: 'save', consentShown: true, settings: { newSitesEnabled: true } }, welcome)).toEqual({ ok: true });
  expect((await request()).results).toBeDefined();
  expect(fresh.state.fetches).toBe(1);
}));

async function exportedBackup(settings) {
  const source = worker({ settings });
  await source.load();
  source.openBackup();
  const { json } = await source.send({ type: 'learningExport' }, backupPage);
  expect(json).toContain('lang-weave-learning-backup');
  return json;
}

test('a new profile with gradual on is still an import target, and the backup restores its own choice', () => isolated(async () => {
  const json = await exportedBackup({ language: 'es', gradual: false, newWordsPerDay: 3 });
  const target = worker({});
  await target.load();
  await target.install({ reason: 'install' });
  expect(target.data.settings).toMatchObject({ gradual: true, newWordsPerDay: 5 });
  target.openBackup();
  const preview = await target.send({ type: 'learningPreview', json, pageId }, backupPage);
  expect(preview.error).toBeUndefined();
  expect(preview.preview.preferences).toMatchObject({ gradual: false, newWordsPerDay: 3 });
  expect(await target.send({ type: 'learningImport', token: preview.token, pageId }, backupPage)).toEqual({ ok: true });
  expect(target.data.settings).toMatchObject({ gradual: false, newWordsPerDay: 3 });
}));

test('a gradual change between preview and import makes the preview stale', () => isolated(async () => {
  const json = await exportedBackup({ language: 'es', gradual: true, newWordsPerDay: 2 });
  const target = worker({});
  await target.load();
  target.openBackup();
  const preview = await target.send({ type: 'learningPreview', json, pageId }, backupPage);
  expect(preview.error).toBeUndefined();
  expect(await target.send({ type: 'save', settings: { gradual: false } }, options)).toEqual({ ok: true });
  const result = await target.send({ type: 'learningImport', token: preview.token, pageId }, backupPage);
  expect(result.error).toMatch(/Preview again|Preview expired/);
  expect(target.data.settings).toMatchObject({ gradual: false, newWordsPerDay: 5 });
  const again = await target.send({ type: 'learningPreview', json, pageId }, backupPage);
  expect(await target.send({ type: 'learningImport', token: again.token, pageId }, backupPage)).toEqual({ ok: true });
  expect(target.data.settings).toMatchObject({ gradual: true, newWordsPerDay: 2 });
}));

// Gradual learning starts on, at five new words a day, only for a truly fresh install
// (gradual-default-on-install-ruling): Chrome's install event AND no settings object at worker startup.
// Every opt-in case is paired with the nearest case that must stay unchanged.
import { expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '../src/settings.js';
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
  // Fire one onInstalled event to every listener, then let the async install write settle.
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
});

test('a fresh install turns gradual on at five words; the same empty profile without an install event stays off', () => isolated(async () => {
  const fresh = worker({});
  await fresh.load();
  expect(fresh.data.settings.gradual).toBe(false); // startup alone writes the shared defaults
  expect(fresh.data.consentShown).toBe(false);
  await fresh.install({ reason: 'install' });
  expect(fresh.data.settings).toMatchObject({ gradual: true, newWordsPerDay: 5 });
  expect(fresh.data.consentShown).toBe(false); // gradual is not a privacy choice
  expect(fresh.opened).toEqual([`chrome-extension://${id}/src/welcome.html`]);

  for (const reason of ['update', 'chrome_update', 'shared_module_update', undefined]) {
    const empty = worker({});
    await empty.load();
    await empty.install({ reason });
    expect(empty.data.settings.gradual).toBe(false);
    expect(empty.opened).toEqual([]);
  }
  const noEvent = worker({});
  await noEvent.load();
  for (let i = 0; i < 50; i++) await tick();
  expect(noEvent.data.settings.gradual).toBe(false);
}));

test('an install event over any stored settings object changes nothing', () => isolated(async () => {
  // Missing fields (an older profile), an explicit off with its own pace, and an empty object.
  for (const settings of [{ enabled: true, language: 'es' }, { gradual: false, newWordsPerDay: 3 }, {}]) {
    const existing = worker({ settings: structuredClone(settings) });
    await existing.load();
    const before = structuredClone(existing.data.settings);
    const writes = existing.state.settingsWrites;
    await existing.install({ reason: 'install' });
    expect(existing.data.settings).toEqual(before);
    expect(existing.data.settings.gradual).toBe(false);
    expect(existing.state.settingsWrites).toBe(writes);
  }
  // An update keeps an explicit on and its pace, and never resets them to the install values.
  const on = worker({ settings: { gradual: true, newWordsPerDay: 8 } });
  await on.load();
  await on.install({ reason: 'update' });
  expect(on.data.settings).toMatchObject({ gradual: true, newWordsPerDay: 8 });
}));

test('the install write is one-shot and merges with a welcome choice instead of replacing it', () => isolated(async () => {
  const fresh = worker({});
  await fresh.load();
  // The welcome page's site choice lands before the install handler runs.
  expect(await fresh.send({ type: 'save', consentShown: true, settings: { newSitesEnabled: false } }, welcome)).toEqual({ ok: true });
  await fresh.install({ reason: 'install' });
  expect(fresh.data.settings).toMatchObject({ gradual: true, newWordsPerDay: 5, newSitesEnabled: false });
  expect(fresh.data.consentShown).toBe(true);
  // The user turns it off; a repeated install event in the same worker must not turn it back on.
  expect(await fresh.send({ type: 'save', settings: { gradual: false } }, options)).toEqual({ ok: true });
  await fresh.install({ reason: 'install' });
  expect(fresh.data.settings.gradual).toBe(false);
}));

test('gradual on does not let a fresh install reach Gemini before the welcome choice', () => isolated(async () => {
  const fresh = worker({ apiKey: 'synthetic-key' }, { origins: ['https://reading.example/*'] }); // no settings: fresh
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

test('a fresh install with gradual on is still an import target, and the backup restores its own choice', () => isolated(async () => {
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

test('an import previewed before the install write lands is refused as stale', () => isolated(async () => {
  const json = await exportedBackup({ language: 'es', gradual: false, newWordsPerDay: 3 });
  const target = worker({});
  await target.load();
  target.openBackup();
  const preview = await target.send({ type: 'learningPreview', json, pageId }, backupPage);
  expect(preview.error).toBeUndefined();
  await target.install({ reason: 'install' });
  expect(target.data.settings.gradual).toBe(true);
  const result = await target.send({ type: 'learningImport', token: preview.token, pageId }, backupPage);
  expect(result.error).toMatch(/Preview again|Preview expired/);
  expect(target.data.settings).toMatchObject({ gradual: true, newWordsPerDay: 5 });
  // A new preview of the same file then imports it.
  const again = await target.send({ type: 'learningPreview', json, pageId }, backupPage);
  expect(await target.send({ type: 'learningImport', token: again.token, pageId }, backupPage)).toEqual({ ok: true });
  expect(target.data.settings).toMatchObject({ gradual: false, newWordsPerDay: 3 });
}));

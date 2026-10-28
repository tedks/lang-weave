import { expect, test } from 'bun:test';
import { localDay } from '../src/events.js';

const id = 'fw-backup';
const sender = { id, url: `chrome-extension://${id}/src/backup.html`, documentId: 'backup-document', tab: { id: 10 } };
const popup = { id, url: `chrome-extension://${id}/src/popup.html` };
const pageId = '22222222-2222-4222-8222-222222222222';
const event = () => { const listeners = []; return { listeners, addListener(fn) { listeners.push(fn); } }; };
function setup(data, suffix) {
  const message = event(), connect = event(), added = event(), removed = event();
  const writes = [];
  let origins = [], failPatch = false, partialPatch = false, holdRead = false,
    holdCommittingRead = false, releaseRead, readStarted;
  const chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        if (keys === null && (holdRead || holdCommittingRead && data.learningImportJournalV1?.phase === 'committing')) {
          holdRead = false;
          holdCommittingRead = false;
          readStarted?.();
          await new Promise((resolve) => { releaseRead = resolve; });
        }
        const names = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
        return structuredClone(Object.fromEntries(names.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]])));
      },
      async set(values) {
        if (failPatch && Object.hasOwn(values, 'recallReview')) {
          failPatch = false;
          if (partialPatch) data.settings = structuredClone(values.settings);
          throw new Error('simulated partial storage failure');
        }
        writes.push(Object.keys(values));
        Object.assign(data, structuredClone(values));
      },
      async remove(keys) { for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key]; },
    } },
    runtime: { id, getURL: (path) => `chrome-extension://${id}/${path}`,
      getManifest: () => ({ version: '0.11.0' }), onMessage: message, onConnect: connect,
      onInstalled: event(), onStartup: event() },
    permissions: { async getAll() { return { origins, permissions: [] }; }, onAdded: added, onRemoved: removed },
    tabs: { async query() { return []; }, async get() { return { id: 10, title: 'Backup', url: sender.url }; },
      async sendMessage() {} },
    scripting: { async getRegisteredContentScripts() { return []; }, async registerContentScripts() {},
      async updateContentScripts() {}, async unregisterContentScripts() {} },
    action: { async setBadgeText() {} }, alarms: { create() {}, onAlarm: event() },
    contextMenus: { removeAll(callback) { callback(); }, create() {}, onClicked: event() },
  };
  globalThis.chrome = chrome;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('chrome-extension://')) return { ok: true, json: async () => ({ version: '0.11.0' }) };
    throw new Error('Import must not call a provider');
  };
  const load = () => import(`../src/background.js?portability-worker-${suffix}`);
  const dispatch = (msg, owner = sender) => new Promise((resolve) => {
    if (!message.listeners.some((fn) => fn(msg, owner, resolve))) resolve(undefined);
  });
  const openPage = (owner = sender) => {
    const onMessage = event(), onDisconnect = event(), replies = [];
    const port = { name: 'learning-backup-page', sender: owner, onMessage, onDisconnect,
      postMessage(value) { replies.push(value); } };
    connect.listeners[0](port);
    onMessage.listeners[0]({ pageId });
    expect(replies).toEqual([{ ready: true, pageId }]);
    return { invalidate() { onMessage.listeners[0]({ pageId, invalidate: true }); },
      disconnect() { onDisconnect.listeners[0](); } };
  };
  return { data, writes, load, dispatch, openPage, added, removed,
    setOrigins(value) { origins = value; },
    failNextPatch(partial = false) { failPatch = true; partialPatch = partial; },
    holdNextRead() { holdRead = true; return new Promise((resolve) => { readStarted = resolve; }); },
    holdCommitRead() { holdCommittingRead = true; return new Promise((resolve) => { readStarted = resolve; }); },
    releaseRead() { releaseRead(); },
  };
}

test('worker export, validated preview and import preserve consent, reject conflict and repeat read-only', async () => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  try {
    const old = setup({ settings: { language: 'es', levelOverride: 2, gradual: true,
      newWordsPerDay: 2, density: 'heavy', inlineRecall: true, enabled: false,
      newSitesEnabled: true, siteOverrides: { 'source.example': true } },
    apiKey: 'secret-source-key', 'c:source-url': { s: 'https://source.example/story' },
    recallReview: { version: 1, cards: { y: { due: 2000, interval: 0, reviews: 1,
      introducedDay: localDay(), introReceipt: { ticket: 'secret-ticket' } } },
      current: { word: 'y', ticket: 'secret-reveal', revealed: true }, inline: null,
      learning: { day: localDay(), count: 1, pending: [{ ownerKey: 'secret-owner' }] } },
    }, 'old');
    await old.load();
    old.openPage();
    const exported = await old.dispatch({ type: 'learningExport' });
    expect(exported.json).toContain('lang-weave-learning-backup');
    expect(exported.json).not.toContain('secret-source-key');
    expect(exported.json).not.toContain('source.example');
    expect(exported.json).not.toContain('secret-ticket');
    expect(old.data.recallReview.current.ticket).toBe('secret-reveal');

    const target = setup({ settings: { language: 'es', levelOverride: 0, gradual: false,
      newWordsPerDay: 5, density: 'normal', inlineRecall: false, enabled: false,
      newSitesEnabled: false, siteOverrides: { 'target.example': false } },
      keyEpoch: 'target-secret-epoch' }, 'new');
    await target.load();
    target.openPage();
    const preview = await target.dispatch({ type: 'learningPreview', json: exported.json, pageId });
    expect(preview.preview).toMatchObject({ exportedByVersion: '0.11.0', cards: 1,
      preferences: { language: 'es', gradual: true } });
    expect(target.data.recallReview).toBeUndefined();
    const imported = await target.dispatch({ type: 'learningImport', token: preview.token, pageId });
    expect(imported).toEqual({ ok: true });
    expect(target.data.settings.enabled).toBe(false);
    expect(target.data.settings.newSitesEnabled).toBe(false);
    expect(target.data.settings.siteOverrides).toEqual({ 'target.example': false });
    expect(target.data.keyEpoch).toBe('target-secret-epoch');
    expect(target.data.apiKey).toBeUndefined();
    expect(target.data.recallReview.cards.y.reviews).toBe(1);
    expect(target.data.recallReview.current).toBeUndefined();
    expect(target.data.learningImportJournalV1).toBeUndefined();
    const repeatPreview = await target.dispatch({ type: 'learningPreview', json: exported.json, pageId });
    expect(repeatPreview.preview.already).toBe(true);
    const before = target.writes.length;
    expect(await target.dispatch({ type: 'learningImport', token: repeatPreview.token, pageId })).toEqual({ ok: true, already: true });
    expect(target.writes).toHaveLength(before);
    target.data.recallReview.cards.y.reviews++;
    expect((await target.dispatch({ type: 'learningPreview', json: exported.json, pageId })).error).toMatch(/target has/);
    expect((await target.dispatch({ type: 'learningExport' }, popup))).toBeUndefined();
    expect((await target.dispatch({ type: 'learningImport', token: 'fake', pageId }, popup))).toBeUndefined();
  } finally { globalThis.chrome = oldChrome; globalThis.fetch = oldFetch; }
});

test('preview is invalidated by port close, file change, settings/permission change and held reads', async () => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  try {
    const source = setup({ settings: { language: 'es', gradual: true },
      recallReview: { version: 1, cards: { y: { due: 0, interval: 0, reviews: 0 } },
        learning: { day: '2026-10-28', count: 1, pending: [] } } }, 'races-source');
    await source.load(); source.openPage();
    const { json } = await source.dispatch({ type: 'learningExport' });
    const target = setup({ settings: { language: 'es', enabled: false, newSitesEnabled: false } }, 'races-target');
    await target.load();
    const port = target.openPage();
    let preview = await target.dispatch({ type: 'learningPreview', json, pageId });
    port.invalidate();
    expect((await target.dispatch({ type: 'learningImport', token: preview.token, pageId })).error).toMatch(/expired/);
    preview = await target.dispatch({ type: 'learningPreview', json, pageId });
    target.data.settings.density = 'heavy'; // another trusted storage writer, no worker generation signal
    expect((await target.dispatch({ type: 'learningImport', token: preview.token, pageId })).error).toMatch(/changed/);
    target.data.settings.density = undefined;
    delete target.data.settings.density;
    preview = await target.dispatch({ type: 'learningPreview', json, pageId });
    target.setOrigins(['https://external.example/*']); // permission list changed before its event arrived
    expect((await target.dispatch({ type: 'learningImport', token: preview.token, pageId })).error).toMatch(/changed/);
    target.setOrigins([]);
    preview = await target.dispatch({ type: 'learningPreview', json, pageId });
    await target.dispatch({ type: 'save', settings: { density: 'light' } }, popup);
    expect((await target.dispatch({ type: 'learningImport', token: preview.token, pageId })).error).toMatch(/changed/);
    preview = await target.dispatch({ type: 'learningPreview', json, pageId });
    target.setOrigins(['https://new.example/*']);
    target.added.listeners[0]();
    expect((await target.dispatch({ type: 'learningImport', token: preview.token, pageId })).error).toMatch(/changed/);
    target.setOrigins([]);
    preview = await target.dispatch({ type: 'learningPreview', json, pageId });
    const started = target.holdNextRead();
    const pending = target.dispatch({ type: 'learningImport', token: preview.token, pageId });
    await started;
    port.disconnect();
    target.releaseRead();
    expect((await pending).error).toMatch(/expired|changed/);
    expect(target.data.recallReview).toBeUndefined();
  } finally { globalThis.chrome = oldChrome; globalThis.fetch = oldFetch; }
});

test('partial storage failure reports error and journal recovers on worker restart', async () => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  try {
    const source = setup({ settings: { language: 'es', levelOverride: 2 },
      recallReview: { version: 1, cards: { y: { due: 0, interval: 0, reviews: 0 } },
        learning: { day: '2026-10-28', count: 1, pending: [] } } }, 'failure-source');
    await source.load(); source.openPage();
    const { json } = await source.dispatch({ type: 'learningExport' });
    const data = { settings: { language: 'es', enabled: false, newSitesEnabled: false } };
    const target = setup(data, 'failure-target');
    await target.load(); target.openPage();
    const preview = await target.dispatch({ type: 'learningPreview', json, pageId });
    target.failNextPatch(true);
    expect((await target.dispatch({ type: 'learningImport', token: preview.token, pageId })).error).toMatch(/did not finish/);
    expect(data.learningImportJournalV1).toBeDefined();
    expect(data.learningImportReceiptV1).toBeUndefined();
    expect((await target.dispatch({ type: 'reviewNext' }, { id, url: `chrome-extension://${id}/src/review.html` })).error)
      .toMatch(/incomplete/);
    const restart = setup(data, 'failure-restart');
    await restart.load(); restart.openPage();
    const recovered = await restart.dispatch({ type: 'learningExport' });
    expect(recovered.json).toContain('"y"');
    expect(data.learningImportJournalV1).toBeUndefined();
    expect(data.learningImportReceiptV1.hash).toBeDefined();
    expect(data.recallReview.cards.y.reviews).toBe(0);
    expect(data.settings.enabled).toBe(false);
  } finally { globalThis.chrome = oldChrome; globalThis.fetch = oldFetch; }
});

test('permission changes during the final journal read cannot commit stale preview', async () => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  try {
    const source = setup({ settings: { language: 'es' },
      recallReview: { version: 1, cards: { y: { due: 0, interval: 0, reviews: 0 } },
        learning: { day: '2026-10-28', count: 1, pending: [] } } }, 'late-source');
    await source.load(); source.openPage();
    const { json } = await source.dispatch({ type: 'learningExport' });
    const target = setup({ settings: { enabled: false, language: 'es' } }, 'late-target');
    await target.load(); target.openPage();
    const preview = await target.dispatch({ type: 'learningPreview', json, pageId });
    const entered = target.holdCommitRead();
    const pending = target.dispatch({ type: 'learningImport', token: preview.token, pageId });
    await entered;
    target.added.listeners[0](); // generation changes before its locked epoch write
    target.releaseRead();
    expect((await pending).error).toMatch(/changed/);
    expect(target.data.recallReview).toBeUndefined();
    expect(target.data.learningImportJournalV1).toBeUndefined();
  } finally { globalThis.chrome = oldChrome; globalThis.fetch = oldFetch; }
});

test('future settings survive worker restarts and cannot yield a lossy export', async () => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  try {
    const data = { settings: { language: 'es', futureLearningPreference: 'keep me' } };
    const first = setup(data, 'future-first');
    await first.load(); first.openPage();
    expect((await first.dispatch({ type: 'learningExport' })).error).toMatch(/unsupported/);
    expect(data.settings.futureLearningPreference).toBe('keep me');
    const second = setup(data, 'future-second');
    await second.load(); second.openPage();
    expect((await second.dispatch({ type: 'learningExport' })).error).toMatch(/unsupported/);
    expect(data.settings.futureLearningPreference).toBe('keep me');
  } finally { globalThis.chrome = oldChrome; globalThis.fetch = oldFetch; }
});

test('restart after journal promotion but before any patch discards stale preview', async () => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  try {
    const source = setup({ settings: { language: 'es' },
      recallReview: { version: 1, cards: { y: { due: 0, interval: 0, reviews: 0 } },
        learning: { day: '2026-10-28', count: 1, pending: [] } } }, 'prepatch-source');
    await source.load(); source.openPage();
    const { json } = await source.dispatch({ type: 'learningExport' });
    const data = { settings: { enabled: false, language: 'es' } };
    const target = setup(data, 'prepatch-target');
    await target.load();
    const port = target.openPage();
    const preview = await target.dispatch({ type: 'learningPreview', json, pageId });
    const entered = target.holdCommitRead();
    const pending = target.dispatch({ type: 'learningImport', token: preview.token, pageId });
    await entered;
    expect(data.learningImportJournalV1.phase).toBe('committing');
    const restart = setup(data, 'prepatch-restart');
    await restart.load(); restart.openPage();
    expect((await restart.dispatch({ type: 'learningExport' })).json).not.toContain('"y"');
    expect(data.recallReview).toBeUndefined();
    expect(data.learningImportJournalV1).toBeUndefined();
    port.disconnect(); target.releaseRead();
    expect((await pending).error).toMatch(/expired|changed/);
    expect(data.recallReview).toBeUndefined();
  } finally { globalThis.chrome = oldChrome; globalThis.fetch = oldFetch; }
});

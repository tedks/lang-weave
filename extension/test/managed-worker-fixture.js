import { expect } from 'bun:test';
import { memoryStorage } from '../src/cache.js';
import { API_BASE } from '../src/gemini.js';
import { hashKey } from '../src/hash.js';
import manifest from '../manifest.json';

export const token = `lwk_${'z'.repeat(43)}`;
export const article = 'I opened the window and looked out over the yard.';
export const page = { id: 'managed-test', tab: { id: 1, title: 'Ordinary reading' }, frameId: 0,
  documentId: 'document-1', documentLifecycle: 'active', url: 'https://example.com/article' };
const extensionOrigin = 'chrome-extension://managed-test';
export const options = { id: page.id, url: `${extensionOrigin}/src/options.html` };
export const emptySwaps = (passages) => passages.map(({ id }) => ({ id, swaps: [] }));

export async function workerFixture({ initial = {}, isolation = true, respond, version = manifest.version,
    beforeSet, beforeTokenRemoval }) {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const runtimeManifest = { ...manifest, version };
  const data = { epoch: 'reading-epoch', keyEpoch: 'byok-epoch', managedToken: token,
    settings: { managedProvider: true, enabled: true, newSitesEnabled: true, model: 'gemini-3.8-flash' }, ...initial };
  const calls = [], listeners = [], connections = [], activations = [], accessLevels = [], gets = [], storageEvents = [];
  const removals = [];
  const on = (list = []) => ({ addListener: (fn) => list.push(fn) });
  let finishIsolation, nextBadgeTitle;
  const store = {
    async get(keys) {
      const names = keys == null ? Object.keys(data) : [keys].flat();
      gets.push(names);
      return structuredClone(Object.fromEntries(names.filter((key) => key in data).map((key) => [key, data[key]])));
    },
    async set(patch) {
      beforeSet?.(patch);
      if (Object.hasOwn(patch, 'managedToken')) storageEvents.push('token stored');
      Object.assign(data, structuredClone(patch));
    },
    async remove(keys) {
      for (const key of [keys].flat()) {
        removals.push(key);
        if (key === 'managedToken' && beforeTokenRemoval) await beforeTokenRemoval();
        delete data[key];
      }
    },
  };
  if (isolation) store.setAccessLevel = async ({ accessLevel }) => {
    accessLevels.push(accessLevel);
    if (isolation === 'reject') throw new Error('Storage isolation unavailable');
    if (isolation === 'pending') await new Promise((done) => { finishIsolation = done; });
    storageEvents.push('isolation established');
  };
  globalThis.chrome = {
    storage: { local: store, session: memoryStorage() },
    runtime: { id: page.id, getURL: (path) => `${extensionOrigin}/${path}`, getManifest: () => runtimeManifest,
      onMessage: on(listeners), onConnect: on(connections), onInstalled: on(), onStartup: on() },
    action: { setBadgeText: async () => {}, setTitle: async ({ title }) => nextBadgeTitle?.(title) },
    tabs: { get: async () => ({ title: page.tab.title, url: page.url }), query: async () => [], sendMessage: async () => {},
      onActivated: on(activations) },
    permissions: { getAll: async () => ({ origins: ['https://example.com/*'] }), onAdded: on(), onRemoved: on() },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  };
  globalThis.fetch = async (url, { signal, ...init } = {}) => {
    if (url === `${extensionOrigin}/manifest.json`) return Response.json(runtimeManifest);
    calls.push({ url, ...init });
    if (!respond) throw new Error('Unexpected external request in worker fixture');
    return respond(url, init, calls.length);
  };
  const send = (msg, sender = page) => new Promise((done) => {
    if (!listeners.some((listener) => listener(msg, sender, done))) done(undefined);
  });
  const ask = async (texts = [article]) => {
    const { revision } = await send({ type: 'config' });
    const items = texts.map((text) => ({ key: `${revision}:${hashKey(text)}`, text }));
    const reply = await send({ type: 'swaps', revision, items, title: page.tab.title });
    return { reply, ids: items.map(({ key }) => key), items };
  };
  const backup = () => {
    const sender = { id: page.id, url: `${extensionOrigin}/src/backup.html`, documentId: 'backup-doc' };
    const messages = [], pageId = crypto.randomUUID();
    const port = { name: 'learning-backup-page', sender, onMessage: on(messages), onDisconnect: on(),
      postMessage: (reply) => expect(reply).toEqual({ ready: true, pageId }) };
    connections[0](port);
    messages[0]({ pageId });
    return (msg) => send({ ...msg, pageId }, sender);
  };
  try { await import(`../src/background.js?managed-worker-${crypto.randomUUID()}`); }
  catch (error) { Object.assign(globalThis, old); throw error; }
  const badgeTitle = () => new Promise((resolve) => {
    nextBadgeTitle = resolve;
    activations[0]({ tabId: page.tab.id });
  });
  return { calls, accessLevels, gets, data, send, ask, backup, badgeTitle, storageEvents, removals,
    releaseIsolation: () => finishIsolation(), restore() { Object.assign(globalThis, old); } };
}

export async function captureByok({ version, gradual, preferences, managedToken }) {
  const worker = await workerFixture({ version,
    initial: { managedToken, apiKey: 'synthetic-byok',
      settings: { ...preferences, gradual, newSitesEnabled: true, model: 'gemini-3.8-flash' } },
    respond(url, init, call) {
      if (!url.startsWith(API_BASE)) throw new Error('Expected only Gemini calls');
      if (call === 1) return new Response('{}', { status: 503 });
      const body = JSON.parse(init.body);
      const passages = JSON.parse(body.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      const text = JSON.stringify({ passages: emptySwaps(passages) });
      return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
    },
  });
  try {
    return { ...await worker.ask(), calls: worker.calls,
      readManagedToken: worker.gets.some((keys) => keys.includes('managedToken')) };
  } finally { worker.restore(); }
}

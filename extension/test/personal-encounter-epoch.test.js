import { expect, test } from 'bun:test';
import { hashKey } from '../src/hash.js';
import { addPersonal, cleanPersonal } from '../src/personal.js';

const PAGE = { id: 'fw-mixed', tab: { id: 7, title: 'Reading' }, frameId: 0,
  documentId: 'doc-one', documentLifecycle: 'active', url: 'https://reading.example/story' };
const POPUP = { id: 'fw-mixed', url: 'chrome-extension://fw-mixed/src/popup.html' };
const PASSAGE = 'We discussed the idea and shimmer with friends today.';
const OWN_KEY = 'lang:personal:es:vocabularyEncounters';

async function mixedEncounter(name, { change = '', failure = '' } = {}) {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const personal = cleanPersonal(null);
  const entry = addPersonal(personal, { source: 'shimmer', target: 'brillar', sense: 'shimmer',
    direction: 'en-to-target' }, 'es', Date.now(), '00000000-0000-4000-8000-000000000001').entry;
  const data = { settings: { enabled: true, newSitesEnabled: true, gradual: true,
    newWordsPerDay: 1 }, apiKey: 'synthetic-key', personalVocabularyV1: personal };
  const messages = [], added = [], removed = [], writes = [];
  const event = (listeners = []) => ({ addListener(fn) { listeners.push(fn); } });
  let origins = ['<all_urls>'], modelCalls = 0, entered, release;
  let holdLegacy = change !== '', failKey = failure === 'legacy' ? 'vocabularyEncounters'
    : failure === 'personal' ? OWN_KEY : '';
  try {
    globalThis.chrome = {
      storage: { local: {
        async setAccessLevel() {},
        async get(keys) {
          const names = typeof keys === 'string' ? [keys] : keys || Object.keys(data);
          return structuredClone(Object.fromEntries(names.filter((key) => key in data)
            .map((key) => [key, data[key]])));
        },
        async set(values) {
          writes.push(Object.keys(values));
          if (holdLegacy && Object.hasOwn(values, 'vocabularyEncounters')) {
            holdLegacy = false;
            entered();
            await new Promise((resolve) => { release = resolve; });
          }
          if (failKey && Object.hasOwn(values, failKey)) throw new Error('synthetic disk failure');
          Object.assign(data, structuredClone(values));
        },
        async remove(keys) { for (const key of keys) delete data[key]; },
      } },
      runtime: { id: PAGE.id, getURL: (path) => `chrome-extension://${PAGE.id}/${path}`,
        getManifest: () => ({ version: '0.10.0' }), onMessage: event(messages),
        onInstalled: event(), onStartup: event() },
      tabs: { get: async () => ({ id: 7, title: 'Reading', url: PAGE.url }),
        query: async () => [], sendMessage: async () => {} },
      action: { setBadgeText: async () => {} }, alarms: { create() {}, onAlarm: event() },
      permissions: { getAll: async () => ({ origins }), onAdded: event(added), onRemoved: event(removed) },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
        updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    };
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('manifest.json')) return { ok: true, json: async () => ({ version: '0.10.0' }) };
      modelCalls++;
      const passages = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{
        text: JSON.stringify({ passages: passages.map(({ id }) => ({ id, swaps: [] })) }),
      }] } }] }) };
    };
    await import(`../src/background.js?mixed-encounter-${name}`);
    const send = (msg, sender = PAGE) => new Promise((resolve) => {
      if (!messages.some((fn) => fn(msg, sender, resolve))) resolve(undefined);
    });
    const revision = (await send({ type: 'config' })).revision;
    const ask = () => send({ type: 'swaps', revision,
      items: [{ key: `${revision}:${hashKey(PASSAGE)}`, text: PASSAGE }] });
    let request = ask();
    if (change) {
      await Promise.race([new Promise((resolve) => { entered = resolve; }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Legacy write did not start')), 2000))]);
      let mutation = Promise.resolve();
      if (change === 'revoke') {
        origins = [];
        mutation = removed[0]();
      } else if (change === 'remove-regrant') {
        origins = [];
        const revoked = removed[0]();
        origins = ['<all_urls>'];
        mutation = Promise.all([revoked, added[0]()]);
      } else if (change === 'site-off') {
        mutation = send({ type: 'save', settings: { enabled: false } }, POPUP);
        await Promise.resolve(); // save increments its epoch before waiting for the storage lock
      }
      release();
      const result = await request;
      await mutation;
      return { data, entry, result, writes, modelCalls };
    }
    const result = await request;
    if (failure) {
      failKey = '';
      const retried = await ask();
      return { data, entry, result, retried, writes, modelCalls };
    }
    return { data, entry, result, writes, modelCalls };
  } finally {
    release?.();
    Object.assign(globalThis, prior);
  }
}

test('mixed encounter writes both ledgers when allowed', async () => {
  const { data, entry, result, writes, modelCalls } = await mixedEncounter('allowed');
  expect(result.stale).toBeUndefined();
  expect(modelCalls).toBe(1);
  expect(data.vocabularyEncounters.counts['es:legacy:la%20idea']).toBe(1);
  expect(data[OWN_KEY].counts[entry.id]).toBe(1);
  expect(writes.filter((keys) => keys.includes(OWN_KEY))).toHaveLength(1);
  expect(data.personalVocabularyV1.history.es?.learning?.count || 0).toBe(0);
});

for (const change of ['revoke', 'remove-regrant', 'site-off']) {
  test(`a held first write cannot authorize the second after ${change}`, async () => {
    const { data, result, writes, modelCalls } = await mixedEncounter(change, { change });
    expect(result.stale).toBe(true);
    expect(data.vocabularyEncounters.counts['es:legacy:la%20idea']).toBe(1); // dispatched earlier
    expect(data[OWN_KEY]).toBeUndefined();
    expect(writes.filter((keys) => keys.includes(OWN_KEY))).toHaveLength(0);
    expect(modelCalls).toBe(0);
  }, 30000);
}

test('either encounter write failure stops dispatch; retry completes without duplicate counts', async () => {
  for (const failure of ['legacy', 'personal']) {
    const { data, entry, result, retried, writes, modelCalls } = await mixedEncounter(failure, { failure });
    expect(result.error).toBe('Local reading storage failed');
    expect(retried.error).toBeUndefined();
    expect(modelCalls).toBe(1); // only the successful retry can reach the model
    expect(data.vocabularyEncounters.counts['es:legacy:la%20idea']).toBe(1);
    expect(data[OWN_KEY].counts[entry.id]).toBe(1);
    expect(writes.filter((keys) => keys.includes(OWN_KEY))).toHaveLength(failure === 'legacy' ? 1 : 2);
  }
}, 30000);

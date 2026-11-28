import { expect, test } from 'bun:test';
import { hashKey } from '../src/hash.js';

const page = { id: 'fw-epoch', tab: { id: 7, title: 'Reading' }, frameId: 0,
  documentId: 'doc-1', documentLifecycle: 'active', url: 'https://reading.example/story' };
const popup = { id: 'fw-epoch', url: 'chrome-extension://fw-epoch/src/popup.html' };
const passage = 'We discussed the idea with friends today.';

async function heldLookup({ name, lookup, change, prime = false }) {
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const data = { settings: { enabled: true, newSitesEnabled: true, gradual: true,
    newWordsPerDay: 1 }, apiKey: 'synthetic-key' };
  if (prime) data.recallReview = { version: 1, cards: {
    'la idea': { due: Date.now() - 1000, interval: 2, reviews: 2 },
  } };
  const messages = [], removed = [], added = [];
  const on = (listeners = []) => ({ addListener: (fn) => listeners.push(fn) });
  let origins = ['<all_urls>'], lookups = 0, encounterReads = 0, reviewReads = 0;
  let targetLookup = prime ? 0 : lookup;
  let releaseLookup, enteredLookup, heldCaller = '';
  let fetches = 0;
  try {
    globalThis.chrome = {
      storage: { local: {
        async setAccessLevel() {},
        async get(keys) {
          const pick = typeof keys === 'string' ? [keys] : keys || Object.keys(data);
          if (pick.includes('vocabularyEncounters')) encounterReads++;
          if (pick.includes('recallReview')) reviewReads++;
          return structuredClone(Object.fromEntries(pick.filter((key) => key in data)
            .map((key) => [key, data[key]])));
        },
        async set(value) { Object.assign(data, structuredClone(value)); },
        async remove(keys) { for (const key of keys) delete data[key]; },
      } },
      runtime: { id: 'fw-epoch', getURL: (path) => `chrome-extension://fw-epoch/${path}`,
        getManifest: () => ({ version: '0.9.0' }), onMessage: on(messages), onInstalled: on(), onStartup: on() },
      tabs: { get: async () => {
        lookups++;
        if (lookups === targetLookup) {
          heldCaller = new Error().stack || '';
          enteredLookup();
          await new Promise((resolve) => { releaseLookup = resolve; });
        }
        return { id: 7, title: 'Reading', url: page.url };
      }, query: async () => [], sendMessage: async () => {} },
      action: { setBadgeText: async () => {} }, alarms: { create: async () => {}, onAlarm: on() },
      permissions: { getAll: async () => ({ origins }), onAdded: on(added), onRemoved: on(removed) },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
        updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    };
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('manifest.json')) return { ok: true, json: async () => ({ version: '0.9.0' }) };
      fetches++;
      const passages = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        passages: passages.map(({ id }) => ({ id, swaps: [{ o: 'the idea', f: 'la idea', ctx: '' }] })),
      }) }] } }] }) };
    };
    await import(`../src/background.js?adaptive-epoch-${name}`);
    const send = (msg, sender = page) => new Promise((resolve) => {
      if (!messages.some((fn) => fn(msg, sender, resolve))) resolve(undefined);
    });
    const revision = (await send({ type: 'config' })).revision;
    const message = { type: 'swaps', revision,
      items: [{ key: `${revision}:${hashKey(passage)}`, text: passage }] };
    if (prime) {
      expect((await send(message)).stale).toBeUndefined();
      expect(fetches).toBe(1);
      targetLookup = lookups + lookup;
    }
    const entered = new Promise((resolve) => { enteredLookup = resolve; });
    const request = send(message);
    await Promise.race([entered, new Promise((_, reject) => setTimeout(() => reject(new Error('Tab lookup not held')), 2000))]);
    expect(lookups).toBe(targetLookup);
    expect(heldCaller).toContain('liveGradualDocument'); // second lookup within stillSafe
    // The ordinal also has to represent the intended gate. If a new tab
    // lookup shifts the sequence, these phase assertions fail instead of
    // silently testing an earlier authorization point.
    if (prime) {
      expect(fetches).toBe(1);
      expect(reviewReads).toBe(5); // second delivery has reloaded the card for the final coverage check
      expect(data.recallReview.cards['la idea'].reviews).toBe(2);
      expect(Object.keys(data).some((key) => key.startsWith('c:'))).toBe(true);
    } else if (lookup === 6) {
      expect(encounterReads).toBe(1); // the final check after the encounter read
      expect(data.vocabularyEncounters).toBeUndefined();
      expect(data.modelCalls).toBeUndefined();
    } else if (lookup === 15) {
      expect(data.vocabularyEncounters.counts['es:legacy:la%20idea']).toBe(1);
      expect(data.modelCalls.count).toBe(1);
      expect(fetches).toBe(0);
    } else if (lookup === 17) {
      expect(fetches).toBe(1);
      expect(data.recallReview).toBeUndefined();
      expect(Object.keys(data).some((key) => key.startsWith('c:'))).toBe(false);
    }
    let mutation = Promise.resolve();
    if (change === 'revoke') {
      origins = [];
      mutation = removed[0]();
    } else if (change === 'remove-regrant') {
      origins = [];
      const first = removed[0]();
      origins = ['<all_urls>'];
      mutation = Promise.all([first, added[0]()]);
    } else if (change === 'site-off') {
      mutation = send({ type: 'save', settings: { enabled: false } }, popup);
    }
    releaseLookup();
    const result = await request;
    await mutation;
    return { data, result, fetches };
  } finally {
    releaseLookup?.();
    Object.assign(globalThis, saved);
  }
}

test('held final encounter lookup rejects revoke, remove/regrant and site-off before recording', async () => {
  for (const change of ['revoke', 'remove-regrant', 'site-off']) {
    const { data, result, fetches } = await heldLookup({ name: `encounter-${change}`, lookup: 6, change });
    expect(result.stale).toBe(true);
    expect(data.vocabularyEncounters).toBeUndefined();
    expect(data.modelCalls).toBeUndefined();
    expect(fetches).toBe(0);
  }
  const allowed = await heldLookup({ name: 'encounter-allowed', lookup: 6 });
  expect(allowed.result.stale).toBeUndefined();
  expect(allowed.data.vocabularyEncounters.counts['es:legacy:la%20idea']).toBe(1);
  expect(allowed.fetches).toBe(1);
  expect(allowed.data.recallReview.learning.count).toBe(0);
}, 30000);

test('held final prefetch lookup rejects revoke, remove/regrant and site-off after counting', async () => {
  for (const change of ['revoke', 'remove-regrant', 'site-off']) {
    const { data, result, fetches } = await heldLookup({ name: `prefetch-${change}`, lookup: 15, change });
    expect(result.stale).toBe(true);
    expect(fetches).toBe(0);
    expect(data.modelCalls.count).toBe(1); // accounting stays before dispatch
    expect(data.vocabularyEncounters.counts['es:legacy:la%20idea']).toBe(1); // counted while eligible
  }
  const allowed = await heldLookup({ name: 'prefetch-allowed', lookup: 15 });
  expect(allowed.result.stale).toBeUndefined();
  expect(allowed.fetches).toBe(1);
  expect(allowed.data.modelCalls.count).toBe(1);
}, 30000);

test('held fresh delivery lookup rejects revoke before caching or reserving', async () => {
  const denied = await heldLookup({ name: 'fresh-delivery-revoke', lookup: 17, change: 'revoke' });
  expect(denied.result.stale).toBe(true);
  expect(denied.fetches).toBe(1); // the fetch itself preceded the revocation
  expect(denied.data.modelCalls.count).toBe(1);
  expect(denied.data.recallReview).toBeUndefined();
  expect(Object.keys(denied.data).some((key) => key.startsWith('c:'))).toBe(false);
  const allowed = await heldLookup({ name: 'fresh-delivery-allowed', lookup: 17 });
  expect(allowed.result.stale).toBeUndefined();
  expect(allowed.data.recallReview.learning.pending).toHaveLength(1);
}, 30000);

test('held cached delivery lookup rejects revoke without returning cached swaps', async () => {
  const denied = await heldLookup({ name: 'cached-delivery-revoke', lookup: 17, change: 'revoke', prime: true });
  expect(denied.result.stale).toBe(true);
  expect(denied.fetches).toBe(1); // only the authorized priming fetch
  expect(denied.data.recallReview.cards['la idea'].reviews).toBe(2);
  const allowed = await heldLookup({ name: 'cached-delivery-allowed', lookup: 17, prime: true });
  expect(allowed.result.stale).toBeUndefined();
  expect(allowed.fetches).toBe(1);
  expect(Object.values(allowed.result.results).flat()[0].status).toBe('due');
}, 30000);

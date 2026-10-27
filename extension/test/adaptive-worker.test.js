import { expect, test } from 'bun:test';
import { hashKey } from '../src/hash.js';
import { entryId } from '../src/catalog.js';

test('worker records only eligible catalog encounters and blocks held-await revocations', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const data = { settings: { enabled: true, newSitesEnabled: true, gradual: true,
    newWordsPerDay: 1 }, apiKey: 'synthetic-key' };
  const listeners = [], removed = [], added = [];
  const on = (list = []) => ({ addListener: (fn) => list.push(fn) });
  const page = { id: 'fw-adaptive', tab: { id: 7, title: 'Reading' }, frameId: 0,
    documentId: 'doc-1', documentLifecycle: 'active', url: 'https://reading.example/story' };
  const popup = { id: 'fw-adaptive', url: 'chrome-extension://fw-adaptive/src/popup.html' };
  let origins = ['<all_urls>'], title = 'Reading', liveUrl = page.url;
  let held = false, entered, release, failEncounter = false;
  let modelCalls = 0;
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        const pick = typeof keys === 'string' ? [keys] : keys || Object.keys(data);
        if (held && pick.includes('vocabularyEncounters')) {
          entered();
          await new Promise((resolve) => { release = resolve; });
        }
        return structuredClone(Object.fromEntries(pick.filter((key) => key in data).map((key) => [key, data[key]])));
      },
      async set(value) {
        if (failEncounter && Object.hasOwn(value, 'vocabularyEncounters')) throw new Error('Synthetic storage failure');
        Object.assign(data, structuredClone(value));
      },
      async remove(keys) { for (const key of keys) delete data[key]; },
    } },
    runtime: { id: 'fw-adaptive', getURL: (path) => `chrome-extension://fw-adaptive/${path}`,
      getManifest: () => ({ version: '0.8.0' }), onMessage: on(listeners), onInstalled: on(), onStartup: on() },
    tabs: { get: async () => ({ id: 7, title, url: liveUrl }), query: async () => [], sendMessage: async () => {} },
    action: { setBadgeText: async () => {} }, alarms: { create: async () => {}, onAlarm: on() },
    permissions: { getAll: async () => ({ origins }), onAdded: on(added), onRemoved: on(removed) },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  };
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('manifest.json')) return { ok: true, json: async () => ({ version: '0.8.0' }) };
    modelCalls++;
    const passages = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      passages: passages.map(({ id, text }) => ({ id, swaps: text.includes('the idea')
        ? [{ o: 'the idea', f: 'la idea', ctx: '' }]
        : text.includes('the question') ? [{ o: 'the question', f: 'la pregunta', ctx: '' }] : [] })) }) }] } }] }) };
  };
  const send = (msg, sender = page) => new Promise((resolve) => {
    if (!listeners.some((fn) => fn(msg, sender, resolve))) resolve(undefined);
  });
  const ask = (text, revision, sender = page) => send({ type: 'swaps', revision,
    items: [{ key: `${revision}:${hashKey(text)}`, text }] }, sender);
  const hold = async (promise) => {
    let saw;
    const waiting = new Promise((resolve) => { saw = resolve; });
    entered = saw; held = true;
    const request = promise();
    await waiting;
    return { request };
  };
  const resume = () => { held = false; release(); };
  const idea = 'We discussed the idea with friends today.';
  const question = 'We discussed the question with friends today.';
  try {
    await import('../src/background.js?adaptive-worker');
    let revision = (await send({ type: 'config' })).revision;
    const empty = await ask('Zebras orbit quartz; distant galaxies shimmer.', revision);
    expect(Object.values(empty.results)).toEqual([[]]);
    expect(modelCalls).toBe(0);
    expect(data.vocabularyEncounters).toBeUndefined();

    let { request: pending } = await hold(() => ask(idea, revision));
    const siteOff = send({ type: 'save', settings: { enabled: false } }, popup);
    await Promise.resolve();
    resume();
    expect((await pending).stale).toBe(true);
    await siteOff;
    expect(data.vocabularyEncounters).toBeUndefined();
    expect(modelCalls).toBe(0);
    await send({ type: 'save', settings: { enabled: true } }, popup);
    revision = (await send({ type: 'config' })).revision;

    ({ request: pending } = await hold(() => ask(idea, revision)));
    origins = [];
    const revoked = removed[0]();
    resume();
    expect((await pending).stale).toBe(true);
    await revoked;
    expect(data.vocabularyEncounters).toBeUndefined();
    expect(modelCalls).toBe(0);
    origins = ['<all_urls>'];
    await added[0]();
    revision = (await send({ type: 'config' })).revision;

    ({ request: pending } = await hold(() => ask(idea, revision)));
    title = 'Medication advice';
    resume();
    expect((await pending).stale).toBe(true);
    expect(data.vocabularyEncounters).toBeUndefined();
    expect(modelCalls).toBe(0);
    title = 'Reading';

    ({ request: pending } = await hold(() => ask(idea, revision)));
    liveUrl = 'https://reading.example/other-document';
    resume();
    expect((await pending).stale).toBe(true);
    expect(data.vocabularyEncounters).toBeUndefined();
    expect(modelCalls).toBe(0);
    liveUrl = page.url;

    failEncounter = true;
    expect((await ask(idea, revision)).error).toBe('Local reading storage failed');
    expect(data.vocabularyEncounters).toBeUndefined();
    expect(modelCalls).toBe(0);
    failEncounter = false;
    const result = await ask(idea, revision);
    const swap = Object.values(result.results).flat()[0];
    expect(swap.word).toBe('la idea');
    expect(swap.status).toBe('new');
    expect(data.recallReview.learning.count).toBe(0); // reservation, not introduction
    expect(data.recallReview.cards['la idea']).toBeUndefined();
    expect(data.vocabularyEncounters.counts[entryId('es', { fr: 'la idea' })]).toBe(1);
    expect(JSON.stringify(data.vocabularyEncounters)).not.toMatch(/https|reading\.example|story|Medication|doc-1|tabId|passage/i);
    expect((await send({ type: 'introAck', word: swap.word, ticket: swap.introTicket, revision })).ok).toBe(true);
    expect(data.recallReview.learning.count).toBe(1);
    expect(data.recallReview.cards['la idea'].reviews).toBe(0);
    await ask(idea, revision);
    expect(data.vocabularyEncounters.counts[entryId('es', { fr: 'la idea' })]).toBe(1);
    const before = modelCalls;
    const denied = await ask(question, revision, { ...page, frameId: 1, documentId: 'subframe' });
    expect(Object.values(denied.results)).toEqual([[]]);
    expect(modelCalls).toBe(before);
  } finally { Object.assign(globalThis, prior); }
}, 30000);

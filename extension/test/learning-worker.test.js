import { test, expect } from 'bun:test';
import { hashKey } from '../src/hash.js';

test('worker serializes introductions and inline tickets, rejects stale/off/site messages', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const data = { settings: { enabled: true, newSitesEnabled: true, gradual: true, newWordsPerDay: 1, inlineRecall: true },
    apiKey: 'synthetic-key' };
  const listeners = [];
  const permissionAdded = [], permissionRemoved = [];
  let origins = ['<all_urls>'];
  const on = (arr = []) => ({ addListener: (fn) => arr.push(fn) });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
  let writesFail = false;
  let cacheWritesFail = false;
  let statusWritesFail = true;
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) { await tick(); const pick = typeof keys === 'string' ? [keys] : keys || Object.keys(data);
        return structuredClone(Object.fromEntries(pick.filter((k) => k in data).map((k) => [k, data[k]]))); },
      async set(values) { await tick(); if (writesFail && 'recallReview' in values) throw new Error('Storage failed');
        if (cacheWritesFail && Object.keys(values).some((key) => key.startsWith('c:'))) throw new Error('Cache storage failed');
        if (statusWritesFail && 'modelStatus' in values) throw new Error('Status storage failed');
        Object.assign(data, structuredClone(values)); },
      async remove(keys) { for (const key of keys) delete data[key]; },
    } },
    runtime: { id: 'fw-test', getURL: (p) => `chrome-extension://fw-test/${p}`,
      getManifest: () => ({ version: '0.5.0' }), onMessage: on(listeners), onInstalled: on(), onStartup: on() },
    tabs: { query: async () => [], sendMessage: async () => {} }, action: { setBadgeText: async () => {} },
    alarms: { create: async () => {}, onAlarm: on() },
    permissions: { getAll: async () => ({ origins }), onAdded: on(permissionAdded), onRemoved: on(permissionRemoved) },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  };
  let modelCalls = 0;
  let modelFails = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('manifest.json')) return { ok: true, json: async () => ({ version: '0.5.0' }) };
    modelCalls++;
    if (modelFails) throw new Error('Synthetic model failure');
    const batch = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
    const passages = batch.map(({ id, text }) => ({ id, swaps: [
      ...(text.includes('the idea') ? [{ o: 'the idea', f: 'la idea', ctx: '' }] : []),
      ...(text.includes('the question') ? [{ o: 'the question', f: 'la pregunta', ctx: '' }] : []),
    ] }));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] }) };
  };
  const send = (msg, sender) => new Promise((resolve) => { if (!listeners.some((fn) => fn(msg, sender, resolve))) resolve(undefined); });
  const popup = { id: 'fw-test', url: 'chrome-extension://fw-test/src/popup.html' };
  const page = { id: 'fw-test', tab: { id: 7 }, frameId: 0, documentId: 'doc-1',
    documentLifecycle: 'active', url: 'https://reading.example/article' };
  const other = { ...page, tab: { id: 8 }, documentId: 'doc-2' };
  const ask = (text, sender, revision) => send({ type: 'swaps', revision,
    items: [{ key: `${revision}:${hashKey(text)}`, text }] }, sender);
  const askBatch = (texts, sender, revision) => send({ type: 'swaps', revision,
    items: texts.map((text) => ({ key: `${revision}:${hashKey(text)}`, text })) }, sender);
  try {
    await import('../src/background.js?learning-worker');
    const revision = (await send({ type: 'config' }, page)).revision;
    const [a, b] = await Promise.all([
      ask('I explained the idea to my friends today.', page, revision),
      ask('I answered the question for my class today.', other, revision),
    ]);
    expect([a, b].flatMap((r) => Object.values(r.results).flat()).filter((s) => s.status === 'new')).toHaveLength(1);
    expect(Object.keys(data.recallReview.cards)).toHaveLength(1);
    expect(data.recallReview.learning.count).toBe(1);
    expect(modelCalls).toBe(2);
    expect((await ask('I explained the idea to my friends today.', page, revision)).results).toBeDefined();
    expect(data.recallReview.learning.count).toBe(1);
    const due = Object.keys(data.recallReview.cards)[0];
    const includedText = due === 'la idea' ? 'I explained the idea to my friends today.' : 'I answered the question for my class today.';
    const excludedText = due === 'la idea' ? 'I answered the question for my class today.' : 'I explained the idea to my friends today.';
    modelFails = true;
    const mixed = await askBatch([includedText, excludedText, 'This passage has no matching word at all today.'], page, revision);
    expect(mixed.error).toMatch(/Synthetic model failure/);
    expect(mixed.results[`${revision}:${hashKey(includedText)}`].map((s) => s.word)).toEqual([due]);
    expect(mixed.results[`${revision}:${hashKey(excludedText)}`]).toEqual([]);
    expect(data.recallReview.learning.count).toBe(1);
    modelFails = false;
    statusWritesFail = false;
    expect(await send({ type: 'inlineBegin', word: due, revision }, { ...page, url: 'https://mail.google.com/' }))
      .toMatchObject({ error: expect.any(String) });
    expect(await send({ type: 'inlineBegin', word: due, revision }, page)).toMatchObject({ ticket: expect.any(String) });
    const ticket = data.recallReview.inline.ticket;
    expect((await send({ type: 'inlineRate', ticket, rating: 'easy', revision }, page)).error).toMatch(/Reveal/);
    expect((await send({ type: 'inlineReveal', ticket, revision }, other)).error).toMatch(/stale/);
    expect((await send({ type: 'inlineReveal', ticket, revision }, page)).answer.fr).toBe(due);
    await send({ type: 'save', settings: { enabled: false } }, popup);
    expect((await send({ type: 'inlineRate', ticket, rating: 'easy', revision }, page)).error).toMatch(/no longer/);
    await send({ type: 'save', settings: { enabled: true } }, popup);
    const reenabled = (await send({ type: 'config' }, page)).revision;
    expect(reenabled).not.toBe(revision);
    expect((await send({ type: 'inlineRate', ticket, rating: 'easy', revision }, page)).error).toMatch(/no longer/);
    const afterToggle = (await send({ type: 'inlineBegin', word: due, revision: reenabled }, page)).ticket;
    expect(afterToggle).toEqual(expect.any(String));
    expect((await send({ type: 'inlineReveal', ticket: afterToggle, revision: reenabled }, page)).answer.fr).toBe(due);
    origins = [];
    await permissionRemoved[0]();
    expect((await send({ type: 'inlineRate', ticket: afterToggle, rating: 'easy', revision: reenabled }, page)).error).toMatch(/no longer/);
    origins = ['<all_urls>'];
    await permissionAdded[0]();
    const restored = (await send({ type: 'config' }, page)).revision;
    expect(restored).not.toBe(reenabled);
    expect((await send({ type: 'inlineRate', ticket: afterToggle, rating: 'easy', revision: reenabled }, page)).error).toMatch(/no longer/);
    const current = (await send({ type: 'inlineBegin', word: due, revision: restored }, page)).ticket;
    expect(current).toEqual(expect.any(String));
    expect((await send({ type: 'inlineReveal', ticket: current, revision: restored }, page)).answer.fr).toBe(due);
    const raced = await Promise.all([
      send({ type: 'inlineRate', ticket: current, rating: 'easy', revision: restored }, page),
      send({ type: 'inlineRate', ticket: current, rating: 'hard', revision: restored }, page),
    ]);
    expect(raced.filter((r) => r.ok)).toHaveLength(1);
    expect(data.recallReview.cards[due].reviews).toBe(1);
    expect((await send({ type: 'inlineBegin', word: due, revision: restored }, page)).error).toMatch(/not due/);
    expect(await send({ type: 'reviewStatus' }, page)).toBeUndefined();
    await send({ type: 'save', settings: { enabled: false } }, popup);
    expect((await send({ type: 'inlineBegin', word: due, revision }, page)).error).toMatch(/no longer/);
    const old = structuredClone(data.recallReview);
    await send({ type: 'save', settings: { enabled: true, newWordsPerDay: 2 } }, popup);
    const resumed = (await send({ type: 'config' }, page)).revision;
    cacheWritesFail = true;
    const cacheFailed = await ask(excludedText, page, resumed);
    expect(cacheFailed.error).toMatch(/Cache storage failed/);
    expect(cacheFailed.results).toEqual({});
    expect(data.recallReview).toEqual(old);
    cacheWritesFail = false;
    writesFail = true;
    const failed = await ask(excludedText, page, resumed);
    expect(failed.error).toMatch(/Storage failed/);
    expect(failed.results).toEqual({});
    expect(data.recallReview).toEqual(old);
  } finally { Object.assign(globalThis, prior); }
}, 30000);

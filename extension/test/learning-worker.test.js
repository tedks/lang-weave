import { test, expect } from 'bun:test';
import { hashKey } from '../src/hash.js';
import { localDay } from '../src/events.js';

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
    tabs: { get: async () => ({ id: 7, title: 'Ordinary reading' }), query: async () => [], sendMessage: async () => {} }, action: { setBadgeText: async () => {} },
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
    expect(Object.keys(data.recallReview.cards)).toHaveLength(0);
    expect(data.recallReview.learning.count).toBe(0);
    expect(data.recallReview.learning.pending).toHaveLength(1);
    const first = [a, b].flatMap((r, i) => Object.values(r.results).flat().map((s) => ({ swap: s, sender: i ? other : page })))
      .find(({ swap }) => swap.status === 'new');
    expect((await send({ type: 'introAck', word: first.swap.word, ticket: first.swap.introTicket,
      revision }, first.sender === page ? other : page)).ok).toBe(false);
    expect(data.recallReview.learning.count).toBe(0);
    writesFail = true;
    expect((await send({ type: 'introAck', word: first.swap.word, ticket: first.swap.introTicket,
      revision }, first.sender)).error).toMatch(/Storage failed/);
    expect(data.recallReview.learning.count).toBe(0);
    writesFail = false;
    expect((await send({ type: 'introAck', word: first.swap.word, ticket: first.swap.introTicket,
      revision }, first.sender)).ok).toBe(true);
    expect((await send({ type: 'introAck', word: first.swap.word, ticket: first.swap.introTicket,
      revision }, first.sender)).ok).toBe(true);
    expect(data.recallReview.learning.count).toBe(1);
    expect(Object.keys(data.recallReview.cards)).toHaveLength(1);
    expect((await send({ type: 'inlineBegin', word: first.swap.word, revision }, first.sender)).error).toMatch(/not due/);
    // The local calendar day boundary, rather than elapsed hours, authorizes automatic cues.
    data.recallReview.cards[first.swap.word].introducedDay = '2000-01-01';
    expect(modelCalls).toBe(2);
    expect((await ask('I explained the idea to my friends today.', page, revision)).results).toBeDefined();
    expect(data.recallReview.learning.count).toBe(1);
    const due = Object.keys(data.recallReview.cards)[0];
    const includedText = due === 'la idea' ? 'I explained the idea to my friends today.' : 'I answered the question for my class today.';
    const excludedText = due === 'la idea' ? 'I answered the question for my class today.' : 'I explained the idea to my friends today.';
    // Prime decisions under the current, exhausted policy; the earlier model
    // decisions were made before the first introduction changed eligibility.
    await askBatch([includedText, excludedText], page, revision);
    modelFails = true;
    const mixed = await askBatch([includedText, excludedText, 'This passage has no matching word at all today.'], page, revision);
    expect(mixed.error).toBe('Model request failed');
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
    const beforeRating = structuredClone(data.recallReview);
    writesFail = true;
    expect((await send({ type: 'inlineRate', ticket: current, rating: 'easy', revision: restored }, page)).error).toMatch(/Storage failed/);
    expect(data.recallReview).toEqual(beforeRating);
    writesFail = false;
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
    expect(cacheFailed.error).toBe('Model request failed');
    expect(cacheFailed.results).toEqual({});
    expect(data.recallReview).toEqual(old);
    cacheWritesFail = false;
    writesFail = true;
    const failed = await ask(excludedText, page, resumed);
    expect(failed.error).toBe('Model request failed');
    expect(failed.results).toEqual({});
    expect(data.recallReview).toEqual(old);
    writesFail = false;
    await send({ type: 'save', settings: { newWordsPerDay: 1 } }, popup);
    const nextRevision = (await send({ type: 'config' }, page)).revision;
    const empty = await ask(excludedText, page, nextRevision);
    expect(Object.values(empty.results).flat()).toEqual([]);
    const beforeNewDay = modelCalls;
    // This stored count came from an earlier local day. The same passage must
    // miss yesterday's cached empty decision and be considered for a new word.
    data.recallReview.learning.day = '2000-01-01';
    const nextDay = await ask(excludedText, page, nextRevision);
    expect(Object.values(nextDay.results).flat().map((s) => s.status)).toEqual(['new']);
    expect(modelCalls).toBe(beforeNewDay + 1);
    data.recallReview.cards = {}; // exhausted allowance with no retained candidate
    const beforeEmpty = modelCalls;
    expect(Object.values((await ask(excludedText, page, nextRevision)).results)).toEqual([[]]);
    expect(modelCalls).toBe(beforeEmpty);
    data.recallReview.cards['la idea'] = { due: Date.now(), interval: 0, reviews: 1,
      introducedDay: '2099-01-01' };
    const preserved = structuredClone(data.recallReview.cards);
    data.recallReview.learning = { day: '2099-01-01', count: 1, pending: [] };
    const warning = await send({ type: 'status' }, popup);
    expect(warning.budgetWarning).toBe('2099-01-01');
    expect((await send({ type: 'recoverBudget', confirm: false, day: '2099-01-01', scope: 'es' }, popup)).error)
      .toMatch(/Confirm/);
    expect((await send({ type: 'recoverBudget', confirm: true, day: '2099-01-01', scope: 'wrong' }, popup)).ok)
      .toBe(false);
    expect(data.recallReview.learning.day).toBe('2099-01-01');
    expect((await send({ type: 'recoverBudget', confirm: true, day: '2099-01-01', scope: 'es' }, page)))
      .toBeUndefined();
    writesFail = true;
    expect((await send({ type: 'recoverBudget', confirm: true, day: '2099-01-01', scope: 'es' }, popup)).error)
      .toMatch(/Storage failed/);
    expect(data.recallReview.learning.day).toBe('2099-01-01');
    expect(data.recallReview.cards).toEqual(preserved);
    writesFail = false;
    expect((await send({ type: 'recoverBudget', confirm: true, day: '2099-01-01', scope: 'es' }, popup)).ok)
      .toBe(true);
    expect(data.recallReview.learning.count).toBe(0);
    expect(data.recallReview.cards['la idea']).toMatchObject({ ...preserved['la idea'], introGateDay: localDay() });
    expect((await send({ type: 'status' }, popup)).budgetWarning).toBe('');
    data.recallReview.cards = {};
    data.recallReview.learning = { day: localDay(), count: 0, pending: [] };
    const unplaced = Object.values((await ask(includedText, page, nextRevision)).results).flat()[0];
    expect(unplaced.introTicket).toEqual(expect.any(String));
    expect(data.recallReview.learning.count).toBe(0);
    await send({ type: 'introRelease', word: unplaced.word, ticket: unplaced.introTicket,
      revision: nextRevision }, other);
    expect(data.recallReview.learning.pending).toHaveLength(1);
    await send({ type: 'introRelease', word: unplaced.word, ticket: unplaced.introTicket,
      revision: nextRevision }, page);
    expect(data.recallReview.learning.pending).toHaveLength(0);
    const replacement = Object.values((await ask(excludedText, other, nextRevision)).results).flat()[0];
    expect(replacement.introTicket).toEqual(expect.any(String));
    expect((await send({ type: 'introAck', word: replacement.word, ticket: replacement.introTicket,
      revision: nextRevision }, other)).ok).toBe(true);
    expect(data.recallReview.learning.count).toBe(1);
    data.recallReview.cards = {};
    data.recallReview.learning = { day: localDay(), count: 0, pending: [] };
    const staleHold = Object.values((await ask(includedText, page, nextRevision)).results).flat()[0];
    data.recallReview.learning.pending[0].until = Date.now() - 1000;
    expect((await send({ type: 'introAck', word: staleHold.word, ticket: staleHold.introTicket,
      revision: nextRevision }, page)).ok).toBe(false);
    await ask('A separate paragraph without either target word is delivered.', other, nextRevision);
    expect(data.recallReview.learning.pending.some((p) => p.ticket === staleHold.introTicket)).toBe(true);
    const beforeRenew = modelCalls;
    expect((await send({ type: 'introRenew', word: staleHold.word, ticket: staleHold.introTicket,
      revision: nextRevision }, other)).ok).toBe(false);
    const renewed = await send({ type: 'introRenew', word: staleHold.word, ticket: staleHold.introTicket,
      revision: nextRevision }, page);
    expect(renewed.ticket).toEqual(expect.any(String));
    expect(renewed.ticket).not.toBe(staleHold.introTicket);
    expect((await send({ type: 'introRenew', word: staleHold.word, ticket: staleHold.introTicket,
      revision: nextRevision }, page)).ticket).toBe(renewed.ticket);
    expect(modelCalls).toBe(beforeRenew);
    expect((await send({ type: 'introAck', word: staleHold.word, ticket: renewed.ticket,
      revision: nextRevision }, page)).ok).toBe(true);
    expect(data.recallReview.learning.count).toBe(1);
  } finally { Object.assign(globalThis, prior); }
}, 30000);

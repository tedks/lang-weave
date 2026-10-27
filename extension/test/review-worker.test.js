import { test, expect } from 'bun:test';
import { DAY_MS, REVIEW_KEY } from '../src/review.js';

test('worker owns review access, persistence, and raced rating serialization', async () => {
  const saved = { chrome: globalThis.chrome, Date: globalThis.Date, fetch: globalThis.fetch };
  const RealDate = Date;
  let now = Date.parse('2026-10-17T12:00:00Z');
  class Clock extends RealDate { static now() { return now; } }
  globalThis.Date = Clock;
  const data = { settings: { enabled: false, levelOverride: 1 } }; // reviews work without a key or enabled reading
  const handlers = [];
  const on = (arr = []) => ({ addListener: (fn) => arr.push(fn) });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
  let failReviewWrite = false;
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        await tick();
        const pick = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
        return structuredClone(Object.fromEntries(pick.filter((key) => key in data).map((key) => [key, data[key]])));
      },
      async set(value) { await tick(); if (failReviewWrite && REVIEW_KEY in value) throw new Error('Storage failed');
        Object.assign(data, structuredClone(value)); },
      async remove(keys) { for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key]; },
    } },
    runtime: { id: 'fw-test', getURL: (path) => `chrome-extension://fw-test/${path}`,
      getManifest: () => ({ version: '0.4.0' }), onMessage: on(handlers), onInstalled: on(), onStartup: on() },
    tabs: { query: async () => [], sendMessage: async () => {} },
    action: { setBadgeText: async () => {} },
    alarms: { create: async () => {}, onAlarm: on() },
    permissions: { getAll: async () => ({ origins: [] }), onAdded: on(), onRemoved: on() },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  };
  globalThis.fetch = async () => { throw new Error('Review made a network request'); };
  const dispatch = (msg, sender) => new Promise((resolve) => {
    if (!handlers.some((fn) => fn(msg, sender, resolve))) resolve(undefined);
  });
  const review = { id: 'fw-test', url: 'chrome-extension://fw-test/src/review.html' };
  const page = { id: 'fw-test', url: 'https://example.com/', tab: { id: 1 } };
  const popup = { id: 'fw-test', url: 'chrome-extension://fw-test/src/popup.html' };
  try {
    await import('../src/background.js?review-worker');
    expect(await dispatch({ type: 'reviewIntroduce' }, page)).toBeUndefined();
    expect(await dispatch({ type: 'reviewRate', ticket: 'x', rating: 'easy' }, popup)).toBeUndefined();
    expect(await dispatch({ type: 'reviewStatus' }, review)).toEqual({ due: 0, new: 30, language: 'Spanish' });
    expect((await dispatch({ type: 'reviewIntroduce' }, review)).added).toBe(5);
    expect((await dispatch({ type: 'reviewIntroduce' }, review)).added).toBe(5);
    expect(Object.keys(data[REVIEW_KEY].cards)).toHaveLength(10);
    const first = (await dispatch({ type: 'reviewNext' }, review)).card;
    expect(first.en).toBe('and');
    expect(first.fr).toBeUndefined();
    expect((await dispatch({ type: 'reviewRate', ticket: first.ticket, rating: 'easy' }, review)).error).toMatch(/not been revealed/);
    expect((await dispatch({ type: 'reviewReveal', ticket: first.ticket }, review)).answer.fr).toBe('y');
    const replies = await Promise.all([
      dispatch({ type: 'reviewRate', ticket: first.ticket, rating: 'easy' }, review),
      dispatch({ type: 'reviewRate', ticket: first.ticket, rating: 'hard' }, review),
    ]);
    expect(replies.filter((r) => r.ok)).toHaveLength(1);
    expect(replies.filter((r) => r.error)).toHaveLength(1);
    expect(data[REVIEW_KEY].cards.y.reviews).toBe(1);
    expect(data[REVIEW_KEY].cards.y.interval).toBe(7);
    expect((await dispatch({ type: 'reviewReveal', ticket: first.ticket }, review)).error).toMatch(/no longer/);
    data['c:synthetic'] = { s: [], t: now };
    const beforeClear = structuredClone(data[REVIEW_KEY]);
    expect((await dispatch({ type: 'clearCache' }, popup)).removed).toBe(1);
    expect(data['c:synthetic']).toBeUndefined();
    expect(data[REVIEW_KEY]).toEqual(beforeClear); // model cache controls cannot erase recall history
    expect((await dispatch({ type: 'reviewNext' }, review)).card.en).toBe('but');
    now += 7 * DAY_MS;
    expect((await dispatch({ type: 'reviewStatus' }, review)).due).toBe(10);
    // Storage survives a page refresh or service worker suspension.
    expect((await dispatch({ type: 'reviewNext' }, review)).card.ticket).toBe(data[REVIEW_KEY].current.ticket);
    // A revealed L2 prompt becomes stale on switching to L1, while card history survives.
    for (const card of Object.values(data[REVIEW_KEY].cards)) card.due = now + 10 * DAY_MS;
    data[REVIEW_KEY].cards.si = { due: now - DAY_MS, interval: 0, reviews: 0 };
    data[REVIEW_KEY].current = null;
    data.settings.levelOverride = 2;
    const l2 = (await dispatch({ type: 'reviewNext' }, review)).card;
    expect(l2.en).toBe('if');
    expect((await dispatch({ type: 'reviewReveal', ticket: l2.ticket }, review)).answer.fr).toBe('si');
    const cardsBeforeSwitch = structuredClone(data[REVIEW_KEY].cards);
    data.settings.levelOverride = 1;
    expect((await dispatch({ type: 'reviewRate', ticket: l2.ticket, rating: 'easy' }, review)).error).toMatch(/stale/);
    expect((await dispatch({ type: 'reviewNext' }, review)).card).toBeNull();
    expect(data[REVIEW_KEY].current).toBeNull();
    expect(data[REVIEW_KEY].cards).toEqual(cardsBeforeSwitch);
    data.settings.levelOverride = 2;
    const resumed = (await dispatch({ type: 'reviewNext' }, review)).card;
    expect(resumed.en).toBe('if');
    expect(resumed.ticket).not.toBe(l2.ticket);
    expect((await dispatch({ type: 'reviewRate', ticket: l2.ticket, rating: 'easy' }, review)).error).toMatch(/stale/);
    expect(data[REVIEW_KEY].cards.si.reviews).toBe(0);

    // A malformed persisted ticket cannot authorize a rating or survive the next load.
    data[REVIEW_KEY].current = { word: 'si', ticket: 'invalid', revealed: true };
    expect((await dispatch({ type: 'reviewRate', ticket: 'invalid', rating: 'easy' }, review)).error).toMatch(/stale/);
    const recovered = (await dispatch({ type: 'reviewNext' }, review)).card;
    expect(recovered.en).toBe('if');
    expect(recovered.ticket).not.toBe('invalid');
    expect(data[REVIEW_KEY].cards).toEqual(cardsBeforeSwitch);

    // Existing standalone review keeps scheduling after three Easy ratings
    // unless the reader opted into gradual learning.
    data.settings.levelOverride = 1;
    data[REVIEW_KEY].cards.y = { due: now, interval: 21, reviews: 2, easyStreak: 2 };
    data[REVIEW_KEY].current = null;
    const ordinary = (await dispatch({ type: 'reviewNext' }, review)).card;
    expect(ordinary.en).toBe('and');
    await dispatch({ type: 'reviewReveal', ticket: ordinary.ticket }, review);
    expect((await dispatch({ type: 'reviewRate', ticket: ordinary.ticket, rating: 'easy' }, review)).ok).toBe(true);
    expect(data[REVIEW_KEY].cards.y.familiar).toBeUndefined();
    data.settings.gradual = true;
    data[REVIEW_KEY].cards.y.due = now;
    const opted = (await dispatch({ type: 'reviewNext' }, review)).card;
    await dispatch({ type: 'reviewReveal', ticket: opted.ticket }, review);
    expect((await dispatch({ type: 'reviewRate', ticket: opted.ticket, rating: 'easy' }, review)).ok).toBe(true);
    expect(data[REVIEW_KEY].cards.y.familiar).toBe(true);

    // A legacy card can miss after prior success without losing history or
    // charging another introduction; the worker persists one rating only.
    data[REVIEW_KEY].cards.y = { due: now, interval: 21, reviews: 9, easyStreak: 2,
      introducedDay: '2026-10-17' };
    data[REVIEW_KEY].current = null;
    const missed = (await dispatch({ type: 'reviewNext' }, review)).card;
    expect(missed.en).toBe('and');
    expect((await dispatch({ type: 'reviewRate', ticket: missed.ticket, rating: 'again' }, review)).error)
      .toMatch(/not been revealed/);
    expect((await dispatch({ type: 'reviewReveal', ticket: missed.ticket }, review)).answer.fr).toBe('y');
    const beforeMiss = structuredClone(data[REVIEW_KEY]);
    failReviewWrite = true;
    expect((await dispatch({ type: 'reviewRate', ticket: missed.ticket, rating: 'again' }, review)).error)
      .toMatch(/Storage failed/);
    expect(data[REVIEW_KEY]).toEqual(beforeMiss);
    failReviewWrite = false;
    const missReplies = await Promise.all([
      dispatch({ type: 'reviewRate', ticket: missed.ticket, rating: 'again' }, review),
      dispatch({ type: 'reviewRate', ticket: missed.ticket, rating: 'again' }, review),
    ]);
    expect(missReplies.filter((r) => r.ok)).toHaveLength(1);
    expect(missReplies.filter((r) => r.error)).toHaveLength(1);
    const savedMiss = structuredClone(data[REVIEW_KEY]);
    expect(savedMiss.cards.y.due).toBe(now + 10 * 60 * 1000);
    expect(savedMiss.cards.y.interval).toBe(0);
    expect(savedMiss.cards.y.easyStreak).toBe(0);
    expect(savedMiss.cards.y.introducedDay).toBe('2026-10-17');
    expect(savedMiss.learning.count).toBe(beforeMiss.learning.count);
    expect((await dispatch({ type: 'reviewRate', ticket: missed.ticket, rating: 'again' }, review)).error)
      .toMatch(/stale/);
    now += 10 * 60 * 1000 - 1;
    expect((await dispatch({ type: 'reviewStatus' }, review)).due).toBe(0);
    now++;
    expect((await dispatch({ type: 'reviewStatus' }, review)).due).toBe(1);
    const hard = (await dispatch({ type: 'reviewNext' }, review)).card;
    expect(hard.en).toBe('and');
    await dispatch({ type: 'reviewReveal', ticket: hard.ticket }, review);
    expect((await dispatch({ type: 'reviewRate', ticket: hard.ticket, rating: 'hard' }, review)).ok).toBe(true);
    expect(data[REVIEW_KEY].cards.y.due).toBe(now + DAY_MS);
    expect(data[REVIEW_KEY].cards.y.interval).toBe(1);
  } finally {
    Object.assign(globalThis, saved);
  }
});

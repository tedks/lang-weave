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
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        await tick();
        const pick = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
        return structuredClone(Object.fromEntries(pick.filter((key) => key in data).map((key) => [key, data[key]])));
      },
      async set(value) { await tick(); Object.assign(data, structuredClone(value)); },
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
    expect(await dispatch({ type: 'reviewStatus' }, review)).toEqual({ due: 0, new: 30 });
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
  } finally {
    Object.assign(globalThis, saved);
  }
});

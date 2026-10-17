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
        const pick = typeof keys === 'string' ? [keys] : keys;
        return structuredClone(Object.fromEntries(pick.filter((key) => key in data).map((key) => [key, data[key]])));
      },
      async set(value) { await tick(); Object.assign(data, structuredClone(value)); },
      async remove() {},
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
    expect((await dispatch({ type: 'reviewNext' }, review)).card.en).toBe('but');
    now += 7 * DAY_MS;
    expect((await dispatch({ type: 'reviewStatus' }, review)).due).toBe(10);
    // Storage survives a page refresh or service worker suspension.
    expect((await dispatch({ type: 'reviewNext' }, review)).card.ticket).toBe(data[REVIEW_KEY].current.ticket);
  } finally {
    Object.assign(globalThis, saved);
  }
});

import { test, expect } from 'bun:test';
import { DAY_MS, REVIEW_KEY } from '../src/review.js';
import { RETRIEVALS_KEY } from '../src/learning-log.js';
import { PERSONAL_KEY } from '../src/personal.js';

const ID = 'fw-progress';
const BASE = `chrome-extension://${ID}/`;
const sender = (page) => ({ id: ID, url: `${BASE}src/${page}.html` });
const UUID = '0b5e7e4c-1d2a-4c3b-9f8e-1a2b3c4d5e6f';

// Boots the real worker with an in-memory storage and a controllable clock.
async function boot(name, data) {
  const RealDate = Date;
  const clock = { now: Date.parse('2026-10-20T15:00:00Z') };
  class Clock extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  globalThis.Date = Clock;
  const handlers = [];
  const on = (arr = []) => ({ addListener: (fn) => arr.push(fn) });
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        const pick = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
        return structuredClone(Object.fromEntries(pick.filter((k) => k in data).map((k) => [k, data[k]])));
      },
      async set(values) { Object.assign(data, structuredClone(values)); },
      async remove(keys) { for (const k of [keys].flat()) delete data[k]; },
    } },
    runtime: { id: ID, getURL: (path) => `${BASE}${path}`, getManifest: () => ({ version: '0.12.9' }),
      onMessage: on(handlers), onInstalled: on(), onStartup: on(), onConnect: on() },
    tabs: { query: async () => [], sendMessage: async () => {} },
    action: { setBadgeText: async () => {} },
    alarms: { create: async () => {}, onAlarm: on() },
    permissions: { getAll: async () => ({ origins: [] }), onAdded: on(), onRemoved: on() },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  };
  globalThis.fetch = async () => { throw new Error('progress made a network request'); };
  await import(`../src/background.js?${name}`);
  const dispatch = (msg, from) => new Promise((resolve) => {
    if (!handlers.some((fn) => fn(msg, from, resolve))) resolve(undefined);
  });
  return { clock, dispatch, restore: () => { globalThis.Date = RealDate; } };
}

test('words actions: Practice now serves the chosen card first, Reset is guarded and forgets only the card', async () => {
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const data = { settings: { enabled: false, levelOverride: 1 } };
  const { clock, dispatch, restore } = await boot('progress-actions', data);
  const words = sender('words'), review = sender('review'), popup = sender('popup');
  try {
    // Only the words page may act on words; the popup may only read progress.
    expect(await dispatch({ type: 'wordReset', id: 'y', scope: 'es', confirm: true }, popup)).toBeUndefined();
    expect(await dispatch({ type: 'wordsList' }, review)).toBeUndefined();
    const first = await dispatch({ type: 'progress' }, popup);
    expect(first).toMatchObject({ language: 'Spanish', due: 0, new: 30, verifiedKnown: 0, practisedThisWeek: 0,
      today: { introduced: 0, seen: 0, peeked: 0, flipped: 0, reviewed: 0 } });
    expect(first.stages.new).toBeGreaterThanOrEqual(200);
    expect(first.activity).toHaveLength(30);

    const list = await dispatch({ type: 'wordsList' }, words);
    expect(list.scope).toBe('es');
    expect(list.rows.length).toBe(first.stages.new);
    expect(JSON.stringify(list)).not.toMatch(/https?:|example\.com/);
    expect(list.rows.find((row) => row.id === 'pero')).toMatchObject({ kind: 'pack', gloss: 'but', stage: 'new',
      due: null, version: null, practise: true });
    const above = list.rows.find((row) => !row.practise);
    expect(above.reason).toBe('Above your current reading level');
    expect((await dispatch({ type: 'wordPractice', id: above.id, scope: 'es' }, words)).error).toMatch(/level/);

    // Two cards due now; Practice now on a new word still puts that word first.
    expect((await dispatch({ type: 'reviewIntroduce' }, review)).added).toBe(5);
    // A word at the current level that the five additions did not include.
    const chosen = list.rows.find((row) => row.practise && !data[REVIEW_KEY].cards[row.id]);
    const W = chosen.id, G = chosen.gloss;
    expect(await dispatch({ type: 'wordPractice', id: W, scope: 'es' }, words)).toEqual({ ok: true, introduced: true });
    let next = await dispatch({ type: 'reviewNext' }, review);
    expect(next.card.en).toBe(G);
    await dispatch({ type: 'reviewReveal', ticket: next.card.ticket }, review);
    expect((await dispatch({ type: 'reviewRate', ticket: next.card.ticket, rating: 'medium' }, review)).interval).toBe(2);

    // A card not due for two days: Practice now makes it an early review scheduled by FSRS.
    clock.now += DAY_MS;
    expect(data[REVIEW_KEY].cards[W].due).toBeGreaterThan(clock.now);
    expect(await dispatch({ type: 'wordPractice', id: W, scope: 'es' }, words)).toEqual({ ok: true, introduced: false });
    expect(data[REVIEW_KEY].current).toMatchObject({ word: W, practice: true, revealed: false });
    expect(data[REVIEW_KEY].current.shownAt).toBeUndefined();
    clock.now += 2000;
    next = await dispatch({ type: 'reviewNext' }, review);
    expect(next.card.en).toBe(G);
    expect(data[REVIEW_KEY].current.shownAt).toBe(clock.now); // latency starts when the page shows it
    clock.now += 3000;
    expect((await dispatch({ type: 'reviewReveal', ticket: next.card.ticket }, review)).answer.fr).toBe(W);
    const early = await dispatch({ type: 'reviewRate', ticket: next.card.ticket, rating: 'easy' }, review);
    expect(early.ok).toBe(true);
    expect(data[REVIEW_KEY].cards[W].reviews).toBe(2);
    const logged = data[RETRIEVALS_KEY].retrievals.at(-1);
    expect(logged.slice(0, 8)).toEqual([W, clock.now, 'standalone', 'productive', 'easy', 1, 3000, 1]);
    expect(logged[9]).toBeGreaterThan(0.9); // an early review: high predicted recall, as FSRS computes it
    expect(data[REVIEW_KEY].current).toBeNull();
    // Without a practice ticket a not-due card is never served.
    expect((await dispatch({ type: 'reviewNext' }, review)).card.en).not.toBe(G);

    // Reset guard: confirm, scope, word and the card version the page showed are all required.
    const shown = (await dispatch({ type: 'wordsList' }, words)).rows.find((row) => row.id === W);
    expect(shown).toMatchObject({ stage: 'learning', reviews: 2 });
    const before = structuredClone(data[REVIEW_KEY].cards[W]);
    const refused = [
      { type: 'wordReset', id: W, scope: 'es', version: shown.version },
      { type: 'wordReset', id: W, scope: 'es', confirm: 'yes', version: shown.version },
      { type: 'wordReset', id: W, scope: 'fr:1', confirm: true, version: shown.version },
      { type: 'wordReset', id: W, confirm: true, version: shown.version },
      { type: 'wordReset', id: W, scope: 'es', confirm: true },
      { type: 'wordReset', id: W, scope: 'es', confirm: true, version: { ...shown.version, reviews: 1 } },
      { type: 'wordReset', id: 'nada-x', scope: 'es', confirm: true, version: shown.version },
      { type: 'wordReset', id: 'constructor', scope: 'es', confirm: true, version: shown.version },
    ];
    for (const msg of refused) expect((await dispatch(msg, words)).error).toBeTruthy();
    expect(data[REVIEW_KEY].cards[W]).toEqual(before);
    // A rating between listing and confirming makes the reset stale.
    expect(await dispatch({ type: 'wordPractice', id: W, scope: 'es' }, words)).toMatchObject({ ok: true });
    next = await dispatch({ type: 'reviewNext' }, review);
    await dispatch({ type: 'reviewReveal', ticket: next.card.ticket }, review);
    await dispatch({ type: 'reviewRate', ticket: next.card.ticket, rating: 'hard' }, review);
    expect((await dispatch({ type: 'wordReset', id: W, scope: 'es', confirm: true, version: shown.version }, words)))
      .toMatchObject({ stale: true });
    // With the current version it resets: the card and any open ticket for it are gone; the log stays.
    const fresh = (await dispatch({ type: 'wordsList' }, words)).rows.find((row) => row.id === W);
    await dispatch({ type: 'wordPractice', id: W, scope: 'es' }, words);
    const ticket = data[REVIEW_KEY].current.ticket;
    const logLength = data[RETRIEVALS_KEY].retrievals.length;
    const reset = await dispatch({ type: 'wordReset', id: W, scope: 'es', confirm: true,
      version: (await dispatch({ type: 'wordsList' }, words)).rows.find((row) => row.id === W).version }, words);
    expect(fresh.version.reviews).toBe(3);
    expect(reset).toEqual({ ok: true });
    expect(data[REVIEW_KEY].cards[W]).toBeUndefined();
    expect(data[REVIEW_KEY].current).toBeNull();
    expect((await dispatch({ type: 'reviewReveal', ticket }, review)).error).toBeTruthy();
    expect(data[RETRIEVALS_KEY].retrievals).toHaveLength(logLength);
    expect((await dispatch({ type: 'wordsList' }, words)).rows.find((row) => row.id === W).stage).toBe('new');
    expect((await dispatch({ type: 'wordReset', id: W, scope: 'es', confirm: true, version: fresh.version }, words)).error)
      .toMatch(/no progress/);

    // Already know: a claim on a new word creates a familiar card; Practice now then refuses it.
    expect(await dispatch({ type: 'wordKnown', id: W, scope: 'es' }, words)).toEqual({ ok: true });
    expect(data[REVIEW_KEY].cards[W]).toMatchObject({ familiar: true, reviews: 0 });
    expect((await dispatch({ type: 'wordPractice', id: W, scope: 'es' }, words)).error).toMatch(/known/);
    const progress = await dispatch({ type: 'progress' }, sender('options'));
    expect(progress.stages.known).toBe(1);
    // The five were added yesterday; today's familiar card is a claim, not an introduction.
    expect(progress.today.introduced).toBe(0);
    expect(progress.today.reviewed).toBe(2);
    expect(progress.practisedThisWeek).toBe(2);
    expect(progress.activity.filter((d) => d.retrievals).map((d) => d.retrievals)).toEqual([1, 2]);
  } finally {
    restore();
    globalThis.chrome = saved.chrome;
    globalThis.fetch = saved.fetch;
  }
});

test('personal words: practice, archive refusal, and linked entries share the bundled row', async () => {
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const LINKED = '7d1c2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  const data = {
    settings: { enabled: false, levelOverride: 1 },
    [PERSONAL_KEY]: { version: 1, revision: 1, entries: [
      { uuid: UUID, id: `personal:es:${UUID}`, language: 'es', source: 'shimmer', target: 'brillar', sense: 'shimmer',
        direction: 'en-to-target', archived: false, provenance: 'manual', createdAt: 1 },
      { uuid: LINKED, id: `personal:es:${LINKED}`, language: 'es', source: 'but', target: 'pero', sense: 'but',
        direction: 'en-to-target', archived: false, provenance: 'bundled-suggestion', createdAt: 2,
        linkedLegacy: 'es:legacy:pero' },
    ], history: {} },
  };
  const { dispatch, restore } = await boot('progress-personal', data);
  const words = sender('words'), review = sender('review');
  const id = `personal:es:${UUID}`;
  try {
    expect((await dispatch({ type: 'reviewIntroduce' }, review)).added).toBe(5); // pack cards due first
    const list = await dispatch({ type: 'wordsList' }, words);
    expect(list.rows.filter((row) => row.kind === 'personal').map((row) => row.id)).toEqual([id]);
    expect(list.rows.find((row) => row.id === 'pero').saved).toEqual({ id: `personal:es:${LINKED}`, archived: false });
    expect((await dispatch({ type: 'wordKnown', id: `personal:es:${LINKED}`, scope: 'es' }, words)).error).toMatch(/bundled/);
    // A personal word chosen with Practice now beats earlier-due pack cards.
    expect(await dispatch({ type: 'wordPractice', id, scope: 'es' }, words)).toEqual({ ok: true, introduced: true });
    const next = await dispatch({ type: 'reviewNext' }, review);
    expect(next.card.en).toBe('shimmer');
    expect((await dispatch({ type: 'reviewReveal', ticket: next.card.ticket }, review)).answer.fr).toBe('brillar');
    expect((await dispatch({ type: 'reviewRate', ticket: next.card.ticket, rating: 'medium' }, review)).ok).toBe(true);
    expect(data[PERSONAL_KEY].history.es.cards[id].reviews).toBe(1);
    expect(data[`lang:personal:es:${RETRIEVALS_KEY}`].retrievals).toHaveLength(1);
    // Archived: listed with Unarchive, but no practice and no claim.
    expect(await dispatch({ type: 'personalArchive', id, archived: true }, words)).toEqual({ ok: true });
    const archived = (await dispatch({ type: 'wordsList' }, words)).rows.find((row) => row.id === id);
    expect(archived).toMatchObject({ archived: true, practise: false, reason: 'Archived', stage: 'learning' });
    expect((await dispatch({ type: 'wordPractice', id, scope: 'es' }, words)).error).toMatch(/Unarchive/);
    expect((await dispatch({ type: 'wordKnown', id, scope: 'es' }, words)).error).toMatch(/Unarchive/);
    // Reset still clears an archived word's card.
    expect(await dispatch({ type: 'wordReset', id, scope: 'es', confirm: true, version: archived.version }, words)).toEqual({ ok: true });
    expect(data[PERSONAL_KEY].history.es.cards[id]).toBeUndefined();
    const progress = await dispatch({ type: 'progress' }, words);
    expect(progress.today.reviewed).toBe(1);
  } finally {
    restore();
    globalThis.chrome = saved.chrome;
    globalThis.fetch = saved.fetch;
  }
});

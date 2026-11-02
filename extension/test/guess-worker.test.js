// Guess first through the real worker listener: eligibility, the three-guess cap, one guess a
// local day, the logged record, a wrong guess as a peek, and the consent and ticket checks.
import { test, expect } from 'bun:test';
import { localDay } from '../src/events.js';

test('the worker offers, records and caps guesses for learning words only', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch, now: Date.now };
  const today = localDay();
  const day = 86400000;
  let clock = Date.now();
  Date.now = () => clock;
  const data = {
    settings: { enabled: true, newSitesEnabled: true, gradual: true, newWordsPerDay: 1, inlineRecall: false,
      guessFirst: true },
    apiKey: 'synthetic-key',
    recallReview: { version: 1, cards: {
      y: { due: clock + 5 * day, interval: 5, reviews: 1, introducedDay: today },
      pero: { due: clock + 400 * day, interval: 365, reviews: 9, introducedDay: '2026-01-01', maintenance: true,
        fsrs: { stability: 300, difficulty: 3, lastReview: clock - day, lapses: 0 } },
      o: { due: clock + day, interval: 1, reviews: 0, introducedDay: today, claimAt: clock, claimDue: clock + 30 * day },
    }, learning: { day: today, count: 0, pending: [] } },
  };
  const listeners = [];
  let origins = ['<all_urls>'];
  const permissionRemoved = [];
  const on = (arr = []) => ({ addListener: (fn) => arr.push(fn) });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
  const session = {};
  let logWritesFail = false;
  let sessionFails = '';
  globalThis.chrome = {
    storage: { session: {
      async get(key) { await tick(); if (sessionFails === 'get') throw new Error('session');
        return key in session ? { [key]: structuredClone(session[key]) } : {}; },
      async set(values) { await tick(); if (sessionFails === 'set') throw new Error('session');
        Object.assign(session, structuredClone(values)); },
    }, local: {
      async setAccessLevel() {},
      async get(keys) { await tick(); const pick = typeof keys === 'string' ? [keys] : keys || Object.keys(data);
        return structuredClone(Object.fromEntries(pick.filter((k) => k in data).map((k) => [k, data[k]]))); },
      async set(values) { await tick(); if (logWritesFail && 'learningRetrievals' in values) throw new Error('Storage failed');
        Object.assign(data, structuredClone(values)); },
      async remove(keys) { for (const key of keys) delete data[key]; },
    } },
    runtime: { id: 'fw-test', getURL: (p) => `chrome-extension://fw-test/${p}`,
      getManifest: () => ({ version: '0.5.0' }), onMessage: on(listeners), onInstalled: on(), onStartup: on() },
    tabs: { get: async () => ({ id: 7, title: 'Ordinary reading', url: 'https://reading.example/article' }),
      query: async () => [], sendMessage: async () => {} },
    action: { setBadgeText: async () => {} },
    alarms: { create: async () => {}, onAlarm: on() },
    permissions: { getAll: async () => ({ origins }), onAdded: on(), onRemoved: on(permissionRemoved) },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  };
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('manifest.json')) return { ok: true, json: async () => ({ version: '0.5.0' }) };
    throw new Error('No model call is expected');
  };
  const send = (msg, sender) => new Promise((resolve) => { if (!listeners.some((fn) => fn(msg, sender, resolve))) resolve(undefined); });
  const page = { id: 'fw-test', tab: { id: 7 }, frameId: 0, documentId: 'doc-1',
    documentLifecycle: 'active', url: 'https://reading.example/article' };
  const other = { ...page, tab: { id: 8 }, documentId: 'doc-2' };
  const log = () => data.learningRetrievals?.retrievals || [];
  try {
    await import('../src/background.js?guess-worker');
    const config = await send({ type: 'config' }, page);
    const revision = config.revision;
    expect(config.settings.guessFirst).toBe(true); // pages receive it

    // Not learning: maintenance, a claim, an unknown word, a word with no card.
    for (const word of ['pero', 'o', 'nope', 'con'])
      expect(await send({ type: 'guessBegin', word, revision }, page)).toEqual({ plain: true });
    expect(log()).toHaveLength(0);

    const begin = await send({ type: 'guessBegin', word: 'y', revision }, page);
    expect(typeof begin.ticket).toBe('string');
    expect(begin.choices).toContain('and');
    expect(begin.choices.length).toBeGreaterThanOrEqual(3);
    expect(begin).not.toHaveProperty('answer'); // the page never learns which index is right before answering
    const right = begin.choices.indexOf('and');
    // The open ticket is held in session storage (it outlives an idle worker), never in local storage.
    expect(Object.values(session.guessTickets).map((t) => t.ticket)).toEqual([begin.ticket]);
    expect(Object.keys(data)).not.toContain('guessTickets');
    // Another document cannot answer this ticket.
    expect((await send({ type: 'guessAnswer', ticket: begin.ticket, choice: right, revision }, other)).error).toBeTruthy();
    // Another tab opens its own ticket for the same word while this one is open.
    const otherTab = await send({ type: 'guessBegin', word: 'y', revision }, other);
    expect(otherTab.ticket).toBeTruthy();
    clock += 4200;
    const wrong = (right + 1) % begin.choices.length;
    const before = structuredClone(data.recallReview.cards.y);
    const answered = await send({ type: 'guessAnswer', ticket: begin.ticket, choice: wrong, revision }, page);
    expect(answered).toEqual({ ok: true, correct: false, answer: right, logged: true });
    expect(log()).toEqual([['y', clock, 'guess', 'receptive', 'incorrect', 1, 4200, null, null, null]]);
    // A wrong guess is exactly a peek: the card's peek counter, the exposure peek and the event.
    expect(data.recallReview.cards.y.peekCount).toBe(1);
    expect(data.recallReview.cards.y.peekDay).toBe(today);
    expect(data.recallReview.cards.y.due).toBe(before.due); // FSRS state and due are untouched
    expect(data.recallReview.cards.y.fsrs).toEqual(before.fsrs);
    expect(data.learningExposures.words.y[1]).toBe(1);
    expect(data.readingEvents.at(-1)).toEqual({ word: 'y', kind: 'peek', day: today });
    // A ticket is single use.
    expect((await send({ type: 'guessAnswer', ticket: begin.ticket, choice: right, revision }, page)).error).toBeTruthy();
    // The other tab's ticket no longer passes: the answer rules are rechecked when it is answered.
    expect((await send({ type: 'guessAnswer', ticket: otherTab.ticket, choice: right, revision }, other)).error).toBeTruthy();
    expect(log()).toHaveLength(1);
    expect(data.recallReview.cards.y.peekCount).toBe(1);
    // One guess a word a day: the next hover today gets the plain gloss.
    expect(await send({ type: 'guessBegin', word: 'y', revision }, page)).toEqual({ plain: true });
    // A second peek today (the plain hover) brings the rated card's review earlier, never later.
    await send({ type: 'event', word: 'y', event: 'peek', revision }, page);
    expect(data.recallReview.cards.y.peekDue).toBeLessThanOrEqual(clock + day);
    expect(data.recallReview.cards.y.peekDue).toBeLessThan(before.due);

    // Next day: a right guess changes no card and records 'correct'.
    clock += day;
    const second = await send({ type: 'guessBegin', word: 'y', revision }, page);
    const cardBefore = structuredClone(data.recallReview.cards.y);
    const exposureBefore = structuredClone(data.learningExposures.words.y);
    clock += 900;
    expect(await send({ type: 'guessAnswer', ticket: second.ticket, choice: second.choices.indexOf('and'), revision }, page))
      .toEqual({ ok: true, correct: true, answer: second.choices.indexOf('and'), logged: true });
    expect(log().at(-1)).toEqual(['y', clock, 'guess', 'receptive', 'correct', 1, 900, null, null, null]);
    expect(data.recallReview.cards.y).toEqual(cardBefore);
    expect(data.learningExposures.words.y).toEqual(exposureBefore);

    // An out-of-range choice from the right document is refused and spends the ticket.
    clock += day;
    const bad = await send({ type: 'guessBegin', word: 'y', revision }, page);
    expect((await send({ type: 'guessAnswer', ticket: bad.ticket, choice: bad.choices.length, revision }, page)).error).toBeTruthy();
    expect((await send({ type: 'guessAnswer', ticket: bad.ticket, choice: 0, revision }, page)).error).toBeTruthy();
    expect(log()).toHaveLength(2);
    // A failed log write is not a recorded guess: an error, and no peek.
    const failing = await send({ type: 'guessBegin', word: 'y', revision }, page);
    const peeksBefore = data.recallReview.cards.y.peekCount;
    logWritesFail = true;
    const failed = await send({ type: 'guessAnswer', ticket: failing.ticket,
      choice: (failing.choices.indexOf('and') + 1) % failing.choices.length, revision }, page);
    logWritesFail = false;
    expect(failed.ok).not.toBe(true);
    expect(failed.error).toBeTruthy();
    expect(log()).toHaveLength(2);
    expect(data.recallReview.cards.y.peekCount).toBe(peeksBefore);

    // Dismissing (no answer) records nothing; the ticket simply lapses.
    clock += day;
    const dismissed = await send({ type: 'guessBegin', word: 'y', revision }, page);
    expect(dismissed.ticket).toBeTruthy();
    expect(log()).toHaveLength(2);
    // The third logged guess reaches the cap.
    const third = await send({ type: 'guessBegin', word: 'y', revision }, page); // replaces the open ticket
    expect((await send({ type: 'guessAnswer', ticket: dismissed.ticket, choice: 0, revision }, page)).error).toBeTruthy();
    expect((await send({ type: 'guessAnswer', ticket: third.ticket, choice: 0, revision }, page)).ok).toBe(true);
    clock += day;
    expect(await send({ type: 'guessBegin', word: 'y', revision }, page)).toEqual({ plain: true });
    expect(log().filter((t) => t[2] === 'guess')).toHaveLength(3);
    // A Reset re-introduces the word: guesses count within the card's current life, by day. A
    // same-day reset keeps today's earlier guess, so the word waits until tomorrow.
    data.recallReview.cards.y = { due: clock + day, interval: 0, reviews: 0, introducedDay: localDay(new Date(clock)) };
    const lastGuessDay = localDay(new Date(log().filter((t) => t[2] === 'guess').at(-1)[1]));
    expect(lastGuessDay).not.toBe(localDay(new Date(clock))); // the last guess was yesterday
    const renewed = await send({ type: 'guessBegin', word: 'y', revision }, page);
    expect(renewed.ticket).toBeTruthy();
    expect((await send({ type: 'guessAnswer', ticket: renewed.ticket, choice: 0, revision }, page)).ok).toBe(true);
    data.recallReview.cards.y = { due: clock + day, interval: 0, reviews: 0, introducedDay: localDay(new Date(clock)) };
    expect(await send({ type: 'guessBegin', word: 'y', revision }, page)).toEqual({ plain: true }); // same-day reset

    // Session storage failures fail closed: no ticket offered, and an unconsumable ticket is not recorded.
    clock += day;
    for (const mode of ['get', 'set']) {
      sessionFails = mode;
      expect(await send({ type: 'guessBegin', word: 'y', revision }, page)).toEqual({ plain: true, stale: true });
    }
    sessionFails = '';
    const held = await send({ type: 'guessBegin', word: 'y', revision }, page);
    const logged = log().length;
    for (const mode of ['get', 'set']) {
      sessionFails = mode;
      expect((await send({ type: 'guessAnswer', ticket: held.ticket, choice: 0, revision }, page)).error).toBeTruthy();
    }
    sessionFails = '';
    expect(log()).toHaveLength(logged);
    expect((await send({ type: 'guessAnswer', ticket: held.ticket, choice: 0, revision }, page)).ok).toBe(true); // still single-use
    expect((await send({ type: 'guessAnswer', ticket: held.ticket, choice: 0, revision }, page)).error).toBeTruthy();

    // A stale ticket (over ten minutes) is refused and records nothing.
    data.recallReview.cards.con = { due: clock + day, interval: 1, reviews: 0, introducedDay: localDay(new Date(clock)) };
    const slow = await send({ type: 'guessBegin', word: 'con', revision }, page);
    expect(slow.ticket).toBeTruthy();
    clock += 10 * 60 * 1000 + 1;
    expect((await send({ type: 'guessAnswer', ticket: slow.ticket, choice: 0, revision }, page)).error).toBeTruthy();
    expect(log().filter((t) => t[0] === 'con')).toHaveLength(0);

    // Consent: a site turned off between begin and answer records nothing.
    const open = await send({ type: 'guessBegin', word: 'con', revision }, page);
    expect(open.ticket).toBeTruthy();
    origins = [];
    for (const fn of permissionRemoved) await fn({ origins: ['<all_urls>'] });
    const off = await send({ type: 'guessAnswer', ticket: open.ticket, choice: 0, revision }, page);
    expect(off.ok).not.toBe(true);
    expect(log().filter((t) => t[0] === 'con')).toHaveLength(0);
    origins = ['<all_urls>'];

    // Setting off (or gradual off): the plain gloss, marked stale so the page does not cache it.
    // (The permission change above moved the revision; take the current one.)
    const onConfig = await send({ type: 'config' }, page);
    data.settings = { ...data.settings, guessFirst: false };
    const offConfig = await send({ type: 'config' }, page);
    expect(offConfig.revision).toBe(onConfig.revision); // guess first is outside the reading revision
    expect(offConfig.settings).not.toHaveProperty('guessFirst');
    expect(await send({ type: 'guessBegin', word: 'con', revision: offConfig.revision }, page))
      .toEqual({ plain: true, stale: true });

    // The Settings toggle: stored only while on, and never a new reading epoch (no cache or model cost).
    const options = { id: 'fw-test', url: 'chrome-extension://fw-test/src/options.html' };
    const epoch = data.epoch;
    expect((await send({ type: 'save', settings: { guessFirst: true } }, options)).ok).toBe(true);
    expect(data.settings.guessFirst).toBe(true);
    expect(data.epoch).toBe(epoch);
    expect((await send({ type: 'save', settings: { guessFirst: false } }, options)).ok).toBe(true);
    expect(data.settings).not.toHaveProperty('guessFirst');
    expect(data.epoch).toBe(epoch);
    expect((await send({ type: 'save', settings: { guessFirst: 'yes' } }, options)).ok).toBe(true);
    expect(data.settings).not.toHaveProperty('guessFirst');
  } finally {
    globalThis.chrome = prior.chrome;
    globalThis.fetch = prior.fetch;
    Date.now = prior.now;
  }
}, 30000);

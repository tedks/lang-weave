import { test, expect } from 'bun:test';
import { L1_WORDS, L2_WORDS } from '../src/vocabulary.js';
import { DAY_MS, cleanReview, introduce, nextReview, revealReview, rateReview, reviewCounts, markFamiliar, askable } from '../src/review.js';
import { initialState, nextState, intervalDays } from '../src/fsrs.js';

test('explicit introduction, clock scheduling, and one revealed rating per ticket', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const state = cleanReview(null, L2_WORDS);
  expect(reviewCounts(state, L1_WORDS, now)).toEqual({ due: 0, new: 30 });
  expect(nextReview(state, L1_WORDS, now)).toBeNull();
  expect(introduce(state, L1_WORDS, now)).toBe(5);
  const first = nextReview(state, L1_WORDS, now, () => 'ticket-1');
  expect(first).toEqual({ ticket: 'ticket-1', en: 'and', revealed: false });
  expect(rateReview(state, first.ticket, 'easy', now)).toBeNull();
  expect(revealReview(state, L1_WORDS, 'wrong', now)).toBeNull();
  expect(revealReview(state, L1_WORDS, first.ticket, now)).toEqual({ fr: 'y', en: 'and', hint: 'ee' });
  expect(rateReview(state, first.ticket, 'invalid', now)).toBeNull();
  // FSRS-6 defaults: a first Easy is 8 days (stability 8.2956 at 0.9 retention).
  expect(rateReview(state, first.ticket, 'easy', now)).toMatchObject({ due: now + 8 * DAY_MS, interval: 8 });
  expect(rateReview(state, first.ticket, 'hard', now)).toBeNull();
  expect(state.cards.y.reviews).toBe(1);
  expect(state.cards.y.fsrs).toEqual({ ...initialState('easy'), lastReview: now, lapses: 0 });
  expect(reviewCounts(state, L1_WORDS, now)).toEqual({ due: 4, new: 25 });
  expect(reviewCounts(state, L1_WORDS, now + 7 * DAY_MS).due).toBe(4);
  expect(reviewCounts(state, L1_WORDS, now + 8 * DAY_MS).due).toBe(5);
  state.current = null;
  for (const word of L1_WORDS.slice(1, 5)) state.cards[word.fr].due = now + 20 * DAY_MS;
  // Reviewed four days late: the actual 12-day gap, not the scheduled 8, drives the update.
  const late = now + 12 * DAY_MS;
  const again = nextReview(state, L1_WORDS, late, () => 'ticket-2');
  expect(again.en).toBe('and');
  expect(revealReview(state, L1_WORDS, again.ticket, late)?.fr).toBe('y');
  const afterMedium = nextState(initialState('easy'), 'medium', 12);
  expect(rateReview(state, again.ticket, 'medium', late)?.interval).toBe(intervalDays(afterMedium.stability));
  expect(state.cards.y.due).toBe(late + intervalDays(afterMedium.stability) * DAY_MS);
  // Hard is a pass: it keeps memory instead of dropping a long interval to one day.
  const hardAt = state.cards.y.due;
  state.current = { word: 'y', ticket: 'ticket-3', revealed: true };
  const hard = rateReview(state, 'ticket-3', 'hard', hardAt);
  expect(hard.interval).toBeGreaterThan(1);
  expect(hard.interval).toBe(intervalDays(nextState(afterMedium, 'hard', intervalDays(afterMedium.stability)).stability));
  state.cards.y = { due: now, interval: 300, reviews: 10000 };
  state.current = { word: 'y', ticket: 'ticket-4', revealed: true };
  expect(rateReview(state, 'ticket-4', 'easy', now)?.interval).toBe(365);
  expect(state.cards.y.reviews).toBe(10000);
});

test('loaded state retains valid unknown history but excludes it from current level review', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const state = cleanReview({ version: 1, cards: {
    'sí': { due: now, interval: 3, reviews: 2, extra: 'discard' },
    si: { due: now, interval: 0, reviews: 0 },
    y: { due: 'yesterday', interval: 1, reviews: 4 },
    bonjour: { due: now, interval: 1, reviews: 1 },
  }, current: { word: 'bonjour', ticket: 'x', revealed: true } }, L2_WORDS);
  expect(Object.keys(state.cards).sort()).toEqual(['bonjour', 'si', 'sí']);
  expect(state.cards.bonjour).toEqual({ due: now, interval: 1, reviews: 1 });
  expect(state.cards.sí).toEqual({ due: now, interval: 3, reviews: 2 });
  expect(state.current).toBeNull();
  expect(reviewCounts(state, L1_WORDS, now)).toEqual({ due: 1, new: 29 });
  expect(reviewCounts(state, L2_WORDS, now).due).toBe(2);
});

test('the most overdue card wins even when it is later in the vocabulary list', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const state = cleanReview(null, L1_WORDS);
  introduce(state, L1_WORDS, now, 2); // y precedes pero in the list
  state.cards.y.due = now - DAY_MS;
  state.cards.pero.due = now - 3 * DAY_MS;
  expect(nextReview(state, L1_WORDS, now, () => 'ticket').en).toBe('but');
});

test('Again resets day interval and Easy streak, then becomes due at the ten-minute boundary', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const words = [{ fr: 'y', en: 'and', hint: 'ee' }];
  const state = cleanReview({ version: 1, cards: { y: {
    due: now, interval: 14, reviews: 7, easyStreak: 2, introducedDay: '2026-10-16', introGateDay: '2026-10-17',
  } } }, words, now);

  expect(rateReview(state, 'again-ticket', 'again', now)).toBeNull(); // unrevealed
  state.current = { word: 'y', ticket: 'old-ticket', revealed: true };
  expect(rateReview(state, 'again-ticket', 'again', now)).toBeNull(); // stale ticket
  state.current = { word: 'y', ticket: 'again-ticket', revealed: true };
  expect(rateReview(state, 'again-ticket', 'Again', now)).toBeNull(); // malformed rating
  expect(rateReview(state, 'again-ticket', 'again', now)).toMatchObject({ due: now + 10 * 60 * 1000, interval: 0 });
  expect(state.cards.y).toEqual({ due: now + 10 * 60 * 1000, interval: 0, reviews: 8,
    easyStreak: 0, introducedDay: '2026-10-16', introGateDay: '2026-10-17', fsrs: expect.any(Object) });
  // Migrated from interval 14 (an Easy): the lapse keeps memory instead of resetting to a new card.
  expect(state.cards.y.fsrs).toMatchObject({ lastReview: now, lapses: 1 });
  expect(state.cards.y.fsrs.stability).toBeLessThan(14);
  expect(state.cards.y.fsrs.stability).toBeGreaterThan(initialState('again').stability);
  const reloaded = cleanReview(structuredClone(state), words, now).cards.y;
  expect(reloaded).toEqual({ ...state.cards.y, easyStreak: undefined });
  expect(reloaded.easyStreak ?? 0).toBe(0); // zero is omitted by legacy cleaning
  expect(rateReview(state, 'again-ticket', 'again', now)).toBeNull(); // duplicate
  expect(nextReview(state, words, now + 10 * 60 * 1000 - 1)).toBeNull();
  expect(nextReview(state, words, now + 10 * 60 * 1000, () => 'retry-ticket')).toEqual({
    ticket: 'retry-ticket', en: 'and', revealed: false,
  });
});

test('cleanReview preserves only the legacy version 1 storage contract', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const words = [{ fr: 'y', en: 'and', hint: 'ee' }];
  const card = { due: now, interval: 3, reviews: 2, easyStreak: 1 };
  expect(cleanReview({ version: 1, cards: { y: card } }, words, now).cards.y).toEqual(card);
  expect(cleanReview({ version: 2, cards: { y: card } }, words, now).cards).toEqual({});
});

test('a migrated first FSRS rating logs no prediction; a stored state logs the scheduler\'s', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const words = [{ fr: 'y', en: 'and', hint: '' }];
  const migrated = cleanReview({ version: 1, cards: { y: { due: now, interval: 20, reviews: 4 } } }, words, now);
  migrated.current = { word: 'y', ticket: 't', revealed: true, shownAt: now - 4000 };
  const first = rateReview(migrated, 't', 'medium', now);
  expect(first.record).toMatchObject({ word: 'y', prior: 4, outcome: 'medium', elapsedDays: 20, predicted: null, latencyMs: 4000 });
  migrated.current = { word: 'y', ticket: 'u', revealed: true };
  const next = rateReview(migrated, 'u', 'easy', migrated.cards.y.due);
  expect(next.record.predicted).toBeCloseTo(0.9, 2); // reviewed on its due date at 0.9 retention
  expect(next.record.latencyMs).toBeNull(); // no prompt time recorded
});

test('a lower desired retention schedules longer intervals; the default is 0.9', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const rate = (retention) => {
    const state = cleanReview({ version: 1, cards: { y: { due: now, interval: 20, reviews: 4 } } }, [{ fr: 'y', en: 'and', hint: '' }], now);
    state.current = { word: 'y', ticket: 't', revealed: true };
    return rateReview(state, 't', 'medium', now, false, retention);
  };
  expect(rate(0.85).interval).toBeGreaterThan(rate(0.9).interval);
  expect(rate(undefined).interval).toBe(rate(0.9).interval);
  expect(() => rate(0.8)).toThrow(RangeError);
});

test('a practice ticket may be served before due, is voided by any card write, and never serves a familiar card', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const words = [{ fr: 'pero', en: 'but', hint: '' }, { fr: 'y', en: 'and', hint: '' }];
  const due = now + 86400000;
  const raw = { version: 1, cards: { pero: { due, interval: 1, reviews: 1, easyStreak: 2 }, y: { due: now - 1, interval: 1, reviews: 1 } },
    current: { word: 'pero', ticket: '11111111-2222-3333-4444-555555555555', revealed: false, practice: due } };
  const state = cleanReview(raw, words, now);
  expect(state.current).toEqual({ word: 'pero', ticket: raw.current.ticket, revealed: false, practice: due });
  for (const bad of [true, 'yes', -1, 1.5]) expect(cleanReview({ ...raw, current: { ...raw.current, practice: bad } }, words, now).current.practice).toBeUndefined();
  expect(askable(state, state.current, now)).toBe(true);
  expect(nextReview(state, words, now)).toEqual({ ticket: raw.current.ticket, en: 'but', revealed: false });
  expect(state.current.shownAt).toBe(now);
  expect(revealReview(state, words, raw.current.ticket, now + 5).fr).toBe('pero');
  // An early Easy is scheduled by FSRS but leaves the Easy streak alone: no automatic familiarity.
  const rated = rateReview(state, raw.current.ticket, 'easy', now + 10, true);
  expect(rated.record).toMatchObject({ word: 'pero', latencyMs: 10, prior: 1, outcome: 'easy' });
  expect(state.cards.pero.easyStreak).toBe(2);
  expect(state.cards.pero.familiar).toBeUndefined();
  expect(state.cards.pero.reviews).toBe(2);
  expect(state.current).toBeNull();
  // An early Hard or Medium still breaks the streak, as any non-Easy pass does.
  for (const rating of ['hard', 'medium']) {
    const again = cleanReview(raw, words, now);
    nextReview(again, words, now);
    revealReview(again, words, raw.current.ticket, now);
    rateReview(again, raw.current.ticket, rating, now + 10, true);
    expect([rating, again.cards.pero.easyStreak]).toEqual([rating, 0]);
  }
  // Any other write to the card (an inline rating, a reset and re-introduction) moves its due
  // time and voids the grant, so the not-due card is skipped for the due one.
  const moved = cleanReview({ ...raw, cards: { ...raw.cards, pero: { ...raw.cards.pero, due: due + 3600000 } } }, words, now);
  expect(askable(moved, moved.current, now)).toBe(false);
  // A voided grant stays void when the card later falls due: the stale ticket (and its old
  // latency start) is dropped, and a fresh ticket is issued for the due card.
  expect(askable(moved, moved.current, due + 7200000)).toBe(false);
  const later = cleanReview({ ...raw, cards: { ...raw.cards, pero: { ...raw.cards.pero, due: due + 3600000 } },
    current: { ...raw.current, shownAt: now } }, [words[0]], now);
  const fresh = nextReview(later, [words[0]], due + 7200000, () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  expect(fresh.ticket).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  expect(later.current).toEqual({ word: 'pero', ticket: fresh.ticket, revealed: false, shownAt: due + 7200000 });
  // An unchanged grant stays valid after the card falls due on its own.
  expect(askable(state.current ? state : cleanReview(raw, words, now), cleanReview(raw, words, now).current, due + 1)).toBe(true);
  expect(nextReview(moved, words, now, () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee').en).toBe('and');
  const plain = cleanReview({ ...raw, current: { ...raw.current, practice: undefined } }, words, now);
  expect(nextReview(plain, words, now, () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee').en).toBe('and');
  // A familiar card is never served, even with a practice ticket.
  const familiar = cleanReview({ ...raw, cards: { ...raw.cards, pero: { ...raw.cards.pero, familiar: true } } }, words, now);
  expect(askable(familiar, familiar.current, now)).toBe(false);
  expect(nextReview(familiar, words, now, () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee').en).toBe('and');
  expect(markFamiliar(familiar, raw.current.ticket, now)).toBe(false);
});

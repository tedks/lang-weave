import { test, expect } from 'bun:test';
import { L1_WORDS, L2_WORDS } from '../src/vocabulary.js';
import { DAY_MS, cleanReview, introduce, nextReview, revealReview, rateReview, reviewCounts } from '../src/review.js';

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
  expect(rateReview(state, first.ticket, 'easy', now)).toEqual({ due: now + 7 * DAY_MS, interval: 7 });
  expect(rateReview(state, first.ticket, 'hard', now)).toBeNull();
  expect(state.cards.y.reviews).toBe(1);
  expect(reviewCounts(state, L1_WORDS, now)).toEqual({ due: 4, new: 25 });
  expect(reviewCounts(state, L1_WORDS, now + 7 * DAY_MS).due).toBe(5);
  state.current = null;
  for (const word of L1_WORDS.slice(1, 5)) state.cards[word.fr].due = now + 20 * DAY_MS;
  const again = nextReview(state, L1_WORDS, now + 7 * DAY_MS, () => 'ticket-2');
  expect(again.en).toBe('and');
  expect(revealReview(state, L1_WORDS, again.ticket, now + 7 * DAY_MS)?.fr).toBe('y');
  expect(rateReview(state, again.ticket, 'medium', now + 7 * DAY_MS)?.interval).toBe(14);
  expect(state.cards.y.due).toBe(now + 21 * DAY_MS);
  state.current = { word: 'y', ticket: 'ticket-3', revealed: true };
  expect(rateReview(state, 'ticket-3', 'hard', now + 21 * DAY_MS)?.interval).toBe(1);
});

test('loaded state drops foreign and malformed cards, preserving Spanish accents and level scope', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const state = cleanReview({ version: 1, cards: {
    'sí': { due: now, interval: 3, reviews: 2, extra: 'discard' },
    si: { due: now, interval: 0, reviews: 0 },
    y: { due: 'yesterday', interval: 1, reviews: 4 },
    bonjour: { due: now, interval: 1, reviews: 1 },
  }, current: { word: 'bonjour', ticket: 'x', revealed: true } }, L2_WORDS);
  expect(Object.keys(state.cards).sort()).toEqual(['si', 'sí']);
  expect(state.cards.sí).toEqual({ due: now, interval: 3, reviews: 2 });
  expect(state.current).toBeNull();
  expect(reviewCounts(state, L1_WORDS, now)).toEqual({ due: 1, new: 29 });
  expect(reviewCounts(state, L2_WORDS, now).due).toBe(2);
});

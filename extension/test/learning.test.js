import { test, expect } from 'bun:test';
import { cleanReview, beginInline, revealInline, finishInline, nextReview, revealReview, rateReview, markFamiliar } from '../src/review.js';
import { cleanLearning, remaining, policyWords, commitLearning } from '../src/learning.js';
import { capSwaps } from '../src/levels.js';

const words = [
  { fr: 'y', en: 'and', hint: 'ee' },
  { fr: 'pero', en: 'but', hint: 'peh' },
  { fr: 'libro', en: 'book', hint: 'lee' },
  { fr: 'casa', en: 'house', hint: 'kah' },
];
const settings = { gradual: true, newWordsPerDay: 2, inlineRecall: true };
const now = Date.parse('2026-10-18T12:00:00Z');
const day = '2026-10-18';
const swap = (word) => ({ word, o: words.find((w) => w.fr === word).en, f: word, g: '', h: '', ctx: '' });

test('gradual policy prioritizes due, then learning, then useful new words, with bounded familiar filler', () => {
  const state = cleanReview(null, words);
  state.cards.pero = { due: now + 1000, interval: 3, reviews: 1 };
  state.cards.y = { due: now - 1000, interval: 0, reviews: 0 };
  expect(policyWords(words, state, settings, now, day).map((w) => [w.fr, w.status]))
    .toEqual([['y', 'due'], ['pero', 'active'], ['libro', 'new'], ['casa', 'new']]);
  state.cards.y.familiar = true;
  expect(policyWords(words, state, settings, now, day).at(-1)).toMatchObject({ fr: 'y', status: 'known' });
  expect(policyWords(words, state, { ...settings, gradual: false }, now, day)).toHaveLength(4);
});

test('only committed contextual new swaps spend the local-day allowance; rollback cannot replenish it', () => {
  const state = cleanReview(null, words);
  expect(remaining(state.learning, day, 2)).toBe(2);
  const result = commitLearning(state, { one: [swap('libro'), swap('casa'), swap('y')], two: [swap('libro')] }, settings, now, day);
  expect(result.one.map((s) => s.word)).toEqual(['libro', 'casa']);
  expect(result.two.map((s) => s.word)).toEqual(['libro']);
  expect(state.learning).toEqual({ day, count: 2 });
  expect(state.cards.libro.introducedDay).toBe(day);
  expect(remaining(state.learning, day, 2)).toBe(0);
  expect(remaining(state.learning, '2026-10-17', 2)).toBe(0);
  expect(remaining(state.learning, '2026-10-19', 2)).toBe(2);
  const next = commitLearning(state, { next: [swap('y')] }, settings, now + 86400000, '2026-10-19');
  expect(next.next).toHaveLength(1);
  expect(state.learning).toEqual({ day: '2026-10-19', count: 1 });
  expect(cleanLearning({ day: '2026-10-19', count: -1 })).toEqual({ day: '2026-10-19', count: 0 });
  expect(cleanLearning({ day: '2024-02-29', count: 2 })).toEqual({ day: '2024-02-29', count: 2 });
  expect(cleanLearning({ day: '9999-99-99', count: 2 })).toEqual({ day: '', count: 2 });
  expect(cleanLearning({ day: '2025-02-29', count: 2 })).toEqual({ day: '', count: 2 });
  const cleaned = cleanReview({ version: 1, cards: { libro: {
    due: now, interval: 0, reviews: 0, introducedDay: '9999-99-99',
  } } }, words);
  expect(cleaned.cards.libro.introducedDay).toBeUndefined();
});

test('due contextual result can cue recall; reveal and one rating require same document and revision', () => {
  const state = cleanReview(null, words);
  state.cards.libro = { due: now - 1, interval: 0, reviews: 0 };
  expect(commitLearning(state, { passage: [swap('libro')] }, settings, now, day).passage[0].practice).toBe(true);
  const sender = { tab: { id: 4 }, frameId: 2, documentId: 'document-a' };
  const ticket = beginInline(state, 'libro', sender, 'revision-a', now, () => 'a'.repeat(36)).ticket;
  expect(finishInline(state, ticket, sender, 'revision-a', now, 'easy')).toBeNull();
  expect(revealInline(state, words, ticket, { ...sender, documentId: 'document-b' }, 'revision-a', now)).toBeNull();
  expect(revealInline(state, words, ticket, sender, 'revision-b', now)).toBeNull();
  expect(revealInline(state, words, ticket, sender, 'revision-a', now)?.fr).toBe('libro');
  expect(finishInline(state, ticket, sender, 'revision-a', now, 'easy')?.interval).toBe(7);
  expect(finishInline(state, ticket, sender, 'revision-a', now, 'easy')).toBeNull();
  expect(state.cards.libro.reviews).toBe(1);
  expect(beginInline(state, 'libro', sender, 'revision-a', now)).toBeNull();
});

test('density choice changes a deterministic ceiling independent of level', () => {
  const swaps = ['y', 'pero', 'libro', 'casa'].map(swap);
  const text = 'And books are here. But the house is there.';
  expect(capSwaps(1, swaps, text, words, 'light')).toHaveLength(1);
  expect(capSwaps(1, swaps, text, words, 'normal')).toHaveLength(2);
  expect(capSwaps(1, swaps, text, words, 'heavy')).toHaveLength(4);
});

test('familiarity follows explicit marking or three Easy recalls, never exposure', () => {
  const state = cleanReview(null, words);
  state.cards.libro = { due: now, interval: 0, reviews: 0 };
  expect(commitLearning(state, { p: [swap('libro')] }, settings, now, day).p[0].practice).toBe(true);
  expect(state.cards.libro.familiar).toBeUndefined();
  for (let i = 0; i < 3; i++) {
    const at = now + i * 30 * 86400000;
    const card = nextReview(state, [words[2]], at, () => `ticket-${i}`);
    expect(revealReview(state, [words[2]], card.ticket, at)?.fr).toBe('libro');
    expect(rateReview(state, card.ticket, 'easy', at, true)).toBeTruthy();
  }
  expect(state.cards.libro.familiar).toBe(true);
  const another = cleanReview(null, words);
  another.cards.y = { due: now, interval: 0, reviews: 0 };
  const card = nextReview(another, [words[0]], now, () => 'explicit-ticket');
  expect(markFamiliar(another, card.ticket, now)).toBe(false);
  revealReview(another, [words[0]], card.ticket, now);
  expect(markFamiliar(another, card.ticket, now)).toBe(true);
  expect(nextReview(another, [words[0]], now)).toBeNull();
  expect(policyWords(words, another, settings, now, day).at(-1)).toMatchObject({ fr: 'y', status: 'known' });
});

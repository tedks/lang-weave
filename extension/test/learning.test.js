import { test, expect } from 'bun:test';
import { cleanReview, beginInline, revealInline, finishInline, nextReview, revealReview, rateReview, markFamiliar } from '../src/review.js';
import { cleanLearning, remaining, policyWords, commitLearning, acknowledgeIntroduction,
  releaseIntroduction, futureBudgetDay } from '../src/learning.js';
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
const sender = { tab: { id: 4 }, frameId: 2, documentId: 'document-a' };
const revision = 'revision-a';

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

test('reservations bound concurrent introductions and only visible acknowledgements spend allowance', () => {
  const state = cleanReview(null, words);
  expect(remaining(state.learning, day, 2)).toBe(2);
  const result = commitLearning(state, { one: [swap('libro'), swap('casa'), swap('y')], two: [swap('libro')] },
    settings, sender, revision, now, day);
  expect(result.one.map((s) => s.word)).toEqual(['libro', 'casa']);
  expect(result.two.map((s) => s.word)).toEqual(['libro']);
  expect(result.one[0].introTicket).toBe(result.two[0].introTicket);
  expect(state.learning.count).toBe(0);
  expect(Object.keys(state.cards)).toHaveLength(0);
  expect(cleanLearning({ pending: [{ ...state.learning.pending[0], until: now + 86400000 }] }, now).pending).toEqual([]);
  const restarted = cleanReview(structuredClone(state), words, now);
  expect(restarted.learning.pending).toEqual(state.learning.pending);
  expect(acknowledgeIntroduction(restarted, 'libro', result.one[0].introTicket, sender, revision, 2, now, day)).toBe(true);
  expect(cleanReview(structuredClone(restarted), words, now).cards.libro.introReceipt.ticket).toBe(result.one[0].introTicket);
  expect(cleanReview(structuredClone(restarted), words, now + 6 * 60 * 1000).cards.libro.introReceipt).toBeUndefined();
  expect(remaining(state.learning, day, 2, now, revision)).toBe(0);
  expect(policyWords(words, state, settings, now, day, revision).some((w) => w.fr === 'libro')).toBe(false);
  expect(acknowledgeIntroduction(state, 'libro', result.one[0].introTicket, sender, revision, 2, now, day)).toBe(true);
  expect(acknowledgeIntroduction(state, 'libro', result.one[0].introTicket, sender, revision, 2, now, day)).toBe(true);
  expect(acknowledgeIntroduction(state, 'libro', result.one[0].introTicket,
    { ...sender, documentId: 'other' }, revision, 2, now, day)).toBe(false);
  expect(state.learning.count).toBe(1);
  expect(state.cards.libro.introducedDay).toBe(day);
  expect(acknowledgeIntroduction(state, 'casa', result.one[1].introTicket, { ...sender, documentId: 'other' }, revision, 2, now, day)).toBe(false);
  expect(releaseIntroduction(state, result.one[1].introTicket, sender, revision)).toBe(true);
  expect(state.learning.count).toBe(1);
  expect(remaining(state.learning, day, 2, now, revision)).toBe(1);
  expect(remaining(state.learning, day, 1)).toBe(0);
  expect(remaining(state.learning, '2026-10-17', 2)).toBe(0);
  expect(remaining(state.learning, '2026-10-19', 2)).toBe(2);
  const next = commitLearning(state, { next: [swap('y')] }, settings, sender, revision, now + 86400000, '2026-10-19');
  expect(next.next).toHaveLength(1);
  expect(state.learning.count).toBe(1);
  expect(acknowledgeIntroduction(state, 'y', next.next[0].introTicket, sender, revision, 2, now + 86400000, '2026-10-19')).toBe(true);
  expect(state.learning.count).toBe(1);
  expect(cleanLearning({ day: '2026-10-19', count: -1 })).toEqual({ day: '2026-10-19', count: 0, pending: [] });
  expect(cleanLearning({ day: '2024-02-29', count: 2 }).day).toBe('2024-02-29');
  expect(cleanLearning({ day: '9999-99-99', count: 2 }).day).toBe('');
  expect(cleanLearning({ day: '2025-02-29', count: 2 }).day).toBe('');
  const cleaned = cleanReview({ version: 1, cards: { libro: {
    due: now, interval: 0, reviews: 0, introducedDay: '9999-99-99',
  } } }, words);
  expect(cleaned.cards.libro.introducedDay).toBeUndefined();
});

test('same-day inline cue waits for next local day; standalone review is immediate', () => {
  const state = cleanReview(null, words);
  const result = commitLearning(state, { one: [swap('libro')] }, settings, sender, revision, now, day);
  const token = result.one[0].introTicket;
  expect(acknowledgeIntroduction(state, 'libro', token, sender, revision, 2, now, day)).toBe(true);
  expect(commitLearning(state, { one: [swap('libro')] }, settings, sender, revision, now, day).one[0].practice).toBeUndefined();
  expect(beginInline(state, 'libro', sender, revision, now)).toBeNull();
  expect(nextReview(state, [words[2]], now)?.en).toBe('book');
  expect(beginInline(state, 'libro', sender, revision, now + 86400000)).toHaveProperty('ticket');
});

test('expired and old-day reservations cannot be acknowledged or block fresh slots', () => {
  const state = cleanReview(null, words);
  const result = commitLearning(state, { one: [swap('libro')] }, { ...settings, newWordsPerDay: 1 },
    sender, revision, now, day);
  const ticket = result.one[0].introTicket;
  expect(acknowledgeIntroduction(state, 'libro', ticket, sender, revision, 1, now + 6 * 60 * 1000, day)).toBe(false);
  expect(acknowledgeIntroduction(state, 'libro', ticket, sender, revision, 1, now + 86400000, '2026-10-19')).toBe(false);
  const next = commitLearning(state, { one: [swap('casa')] }, { ...settings, newWordsPerDay: 1 },
    sender, revision, now + 86400000, '2026-10-19');
  expect(next.one).toHaveLength(1);
  expect(state.learning.pending).toHaveLength(1);
  expect(state.learning.pending[0].word).toBe('casa');
  expect(state.learning.count).toBe(0);
});

test('acknowledgement rechecks the persisted count even when a reservation exists', () => {
  const state = cleanReview(null, words);
  const ticket = commitLearning(state, { one: [swap('libro')] }, { ...settings, newWordsPerDay: 1 },
    sender, revision, now, day).one[0].introTicket;
  state.learning.day = day;
  state.learning.count = 1; // another serialized action spent the final slot
  expect(acknowledgeIntroduction(state, 'libro', ticket, sender, revision, 1, now, day)).toBe(false);
  expect(state.cards.libro).toBeUndefined();
  expect(state.learning.count).toBe(1);
});

test('future budget warning requires more than seven calendar days, including leap and year boundaries', () => {
  expect(futureBudgetDay(cleanLearning({ day: '2026-10-25', count: 1 }), day)).toBe('');
  expect(futureBudgetDay(cleanLearning({ day: '2026-10-26', count: 1 }), day)).toBe('2026-10-26');
  expect(futureBudgetDay(cleanLearning({ day: '2027-01-04', count: 1 }), '2026-12-27')).toBe('2027-01-04');
  expect(futureBudgetDay(cleanLearning({ day: '2024-03-07', count: 1 }), '2024-02-28')).toBe('2024-03-07');
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

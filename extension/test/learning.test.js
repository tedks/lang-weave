import { test, expect } from 'bun:test';
import { cleanReview, introduce, beginInline, revealInline, finishInline, nextReview, revealReview, rateReview, markFamiliar } from '../src/review.js';
import { cleanLearning, remaining, policyWords, commitLearning, acknowledgeIntroduction,
  releaseIntroduction, futureBudgetDay } from '../src/learning.js';
import { capSwaps } from '../src/levels.js';
import { localDay } from '../src/events.js';

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
  expect(state.learning.pending[0].ownerKey).toMatch(/^[0-9a-f]{16}$/);
  expect(state.learning.pending[0].documentId).toBeUndefined();
  expect(state.learning.pending[0].tabId).toBeUndefined();
  expect(state.learning.pending[0].frameId).toBeUndefined();
  expect(cleanLearning({ pending: [{ ...state.learning.pending[0], until: now + 86400000 }] }, now).pending).toEqual([]);
  expect(cleanLearning({ pending: [{ ...state.learning.pending[0], until: now - 86400001 }] }, now).pending).toEqual([]);
  const restarted = cleanReview(structuredClone(state), words, now);
  expect(restarted.learning.pending).toEqual(state.learning.pending);
  expect(acknowledgeIntroduction(restarted, 'libro', result.one[0].introTicket, sender, revision, 2, now, day)).toBe(true);
  expect(cleanReview(structuredClone(restarted), words, now).cards.libro.introReceipt.ticket).toBe(result.one[0].introTicket);
  expect(cleanReview(structuredClone(restarted), words, now + 29_000).cards.libro.introReceipt.ticket)
    .toBe(result.one[0].introTicket);
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
  const manual = cleanReview(null, words);
  expect(introduce(manual, [words[3]], now, 1)).toBe(1);
  expect(nextReview(manual, [words[3]], now)?.en).toBe('house');
  expect(beginInline(manual, 'casa', sender, revision, now)).toBeNull();
  expect(beginInline(manual, 'casa', sender, revision, now + 86400000)).toHaveProperty('ticket');
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

test('an unrelated delivery preserves an expired hold long enough for a visible renewal', () => {
  const state = cleanReview(null, words);
  const first = commitLearning(state, { one: [swap('libro')] }, settings, sender, revision, now, day);
  const ticket = first.one[0].introTicket;
  state.learning.pending[0].until = now - 1;
  const restarted = cleanReview(structuredClone(state), words, now);
  commitLearning(restarted, { unrelated: [] }, settings, sender, revision, now, day);
  expect(restarted.learning.pending.some((p) => p.ticket === ticket)).toBe(true);
  expect(acknowledgeIntroduction(restarted, 'libro', ticket, sender, revision, 2, now, day)).toBe(false);
  const renewed = commitLearning(restarted, { renew: [swap('libro')] }, settings, sender, revision, now, day);
  expect(renewed.renew[0].introTicket).not.toBe(ticket);
  expect(acknowledgeIntroduction(restarted, 'libro', renewed.renew[0].introTicket,
    sender, revision, 2, now, day)).toBe(true);
});

test('a near-expiry acknowledgement keeps a full retry receipt after its saved write', () => {
  const state = cleanReview(null, words);
  const held = commitLearning(state, { one: [swap('libro')] }, settings, sender, revision, now, day);
  const ticket = held.one[0].introTicket;
  expect(acknowledgeIntroduction(state, 'libro', ticket, sender, revision, 2, now + 29_000, day)).toBe(true);
  const restarted = cleanReview(structuredClone(state), words, now + 58_000);
  expect(acknowledgeIntroduction(restarted, 'libro', ticket, sender, revision, 2,
    now + 58_000, day)).toBe(true);
  expect(restarted.learning.count).toBe(1);
});

test('recovered future introduction history waits one local day before inline recall', () => {
  const state = cleanReview(null, words);
  state.cards.libro = { due: now, interval: 0, reviews: 0,
    introducedDay: '2099-01-01', introGateDay: day };
  const restarted = cleanReview(structuredClone(state), words, now);
  expect(restarted.cards.libro.introducedDay).toBe('2099-01-01');
  expect(commitLearning(restarted, { one: [swap('libro')] }, settings, sender, revision, now, day)
    .one[0].practice).toBeUndefined();
  expect(beginInline(restarted, 'libro', sender, revision, now)).toBeNull();
  expect(commitLearning(restarted, { one: [swap('libro')] }, settings, sender, revision,
    now + 86400000, '2026-10-19').one[0].practice).toBe(true);
  expect(beginInline(restarted, 'libro', sender, revision, now + 86400000)).toHaveProperty('ticket');
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
  expect(finishInline(state, ticket, sender, 'revision-a', now, 'easy')?.interval).toBe(8); // FSRS-6 first Easy
  expect(finishInline(state, ticket, sender, 'revision-a', now, 'easy')).toBeNull();
  expect(state.cards.libro.reviews).toBe(1);
  expect(beginInline(state, 'libro', sender, 'revision-a', now)).toBeNull();
});

test('inline Again is bound to its revealed document and revision, with a ten-minute retry', () => {
  const state = cleanReview(null, words);
  state.cards.libro = { due: now, interval: 21, reviews: 4, easyStreak: 2,
    introducedDay: '2026-10-17', introGateDay: '2026-10-17' };
  const ticket = beginInline(state, 'libro', sender, revision, now, () => 'b'.repeat(36)).ticket;
  expect(finishInline(state, ticket, sender, revision, now, 'again')).toBeNull(); // unrevealed
  expect(revealInline(state, words, ticket, { ...sender, documentId: 'other' }, revision, now)).toBeNull();
  expect(revealInline(state, words, ticket, sender, 'other-revision', now)).toBeNull();
  expect(revealInline(state, words, ticket, sender, revision, now)?.fr).toBe('libro');
  expect(finishInline(state, ticket, { ...sender, documentId: 'other' }, revision, now, 'again')).toBeNull();
  expect(finishInline(state, ticket, sender, 'other-revision', now, 'again')).toBeNull();
  expect(finishInline(state, ticket, sender, revision, now, 'AGAIN')).toBeNull(); // malformed rating
  expect(finishInline(state, ticket, sender, revision, now, 'again')).toMatchObject({
    due: now + 10 * 60 * 1000, interval: 0, familiar: false,
  });
  expect(state.cards.libro).toEqual({ due: now + 10 * 60 * 1000, interval: 0, reviews: 5,
    easyStreak: 0, introducedDay: '2026-10-17', introGateDay: '2026-10-17', fsrs: expect.any(Object) });
  expect(finishInline(state, ticket, sender, revision, now, 'again')).toBeNull(); // duplicate
  expect(beginInline(state, 'libro', sender, revision, now + 10 * 60 * 1000 - 1)).toBeNull();
  expect(beginInline(state, 'libro', sender, revision, now + 10 * 60 * 1000)).toHaveProperty('ticket');
});

test('Again cannot bypass the same-local-day automatic cue guard, while manual review remains due', () => {
  const today = localDay(new Date(now));
  const state = cleanReview(null, words);
  state.cards.libro = { due: now, interval: 0, reviews: 0, introducedDay: today,
    introGateDay: today };
  const first = nextReview(state, [words[2]], now, () => 'manual-ticket');
  expect(revealReview(state, [words[2]], first.ticket, now)?.fr).toBe('libro');
  expect(rateReview(state, first.ticket, 'again', now, true)?.due).toBe(now + 10 * 60 * 1000);
  expect(beginInline(state, 'libro', sender, revision, now + 10 * 60 * 1000)).toBeNull();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  expect(beginInline(state, 'libro', sender, revision, nextMidnight.getTime() - 1)).toBeNull();
  expect(nextReview(state, [words[2]], now + 10 * 60 * 1000, () => 'retry-ticket')?.ticket)
    .toBe('retry-ticket');
  expect(beginInline(state, 'libro', sender, revision, nextMidnight.getTime())).toHaveProperty('ticket');
});

test('a familiar card cannot enter the existing inline rating route', () => {
  const state = cleanReview(null, words);
  state.cards.libro = { due: now, interval: 365, reviews: 20, familiar: true };
  expect(beginInline(state, 'libro', sender, revision, now)).toBeNull();
  expect(nextReview(state, [words[2]], now)).toBeNull();
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
    const at = state.cards.libro.due; // each Easy is rated when the card is next due
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

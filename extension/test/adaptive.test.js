import { expect, test } from 'bun:test';
import { catalogEntries, englishAnchors, matchingEntries, entryId } from '../src/catalog.js';
import { BACKLOG_THROTTLE, MAX_CANDIDATES, MAX_REQUEST_CHARS, MAX_VOCABULARY_CHARS,
  requestChars, reviewBacklog, selectWorkingSet, vocabularyChars } from '../src/adaptive.js';
import { L1_WORDS, L2_WORDS } from '../src/vocabulary.js';
import { cleanReview } from '../src/review.js';
import { memoryStorage } from '../src/cache.js';
import { scopedStorage } from '../src/scope.js';
import { cleanEncounters, countEncounters, ENCOUNTERS_KEY, MAX_ENCOUNTER_COUNT, MAX_ENCOUNTER_IDS } from '../src/encounters.js';

const now = Date.parse('2026-10-27T14:00:00Z');
const day = '2026-10-27';
const settings = { gradual: true, newWordsPerDay: 5 };
const batch = (text) => [{ id: 'one', text }];
const select = (options = {}) => selectWorkingSet({ batch: batch('The window and the book are here today.'),
  words: L2_WORDS, fullWords: L2_WORDS, scope: 'es', state: cleanReview(null, L2_WORDS, now),
  settings, now, day, revision: 'rev', level: 2, language: 'es', ...options });

test('catalog IDs retain exact legacy forms and local matching skips ambiguous anchors', () => {
  expect(entryId('es', { fr: 'sí' })).toBe('es:legacy:s%C3%AD');
  expect(entryId('es', { fr: 'si' })).not.toBe(entryId('es', { fr: 'sí' }));
  expect(englishAnchors({ en: 'the window' })).toEqual(['the window', 'window']);
  expect(matchingEntries(batch('A free ticket was found.'), catalogEntries(L2_WORDS, 'es'))
    .some((entry) => ['libre', 'gratis'].includes(entry.word.fr))).toBe(false);
  expect(matchingEntries(batch('The windows were open.'), catalogEntries([{ fr: 'la ventana', en: 'the window' }], 'es')))
    .toEqual([]); // plural noun needs a separate safe form
  expect(select({ batch: batch('Zebras orbit quartz; distant galaxies shimmer.') })).toEqual([]);
});

test('due and recent difficulty lead active and new with stable ties and passage relevance', () => {
  const state = cleanReview({ version: 1, cards: {
    'la ventana': { due: now - 1000, interval: 2, reviews: 2 },
    'el libro': { due: now + 600000, interval: 0, reviews: 1 },
    'el día': { due: now + 86400000, interval: 7, reviews: 2 },
  } }, L2_WORDS, now);
  const text = batch('Today the window and the book tell the story of the day and the town.');
  const first = select({ batch: text, state });
  expect(first.map(({ fr, reasonCode }) => [fr, reasonCode])).toEqual([
    ['la ventana', 'due'], ['el libro', 'recent_difficulty'], ['el día', 'active'],
    ['el pueblo', 'new'], ['hoy', 'new'], ['la historia', 'new'], ['y', 'new'],
  ]);
  expect(select({ batch: text, state })).toEqual(first);
  expect(first.every((w) => !['el gato', 'el perro'].includes(w.fr))).toBe(true);
  expect(state.cards['la historia']).toBeUndefined();
});

test('full-scope backlog throttles fresh at the exact boundary and resumes after review', () => {
  const cards = Object.fromEntries(L2_WORDS.slice(0, BACKLOG_THROTTLE).map((w) =>
    [w.fr, { due: now - 1, interval: 1, reviews: 1 }]));
  const state = cleanReview({ version: 1, cards }, L2_WORDS, now);
  const passage = batch('The window and the book are here today with the cat.');
  expect(reviewBacklog(state, L2_WORDS, now)).toBe(5);
  expect(select({ batch: passage, state }).some((w) => w.status === 'new')).toBe(false);
  state.cards[L2_WORDS[0].fr].due = now + 2 * 86400000;
  state.cards[L2_WORDS[0].fr].interval = 2;
  expect(reviewBacklog(state, L2_WORDS, now)).toBe(4);
  expect(select({ batch: passage, state }).some((w) => w.status === 'new')).toBe(true);
  state.learning = { day, count: 5, pending: [] };
  expect(select({ batch: passage, state }).some((w) => w.status === 'new')).toBe(false);
});

test('candidate, fresh, vocabulary and entire request bounds never truncate an entry', () => {
  const words = Array.from({ length: 45 }, (_, i) => ({ fr: `palabra${i}`, en: `anchor${i}`, hint: 'x' }));
  const text = words.map((w) => w.en).join(' ');
  const chosen = select({ batch: batch(text), words, fullWords: words });
  expect(chosen).toHaveLength(4);
  expect(chosen.every((w) => words.includes(words.find((entry) => entry.fr === w.fr)))).toBe(true);
  const state = cleanReview({ version: 1, cards: Object.fromEntries(words.map((w) =>
    [w.fr, { due: now - 1, interval: 2, reviews: 2 }])) }, words, now);
  const due = select({ batch: batch(text), words, fullWords: words, state });
  expect(due).toHaveLength(MAX_CANDIDATES);
  expect(vocabularyChars(due)).toBeLessThanOrEqual(MAX_VOCABULARY_CHARS);
  expect(requestChars(due, { batch: batch(text), level: 2, language: 'es', density: 'normal' }))
    .toBeLessThanOrEqual(MAX_REQUEST_CHARS);
  expect(select({ batch: batch(text), words: [{ fr: 'x'.repeat(3100), en: 'anchor0' }],
    fullWords: words })).toEqual([]);
  expect(select({ batch: batch('x'.repeat(26000) + ' anchor0'), words, fullWords: words })).toEqual([]);
});

test('full history survives many candidate windows, level/scope toggles and restart', async () => {
  expect(L1_WORDS).toHaveLength(30);
  expect(L2_WORDS).toHaveLength(226);
  const cards = Object.fromEntries(L2_WORDS.map((w, i) => [w.fr,
    { due: now + i * 60000, interval: i % 4, reviews: i % 6, introducedDay: '2026-10-20' }]));
  cards.orphan = { due: now - 1, interval: 1, reviews: 9 };
  const initial = { version: 1, cards, current: null, learning: { day, count: 2, pending: [] }, inline: null };
  const foreign = { version: 1, cards: { salut: { due: now, interval: 1, reviews: 4 } } };
  const storage = memoryStorage({ recallReview: initial, readingEvents: [{ word: 'y', kind: 'seen', day }],
    'lang:fr:pack123:recallReview': foreign });
  const spanish = scopedStorage(storage, 'es');
  for (let i = 0; i < 35; i++) {
    const levelWords = i % 2 ? L1_WORDS : L2_WORDS;
    const state = cleanReview((await spanish.get(['recallReview'])).recallReview, L2_WORDS, now);
    select({ batch: batch(`${levelWords[i % levelWords.length].en} and the window today.`),
      words: levelWords, fullWords: L2_WORDS, state });
    await spanish.set({ recallReview: state });
  }
  const restarted = cleanReview((await spanish.get(['recallReview'])).recallReview, L2_WORDS, now);
  expect(Object.keys(restarted.cards)).toHaveLength(227);
  expect(restarted.cards.orphan).toEqual(cards.orphan);
  expect(restarted.cards['el zapato']).toEqual(cards['el zapato']);
  expect(restarted.learning).toEqual(initial.learning);
  const all = await storage.getAll();
  expect(all.readingEvents).toEqual([{ word: 'y', kind: 'seen', day }]);
  expect(all['lang:fr:pack123:recallReview']).toEqual(foreign);
});

test('generated scope is exact and retains listed forms', () => {
  const words = [{ fr: 'fenêtre', en: 'window', hint: 'x' }, { fr: 'livre', en: 'book', hint: 'x' }];
  const state = cleanReview(null, words, now);
  const chosen = select({ words, fullWords: words, scope: 'fr:pack123', language: 'fr',
    batch: batch('The window and book are on the table.'), state });
  expect(chosen.map((w) => w.entryId)).toEqual(['fr:pack123:legacy:fen%C3%AAtre', 'fr:pack123:legacy:livre']);
  expect(chosen.map((w) => w.fr)).toEqual(['fenêtre', 'livre']);
});

test('encounters store only coarse saturated entry counts and do not change review or allowance', () => {
  const id = entryId('es', L2_WORDS[0]);
  const state = cleanReview(null, L2_WORDS, now);
  const before = structuredClone(state);
  let aggregate = cleanEncounters(null, [id], day);
  countEncounters(aggregate, [id, id], day);
  expect(aggregate).toMatchObject({ version: 1, day, counts: { [id]: 1 }, touched: [id] });
  countEncounters(aggregate, [id], day);
  expect(aggregate.counts[id]).toBe(1);
  for (let i = 1; i <= 10; i++) {
    const nextDay = `2026-11-${String(i).padStart(2, '0')}`;
    aggregate = cleanEncounters(aggregate, [id], nextDay);
    countEncounters(aggregate, [id], nextDay);
  }
  expect(aggregate.counts[id]).toBeLessThanOrEqual(MAX_ENCOUNTER_COUNT);
  expect(Object.keys(aggregate).sort()).toEqual(['bucket', 'counts', 'day', 'touched', 'version']);
  expect(JSON.stringify(aggregate)).not.toMatch(/window|http|title|tab|passage|host/i);
  expect(state).toEqual(before);
  expect(select({ encounters: { [entryId('es', { fr: 'la ventana' })]: 3 },
    batch: batch('The window is near the book and the cat today.') })
    .find((w) => w.fr === 'la ventana')?.reasonCode).toBe('encountered_often');
  const rollback = cleanEncounters(aggregate, [id], day);
  expect(countEncounters(rollback, [id], day).counts[id]).toBe(aggregate.counts[id]);
  const many = Array.from({ length: MAX_ENCOUNTER_IDS + 30 }, (_, i) => `es:legacy:${i}`);
  const bounded = cleanEncounters({ version: 1, day, bucket: aggregate.bucket,
    counts: Object.fromEntries(many.map((key) => [key, 6])), touched: many }, many, day);
  expect(Object.keys(bounded.counts)).toHaveLength(MAX_ENCOUNTER_IDS);
  expect(bounded.touched).toHaveLength(MAX_ENCOUNTER_IDS);
  expect(ENCOUNTERS_KEY).toBe('vocabularyEncounters');
});

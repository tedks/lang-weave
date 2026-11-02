// Guess first: deterministic distractors, the log shape and backup handling (docs/INFERENCE-MISSION.md).
import { test, expect } from 'bun:test';
import { guessChoices, seedHash, GUESS_LIMIT, MAX_DISTRACTORS, MIN_DISTRACTORS } from '../src/guess.js';
import { wordsForLevel } from '../src/levels.js';
import { englishAnchors } from '../src/catalog.js';
import { appendRetrieval, cleanRetrievals, retrievalEntries, reviewEntries, nextDayRecall, longRetention,
  calibration, verifiedKnown, workload, leeches, summarize, cleanExposures, SOURCES, OUTCOMES } from '../src/learning-log.js';
import { createBackup, parseBackup, EXPORT_GUESSES } from '../src/portability.js';
import { baseline } from './backup-fixture.js';

const PACK = wordsForLevel(2);
const DAY = '2026-10-31';
const bare = (anchor) => anchor.replace(/^(?:the|a|an|to)\s+/, '').split(/[\s'-]+/).filter(Boolean);
const shareSense = (a, b) => englishAnchors({ en: a }).some((x) => englishAnchors({ en: b }).some((y) => {
  const [small, large] = bare(x).length <= bare(y).length ? [bare(x), bare(y)] : [bare(y), bare(x)];
  return small.length > 0 && small.every((token) => large.includes(token));
}));

test('every bundled Spanish word gets a safe, deterministic choice set', () => {
  for (const word of PACK) {
    const result = guessChoices(word, PACK, { wordId: word.fr, day: DAY });
    expect(result).not.toBeNull();
    const { choices, answer } = result;
    expect(choices.length).toBeGreaterThanOrEqual(1 + MIN_DISTRACTORS);
    expect(choices.length).toBeLessThanOrEqual(1 + MAX_DISTRACTORS);
    expect(choices[answer]).toBe(word.en);
    expect(new Set(choices.map((c) => c.toLowerCase())).size).toBe(choices.length);
    const distractors = choices.filter((_, i) => i !== answer);
    for (const d of distractors) {
      expect(d).not.toBe(word.en);
      expect(shareSense(d, word.en)).toBe(false);
      expect(PACK.some((entry) => entry.en === d)).toBe(true); // drawn from the pack, never invented
      // no distractor is the gloss of a homograph of this word (accent-folded target)
      const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      expect(PACK.some((entry) => entry.en === d && fold(entry.fr) === fold(word.fr))).toBe(false);
    }
    for (let i = 0; i < distractors.length; i++) for (let j = i + 1; j < distractors.length; j++)
      expect(shareSense(distractors[i], distractors[j])).toBe(false);
    // Deterministic for the same word and day.
    expect(guessChoices(word, PACK, { wordId: word.fr, day: DAY })).toEqual(result);
  }
});

test('the distractor set is stable across days; only the order is reseeded by day', () => {
  let reordered = 0;
  for (const word of PACK) {
    const a = guessChoices(word, PACK, { wordId: word.fr, day: '2026-10-30' });
    const b = guessChoices(word, PACK, { wordId: word.fr, day: '2026-10-31' });
    expect([...a.choices].sort()).toEqual([...b.choices].sort());
    if (a.choices.join('|') !== b.choices.join('|')) reordered++;
  }
  expect(reordered).toBeGreaterThan(PACK.length / 2); // the day seed actually shuffles
  // The answer lands in every position across the pack, so position never gives it away.
  const positions = new Set(PACK.map((word) => guessChoices(word, PACK, { wordId: word.fr, day: DAY }).answer));
  expect(positions).toEqual(new Set([0, 1, 2, 3]));
});

test('distractors prefer the answer shape and a similar length', () => {
  const word = PACK.find((w) => w.fr === 'el problema');
  const { choices } = guessChoices(word, PACK, { wordId: word.fr, day: DAY });
  expect(choices.every((c) => c.startsWith('the '))).toBe(true);
  const short = PACK.find((w) => w.fr === 'y');
  const shortChoices = guessChoices(short, PACK, { wordId: short.fr, day: DAY }).choices;
  expect(Math.max(...shortChoices.map((c) => c.length))).toBeLessThanOrEqual(4);
});

test('homographs, overlapping senses and duplicate glosses are refused', () => {
  const pack = [
    { fr: 'si', en: 'if' }, { fr: 'sí', en: 'yes' }, // folded homograph: "yes" could be the answer
    { fr: 'mucho', en: 'a lot' }, { fr: 'demasiado', en: 'too much' }, { fr: 'más', en: 'much / more' },
    { fr: 'otro', en: 'if' }, // the same gloss under another word
    { fr: 'casa', en: 'house' }, { fr: 'perro', en: 'dog' }, { fr: 'gato', en: 'cat' },
  ];
  const { choices } = guessChoices({ fr: 'si', en: 'if' }, pack, { wordId: 'si', day: DAY });
  expect(choices).toContain('if');
  expect(choices).not.toContain('yes');
  expect(choices.filter((c) => c === 'if')).toHaveLength(1);
  const much = guessChoices({ fr: 'mucho', en: 'a lot' }, [...pack, { fr: 'muchísimo', en: 'a lot more' }],
    { wordId: 'mucho', day: DAY }).choices;
  expect(much).not.toContain('a lot more'); // a superset of the answer's sense
  // "too much" and "much / more" share "much": at most one of them is offered.
  const lot = guessChoices({ fr: 'bastante', en: 'quite' }, pack, { wordId: 'bastante', day: DAY }).choices;
  expect(lot.filter((c) => c === 'too much' || c === 'much / more').length).toBeLessThanOrEqual(1);
});

test('too few safe distractors fall back to the plain gloss (null)', () => {
  const pack = [{ fr: 'y', en: 'and' }, { fr: 'e', en: 'and' }, { fr: 'pero', en: 'but' }];
  expect(guessChoices({ fr: 'y', en: 'and' }, pack, { wordId: 'y', day: DAY })).toBeNull();
  expect(guessChoices({ fr: 'y', en: '' }, PACK, { wordId: 'y', day: DAY })).toBeNull();
  expect(guessChoices({ fr: 'y', en: 'and' }, null, { wordId: 'y', day: DAY })).toBeNull();
  expect(guessChoices({ fr: 'y', en: 'and' }, PACK, { wordId: 'y' })).toBeNull();
  expect(GUESS_LIMIT).toBe(3);
  expect(seedHash('y\u00002026-10-31')).toBe(seedHash('y\u00002026-10-31'));
});

const CATALOG = new Set(['y', 'casa', 'perro']);
const guessRow = (word, at, outcome) => ({ word, at, source: 'guess', direction: 'receptive', outcome, prior: 0,
  latencyMs: 2100 });

test('a guess is logged in the existing ten fields with source guess and a receptive direction', () => {
  expect(SOURCES).toContain('guess');
  expect(OUTCOMES).toEqual(expect.arrayContaining(['correct', 'incorrect']));
  const state = cleanRetrievals(null);
  expect(appendRetrieval(state, { ...guessRow('y', 1000, 'correct'), url: 'https://x.test/' }, CATALOG)).toBe(true);
  expect(state.retrievals).toEqual([['y', 1000, 'guess', 'receptive', 'correct', 0, 2100, null, null, null]]);
  // The new values occur only together.
  for (const bad of [{ direction: 'productive' }, { outcome: 'medium' }, { outcome: 'known' }])
    expect(appendRetrieval(state, { ...guessRow('y', 2000, 'incorrect'), ...bad }, CATALOG)).toBe(false);
  for (const outcome of ['correct', 'incorrect'])
    expect(appendRetrieval(state, { word: 'y', at: 3000, source: 'inline', direction: 'productive', outcome, prior: 0 },
      CATALOG)).toBe(false);
  expect(cleanRetrievals({ version: 1, retrievals: [['y', 5, 'standalone', 'productive', 'correct', 0, null, null, null, null],
    ['y', 6, 'guess', 'receptive', 'incorrect', 0, 10, null, null, null]] }).retrievals).toHaveLength(1);
});

test('guesses never enter a review measure', () => {
  const day = (d, h = 12) => new Date(2026, 9, d, h).getTime();
  const state = cleanRetrievals(null);
  const review = (word, at, outcome, extra = {}) => appendRetrieval(state, { word, at, source: 'standalone',
    direction: 'productive', outcome, prior: 0, latencyMs: 3000, elapsedDays: 1, ...extra }, CATALOG);
  review('casa', day(2), 'medium');
  for (let i = 0; i < 6; i++) appendRetrieval(state, guessRow('y', day(1, 8 + i), 'incorrect'), CATALOG);
  const all = retrievalEntries(state);
  const reviews = reviewEntries(all);
  expect(reviews).toHaveLength(1);
  expect(nextDayRecall(all)).toEqual(nextDayRecall(reviews));
  expect(longRetention(all)).toEqual(longRetention(reviews));
  expect(calibration(all)).toEqual(calibration(reviews));
  expect(verifiedKnown(all)).toEqual(verifiedKnown(reviews));
  expect(workload(all, day(3), 30)).toEqual(workload(reviews, day(3), 30));
  expect(leeches(all)).toEqual(leeches(reviews));
  expect(summarize(state, cleanExposures(null), { now: day(3) }).retrievals).toBe(1);
});

test('schema 2 export leaves guesses out and counts them; import accepts them', () => {
  expect(EXPORT_GUESSES).toBe(false);
  const { source, spanish } = baseline();
  const all = structuredClone(source);
  const review = [spanish, 10, 'standalone', 'productive', 'medium', 1, 3000, 2, 3, 0.91];
  const guess = [spanish, 11, 'guess', 'receptive', 'incorrect', 0, 1500, null, null, null];
  all.learningRetrievals = { version: 1, retrievals: [review, guess] };
  const file = JSON.parse(createBackup(all, '0.12.21', 2));
  expect(file.state.scopes.es.retrievals.retrievals).toEqual([review]);
  expect(file.state.logOmitted.retrievals).toBe(1);
  // A file that carries a guess (a later writer) is read by this build.
  file.state.scopes.es.retrievals.retrievals.push(guess);
  delete file.state.logOmitted;
  const parsed = parseBackup(JSON.stringify(file));
  expect(parsed.state.scopes.es.retrievals.retrievals).toEqual([review, guess]);
});

test('the progress measurement: first-guess accuracy and next-day recall of guessed against other words', async () => {
  const { guessMeasurement, measurements, MIN_SAMPLES } = await import('../src/progress.js');
  const { measurementItems } = await import('../src/progress-text.js');
  const g = (word, at, outcome) => ({ word, at, source: 'guess', direction: 'receptive', outcome, prior: 0,
    latencyMs: 1000, elapsedDays: null, intervalDays: null, predicted: null });
  const r = (word, at, outcome, extra = {}) => ({ word, at, source: 'standalone', direction: 'productive', outcome,
    prior: 0, latencyMs: 3000, elapsedDays: 1, intervalDays: null, predicted: null, ...extra });
  // Not enough data: hidden when off and nothing was guessed; shown with the honest state when on.
  expect(guessMeasurement([], { on: false }).shown).toBe(false);
  const empty = guessMeasurement([], { on: true });
  expect(empty).toMatchObject({ shown: true, accuracy: { n: 0, rate: null, enough: false }, recall: { enough: false } });
  // Twelve words guessed (first guesses: 9 right), later guesses of the same word do not count again.
  const entries = [];
  for (let i = 0; i < 12; i++) {
    entries.push(g(`w${i}`, 100 + i, i < 9 ? 'correct' : 'incorrect'));
    entries.push(g(`w${i}`, 200 + i, 'correct'));
    entries.push(r(`w${i}`, 1000 + i, i < 10 ? 'medium' : 'again')); // next-day review after the guess
  }
  for (let i = 0; i < 10; i++) entries.push(r(`u${i}`, 1000 + i, i < 5 ? 'medium' : 'again')); // never guessed
  entries.push(g('late', 5000, 'correct'), r('late', 4000, 'medium')); // guessed only after its review: other
  entries.push(r('claimed', 1000, 'known')); // a claim is never a recall
  const m = guessMeasurement(entries, { on: false });
  expect(m.shown).toBe(true);
  expect(m.accuracy).toEqual({ n: 13, correct: 10, rate: 10 / 13, guesses: 25, enough: true });
  expect(m.recall.guessed).toMatchObject({ n: 12, passed: 10 });
  expect(m.recall.unguessed).toMatchObject({ n: 11, passed: 6 });
  expect(m.recall.enough).toBe(true);
  expect(MIN_SAMPLES.guessRecall).toBe(10);
  // The other measurements ignore guesses entirely.
  const opts = { now: 10000, retention: 0.9, exposures: { words: {} }, learningWords: [] };
  const withGuesses = measurements(entries, opts);
  const without = measurements(entries.filter((e) => e.source !== 'guess'), opts);
  const { guess, ...rest } = withGuesses;
  const { guess: _, ...restWithout } = without;
  expect(rest).toEqual(restWithout);
  const items = measurementItems(withGuesses, 0);
  expect(items.at(-2)).toEqual({ title: 'First-guess accuracy', value: '77% of first guesses were right (13 words).',
    why: expect.stringContaining('retrieval') });
  expect(items.at(-1).value).toBe('83% for guessed words (12 reviews), 55% for other words (11 reviews).');
  const few = measurementItems(measurements([g('a', 1, 'correct')], opts), 0);
  expect(few.at(-2).value).toBe('Not enough data yet: 1 word guessed; 10 are needed.');
  expect(few.at(-1).value).toBe('Not enough data yet: 0 next-day reviews of guessed words and 0 of other words; 10 of each are needed.');
  expect(measurementItems(measurements([], opts), 0).map((i) => i.title)).not.toContain('First-guess accuracy');
});

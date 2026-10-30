import { test, expect } from 'bun:test';
import { EXPOSURES_KEY, MAX_EXPOSURE_WORDS, MAX_LATENCY_MS, MAX_RETRIEVALS, RETRIEVALS_KEY, appendRetrieval,
  calibration, cleanExposures, cleanRetrievals, countExposures, exposureCoverage, leeches, longRetention,
  nextDayRecall, peekRate, recordExposures, recordRetrieval, retrievalEntries, summarize, validWordId,
  verifiedKnown, workload } from '../src/learning-log.js';
import { scopedStorage } from '../src/scope.js';

const memory = () => {
  const data = {};
  return { data, async get(keys) { return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])); },
    async set(entries) { Object.assign(data, structuredClone(entries)); }, async remove(keys) { for (const k of keys) delete data[k]; } };
};
const at = (day, hour = 12) => new Date(2026, 9, day, hour, 0).getTime();
const base = { source: 'standalone', direction: 'productive', prior: 1, latencyMs: 3000, elapsedDays: 3,
  intervalDays: 3, predicted: 0.9 };
const CATALOG = new Set(['y', 'casa', 'por favor', 'perro', 'gato', 'personal:es:0b5c3f1e-8d2a-4c1b-9f3e-2a7d6c5b4e3f']);
function log(rows) {
  const state = cleanRetrievals(null);
  for (const row of rows) expect(appendRetrieval(state, { ...base, ...row }, CATALOG)).toBe(true);
  return state;
}

test('a retrieval stores only the fixed fields, compactly, for catalog words', () => {
  const state = cleanRetrievals(undefined);
  const entry = { word: 'casa', at: at(1), source: 'inline', direction: 'productive', outcome: 'medium', prior: 2,
    latencyMs: 4200, elapsedDays: 5, intervalDays: 11, predicted: 0.912345678,
    url: 'https://example.com/private', host: 'example.com', passage: 'La casa es grande', title: 'secret' };
  expect(appendRetrieval(state, entry, CATALOG)).toBe(true);
  expect(state.retrievals).toEqual([['casa', at(1), 'inline', 'productive', 'medium', 2, 4200, 5, 11, 0.9123]]);
  const json = JSON.stringify(state);
  for (const leaked of ['example', 'private', 'grande', 'secret', 'http']) expect(json).not.toContain(leaked);
  expect(retrievalEntries(state)[0]).toEqual({ word: 'casa', at: at(1), source: 'inline', direction: 'productive',
    outcome: 'medium', prior: 2, latencyMs: 4200, elapsedDays: 5, intervalDays: 11, predicted: 0.9123 });
});

test('words outside the scope catalog and text-like IDs are never logged', () => {
  const state = cleanRetrievals(null);
  const ok = { ...base, word: 'casa', at: at(1), outcome: 'easy' };
  for (const word of ['mesa', 'https://example.com', 'example.com', 'www.example', 'a@b', 'a/b', '<b>', ' casa', 'see www.example now',
    'one two three four five six', 'x'.repeat(101), 'casa\u0000', '']) {
    expect(appendRetrieval(state, { ...ok, word }, new Set([...CATALOG, word]))).toBe(word === 'mesa');
  }
  // Host:port, abbreviations with inner dots, colons, long forms and 5+ words are refused.
  for (const id of ['example.com:443', 'localhost:8080', 'p.ej.', 'foo.bar', 'personal:es:not-a-uuid', 'a:b',
    'x'.repeat(51), 'uno dos tres cuatro cinco seis']) expect(validWordId(id)).toBe(false);
  for (const id of ['etc.', 'au fur et à mesure', 'x'.repeat(50), 'personal:zh-hant:0b5c3f1e-8d2a-4c1b-9f3e-2a7d6c5b4e3f',
    'می\u200cخواهم']) expect(validWordId(id)).toBe(true);
  expect(validWordId('por favor')).toBe(true);
  expect(validWordId('niño')).toBe(true);
  expect(validWordId('personal:es:0b5c3f1e-8d2a-4c1b-9f3e-2a7d6c5b4e3f')).toBe(true);
  expect(appendRetrieval(state, ok, ['casa'])).toBe(true); // an array catalog is accepted
  expect(() => appendRetrieval(state, ok)).toThrow(TypeError);
  expect(() => appendRetrieval(state, ok, 'casa')).toThrow(TypeError);
});

test('invalid enums and numbers are rejected; latency is capped and missing values are null', () => {
  const state = cleanRetrievals(null);
  const ok = { ...base, word: 'casa', at: at(1), outcome: 'easy' };
  for (const bad of [{ source: 'page' }, { direction: 'both' }, { outcome: 'good' }, { at: -1 }, { at: 1.5 },
    { prior: -1 }, { prior: 10001 }, { elapsedDays: -1 }, { intervalDays: 366 }, { elapsedDays: 'x' }])
    expect(appendRetrieval(state, { ...ok, ...bad }, CATALOG)).toBe(false);
  expect(appendRetrieval(state, { ...ok, latencyMs: 2 * 60 * 60 * 1000, predicted: 1.2, elapsedDays: undefined,
    intervalDays: undefined }, CATALOG)).toBe(true);
  expect(state.retrievals).toEqual([['casa', at(1), 'standalone', 'productive', 'easy', 1, MAX_LATENCY_MS, null, null, null]]);
});

test('the retrieval log is bounded, drops the oldest first and cleans malformed stored entries', () => {
  const state = cleanRetrievals(null);
  for (let i = 0; i < MAX_RETRIEVALS + 7; i++) appendRetrieval(state, { ...base, word: 'y', at: i, outcome: 'easy' }, CATALOG);
  expect(state.retrievals.length).toBe(MAX_RETRIEVALS);
  expect(state.retrievals[0][1]).toBe(7);
  const raw = { version: 1, retrievals: [...state.retrievals.slice(-2), ['https://x.com', 1, 'inline', 'productive', 'easy', 0, null, null, null, null],
    ['y', 1, 'inline', 'productive', 'easy', 0, null, null, null], 'junk', null] };
  expect(cleanRetrievals(raw).retrievals.length).toBe(2);
  expect(cleanRetrievals({ version: 2, retrievals: raw.retrievals }).retrievals).toEqual([]);
  expect(cleanRetrievals([]).retrievals).toEqual([]);
});

test('exposures count placements and distinct local days; peeks never add exposures', () => {
  const state = cleanExposures(null);
  expect(countExposures(state, ['casa', 'casa', 'perro', 'mesa', 'https://x.com'], CATALOG, '2026-10-01')).toBe(2);
  countExposures(state, ['casa'], CATALOG, '2026-10-01');
  countExposures(state, ['casa'], CATALOG, '2026-10-03');
  countExposures(state, ['casa'], CATALOG, '2026-10-03', 'peek');
  expect(state.words.casa).toEqual([3, 1, 2, '2026-10-01', '2026-10-03']);
  // Clock rollback: counted, but no new distinct day and last day does not move back.
  countExposures(state, ['casa'], CATALOG, '2026-10-02');
  expect(state.words.casa).toEqual([4, 1, 2, '2026-10-01', '2026-10-03']);
  // A peek on an unseen word creates a zero-exposure record whose first sighting counts a day.
  countExposures(state, ['gato'], CATALOG, '2026-10-04', 'peek');
  expect(state.words.gato).toEqual([0, 1, 0, '2026-10-04', '2026-10-04']);
  countExposures(state, ['gato'], CATALOG, '2026-10-04');
  expect(state.words.gato).toEqual([1, 1, 1, '2026-10-04', '2026-10-04']);
  expect(countExposures(state, ['casa'], CATALOG, '2026-02-30')).toBe(0);
  expect(countExposures(state, ['casa'], CATALOG, '2026-10-05', 'flip')).toBe(0);
  expect(JSON.stringify(state)).not.toContain('mesa');
});

test('the exposure map is bounded and evicts the word seen longest ago', () => {
  const state = cleanExposures(null);
  const ids = Array.from({ length: MAX_EXPOSURE_WORDS }, (_, i) => `w${i}`);
  const allowed = new Set([...ids, 'fresh']);
  countExposures(state, ids, allowed, '2026-10-02');
  countExposures(state, ['w7'], allowed, '2026-10-01'); // rollback keeps last day 10-02
  for (const id of ids.slice(1)) countExposures(state, [id], allowed, '2026-10-03');
  countExposures(state, ['fresh'], allowed, '2026-10-04');
  expect(Object.keys(state.words).length).toBe(MAX_EXPOSURE_WORDS);
  expect(state.words.w0).toBeUndefined();
  expect(state.words.fresh).toEqual([1, 0, 1, '2026-10-04', '2026-10-04']);
  const raw = { version: 1, words: { ...state.words, 'bad.com': [1, 0, 1, '2026-10-01', '2026-10-01'],
    y: [1, 0, 1, '2026-10-05', '2026-10-01'], z: [1, 0, 1, '2026-13-01', '2026-13-01'] } };
  const clean = cleanExposures(raw);
  expect(Object.keys(clean.words).length).toBe(MAX_EXPOSURE_WORDS);
  expect(clean.words['bad.com']).toBeUndefined();
  expect(clean.words.y).toBeUndefined();
  // Counters must be mutually consistent.
  const counters = cleanExposures({ version: 1, words: {
    ok: [5, 2, 3, '2026-10-01', '2026-10-03'], peekOnly: [0, 4, 0, '2026-10-01', '2026-10-01'],
    moreDaysThanExposures: [2, 0, 3, '2026-10-01', '2026-10-05'], absurdDays: [1, 0, 1000000, '2026-10-01', '2026-10-03'], moreDaysThanSpan: [9, 0, 4, '2026-10-01', '2026-10-03'],
    seenWithoutDay: [2, 0, 0, '2026-10-01', '2026-10-01'], daysWithoutExposure: [0, 1, 1, '2026-10-01', '2026-10-01'] } });
  expect(Object.keys(counters.words).sort()).toEqual(['ok', 'peekOnly']);
});

test('storage wrappers keep each scope separate and never overwrite a newer format', async () => {
  const storage = memory();
  const es = scopedStorage(storage, 'es');
  const fr = scopedStorage(storage, 'fr:0123456789abcdef');
  expect(await recordRetrieval(es, { ...base, word: 'casa', at: at(1), outcome: 'easy' }, CATALOG)).toBe(true);
  expect(await recordRetrieval(fr, { ...base, word: 'maison', at: at(1), outcome: 'again' }, new Set(['maison']))).toBe(true);
  expect(await recordRetrieval(es, { ...base, word: 'maison', at: at(1), outcome: 'again' }, CATALOG)).toBe(false);
  expect(await recordExposures(es, ['casa'], CATALOG, '2026-10-01')).toBe(1);
  expect(await recordExposures(es, ['nope'], CATALOG, '2026-10-01')).toBe(0);
  expect(Object.keys(storage.data).sort()).toEqual([EXPOSURES_KEY, RETRIEVALS_KEY,
    `lang:fr:0123456789abcdef:${RETRIEVALS_KEY}`].sort());
  expect(storage.data[RETRIEVALS_KEY].retrievals.map((t) => t[0])).toEqual(['casa']);
  const future = { version: 2, retrievals: [['casa']] };
  storage.data[RETRIEVALS_KEY] = future;
  storage.data[EXPOSURES_KEY] = { version: 3 };
  expect(await recordRetrieval(es, { ...base, word: 'casa', at: at(2), outcome: 'easy' }, CATALOG)).toBe(false);
  expect(await recordExposures(es, ['casa'], CATALOG, '2026-10-02')).toBe(0);
  expect(storage.data[RETRIEVALS_KEY]).toEqual(future);
  expect(storage.data[EXPOSURES_KEY]).toEqual({ version: 3 });
  storage.data[RETRIEVALS_KEY] = 'corrupt';
  expect(await recordRetrieval(es, { ...base, word: 'casa', at: at(2), outcome: 'easy' }, CATALOG)).toBe(true);
});

test('next-day recall uses first retrievals one local day after introduction', () => {
  const entries = retrievalEntries(log([
    { word: 'casa', at: at(2), prior: 0, elapsedDays: 1, outcome: 'medium' },
    { word: 'perro', at: at(2), prior: 0, elapsedDays: 1, outcome: 'again' },
    { word: 'gato', at: at(2), prior: 0, elapsedDays: 1, outcome: 'hard' },
    { word: 'y', at: at(2), prior: 0, elapsedDays: 1, outcome: 'known' }, // claim, not recall
    { word: 'y', at: at(3), prior: 0, elapsedDays: 0, outcome: 'again' }, // same day
    { word: 'casa', at: at(5), prior: 1, elapsedDays: 1, outcome: 'again' }, // not a first retrieval
  ]));
  expect(nextDayRecall(entries)).toEqual({ n: 3, passed: 2, rate: 2 / 3 });
  expect(nextDayRecall([])).toEqual({ n: 0, passed: 0, rate: null });
});

test('long retention, verified-known and leeches follow the documented rules', () => {
  const entries = retrievalEntries(log([
    { word: 'casa', at: at(1), elapsedDays: 25, outcome: 'easy', predicted: 0.8 },
    { word: 'perro', at: at(1), elapsedDays: 21, outcome: 'hard', predicted: 0.86 },
    { word: 'gato', at: at(1), elapsedDays: 30, outcome: 'again', predicted: 0.7 },
    { word: 'y', at: at(1), elapsedDays: 20, outcome: 'easy', predicted: 0.9 },
    { word: 'perro', at: at(2), elapsedDays: 1, outcome: 'again' }, // un-verifies perro
    { word: 'casa', at: at(3), elapsedDays: 40, outcome: 'known', predicted: 0.5 }, // claim ignored
    { word: 'y', at: at(4), prior: 0, elapsedDays: 22, outcome: 'again', predicted: null }, // first retrieval
  ]));
  const long = longRetention(entries);
  expect(long).toMatchObject({ n: 4, passed: 2, rate: 2 / 4 });
  // The scheduler comparison uses only the long-gap retrievals that carry a prediction.
  expect(long.predicted).toMatchObject({ n: 3, observed: 2 / 3 });
  expect(long.predicted.meanPredicted).toBeCloseTo((0.8 + 0.86 + 0.7) / 3, 12);
  expect(verifiedKnown(entries)).toEqual({ count: 1, words: ['casa'] });

  const lapses = retrievalEntries(log([
    ...Array.from({ length: 4 }, (_, i) => ({ word: 'gato', at: at(i + 1), elapsedDays: 2, outcome: 'again' })),
    ...Array.from({ length: 3 }, (_, i) => ({ word: 'perro', at: at(i + 1), elapsedDays: 2, outcome: 'again' })),
    { word: 'perro', at: at(9), elapsedDays: 0, outcome: 'again' }, // same-day retry is not a lapse
    { word: 'perro', at: at(9), prior: 0, elapsedDays: 3, outcome: 'again' }, // a new card cannot lapse
    { word: 'perro', at: at(9), elapsedDays: null, outcome: 'again' }, // no elapsed time: not a lapse
  ]));
  expect(leeches(lapses)).toEqual({ count: 1, words: [{ word: 'gato', lapses: 4 }] });
  expect(leeches(lapses, 3).count).toBe(2);
});

test('calibration buckets predictions and compares the scheduler with a constant predictor', () => {
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => ({ word: 'casa', at: at(1) + i, predicted: 0.95, outcome: 'medium' })),
    { word: 'casa', at: at(2), predicted: 0.95, outcome: 'again' },
    { word: 'perro', at: at(2), predicted: 0.15, outcome: 'again' },
    { word: 'perro', at: at(3), predicted: 0.15, outcome: 'again' },
    { word: 'gato', at: at(3), predicted: null, outcome: 'again' }, // no prediction
    { word: 'y', at: at(3), predicted: 0.5, outcome: 'known' }, // claim
    // Same-day retries always predict 1 and are excluded.
    ...Array.from({ length: 5 }, (_, i) => ({ word: 'gato', at: at(4) + i, predicted: 1, elapsedDays: 0, outcome: 'again' })),
  ];
  const result = calibration(retrievalEntries(log(rows)));
  expect(result.n).toBe(12);
  expect(result.buckets.length).toBe(10);
  expect(result.buckets[9]).toMatchObject({ n: 10, observed: 0.9 });
  expect(result.buckets[9].meanPredicted).toBeCloseTo(0.95, 12);
  expect(result.buckets[1]).toMatchObject({ n: 2, observed: 0 });
  expect(result.buckets[5]).toEqual({ from: 0.5, to: 0.6, n: 0, meanPredicted: null, observed: null });
  // Hand-computed: scheduler (9*0.0025 + 0.9025 + 2*0.0225)/12; constant 0.75: (9*0.0625 + 3*0.5625)/12.
  expect(result.brier).toBeCloseTo((9 * 0.0025 + 0.9025 + 2 * 0.0225) / 12, 12);
  expect(result.baselineBrier).toBeCloseTo((9 * 0.0625 + 3 * 0.5625) / 12, 12);
  expect(result.beatsConstant).toBe(true);
  // A predictor that says the opposite of what happens does not beat the constant.
  const inverted = calibration(retrievalEntries(log(rows.map((r) => r.predicted === 0.95 ? { ...r, predicted: 0.05 }
    : r.predicted === 0.15 ? { ...r, predicted: 0.85 } : r))));
  expect(inverted.beatsConstant).toBe(false);
  expect(calibration([])).toMatchObject({ n: 0, brier: null, beatsConstant: null });
  // A prediction of exactly 1 lands in the top bucket.
  expect(calibration(retrievalEntries(log([{ word: 'y', at: 1, predicted: 1, outcome: 'easy' }]))).buckets[9].n).toBe(1);
  expect(calibration(retrievalEntries(log([{ word: 'y', at: 1, predicted: 0.9, elapsedDays: null, outcome: 'easy' }]))).n).toBe(0);
});

test('peek rate, exposure coverage and workload', () => {
  const exposures = cleanExposures(null);
  for (let d = 1; d <= 9; d++) countExposures(exposures, ['casa'], CATALOG, `2026-10-0${d}`);
  countExposures(exposures, ['perro'], CATALOG, '2026-10-01');
  countExposures(exposures, ['perro'], CATALOG, '2026-10-01');
  countExposures(exposures, ['perro'], CATALOG, '2026-10-01', 'peek');
  expect(peekRate(exposures)).toEqual({ exposures: 11, peeks: 1, rate: 1 / 11,
    words: Object.assign(Object.create(null), { casa: 0, perro: 0.5 }) });
  const proto = cleanExposures(null);
  countExposures(proto, ['__proto__'], ['__proto__'], '2026-10-01');
  const protoRate = peekRate(proto);
  expect(Object.getPrototypeOf(protoRate.words)).toBeNull();
  expect(Object.keys(protoRate.words)).toEqual(['__proto__']);
  expect(exposureCoverage(exposures, ['casa', 'perro', 'gato', 'casa'])).toEqual({ words: 3, medianExposures: 2,
    medianDays: 1, atTarget: 1, rows: [{ word: 'casa', exposures: 9, days: 9 }, { word: 'perro', exposures: 2, days: 1 },
      { word: 'gato', exposures: 0, days: 0 }] });

  const now = at(30, 18);
  const entries = retrievalEntries(log([
    { word: 'casa', at: at(1, 9), outcome: 'easy', latencyMs: 1000 }, // day 1: outside a 7-day window
    { word: 'casa', at: at(24, 0), outcome: 'easy', latencyMs: 2000 }, // first day of the window
    { word: 'perro', at: at(30, 8), outcome: 'again', latencyMs: 6000 },
    { word: 'gato', at: at(30, 9), outcome: 'hard', latencyMs: null },
    { word: 'y', at: at(30, 20), outcome: 'easy', latencyMs: 9000 }, // after now: excluded
  ]));
  expect(workload(entries, now, 7)).toEqual({ reviews: 3, days: 7, reviewsPerDay: 3 / 7, activeDays: 2,
    medianSecondsPerReview: 4 });
  expect(workload(entries, now, 30).reviews).toBe(4);
  expect(() => workload(entries, now, 0)).toThrow(RangeError);
});

test('summarize reports every section 9 measurement for one scope', () => {
  const state = log([{ word: 'casa', at: at(2), prior: 0, elapsedDays: 1, outcome: 'medium', predicted: 0.9 },
    { word: 'casa', at: at(29), elapsedDays: 27, outcome: 'easy', predicted: 0.8 },
    { word: 'y', at: at(29), outcome: 'known' }]);
  const exposures = cleanExposures(null);
  countExposures(exposures, ['casa'], CATALOG, '2026-10-01');
  const summary = summarize(state, exposures, { now: at(30), learningWords: ['casa'] });
  expect(Object.keys(summary)).toEqual(['retrievals', 'claims', 'nextDayRecall', 'longRetention', 'calibration',
    'verifiedKnown', 'peekRate', 'exposureCoverage', 'workload', 'leeches']);
  expect(summary).toMatchObject({ retrievals: 3, claims: 1, nextDayRecall: { n: 1, rate: 1 },
    longRetention: { n: 1, rate: 1, target: 0.9 }, verifiedKnown: { count: 1 }, workload: { reviews: 3 },
    leeches: { count: 0 } });
  expect(() => summarize(state, exposures)).toThrow(RangeError);
});

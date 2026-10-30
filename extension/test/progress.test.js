import { test, expect, afterAll } from 'bun:test';
import { reviewCard, withFsrs } from '../src/fsrs.js';
import { localDay } from '../src/events.js';
import { retrievalEntries, cleanRetrievals } from '../src/learning-log.js';
import { wordStage, stageCounts, verifiedWords, todayCounts, activity, practisedThisWeek, measurements,
  MAINTENANCE_DAYS, MIN_SAMPLES } from '../src/progress.js';
import { todayLine, primaryAction, measurementItems, headline } from '../src/progress-text.js';

const DAY = 86400000;
const originalTz = process.env.TZ;
afterAll(() => { process.env.TZ = originalTz; });

// A card as review.js writes it after each rating (scheduleCard), driven by the real scheduler.
function rate(card, rating, now) {
  const step = reviewCard(card.fsrs ?? null, rating, now);
  return { ...card, fsrs: step.fsrs, interval: step.interval, due: step.due, reviews: card.reviews + 1 };
}

test('stages follow FSRS stability: learning until 21 days, then maintenance; a lapse returns to learning', () => {
  const t0 = Date.parse('2026-01-05T12:00:00Z');
  expect(wordStage(undefined)).toBe('new');
  let card = { due: t0, interval: 0, reviews: 0, introducedDay: '2026-01-05' };
  expect(wordStage(card)).toBe('learning'); // introduced, not yet rated
  const stages = [];
  let now = t0;
  for (let i = 0; i < 4; i++) {
    card = rate(card, 'medium', now);
    stages.push([card.interval, Math.round(card.fsrs.stability * 100) / 100, wordStage(card)]);
    now = card.due;
  }
  // Pinned from fsrs.js (FSRS-6 default weights, retention 0.9, Good at each due date).
  expect(stages).toEqual([[2, 2.31, 'learning'], [11, 10.96, 'learning'], [46, 46.28, 'maintenance'],
    [163, 162.86, 'maintenance']]);
  for (const [, stability, stage] of stages) expect(stage).toBe(stability >= MAINTENANCE_DAYS ? 'maintenance' : 'learning');
  const lapsed = rate(card, 'again', now);
  expect(lapsed.interval).toBe(0);
  expect(lapsed.fsrs.stability).toBeLessThan(MAINTENANCE_DAYS);
  expect(wordStage(lapsed)).toBe('learning');
  // Without stored state the migrated stability is the interval (fsrs.js migrateCard).
  const old = { due: t0 + 30 * DAY, interval: 30, reviews: 4 };
  expect(withFsrs(old).fsrs.stability).toBe(30);
  expect(wordStage(old)).toBe('maintenance');
  expect(wordStage({ ...old, interval: 20, due: t0 + 20 * DAY })).toBe('learning');
  expect(wordStage({ ...card, familiar: true })).toBe('known');
  expect(wordStage({ ...card, familiar: true }, true)).toBe('verified');
  expect(wordStage(undefined, true)).toBe('new'); // no card, no stage beyond new
  const cards = { a: card, b: lapsed, c: { ...card, familiar: true } };
  expect(stageCounts(['a', 'b', 'c', 'd', 'a'], cards, new Set(['c'])))
    .toEqual({ new: 1, learning: 1, maintenance: 1, known: 0, verified: 1 });
});

const entry = (word, at, outcome, elapsedDays, extra = {}) => ({ word, at, source: 'standalone', direction: 'productive',
  outcome, prior: 1, latencyMs: 4000, elapsedDays, intervalDays: 30, predicted: 0.9, ...extra });

test('verified words need a 21+ day pass in the current card life, with no Again since', () => {
  process.env.TZ = 'America/New_York';
  const intro = '2026-01-01';
  const t = (day) => new Date(`${day}T10:00:00`).getTime();
  const card = { due: t('2026-04-01'), interval: 40, reviews: 3, introducedDay: intro };
  const cards = { gato: card, perro: { ...card }, casa: { ...card } };
  const log = [
    entry('gato', t('2026-02-10'), 'medium', 25),
    entry('perro', t('2026-02-10'), 'easy', 21),
    entry('perro', t('2026-02-12'), 'again', 2),
    entry('casa', t('2026-02-10'), 'hard', 20), // a pass, but below 21 days
    entry('mesa', t('2026-02-10'), 'easy', 30), // no card: never verified
    entry('casa', t('2026-02-11'), 'known', null), // a claim never verifies
  ];
  expect([...verifiedWords(log, cards)].sort()).toEqual(['gato']);
  // Reset deletes the card; a re-introduction starts a new life the same day. The old pass's gap
  // began 25 days before the new introduction day, so it no longer verifies the word.
  const reborn = { gato: { due: t('2026-02-10') + 60000, interval: 0, reviews: 0, introducedDay: '2026-02-10' } };
  expect([...verifiedWords(log, reborn)]).toEqual([]);
  expect([...verifiedWords(log, {})]).toEqual([]);
  // A pass in the new life whose gap began on the introduction day verifies it again.
  const later = [...log, entry('gato', t('2026-03-03'), 'medium', 21, { prior: 0 })];
  expect([...verifiedWords(later, reborn)]).toEqual(['gato']);
  // A card without an introduction day (pre-0.8 cards) has no floor.
  expect([...verifiedWords(log, { gato: { due: 0, interval: 30, reviews: 3 } })]).toEqual(['gato']);
});

for (const tz of ['America/Los_Angeles', 'Asia/Tokyo']) {
  test(`today counts and the activity strip use local days (${tz})`, () => {
    process.env.TZ = tz;
    // One instant: 2026-10-30 in Los Angeles evening is already 2026-10-31 in Tokyo.
    const now = Date.parse('2026-10-31T02:30:00Z');
    const day = localDay(new Date(now));
    expect(day).toBe(tz === 'Asia/Tokyo' ? '2026-10-31' : '2026-10-30');
    const yesterday = localDay(new Date(now - DAY));
    const entries = [
      entry('gato', now - 60000, 'medium', 3),
      entry('gato', now - 50000, 'known', null),
      entry('perro', now - DAY, 'again', 1),
      entry('casa', now + DAY, 'easy', 5), // clock rollback: a future entry is ignored
      entry('mesa', now - 40 * DAY, 'easy', 9), // outside the strip
    ];
    const scopes = [
      { cards: { gato: { introducedDay: day }, perro: { introducedDay: yesterday },
        sol: { introducedDay: day, familiar: true } },
        sent: { day, words: ['gato', 'peek:gato', 'perro', 7] },
        pending: [{ word: 'gato', kind: 'flip', day }, { word: 'gato', kind: 'flip', day: yesterday }, null, 'x'] },
      { cards: { 'personal:es:x': { introducedDay: day } }, sent: { day: yesterday, words: ['old'] }, pending: 'bad' },
      { cards: {}, sent: null, pending: undefined },
    ];
    expect(todayCounts(scopes, entries, now)).toEqual({ day, introduced: 2, seen: 2, peeked: 1, flipped: 1, reviewed: 1 });
    const strip = activity(entries, now);
    expect(strip).toHaveLength(30);
    expect(strip.at(-1)).toEqual({ day, retrievals: 2 });
    expect(strip.at(-2)).toEqual({ day: yesterday, retrievals: 1 });
    expect(strip.reduce((n, d) => n + d.retrievals, 0)).toBe(3);
    expect(new Set(strip.map((d) => d.day)).size).toBe(30);
    expect(practisedThisWeek(strip)).toBe(2);
  });
}

test('the strip has one entry per local day across a DST change, and a week counts at most 7 days', () => {
  process.env.TZ = 'America/New_York';
  const now = new Date('2026-11-03T10:00:00').getTime(); // DST ended on 2026-11-01
  const entries = Array.from({ length: 40 }, (_, i) => entry('gato', new Date(2026, 10, 3 - i, 9).getTime(), 'medium', 1));
  const strip = activity(entries, now);
  expect(strip[0].day).toBe('2026-10-05');
  expect(strip.at(-1).day).toBe('2026-11-03');
  expect(strip.every((d) => d.retrievals === 1)).toBe(true);
  expect(practisedThisWeek(strip)).toBe(7);
  expect(practisedThisWeek(activity([], now))).toBe(0);
});

test('measurements report "not enough data" until their sample sizes, then rates', () => {
  process.env.TZ = 'UTC';
  const now = Date.parse('2026-10-30T12:00:00Z');
  const empty = measurements([], { now, retention: 0.9, exposures: { words: {} }, learningWords: [] });
  expect(empty.nextDayRecall.enough).toBe(false);
  expect(empty.longRetention.enough).toBe(false);
  expect(empty.calibration.enough).toBe(false);
  expect(empty.leeches.enough).toBe(false);
  expect(empty.exposure.enough).toBe(false);
  expect(empty.workload.enough).toBe(false);
  expect(measurementItems(empty, 0).map((i) => i.value).filter((v) => v.startsWith('Not enough data yet'))).toHaveLength(5);
  for (const item of measurementItems(empty, 0)) expect(item.why).toMatch(/\.$/);

  // Sparse: nine next-day firsts (one short), and real long-gap retrievals through the log's cleaner.
  const raw = [];
  for (let i = 0; i < 9; i++) raw.push([`w${i}`, now - 5 * DAY, 'standalone', 'productive', i < 6 ? 'medium' : 'again', 0, 3000, 1, 1, null]);
  for (let i = 0; i < 12; i++) raw.push([`v${i}`, now - DAY, 'inline', 'productive', i < 9 ? 'easy' : 'again', 3, 5000, 21 + i, 40, 0.88]);
  for (let i = 0; i < 4; i++) raw.push(['leech', now - (10 - i) * DAY, 'standalone', 'productive', 'again', 2 + i, 3000, 1, 0, 0.6]);
  const entries = retrievalEntries(cleanRetrievals({ version: 1, retrievals: raw }));
  const m = measurements(entries, { now, retention: 0.9, exposures: { words: { v0: [9, 1, 8, '2026-09-01', '2026-10-20'] } },
    learningWords: ['v0', 'v1'], label: (id) => (id === 'leech' ? 'la sanguijuela' : id) });
  expect(m.nextDayRecall).toMatchObject({ n: 9, enough: false });
  expect(m.longRetention).toMatchObject({ n: 12, rate: 0.75, target: 0.9, enough: true });
  expect(m.calibration.enough).toBe(false);
  expect(m.calibration.n).toBe(16);
  expect(m.leeches).toEqual({ count: 1, words: [{ word: 'leech', label: 'la sanguijuela', lapses: 4 }], enough: true });
  expect(m.exposure).toMatchObject({ words: 2, atTarget: 1, enough: true });
  expect(m.workload.enough).toBe(true);
  const items = measurementItems(m, 3);
  expect(items[0].value).toBe('3 words recalled after a gap of 3 weeks or more, with no miss since.');
  expect(items[2].value).toBe('75% recalled after gaps of 21 days or more, against a target of 90% (12 reviews).');
  expect(items[4].value).toContain('la sanguijuela');

  // Enough calibration data: 50 scheduled reviews in two buckets.
  const many = Array.from({ length: MIN_SAMPLES.calibration }, (_, i) =>
    entry(`c${i}`, now - DAY, i % 5 ? 'medium' : 'again', 3, { predicted: i < 25 ? 0.95 : 0.7 }));
  const cal = measurements(many, { now, retention: 0.9, exposures: { words: {} }, learningWords: [] }).calibration;
  expect(cal.enough).toBe(true);
  expect(cal.buckets.map((b) => [b.from, b.n])).toEqual([[0.6, 25], [0.8, 25]]);
  expect(measurementItems({ ...m, calibration: cal }, 0)[3].value).toMatch(/^predicted 60%–80%: recalled \d+% of 25; predicted 80%–100%/);
});

test('popup text: the Today line, headline and the honest primary action', () => {
  expect(todayLine({ introduced: 0, seen: 0, peeked: 0, flipped: 0, reviewed: 0 })).toBe('Today: nothing yet');
  expect(todayLine({ introduced: 1, seen: 0, peeked: 0, flipped: 2, reviewed: 0 })).toBe('Today: 1 introduced · 2 flipped');
  expect(headline(0)).toBe('No words verified yet');
  expect(headline(1)).toBe('1 word verified known');
  expect(primaryAction({ due: 1, new: 9 })).toEqual({ label: 'Review 1 due word', page: 'review.html' });
  expect(primaryAction({ due: 0, new: 9 })).toEqual({ label: 'Add words', page: 'review.html' });
  expect(primaryAction({ due: 0, new: 0 })).toEqual({ label: 'Practice', page: 'words.html' });
});

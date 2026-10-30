import { test, expect } from 'bun:test';
import { AGAIN_STEP_MS, DEFAULT_PARAMETERS, FSRS_VERSION, cleanFsrsState, elapsedDays, grade, initialState,
  intervalDays, migrateCard, nextState, predictedRecall, retrievability, reviewCard, withFsrs } from '../src/fsrs.js';

const DAY = 86400000;
// Reference values computed separately in Python from the published FSRS-6 formulas, as
// implemented in py-fsrs v6.3.2 (https://github.com/open-spaced-repetition/py-fsrs/blob/v6.3.2/fsrs/scheduler.py,
// commit 9446cb06) and ts-fsrs v6.0.0 (packages/fsrs/src/models/fsrs-6). The default weights
// below are FSRS6_DEFAULT_WEIGHTS / DEFAULT_PARAMETERS in both.
const close = (actual, expected) => expect(Math.abs(actual - expected)).toBeLessThan(1e-9);

test('FSRS-6 published default parameters are pinned', () => {
  expect(FSRS_VERSION).toBe('FSRS-6');
  expect([...DEFAULT_PARAMETERS]).toEqual([0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
    1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542]);
  expect(Object.isFrozen(DEFAULT_PARAMETERS)).toBe(true);
});

test('ratings map Again/Hard/Medium/Easy to FSRS grades 1-4 and reject anything else', () => {
  expect(['again', 'hard', 'medium', 'easy'].map(grade)).toEqual([1, 2, 3, 4]);
  for (const bad of ['good', 'known', '', 3, null, 'toString', '__proto__']) expect(() => grade(bad)).toThrow(RangeError);
});

test('retrievability is exactly 0.9 when elapsed time equals stability, and decays with time', () => {
  for (const s of [0.5, 2.3065, 10, 365]) close(retrievability(s, s), 0.9);
  expect(retrievability(10, 0)).toBe(1);
  close(retrievability(2.3065, 3), 0.8809479557659419);
  close(retrievability(10, 21), 0.8416462786200101);
  expect(retrievability(10, 30)).toBeLessThan(retrievability(10, 20));
  close(predictedRecall({ stability: 10, difficulty: 5 }, 21), 0.8416462786200101);
});

test('initial states and first intervals match the FSRS-6 defaults (1, 1, 2 and 8 days)', () => {
  expect(initialState('again')).toEqual({ stability: 0.212, difficulty: 6.4133 });
  const hard = initialState('hard'), good = initialState('medium'), easy = initialState('easy');
  expect(hard.stability).toBe(1.2931); close(hard.difficulty, 5.112170705601055);
  expect(good.stability).toBe(2.3065); close(good.difficulty, 2.118103970459015);
  // Raw D0(Easy) is -4.77; difficulty is clamped to 1.
  expect(easy).toEqual({ stability: 8.2956, difficulty: 1 });
  expect([0.212, 1.2931, 2.3065, 8.2956].map((s) => intervalDays(s))).toEqual([1, 1, 2, 8]);
});

test('a review sequence follows the published formulas, including lateness, a lapse and a same-day step', () => {
  let state = initialState('medium');
  const steps = [
    ['medium', 2, 0.9094932559773545, 10.964332335820703, 2.1112142357853942, 11],
    ['medium', 7, 0.9277904444502333, 36.12363574667533, 2.1043313908464474, 36], // early: 7 of 11 days
    ['again', 30, 0.912246591727003, 2.597901855778608, 7.389975788014609, 3],
    ['medium', 0, 1, 2.597901855778608, 7.377814181523433, 3], // same day: a pass never lowers stability
    ['medium', 1, 0.9518287938966605, 4.638027873860768, 7.365664736638748, 5],
    ['hard', 5, 0.8947545719431479, 9.099021949247614, 8.236433861454366, 9],
    ['easy', 10, 0.8933831628520166, 27.87465534946712, 7.632360609431308, 28],
  ];
  for (const [rating, t, r, s, d, iv] of steps) {
    close(predictedRecall(state, t), r);
    state = nextState(state, rating, t);
    close(state.stability, s);
    close(state.difficulty, d);
    expect(intervalDays(state.stability)).toBe(iv);
  }
});

test('rating order is monotone: Again < Hard < Medium < Easy stability, reverse for difficulty', () => {
  const from = { stability: 10, difficulty: 5 };
  const next = ['again', 'hard', 'medium', 'easy'].map((r) => nextState(from, r, 10));
  const expected = [[1.3919869729546932, 8.341762369296838], [23.246875110466817, 6.665995369296838],
    [32.02672948198673, 4.9902283692968386], [51.25386164681294, 3.3144613692968385]];
  next.forEach((n, i) => { close(n.stability, expected[i][0]); close(n.difficulty, expected[i][1]); });
  // A same-day Hard is a pass and never lowers stability (py-fsrs v6.3.2 #155, ts-fsrs v6.0.0).
  expect(nextState(from, 'hard', 0).stability).toBe(10);
  expect(nextState({ stability: 0.5, difficulty: 5 }, 'hard', 0).stability).toBe(0.5);
  // Same-day Again lowers stability through the short-term formula.
  close(nextState({ stability: 0.212, difficulty: 6.4133 }, 'again', 0).stability, 0.08335671711031603);
  // A forgotten weak card cannot come out of a lapse stronger than it went in (long-term 0.2109).
  close(nextState({ stability: 0.212, difficulty: 1 }, 'again', 100).stability, 0.20176633585888237);
});

test('lateness matters: the same rating after a longer gap grows stability more', () => {
  const from = { stability: 10, difficulty: 5 };
  expect(nextState(from, 'medium', 30).stability).toBeGreaterThan(nextState(from, 'medium', 10).stability);
});

test('intervals honour the configurable retention range and the maximum', () => {
  expect(intervalDays(10, 0.9)).toBe(10);
  expect(intervalDays(10, 0.85)).toBe(19);
  expect(intervalDays(1000)).toBe(365);
  expect(intervalDays(1000, 0.9, { maxInterval: 30 })).toBe(30);
  expect(intervalDays(0.001)).toBe(1);
  for (const r of [0.84, 0.91, 0.5, 1, NaN]) expect(() => intervalDays(10, r)).toThrow(RangeError);
  expect(() => intervalDays(10, 0.9, { maxInterval: 0 })).toThrow(RangeError);
  expect(() => intervalDays(0)).toThrow(RangeError);
});

test('invalid states, elapsed days and parameters fail closed', () => {
  expect(() => nextState({ stability: 0, difficulty: 5 }, 'medium', 1)).toThrow(RangeError);
  expect(() => nextState({ stability: 5, difficulty: 11 }, 'medium', 1)).toThrow(RangeError);
  expect(() => nextState({ stability: 5, difficulty: 5 }, 'medium', -1)).toThrow(RangeError);
  expect(() => nextState({ stability: 5, difficulty: 5 }, 'medium', Infinity)).toThrow(RangeError);
  expect(() => initialState('medium', [1, 2, 3])).toThrow(RangeError);
  expect(() => retrievability(10, 1, [...DEFAULT_PARAMETERS.slice(0, 20), 0])).toThrow(RangeError);
});

test('elapsed days are whole 24-hour periods, as py-fsrs counts them; a rollback is zero', () => {
  const evening = Date.parse('2026-10-17T22:00:00Z');
  expect(elapsedDays(evening, evening + 9 * 3600000)).toBe(0); // across midnight
  expect(elapsedDays(evening, evening + DAY - 1)).toBe(0);
  expect(elapsedDays(evening, evening + DAY)).toBe(1);
  expect(elapsedDays(evening, evening + 25 * 3600000)).toBe(1);
  expect(elapsedDays(evening, evening + 31 * DAY + 3600000)).toBe(31);
  expect(elapsedDays(evening, evening - DAY)).toBe(0);
  expect(() => elapsedDays(1.5, evening)).toThrow(RangeError);
});

test('a ten-minute retry across midnight is a same-day step, not a review or a second lapse', () => {
  const lateNight = new Date(2026, 9, 11, 23, 58).getTime(); // 23:58 local time
  const card = reviewCard(null, 'medium', lateNight - 10 * DAY).fsrs;
  const lapse = reviewCard(card, 'again', lateNight);
  expect(lapse.fsrs.lapses).toBe(1);
  const retry = reviewCard(lapse.fsrs, 'medium', lateNight + 11 * 60000); // 00:09 the next local day
  expect(retry.elapsedDays).toBe(0);
  expect(retry.fsrs.stability).toBe(nextState(lapse.fsrs, 'medium', 0).stability);
  expect(retry.interval).toBe(reviewCard(lapse.fsrs, 'medium', lateNight + 60000).interval);
  expect(reviewCard(lapse.fsrs, 'again', lateNight + 11 * 60000).fsrs.lapses).toBe(1);
});

test('reviewCard schedules on actual elapsed time and returns what the log records', () => {
  const t0 = Date.parse('2026-10-01T09:00:00Z');
  const first = reviewCard(null, 'medium', t0);
  expect(first).toEqual({ fsrs: { stability: 2.3065, difficulty: first.fsrs.difficulty, lastReview: t0, lapses: 0 },
    interval: 2, due: t0 + 2 * DAY, elapsedDays: null, predictedRecall: null });
  // Reviewed five days late: the elapsed time, not the scheduled interval, drives the update.
  const late = t0 + 7 * DAY;
  const second = reviewCard(first.fsrs, 'medium', late);
  expect(second.elapsedDays).toBe(7);
  close(second.predictedRecall, retrievability(2.3065, 7));
  close(second.fsrs.stability, nextState(first.fsrs, 'medium', 7).stability);
  expect(second.due).toBe(late + second.interval * DAY);
  const onTime = reviewCard(first.fsrs, 'medium', t0 + 2 * DAY);
  expect(second.fsrs.stability).toBeGreaterThan(onTime.fsrs.stability);
});

test('Again keeps memory across a lapse, uses the retry step and counts one lapse per forgetting', () => {
  const t0 = Date.parse('2026-10-01T09:00:00Z');
  let card = reviewCard(null, 'easy', t0).fsrs;
  card = reviewCard(card, 'easy', t0 + 8 * DAY).fsrs;
  const before = card.stability;
  const at = t0 + 50 * DAY;
  const lapse = reviewCard(card, 'again', at);
  expect(lapse).toMatchObject({ interval: 0, due: at + AGAIN_STEP_MS });
  expect(lapse.fsrs.lapses).toBe(1);
  // FSRS post-lapse stability is not a reset to the new-card value.
  expect(lapse.fsrs.stability).toBeGreaterThan(initialState('again').stability);
  expect(lapse.fsrs.stability).toBeLessThan(before);
  const retry = reviewCard(lapse.fsrs, 'again', at + AGAIN_STEP_MS);
  expect(retry.fsrs.lapses).toBe(1); // same-day retry is not another lapse
  expect(reviewCard(null, 'again', t0).fsrs.lapses).toBe(0); // a new card cannot lapse
  expect(() => reviewCard({ stability: -1 }, 'again', at)).toThrow(RangeError);
  // Clock rollback: the current clock is trusted, elapsed is 0 and due never precedes the last review.
  const rolledBack = reviewCard(card, 'medium', card.lastReview - 3 * DAY);
  expect(rolledBack.elapsedDays).toBe(0);
  expect(rolledBack.fsrs.lastReview).toBe(card.lastReview - 3 * DAY);
  expect(rolledBack.due).toBeGreaterThanOrEqual(rolledBack.fsrs.lastReview);
  expect(withFsrs({ due: rolledBack.due, interval: rolledBack.interval, reviews: 3, fsrs: rolledBack.fsrs }).fsrs)
    .toEqual(rolledBack.fsrs);
  expect(() => reviewCard(null, 'again', -1)).toThrow(RangeError);
  for (const maxInterval of [0, 366, 1.5]) expect(() => reviewCard(card, 'medium', at, { maxInterval })).toThrow(RangeError);
  expect(reviewCard(card, 'medium', at, { retention: 0.85 }).interval)
    .toBeGreaterThan(reviewCard(card, 'medium', at).interval);
});

test('cleanFsrsState keeps only valid bounded fields', () => {
  const ok = { stability: 3.5, difficulty: 4.2, lastReview: 1, lapses: 2 };
  expect(cleanFsrsState({ ...ok, extra: 'https://example.com' })).toEqual(ok);
  for (const bad of [null, [], { ...ok, stability: NaN }, { ...ok, difficulty: 0.5 }, { ...ok, lastReview: -1 },
    { ...ok, lapses: 1.5 }, { ...ok, lapses: 10001 }, { ...ok, stability: 1e9 }]) expect(cleanFsrsState(bad)).toBeNull();
});

test('migration derives FSRS state from the existing card shape and preserves every field', () => {
  const due = Date.parse('2026-11-10T12:00:00Z');
  // Introduced only: stays new.
  expect(migrateCard({ due, interval: 0, reviews: 0, introducedDay: '2026-10-30' })).toBeNull();
  // Last rating Again: due ten minutes after the review.
  expect(migrateCard({ due, interval: 0, reviews: 4 }))
    .toEqual({ stability: 0.212, difficulty: 6.4133, lastReview: due - AGAIN_STEP_MS, lapses: 0 });
  // Hard, Medium and Easy: stability is the old interval, so 0.9 retention keeps the due date.
  const hard = migrateCard({ due, interval: 1, reviews: 2 });
  const medium = migrateCard({ due, interval: 12, reviews: 5 });
  const easy = migrateCard({ due, interval: 21, reviews: 3, easyStreak: 2 });
  expect(hard).toMatchObject({ stability: 1, lastReview: due - DAY }); close(hard.difficulty, 5.112170705601055);
  expect(medium).toMatchObject({ stability: 12, lastReview: due - 12 * DAY }); close(medium.difficulty, 2.118103970459015);
  expect(easy).toEqual({ stability: 21, difficulty: 1, lastReview: due - 21 * DAY, lapses: 0 });
  for (const m of [hard, medium, easy]) expect(m.lastReview + intervalDays(m.stability) * DAY).toBe(due);
  // A timestamp before the epoch or a malformed card gives no guess.
  expect(migrateCard({ due: DAY, interval: 30, reviews: 2 })).toBeNull();
  expect(migrateCard({ due, interval: 400, reviews: 2 })).toBeNull();
  expect(migrateCard({ due: -1, interval: 1, reviews: 2 })).toBeNull();
  expect(migrateCard(null)).toBeNull();

  const card = { due, interval: 12, reviews: 5, familiar: true, easyStreak: 3, introducedDay: '2026-09-01',
    introGateDay: '2026-09-02' };
  const migrated = withFsrs(card);
  const { fsrs, ...rest } = migrated;
  expect(rest).toEqual(card);
  expect(card.fsrs).toBeUndefined(); // input not mutated
  expect(fsrs).toEqual({ stability: 12, difficulty: 1, lastReview: due - 12 * DAY, lapses: 0 });
  // An existing valid state is kept; an invalid one is replaced by a derived state.
  const kept = { stability: 40, difficulty: 3, lastReview: due - 12 * DAY, lapses: 1 }; // agrees with interval 12
  expect(withFsrs({ ...card, fsrs: kept }).fsrs).toEqual(kept);
  expect(withFsrs({ ...card, fsrs: { stability: 'x' } }).fsrs).toEqual(fsrs);
  // due and interval are authoritative: a state that disagrees with them is re-derived.
  expect(withFsrs({ ...card, fsrs: { ...kept, lastReview: due + 1 } }).fsrs).toEqual(fsrs);
  expect(withFsrs({ ...card, fsrs: { ...kept, lastReview: due - 11 * DAY } }).fsrs).toEqual(fsrs);
  const agreeing = { ...kept, lastReview: due - 12 * DAY };
  expect(withFsrs({ ...card, fsrs: agreeing }).fsrs).toEqual(agreeing);
  // Again: interval 0 and a retry step of at most a day.
  const again = { due, interval: 0, reviews: 4 };
  expect(withFsrs({ ...again, fsrs: { ...kept, lastReview: due - AGAIN_STEP_MS } }).fsrs.stability).toBe(40);
  expect(withFsrs({ ...again, fsrs: { ...kept, lastReview: due - 2 * DAY } }).fsrs.stability).toBe(0.212);
  // Every state reviewCard writes is accepted as consistent.
  let state = null, now = due;
  for (const rating of ['medium', 'again', 'hard', 'easy', 'again', 'medium']) {
    const step = reviewCard(state, rating, now);
    expect(withFsrs({ due: step.due, interval: step.interval, reviews: 10, fsrs: step.fsrs }).fsrs).toEqual(step.fsrs);
    state = step.fsrs; now = step.due;
  }
  expect(withFsrs({ due, interval: 0, reviews: 0 })).toEqual({ due, interval: 0, reviews: 0 });
});

test('matches py-fsrs 6.3.2 on 24 recorded review sequences (fixture generated from upstream)', async () => {
  const reference = await Bun.file(new URL('./fsrs-reference.json', import.meta.url)).json();
  expect(reference.source).toStartWith('py-fsrs 6.3.2');
  expect(reference.parameters).toEqual([...DEFAULT_PARAMETERS]);
  const names = [null, 'again', 'hard', 'medium', 'easy'];
  let checked = 0;
  for (const [[first, , s0, d0, i0], ...steps] of reference.sequences) {
    let state = initialState(names[first]);
    expect(state.stability).toBeCloseTo(s0, 12);
    expect(state.difficulty).toBeCloseTo(d0, 12);
    expect(intervalDays(state.stability)).toBe(i0);
    for (const [g, elapsed, s, d, interval] of steps) {
      state = nextState(state, names[g], elapsed);
      expect(Math.abs(state.stability - s) / s).toBeLessThan(1e-12);
      expect(state.difficulty).toBeCloseTo(d, 12);
      expect(intervalDays(state.stability)).toBe(interval);
      checked++;
    }
  }
  expect(checked).toBe(24 * 12);
});

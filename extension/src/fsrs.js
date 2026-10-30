// FSRS-6 memory model and scheduler: pure, dependency-free, no clock or storage access.
//
// Source: the Free Spaced Repetition Scheduler, algorithm version FSRS-6 (21 weights), as
// published by open-spaced-repetition in "The Algorithm"
// (https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm) and implemented by
// py-fsrs 6.x and ts-fsrs 5.x (both MIT). This file is an independent port of the published
// formulas, not vendored code. DEFAULT_PARAMETERS are the FSRS-6 published defaults; the
// numeric constants are attributed in NOTICE. They were transcribed without network access in
// this change, so the tests pin them and the formulas to hand-computed values.
//
// Deliberate differences from the reference schedulers, all of which are product choices:
// - Elapsed time is whole 24-hour periods since the last review (`elapsedDays`), as py-fsrs
//   counts it; under one day uses FSRS's short-term (same-day) stability formula. Calendar
//   days would turn a ten-minute retry across midnight into a one-day review.
// - No interval fuzz: scheduling is deterministic so the worker tests can pin it.
// - No learning-step state machine. Again schedules a fixed retry step (10 minutes, as the
//   existing review.js does) and records the FSRS post-lapse stability.
// - Intervals are capped at 365 days by default, the bound the learning backup validates.
//
// Ratings: Lang Weave's again/hard/medium/easy are FSRS Again/Hard/Good/Easy (grades 1–4).

export const FSRS_VERSION = 'FSRS-6';
export const DEFAULT_PARAMETERS = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
  1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);
export const DEFAULT_RETENTION = 0.9;
export const MIN_RETENTION = 0.85;
export const MAX_RETENTION = 0.9;
export const MAX_INTERVAL_DAYS = 365;
export const MIN_STABILITY = 0.001;
export const MAX_STABILITY = 36500;
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;
export const MAX_LAPSES = 10000;
export const AGAIN_STEP_MS = 10 * 60 * 1000;
const DAY_MS = 86400000;
const GRADES = Object.freeze({ again: 1, hard: 2, medium: 3, easy: 4 });

export function grade(rating) {
  if (typeof rating !== 'string' || !Object.hasOwn(GRADES, rating)) throw new RangeError('FSRS: unknown rating');
  return GRADES[rating];
}

function checkParameters(w) {
  if (w === DEFAULT_PARAMETERS) return w;
  if (!Array.isArray(w) || w.length !== 21 || !w.every(Number.isFinite) || !(w[20] > 0))
    throw new RangeError('FSRS: parameters must be 21 finite FSRS-6 weights with a positive decay');
  return w;
}
const decay = (w) => -w[20];
// FACTOR makes retrievability exactly 0.9 when elapsed time equals stability.
const factor = (w) => 0.9 ** (1 / decay(w)) - 1;
const clampStability = (s) => Math.min(MAX_STABILITY, Math.max(MIN_STABILITY, s));
const clampDifficulty = (d) => Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, d));
// Unclamped D0; mean reversion targets the unclamped Easy value, as the reference does.
const initialDifficultyRaw = (g, w) => w[4] - Math.exp(w[5] * (g - 1)) + 1;

function checkElapsed(elapsedDays) {
  if (!Number.isFinite(elapsedDays) || elapsedDays < 0) throw new RangeError('FSRS: elapsed days must be finite and non-negative');
  return elapsedDays;
}
function checkState(state) {
  if (!state || !Number.isFinite(state.stability) || state.stability < MIN_STABILITY || state.stability > MAX_STABILITY ||
      !Number.isFinite(state.difficulty) || state.difficulty < MIN_DIFFICULTY || state.difficulty > MAX_DIFFICULTY)
    throw new RangeError('FSRS: invalid memory state');
  return state;
}

// Probability of recall after `elapsedDays` for a memory of `stability` days.
export function retrievability(stability, elapsedDays, w = DEFAULT_PARAMETERS) {
  checkParameters(w);
  if (!Number.isFinite(stability) || stability < MIN_STABILITY || stability > MAX_STABILITY)
    throw new RangeError('FSRS: invalid stability');
  return (1 + factor(w) * checkElapsed(elapsedDays) / stability) ** decay(w);
}

export function predictedRecall(state, elapsedDays, w = DEFAULT_PARAMETERS) {
  return retrievability(checkState(state).stability, elapsedDays, w);
}

// Memory state after the first rating of a new card.
export function initialState(rating, w = DEFAULT_PARAMETERS) {
  checkParameters(w);
  const g = grade(rating);
  return { stability: clampStability(w[g - 1]), difficulty: clampDifficulty(initialDifficultyRaw(g, w)) };
}

function nextDifficulty(d, g, w) {
  const damped = d + (MAX_DIFFICULTY - d) * (-w[6] * (g - 3)) / 9;
  return clampDifficulty(w[7] * initialDifficultyRaw(4, w) + (1 - w[7]) * damped);
}

function nextStability(s, d, g, elapsedDays, w) {
  if (elapsedDays < 1) {
    // Same-day review: FSRS-6 short-term stability; a pass never lowers stability.
    let increase = Math.exp(w[17] * (g - 3 + w[18])) * s ** -w[19];
    if (g >= 3) increase = Math.max(increase, 1);
    return clampStability(s * increase);
  }
  const r = retrievability(s, elapsedDays, w);
  if (g === 1) {
    const longTerm = w[11] * d ** -w[12] * ((s + 1) ** w[13] - 1) * Math.exp((1 - r) * w[14]);
    return clampStability(Math.min(longTerm, s / Math.exp(w[17] * w[18])));
  }
  const hardPenalty = g === 2 ? w[15] : 1;
  const easyBonus = g === 4 ? w[16] : 1;
  return clampStability(s * (1 + Math.exp(w[8]) * (11 - d) * s ** -w[9] *
    (Math.exp(w[10] * (1 - r)) - 1) * hardPenalty * easyBonus));
}

// Memory state after rating a card that already has one. Stability uses the prior difficulty.
export function nextState(state, rating, elapsedDays, w = DEFAULT_PARAMETERS) {
  checkParameters(w);
  checkState(state);
  checkElapsed(elapsedDays);
  const g = grade(rating);
  return { stability: nextStability(state.stability, state.difficulty, g, elapsedDays, w),
    difficulty: nextDifficulty(state.difficulty, g, w) };
}

// Whole days until predicted recall falls to `retention`, in [1, maxInterval].
export function intervalDays(stability, retention = DEFAULT_RETENTION,
  { maxInterval = MAX_INTERVAL_DAYS, parameters = DEFAULT_PARAMETERS } = {}) {
  checkParameters(parameters);
  if (!Number.isFinite(stability) || stability < MIN_STABILITY || stability > MAX_STABILITY)
    throw new RangeError('FSRS: invalid stability');
  if (!Number.isFinite(retention) || retention < MIN_RETENTION || retention > MAX_RETENTION)
    throw new RangeError(`FSRS: desired retention must be between ${MIN_RETENTION} and ${MAX_RETENTION}`);
  if (!Number.isSafeInteger(maxInterval) || maxInterval < 1 || maxInterval > MAX_STABILITY)
    throw new RangeError('FSRS: invalid maximum interval');
  const raw = stability / factor(parameters) * (retention ** (1 / decay(parameters)) - 1);
  return Math.min(maxInterval, Math.max(1, Math.round(raw)));
}

// Whole 24-hour periods from `fromMs` to `toMs`; a clock rollback counts as 0.
export function elapsedDays(fromMs, toMs) {
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs)) throw new RangeError('FSRS: invalid timestamp');
  return Math.max(0, Math.floor((toMs - fromMs) / DAY_MS));
}

// Stored per-card FSRS state: { stability, difficulty, lastReview (ms), lapses }.
export function cleanFsrsState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { stability, difficulty, lastReview, lapses } = raw;
  if (!Number.isFinite(stability) || stability < MIN_STABILITY || stability > MAX_STABILITY ||
      !Number.isFinite(difficulty) || difficulty < MIN_DIFFICULTY || difficulty > MAX_DIFFICULTY ||
      !Number.isSafeInteger(lastReview) || lastReview < 0 ||
      !Number.isSafeInteger(lapses) || lapses < 0 || lapses > MAX_LAPSES) return null;
  return { stability, difficulty, lastReview, lapses };
}

// One scheduler step. `fsrs` is the card's stored state, or null for a card never rated.
// Returns the new stored state plus the values the learning log records. A lapse is an
// Again on a rated card at least one day (24 hours) after its last review; repeated Agains
// during the retry step are not further lapses.
export function reviewCard(fsrs, rating, now, { retention = DEFAULT_RETENTION, maxInterval = MAX_INTERVAL_DAYS,
  againStepMs = AGAIN_STEP_MS, parameters = DEFAULT_PARAMETERS } = {}) {
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('FSRS: invalid review time');
  if (!Number.isSafeInteger(againStepMs) || againStepMs < 0 || againStepMs > DAY_MS)
    throw new RangeError('FSRS: invalid Again step');
  // Stored cards and log entries are validated at <= 365 days; never schedule past that.
  if (!Number.isSafeInteger(maxInterval) || maxInterval < 1 || maxInterval > MAX_INTERVAL_DAYS)
    throw new RangeError('FSRS: invalid maximum interval');
  const g = grade(rating);
  const prior = fsrs == null ? null : cleanFsrsState(fsrs);
  if (fsrs != null && !prior) throw new RangeError('FSRS: invalid stored state');
  let state, elapsed = null, predicted = null;
  if (!prior) state = initialState(rating, parameters);
  else {
    elapsed = elapsedDays(prior.lastReview, now);
    predicted = retrievability(prior.stability, elapsed, parameters);
    state = nextState(prior, rating, elapsed, parameters);
  }
  const lapses = Math.min(MAX_LAPSES, (prior?.lapses || 0) + (prior && g === 1 && elapsed >= 1 ? 1 : 0));
  const interval = g === 1 ? 0 : intervalDays(state.stability, retention, { maxInterval, parameters });
  // Rollback policy: the current clock is trusted, as a correction. A review before the stored
  // last review counts 0 elapsed days and becomes the new last review, so due >= lastReview
  // always holds (withFsrs relies on it). A temporary rollback that later reverts makes the
  // next gap look longer by the rollback; that is the accepted cost.
  return { fsrs: { ...state, lastReview: now, lapses }, interval,
    due: g === 1 ? now + againStepMs : now + interval * DAY_MS, elapsedDays: elapsed, predictedRecall: predicted };
}

// Derive FSRS state from a review.js card ({ due, interval, reviews, familiar?, easyStreak?, ... }).
// The old scheduler kept no per-review log, so this is an estimate from what it did keep:
// - reviews === 0: never rated; no FSRS state (the first rating uses initialState).
// - interval === 0 after a rating: the last rating was Again, due 10 minutes after it.
// - interval >= 1: the last rating was Hard (interval 1), Easy (easyStreak > 0) or Medium.
//   Stability is the old interval, so at 0.9 retention FSRS reproduces the existing due date.
// Difficulty is FSRS's initial difficulty for that inferred last rating. Lapses before the
// migration were never recorded and start at 0. A timestamp that would precede the epoch
// yields null rather than a guess. Nothing in the card is changed or dropped.
export function migrateCard(card, w = DEFAULT_PARAMETERS) {
  checkParameters(w);
  if (!card || !Number.isSafeInteger(card.due) || card.due < 0 ||
      !Number.isSafeInteger(card.interval) || card.interval < 0 || card.interval > MAX_INTERVAL_DAYS ||
      !Number.isSafeInteger(card.reviews) || card.reviews < 0 || card.reviews > 10000) return null;
  if (card.reviews === 0) return null;
  if (card.interval === 0) {
    const lastReview = card.due - AGAIN_STEP_MS;
    return lastReview < 0 ? null : { ...initialState('again', w), lastReview, lapses: 0 };
  }
  const lastReview = card.due - card.interval * DAY_MS;
  if (lastReview < 0) return null;
  const last = card.interval === 1 ? 'hard' : Number.isSafeInteger(card.easyStreak) && card.easyStreak > 0 ? 'easy' : 'medium';
  return { stability: clampStability(card.interval),
    difficulty: clampDifficulty(initialDifficultyRaw(grade(last), w)), lastReview, lapses: 0 };
}

// A copy of `card` with `fsrs` attached when it is derivable and not already valid. A stored
// state whose last review is after the card's due time is stale and is re-derived.
export function withFsrs(card, w = DEFAULT_PARAMETERS) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return card;
  const existing = cleanFsrsState(card.fsrs);
  if (existing && !(Number.isSafeInteger(card.due) && existing.lastReview > card.due)) return { ...card, fsrs: existing };
  const { fsrs: _invalid, ...rest } = card;
  const derived = migrateCard(rest, w);
  return derived ? { ...rest, fsrs: derived } : rest;
}

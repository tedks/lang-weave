// Progress derivations for the popup Today line, the My words page and "Is this working?".
// Pure: no clock, storage or Chrome access. Inputs are the cleaned review cards, the cleaned
// learning log (learning-log.js) and the per-scope reading-event stores (events.js). Outputs
// hold counts, local days, catalog forms and personal IDs only: never a URL, host or passage.
import { localDay } from './events.js';
import { validDay } from './learning.js';
import { withFsrs } from './fsrs.js';
import { nextDayRecall, longRetention, calibration, leeches, workload, exposureCoverage } from './learning-log.js';

const DAY_MS = 86400000;
// A recall at a gap of 21 days or more verifies a word (learning-science.md section 9.4).
export const VERIFY_DAYS = 21;
// A card whose FSRS stability reaches 21 days has left learning for long-interval maintenance.
export const MAINTENANCE_DAYS = 21;
export const STAGES = Object.freeze(['new', 'learning', 'maintenance', 'known', 'verified']);
export const ACTIVITY_DAYS = 30;
export const WEEK_DAYS = 7;
// Below these sample sizes a measurement is shown as "not enough data yet", never as a rate.
export const MIN_SAMPLES = Object.freeze({ nextDayRecall: 10, longRetention: 10, calibration: 50, leeches: 20 });

// Local midnight of an ISO local day, in ms; -Infinity when the card has no introduction day.
function dayStart(day) {
  if (!validDay(day)) return -Infinity;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

// Words whose latest long-gap evidence in the current card's life is a pass. Like
// learning-log.js verifiedKnown, any later Again un-verifies the word. Two additions:
// - The word must still have a card. Reset deletes the card, so a reset word is unverified.
// - The pass must measure a gap that began in this card's life: at minus the gap must not
//   precede the card's introduction day (one day of slack for DST and the calendar-day count
//   of a first retrieval). A reset word is re-introduced with a new introduction day, so a
//   pass from before the reset (whose gap began 21+ days before it) never verifies it again.
//   The log has no reset marker (its format is unchanged), and this is the substitute.
// `entries` must be in retrieval order per word (log order; scopes never share an ID).
export function verifiedWords(entries, cards, minDays = VERIFY_DAYS) {
  const verified = new Set();
  for (const e of entries) {
    if (e.outcome === 'known') continue; // a claim is never a recall
    if (e.outcome === 'again') { verified.delete(e.word); continue; }
    const card = cards[e.word];
    if (!card || e.elapsedDays === null || e.elapsedDays < minDays) continue;
    // After a confirmed clock recovery the gate day replaces a future introduction day.
    if (e.at - e.elapsedDays * DAY_MS < dayStart(card.introGateDay || card.introducedDay) - DAY_MS) continue;
    verified.add(e.word);
  }
  for (const word of verified) if (!cards[word]) verified.delete(word);
  return verified;
}

// One word's stage. `card` is a cleaned review card or undefined.
// - new: no card (never introduced, or reset).
// - known: marked "Already know" (a claim) and not verified.
// - verified: recalled at a gap of 21+ days in this card's life, with no Again since.
// - maintenance: FSRS stability of 21+ days (a migrated card's stability is its interval).
// - learning: everything else that has a card, including introduced but not yet rated.
export function wordStage(card, verified = false) {
  if (!card) return 'new';
  if (verified) return 'verified';
  if (card.familiar) return 'known';
  const stability = withFsrs(card).fsrs?.stability ?? 0;
  return stability >= MAINTENANCE_DAYS ? 'maintenance' : 'learning';
}

export function stageCounts(ids, cards, verified) {
  const counts = Object.fromEntries(STAGES.map((stage) => [stage, 0]));
  for (const id of new Set(ids)) counts[wordStage(cards[id], verified.has(id))]++;
  return counts;
}

const sentToday = (sent, day) => sent && sent.day === day && Array.isArray(sent.words)
  ? sent.words.filter((tag) => typeof tag === 'string') : [];

// Today's counts on `now`'s local day across scopes. Each scope is { cards, sent, pending }:
// cleaned review cards, the events.js seenSent record and the readingEvents queue.
// - introduced: cards whose introduction day is today, excluding "Already know" claims.
// - seen / peeked: distinct words (events.js already counts each once per day).
// - flipped: flip events; the queue keeps the latest 500 events, so this is a lower bound.
// - reviewed: graded ratings (Again to Easy) logged today; "Already know" claims are excluded.
export function todayCounts(scopes, entries, now) {
  const day = localDay(new Date(now));
  let introduced = 0, seen = 0, peeked = 0, flipped = 0;
  for (const { cards = {}, sent, pending } of scopes) {
    introduced += Object.values(cards).filter((card) => card.introducedDay === day && !card.familiar).length;
    const tags = sentToday(sent, day);
    peeked += tags.filter((tag) => tag.startsWith('peek:')).length;
    seen += tags.filter((tag) => !tag.startsWith('peek:')).length;
    if (Array.isArray(pending)) flipped += pending.filter((e) => e?.day === day && e.kind === 'flip').length;
  }
  const reviewed = entries.filter((e) => e.outcome !== 'known' && e.at <= now && localDay(new Date(e.at)) === day).length;
  return { day, introduced, seen, peeked, flipped, reviewed };
}

// The last `days` local days ending today, oldest first, with how many retrievals (ratings
// and claims) each holds. Calendar arithmetic, so DST days are still one entry each. Entries
// from the future (a clock rollback) are ignored.
export function activity(entries, now, days = ACTIVITY_DAYS) {
  const today = new Date(now);
  const list = Array.from({ length: days }, (_, i) =>
    localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i))));
  const counts = new Map(list.map((day) => [day, 0]));
  for (const e of entries) {
    if (e.at > now) continue;
    const day = localDay(new Date(e.at));
    if (counts.has(day)) counts.set(day, counts.get(day) + 1);
  }
  return list.map((day) => ({ day, retrievals: counts.get(day) }));
}

// Days with any retrieval among the last seven local days, today included. Forgiving by
// design: a missed day lowers nothing but this rolling count, and nothing is ever "lost".
export function practisedThisWeek(strip) {
  return strip.slice(-WEEK_DAYS).filter((d) => d.retrievals > 0).length;
}

// The section 9 measurements that the log can answer, over every scope's entries, each with
// `enough`: whether the sample is large enough to show. Leech words carry a display label.
export function measurements(entries, { now, retention, exposures, learningWords, label = (id) => id }) {
  const graded = entries.filter((e) => e.outcome !== 'known').length;
  const next = nextDayRecall(entries);
  const long = longRetention(entries, VERIFY_DAYS);
  const cal = calibration(entries, 5);
  const leech = leeches(entries);
  const coverage = exposureCoverage(exposures, learningWords);
  const load = workload(entries, now, ACTIVITY_DAYS);
  return {
    graded,
    nextDayRecall: { ...next, enough: next.n >= MIN_SAMPLES.nextDayRecall },
    longRetention: { n: long.n, rate: long.rate, target: retention, enough: long.n >= MIN_SAMPLES.longRetention },
    calibration: { n: cal.n, brier: cal.brier, baselineBrier: cal.baselineBrier, beatsConstant: cal.beatsConstant,
      buckets: cal.buckets.filter((b) => b.n > 0), enough: cal.n >= MIN_SAMPLES.calibration },
    leeches: { count: leech.count, words: leech.words.slice(0, 20).map(({ word, lapses }) =>
      ({ word, label: label(word), lapses })), enough: graded >= MIN_SAMPLES.leeches },
    exposure: { words: coverage.words, medianDays: coverage.medianDays, atTarget: coverage.atTarget,
      enough: coverage.words > 0 },
    workload: { reviewsPerDay: load.reviewsPerDay, medianSecondsPerReview: load.medianSecondsPerReview,
      enough: load.reviews > 0 },
  };
}

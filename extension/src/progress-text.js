// Plain-language text for the progress message. Pure; shared by the popup, options and My words.
import { t, tn } from './i18n.js';

// English-only pluralisation, kept for callers outside this branch's pages. User-facing counts use tn().
export const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const percent = (rate) => `${Math.round(rate * 100)}%`;

export const STAGE_LABELS = Object.freeze({ new: t('progress_stage_new'), learning: t('progress_stage_learning'),
  maintenance: t('progress_stage_maintenance'), known: t('progress_stage_known'), verified: t('progress_stage_verified') });

export function todayLine(today) {
  const parts = [];
  if (today.introduced > 0) parts.push(t('progress_today_introduced', today.introduced));
  if (today.seen > 0) parts.push(t('progress_today_seen', today.seen));
  if (today.peeked > 0) parts.push(t('progress_today_peeked', today.peeked));
  if (today.flipped > 0) parts.push(t('progress_today_flipped', today.flipped));
  if (today.reviewed > 0) parts.push(t('progress_today_reviewed', today.reviewed));
  return parts.length ? t('progress_today', parts.join(' · ')) : t('progress_today_none');
}

export const weekLine = (days) => tn('progress_week', days);

export const headline = (count) => count ? tn('progress_headline', count) : t('progress_headline_none');

// The primary popup action from the same progress reply: review what is due, otherwise add
// words when some are available, otherwise practise any word from My words.
export function primaryAction({ due, new: available }) {
  if (due > 0) return { label: tn('progress_review_due', due), page: 'review.html' };
  if (available > 0) return { label: t('progress_add_words'), page: 'review.html' };
  return { label: t('progress_practice'), page: 'words.html' };
}

// One entry per measurement: a title, the result or an honest "not enough data yet", and one
// sentence on what it means and what would change it.
export function measurementItems(m, verifiedKnown) {
  const items = [];
  items.push({ title: t('progress_measure_verified_title'),
    value: verifiedKnown ? tn('progress_measure_verified_value', verifiedKnown) : t('progress_measure_verified_none'),
    why: t('progress_measure_verified_why') });
  const next = m.nextDayRecall;
  items.push({ title: t('progress_measure_next_day_title'),
    value: next.enough ? tn('progress_measure_next_day_value', next.n, percent(next.rate))
      : tn('progress_measure_next_day_few', next.n),
    why: t('progress_measure_next_day_why') });
  const long = m.longRetention;
  items.push({ title: t('progress_measure_retention_title'),
    value: long.enough ? tn('progress_measure_retention_value', long.n, percent(long.rate), percent(long.target))
      : tn('progress_measure_retention_few', long.n),
    why: t('progress_measure_retention_why') });
  const cal = m.calibration;
  const bands = () => cal.buckets.map((b) =>
    t('progress_measure_calibration_bucket', percent(b.from), percent(b.to), percent(b.observed), b.n)).join('; ');
  items.push({ title: t('progress_measure_calibration_title'),
    value: !cal.enough ? tn('progress_measure_calibration_few', cal.n)
      : cal.beatsConstant ? t('progress_measure_calibration_beats', bands()) : t('progress_measure_calibration_no_beat', bands()),
    why: t('progress_measure_calibration_why') });
  const leech = m.leeches;
  items.push({ title: t('progress_measure_hard_title'),
    value: !leech.enough ? tn('progress_measure_hard_few', m.graded)
      : leech.count ? tn('progress_measure_hard_value', leech.count, leech.words.map((w) => w.label).join(', '))
        : t('progress_measure_hard_none'),
    why: t('progress_measure_hard_why') });
  const exp = m.exposure;
  items.push({ title: t('progress_measure_exposure_title'),
    value: exp.enough ? tn('progress_measure_exposure_value', exp.medianDays ?? 0, exp.atTarget, exp.words)
      : t('progress_measure_exposure_none'),
    why: t('progress_measure_exposure_why') });
  const load = m.workload;
  items.push({ title: t('progress_measure_workload_title'),
    value: !load.enough ? t('progress_measure_workload_none')
      : load.medianSecondsPerReview === null ? t('progress_measure_workload_value', load.reviewsPerDay.toFixed(1))
        : t('progress_measure_workload_value_seconds', load.reviewsPerDay.toFixed(1), Math.round(load.medianSecondsPerReview)),
    why: t('progress_measure_workload_why') });
  // Guess first: shown while the setting is on or once any guess is logged.
  const guess = m.guess;
  if (guess?.shown) {
    const acc = guess.accuracy;
    items.push({ title: t('progress_measure_guess_title'),
      value: acc.enough ? tn('progress_measure_guess_value', acc.n, percent(acc.rate))
        : tn('progress_measure_guess_few', acc.n),
      why: t('progress_measure_guess_why') });
    const { guessed, unguessed } = guess.recall;
    items.push({ title: t('progress_measure_guess_recall_title'),
      value: guess.recall.enough
        ? t('progress_measure_guess_recall_value', percent(guessed.rate), guessed.n, percent(unguessed.rate), unguessed.n)
        : t('progress_measure_guess_recall_few', guessed.n, unguessed.n),
      why: t('progress_measure_guess_recall_why') });
  }
  return items;
}

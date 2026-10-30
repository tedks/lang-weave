// Plain-language text for the progress message. Pure; shared by the popup, options and My words.
export const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const percent = (rate) => `${Math.round(rate * 100)}%`;

export const STAGE_LABELS = Object.freeze({ new: 'New', learning: 'Learning', maintenance: 'Maintenance',
  known: 'Marked known', verified: 'Verified known' });

export function todayLine(today) {
  const parts = [['introduced', today.introduced], ['seen', today.seen], ['peeked', today.peeked],
    ['flipped', today.flipped], ['reviewed', today.reviewed]].filter(([, n]) => n > 0);
  return parts.length ? `Today: ${parts.map(([label, n]) => `${n} ${label}`).join(' · ')}`
    : 'Today: nothing yet';
}

export const weekLine = (days) => `Practised on ${plural(days, 'day')} of the last 7`;

export const headline = (count) => count
  ? `${plural(count, 'word')} verified known`
  : 'No words verified yet';

// The primary popup action from the same progress reply: review what is due, otherwise add
// words when some are available, otherwise practise any word from My words.
export function primaryAction({ due, new: available }) {
  if (due > 0) return { label: `Review ${plural(due, 'due word')}`, page: 'review.html' };
  if (available > 0) return { label: 'Add words', page: 'review.html' };
  return { label: 'Practice', page: 'words.html' };
}

// One entry per measurement: a title, the result or an honest "not enough data yet", and one
// sentence on what it means and what would change it.
export function measurementItems(m, verifiedKnown) {
  const items = [];
  items.push({ title: 'Verified known',
    value: verifiedKnown ? `${plural(verifiedKnown, 'word')} recalled after a gap of 3 weeks or more, with no miss since.`
      : 'No word has been recalled after a 3-week gap yet.',
    why: 'This counts lasting learning, not words seen. It grows when words survive long gaps between reviews.' });
  const next = m.nextDayRecall;
  items.push({ title: 'Next-day recall',
    value: next.enough ? `${percent(next.rate)} of new words recalled the day after you met them (${plural(next.n, 'review')}).`
      : `Not enough data yet: ${plural(next.n, 'first review')} made the day after introduction; 10 are needed.`,
    why: 'Low next-day recall means words arrive faster than they stick; fewer new words a day, or reviewing the next day, raises it.' });
  const long = m.longRetention;
  items.push({ title: 'Retention after 3 weeks',
    value: long.enough ? `${percent(long.rate)} recalled after gaps of 21 days or more, against a target of ${percent(long.target)} (${plural(long.n, 'review')}).`
      : `Not enough data yet: ${plural(long.n, 'review')} after a 21-day gap; 10 are needed.`,
    why: 'Well below the target means the schedule is too optimistic for you; near it means the spacing is working.' });
  const cal = m.calibration;
  items.push({ title: 'Predicted against actual recall',
    value: cal.enough ? `${cal.buckets.map((b) => `predicted ${percent(b.from)}–${percent(b.to)}: recalled ${percent(b.observed)} of ${b.n}`).join('; ')}. `
      + `The scheduler ${cal.beatsConstant ? 'beats' : 'does not beat'} a constant guess.`
      : `Not enough data yet: ${plural(cal.n, 'scheduled review')}; 50 are needed, and a fair test needs a few hundred.`,
    why: 'If predictions do not beat a constant guess after a few hundred reviews, the scheduler is not fitting your memory.' });
  const leech = m.leeches;
  items.push({ title: 'Hard words',
    value: !leech.enough ? `Not enough data yet: ${plural(m.graded, 'rated review')}; 20 are needed.`
      : leech.count ? `${plural(leech.count, 'word')} missed 4 or more times after a gap of a day or more: ${leech.words.map((w) => w.label).join(', ')}.`
        : 'No word has been missed 4 or more times.',
    why: 'Words that keep slipping need a new context or a memory aid; Reset starts one over.' });
  const exp = m.exposure;
  items.push({ title: 'Meetings while reading',
    value: exp.enough ? `Your learning words were met on a median of ${plural(exp.medianDays ?? 0, 'day')}; ${exp.atTarget} of ${exp.words} reached 8 different days.`
      : 'Not enough data yet: no words are being learned.',
    why: 'Words met on 8 or more different days stick far better; reading on more days moves this.' });
  const load = m.workload;
  items.push({ title: 'Workload',
    value: load.enough ? `${load.reviewsPerDay.toFixed(1)} reviews a day over the last 30 days${load.medianSecondsPerReview === null ? '' : `, about ${Math.round(load.medianSecondsPerReview)} seconds each`}.`
      : 'No reviews in the last 30 days.',
    why: 'If this feels heavy, lower the new words per day in Settings; reviews shrink as intervals grow.' });
  return items;
}

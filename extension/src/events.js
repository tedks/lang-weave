// Reading feedback stays in this extension. No native host, account or page text.
export const PENDING_KEY = 'readingEvents';
export const SENT_KEY = 'seenSent';
export const READING_DAYS_KEY = 'readingDaysV1';
export const MAX_READING_DAYS = 30;
const MAX_EVENTS = 500;
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function validDay(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d\d)-(\d\d)$/.exec(value);
  if (!match) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]);
}

export function validReadingDays(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_READING_DAYS) return false;
  const days = new Set(value);
  return days.size === value.length && [...days].every(validDay);
}

// A pre-0.14 event or shown record can prove a date even if there is no date list yet.
// Match catalog IDs as the queue stored them. An exposure aggregate cannot prove these days.
export function readingDates(record, wordIds) {
  const stored = record[READING_DAYS_KEY];
  const days = new Set(validReadingDays(stored) ? stored : []);
  const allowed = new Set(wordIds.map((word) => word.toLowerCase()));
  const pending = record[PENDING_KEY];
  if (Array.isArray(pending)) for (const event of pending.slice(-MAX_EVENTS)) {
    if (event?.kind === 'seen' && allowed.has(event.word) && validDay(event.day)) days.add(event.day);
  }
  const sent = record[SENT_KEY];
  if (validDay(sent?.day) && Array.isArray(sent.words) &&
      sent.words.some((word) => allowed.has(word) && !word.startsWith('peek:'))) days.add(sent.day);
  return [...days];
}

// Caller serializes read-modify-write operations. Keep only the latest 500 events.
export async function queueEvents(storage, events, day = localDay(), { wordIds = [], canWrite = () => true } = {}) {
  const obj = await storage.get([PENDING_KEY, SENT_KEY, READING_DAYS_KEY]);
  const stored = obj[READING_DAYS_KEY];
  let dates = validReadingDays(stored) ? stored : readingDates(obj, wordIds);
  const pending = Array.isArray(obj[PENDING_KEY]) ? [...obj[PENDING_KEY]] : [];
  const oldSent = obj[SENT_KEY];
  const sent = { day, words: oldSent?.day === day && Array.isArray(oldSent.words)
    ? oldSent.words.filter((word) => typeof word === 'string') : [] };
  for (const e of events || []) {
    if (!e || typeof e.word !== 'string' || !['seen', 'flip', 'peek'].includes(e.kind)) continue;
    const word = e.word.toLowerCase();
    if (e.kind === 'seen' && validDay(day) && dates.at(-1) !== day) {
      // Arrival order lets a sighting after a clock rollback be retained. Future dates are
      // kept within the same cap and remain outside the display window until the clock catches up.
      dates = [...dates.filter((date) => date !== day), day];
    }
    if (e.kind !== 'flip') {
      const tag = e.kind === 'seen' ? word : `peek:${word}`;
      if (sent.words.includes(tag)) continue;
      sent.words.push(tag);
    }
    pending.push({ word, kind: e.kind, day });
  }
  if (!canWrite()) return null;
  await storage.set({ [PENDING_KEY]: pending.slice(-MAX_EVENTS), [SENT_KEY]: sent,
    ...(dates.length && dates !== stored ? { [READING_DAYS_KEY]: dates.slice(-MAX_READING_DAYS) } : {}) });
  return pending.length;
}

export async function shownToday(storage, day = localDay()) {
  const obj = await storage.get([SENT_KEY]);
  const sent = obj?.[SENT_KEY];
  return sent?.day === day && Array.isArray(sent.words)
    ? sent.words.filter((word) => typeof word === 'string' && !word.startsWith('peek:')) : [];
}

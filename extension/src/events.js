// Reading feedback stays in this extension. No native host, account or page text.
export const PENDING_KEY = 'readingEvents';
export const SENT_KEY = 'seenSent';
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Caller serializes read-modify-write operations. Keep only the latest 500 events.
export async function queueEvents(storage, events, day = localDay()) {
  const obj = await storage.get([PENDING_KEY, SENT_KEY]);
  const pending = Array.isArray(obj[PENDING_KEY]) ? obj[PENDING_KEY] : [];
  const sent = obj[SENT_KEY]?.day === day ? obj[SENT_KEY] : { day, words: [] };
  for (const e of events || []) {
    if (!e || typeof e.word !== 'string' || !['seen', 'flip', 'peek'].includes(e.kind)) continue;
    const word = e.word.toLowerCase();
    if (e.kind !== 'flip') {
      const tag = e.kind === 'seen' ? word : `peek:${word}`;
      if (sent.words.includes(tag)) continue;
      sent.words.push(tag);
    }
    pending.push({ word, kind: e.kind, day });
  }
  await storage.set({ [PENDING_KEY]: pending.slice(-500), [SENT_KEY]: sent });
  return pending.length;
}

export async function shownToday(storage, day = localDay()) {
  const obj = await storage.get([SENT_KEY]);
  const sent = obj?.[SENT_KEY];
  return sent?.day === day ? sent.words.filter((w) => !w.startsWith('peek:')) : [];
}

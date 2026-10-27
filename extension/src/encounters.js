// Coarse, saturated, catalog-ID-only signal. No page or visit identity is stored.
export const ENCOUNTERS_KEY = 'vocabularyEncounters';
export const MAX_ENCOUNTER_IDS = 256;
export const MAX_ENCOUNTER_COUNT = 7;

const dayNumber = (day) => /^\d{4}-\d\d-\d\d$/.test(day || '') ? Date.parse(`${day}T00:00:00Z`) / 86400000 : NaN;

export function cleanEncounters(raw, allowedIds, day) {
  const allowed = new Set(allowedIds);
  const today = dayNumber(day), saved = dayNumber(raw?.day);
  const currentBucket = Math.floor(today / 7);
  const savedBucket = Number.isSafeInteger(raw?.bucket) && raw.bucket >= 0 ? raw.bucket : currentBucket;
  const elapsed = Number.isFinite(today) && Number.isFinite(saved) && today >= saved
    ? Math.max(0, Math.min(7, currentBucket - savedBucket)) : 0;
  const heldDay = Number.isFinite(saved) && saved > today ? raw.day : day;
  const bucket = heldDay === raw?.day && saved > today ? savedBucket : currentBucket;
  const counts = Object.create(null);
  const source = raw?.version === 1 && raw.counts && typeof raw.counts === 'object' && !Array.isArray(raw.counts) ? raw.counts : {};
  let kept = 0;
  for (const [id, value] of Object.entries(source).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!allowed.has(id) || !Number.isSafeInteger(value) || value < 1 || value > MAX_ENCOUNTER_COUNT) continue;
    const decayed = Math.max(0, value - elapsed);
    if (decayed && kept < MAX_ENCOUNTER_IDS) { counts[id] = decayed; kept++; }
  }
  const touched = heldDay === raw?.day && Array.isArray(raw?.touched)
    ? [...new Set(raw.touched.filter((id) => typeof id === 'string' && allowed.has(id)))].slice(0, MAX_ENCOUNTER_IDS) : [];
  return { version: 1, day: heldDay, bucket, counts, touched };
}

export function countEncounters(state, ids, day) {
  if (state.day !== day) return state; // clock rollback cannot mint another daily count
  const touched = new Set(state.touched);
  for (const id of ids) {
    if (touched.has(id) || !Object.hasOwn(state.counts, id) && Object.keys(state.counts).length >= MAX_ENCOUNTER_IDS) continue;
    touched.add(id);
    state.counts[id] = Math.min(MAX_ENCOUNTER_COUNT, (state.counts[id] || 0) + 1);
  }
  state.touched = [...touched].slice(0, MAX_ENCOUNTER_IDS);
  return state;
}

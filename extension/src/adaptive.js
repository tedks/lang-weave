import { catalogEntries, matchingEntries } from './catalog.js';
import { activeReservations, introductionOwner, remaining } from './learning.js';
import { buildSystemPrompt, buildUserContent, RESPONSE_SCHEMA } from './prompt.js';
import { buildRequest } from './gemini.js';

export const MAX_CANDIDATES = 32;
export const MAX_VOCABULARY_CHARS = 3000;
export const MAX_FRESH_CANDIDATES = 4;
export const MAX_REQUEST_CHARS = 25000;
export const BACKLOG_THROTTLE = 5;
const BASIC = new Set(['and', 'or', 'but', 'no', 'yes', 'with', 'for (purpose)', 'in', 'the', 'a']);

const weak = (card) => !!card && !card.familiar && card.reviews > 0 && card.interval <= 1;
export function reviewBacklog(state, eligibleWords, now) {
  return eligibleWords.filter(({ fr }) => {
    const card = state.cards[fr];
    return card && !card.familiar && (card.due <= now || weak(card));
  }).length;
}

export function requestChars(words, { batch, level, language, density, shownToday = [] }) {
  // Worker items carry `key`; requestSwaps sends that value as `id`. Measure
  // the exact JSON field that the model receives, including every batch ID.
  const requestBatch = batch.map(({ id, key, text }) => ({ id: key ?? id, text }));
  const body = buildRequest({ system: buildSystemPrompt(level, words, shownToday, language, density),
    user: buildUserContent(requestBatch), schema: RESPONSE_SCHEMA });
  return JSON.stringify(body).length;
}

export function vocabularyChars(words) {
  // JSON is an upper bound for both prompt formats: generated targets use this
  // form, while Spanish uses shorter `fr = en` entries and bare known forms.
  return JSON.stringify(words.map(({ fr, en }) => ({ target: fr, english: en }))).length;
}

export function selectWorkingSet({ batch, words, scope, state, settings, now, day, revision,
  encounters = {}, sender, level, language, density = 'normal', shownToday = [] }) {
  if (!Array.isArray(batch) || !batch.length || !state || !settings.gradual) return [];
  const left = remaining(state.learning, day, settings.newWordsPerDay, now, revision);
  const allowFresh = reviewBacklog(state, words, now) >= BACKLOG_THROTTLE ? 0 : Math.min(MAX_FRESH_CANDIDATES, left);
  const reservations = activeReservations(state.learning, day, now, revision);
  const reserved = new Set(reservations.map((p) => p.word));
  const owned = new Set(reservations.filter((p) => sender && p.ownerKey ===
    introductionOwner(p.ticket, sender, revision)).map((p) => p.word));
  const ranked = matchingEntries(batch, catalogEntries(words, scope)).map(({ id, word, matchLength }) => {
    const card = state.cards[word.fr];
    const base = { ...word, entryId: id, matchLength };
    if (card?.familiar) return { ...base, status: 'known', reasonCode: 'known', rank: 4 };
    if (card?.due <= now) return { ...base, status: 'due', reasonCode: weak(card) ? 'recent_difficulty' : 'due', rank: 0 };
    if (weak(card)) return { ...base, status: 'active', reasonCode: 'recent_difficulty', rank: 1 };
    if (card) return { ...base, status: 'active', reasonCode: 'active', rank: 2 };
    return { ...base, status: 'new', reasonCode: (encounters[id] || 0) >= 2 ? 'encountered_often' : 'new', rank: 3 };
  }).filter((w) => w.status !== 'new' || owned.has(w.fr) || allowFresh > 0 && !reserved.has(w.fr));
  ranked.sort((a, b) => a.rank - b.rank ||
    (a.rank === 0 ? state.cards[a.fr].due - state.cards[b.fr].due : 0) ||
    (a.rank === 3 ? Number(!owned.has(a.fr)) - Number(!owned.has(b.fr)) : 0) ||
    (encounters[b.entryId] || 0) - (encounters[a.entryId] || 0) ||
    (a.rank === 3 ? Number(BASIC.has(a.en)) - Number(BASIC.has(b.en)) : 0) ||
    b.matchLength - a.matchLength ||
    (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
  const selected = [];
  let fresh = 0, newSlots = 0, known = 0;
  for (const word of ranked) {
    if (word.status === 'new' && (fresh >= MAX_FRESH_CANDIDATES ||
        !owned.has(word.fr) && newSlots >= allowFresh) || word.status === 'known' && known >= 2) continue;
    if (selected.length >= MAX_CANDIDATES) break;
    const { rank, matchLength, ...candidate } = word;
    const next = [...selected, candidate];
    if (vocabularyChars(next) > MAX_VOCABULARY_CHARS ||
        requestChars(next, { batch, level, language, density, shownToday }) > MAX_REQUEST_CHARS) continue;
    selected.push(candidate);
    if (word.status === 'new') { fresh++; if (!owned.has(word.fr)) newSlots++; }
    if (word.status === 'known') known++;
  }
  return selected;
}

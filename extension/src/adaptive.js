import { catalogEntries, matchingEntries } from './catalog.js';
import { activeReservations, introductionOwner, remaining } from './learning.js';
import { buildSystemPrompt, buildUserContent, RESPONSE_SCHEMA, unknownBudget } from './prompt.js';
import { buildRequest } from './gemini.js';
import { dueAt } from './review.js';

export const MAX_CANDIDATES = 32;
export const MAX_VOCABULARY_CHARS = 3000;
export const MAX_FRESH_CANDIDATES = 4;
export const MAX_REQUEST_CHARS = 25000;
export const BACKLOG_THROTTLE = 5;
const BASIC = new Set(['and', 'or', 'but', 'no', 'yes', 'with', 'for (purpose)', 'in', 'the', 'a']);

const weak = (card) => !!card && !card.familiar && card.reviews > 0 && card.interval <= 1;
const dayIndex = (day) => Date.parse(`${day}T00:00:00Z`) / 86400000;
export function underExposed(card, aggregate, day) {
  if (!card || card.maintenance || !aggregate || aggregate[2] >= 8) return false;
  const first = card.introducedDay || aggregate[3];
  const age = dayIndex(day) - dayIndex(first);
  return Number.isFinite(age) && age >= 0 && age < 21;
}

// Conservative Spanish cognate cue: same first four letters after accents/articles are removed,
// and at least 70% length overlap. Sense matching remains the model and validator's job.
export function cognate(word, language = 'es') {
  if (language !== 'es') return false;
  const clean = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^(?:the|a|an|to|el|la|los|las|un|una)\s+/, '').replace(/[^a-z]/g, '');
  const a = clean(word.en), b = clean(word.fr);
  return a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4) &&
    Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.7;
}
export function reviewBacklog(state, eligibleWords, now) {
  return eligibleWords.filter(({ fr }) => {
    const card = state.cards[fr];
    return card && !card.maintenance && (dueAt(card) <= now || weak(card));
  }).length;
}

export function requestChars(words, { batch, level, language, density, shownToday = [] }) {
  // Worker items carry `key`; requestSwaps sends that value as `id`. Measure
  // the exact JSON field that the model receives, including every batch ID.
  const requestBatch = batch.map(({ id, key, text }) => ({ id: key ?? id, text }));
  const body = buildRequest({ system: buildSystemPrompt(level, words, shownToday, language, density, unknownBudget(batch)),
    user: buildUserContent(requestBatch), schema: RESPONSE_SCHEMA });
  return JSON.stringify(body).length;
}

export function vocabularyChars(words) {
  // JSON is an upper bound for both prompt formats: generated targets use this
  // form, while Spanish uses shorter `fr = en` entries and bare known forms.
  return JSON.stringify(words.map(({ fr, en }) => ({ target: fr, english: en }))).length;
}

// Deterministic request-wide ceiling after model validation, including cached results. Count
// placements, not unique forms; a repeated unfamiliar word still consumes reading coverage.
export function capUnknownSwaps(results, batch, candidates, currentCards = null) {
  const budget = unknownBudget(batch);
  const order = new Map(candidates.map((word, i) => [word.fr, i]));
  const status = new Map(candidates.map((word) => [word.fr, word.status]));
  const known = (word) => currentCards ? !!currentCards[word]?.maintenance : status.get(word) === 'known';
  const all = Object.entries(results).flatMap(([key, swaps]) => swaps.map((swap, position) => ({ key, swap, position })));
  const unknown = all.filter(({ swap }) => !known(swap.word))
    .sort((a, b) => (order.get(a.swap.word) ?? Infinity) - (order.get(b.swap.word) ?? Infinity));
  const keep = new Set(unknown.slice(0, budget).map(({ key, position }) => `${key}:${position}`));
  return Object.fromEntries(Object.entries(results).map(([key, swaps]) => [key,
    swaps.filter((swap, position) => known(swap.word) ||
      keep.has(`${key}:${position}`))]));
}

export function selectWorkingSet({ batch, words, scope, state, settings, now, day, revision,
  encounters = {}, exposures = {}, sender, level, language, density = 'normal', shownToday = [] }) {
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
    if (card?.maintenance) return { ...base, status: 'known', reasonCode: 'known', rank: 5 };
    if (dueAt(card) <= now) return { ...base, status: 'due', reasonCode: weak(card) ? 'recent_difficulty' : 'due', rank: 0 };
    if (weak(card)) return { ...base, status: 'active', reasonCode: 'recent_difficulty', rank: 1 };
    if (card) return { ...base, status: 'active', reasonCode: underExposed(card, exposures[word.fr], day) ? 'under_exposed' : 'active',
      rank: underExposed(card, exposures[word.fr], day) ? 2 : 3 };
    return { ...base, status: 'new', reasonCode: (encounters[id] || 0) >= 2 ? 'encountered_often' : 'new', rank: 4,
      guessable: cognate(word, language) };
  }).filter((w) => (w.status === 'known' || state.cards[w.fr]?.seenDay !== day || state.cards[w.fr].seenCount < 3) &&
    (w.status !== 'new' || owned.has(w.fr) || allowFresh > 0 && !reserved.has(w.fr)));
  ranked.sort((a, b) => a.rank - b.rank ||
    (a.rank === 0 ? state.cards[a.fr].due - state.cards[b.fr].due : 0) ||
    (a.rank === 4 ? Number(!owned.has(a.fr)) - Number(!owned.has(b.fr)) : 0) ||
    (a.rank === 4 ? Number(!a.guessable) - Number(!b.guessable) : 0) ||
    (encounters[b.entryId] || 0) - (encounters[a.entryId] || 0) ||
    (a.rank === 4 ? Number(BASIC.has(a.en)) - Number(BASIC.has(b.en)) : 0) ||
    b.matchLength - a.matchLength ||
    (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
  const selected = [];
  let fresh = 0, newSlots = 0, known = 0;
  for (const word of ranked) {
    if (word.status === 'new' && (fresh >= MAX_FRESH_CANDIDATES ||
        !owned.has(word.fr) && newSlots >= allowFresh) || word.status === 'known' && known >= 2) continue;
    if (selected.length >= MAX_CANDIDATES) break;
    const { rank, matchLength, guessable, ...candidate } = word;
    const next = [...selected, candidate];
    if (vocabularyChars(next) > MAX_VOCABULARY_CHARS ||
        requestChars(next, { batch, level, language, density, shownToday }) > MAX_REQUEST_CHARS) continue;
    selected.push(candidate);
    if (word.status === 'new') { fresh++; if (!owned.has(word.fr)) newSlots++; }
    if (word.status === 'known') known++;
  }
  return selected;
}

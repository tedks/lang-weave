import { catalogEntries, matchingEntries } from './catalog.js';
import { activeReservations, remaining } from './learning.js';
import { buildSystemPrompt, buildUserContent, RESPONSE_SCHEMA } from './prompt.js';
import { buildRequest } from './gemini.js';

export const MAX_CANDIDATES = 32;
export const MAX_VOCABULARY_CHARS = 3000;
export const MAX_FRESH_CANDIDATES = 4;
export const MAX_REQUEST_CHARS = 25000;
export const BACKLOG_THROTTLE = 5;
const BASIC = new Set(['and', 'or', 'but', 'no', 'yes', 'with', 'for (purpose)', 'in', 'the', 'a']);

const weak = (card) => !!card && !card.familiar && card.reviews > 0 && card.interval <= 1;
export function reviewBacklog(state, fullWords, now) {
  return fullWords.filter(({ fr }) => {
    const card = state.cards[fr];
    return card && !card.familiar && (card.due <= now || weak(card));
  }).length;
}

export function requestChars(words, { batch, level, language, density, shownToday = [] }) {
  const body = buildRequest({ system: buildSystemPrompt(level, words, shownToday, language, density),
    user: buildUserContent(batch), schema: RESPONSE_SCHEMA });
  return JSON.stringify(body).length;
}

export function vocabularyChars(words) {
  // JSON is an upper bound for both prompt formats: generated targets use this
  // form, while Spanish uses shorter `fr = en` entries and bare known forms.
  return JSON.stringify(words.map(({ fr, en }) => ({ target: fr, english: en }))).length;
}

export function selectWorkingSet({ batch, words, fullWords, scope, state, settings, now, day, revision,
  encounters = {}, level, language, density = 'normal', shownToday = [] }) {
  if (!Array.isArray(batch) || !batch.length || !state || !settings.gradual) return [];
  const left = remaining(state.learning, day, settings.newWordsPerDay, now, revision);
  const allowFresh = reviewBacklog(state, fullWords, now) >= BACKLOG_THROTTLE ? 0 : Math.min(MAX_FRESH_CANDIDATES, left);
  const reserved = new Set(activeReservations(state.learning, day, now, revision).map((p) => p.word));
  const ranked = matchingEntries(batch, catalogEntries(words, scope)).map(({ id, word }) => {
    const card = state.cards[word.fr];
    if (card?.familiar) return { ...word, entryId: id, status: 'known', reasonCode: 'known', rank: 4 };
    if (card?.due <= now) return { ...word, entryId: id, status: 'due', reasonCode: weak(card) ? 'recent_difficulty' : 'due', rank: 0 };
    if (weak(card)) return { ...word, entryId: id, status: 'active', reasonCode: 'recent_difficulty', rank: 1 };
    if (card) return { ...word, entryId: id, status: 'active', reasonCode: 'active', rank: 2 };
    return { ...word, entryId: id, status: 'new', reasonCode: (encounters[id] || 0) >= 2 ? 'encountered_often' : 'new', rank: 3 };
  }).filter((w) => w.status !== 'new' || allowFresh > 0 && !reserved.has(w.fr));
  ranked.sort((a, b) => a.rank - b.rank ||
    (a.rank === 0 ? state.cards[a.fr].due - state.cards[b.fr].due : 0) ||
    (encounters[b.entryId] || 0) - (encounters[a.entryId] || 0) ||
    (a.rank === 3 ? Number(BASIC.has(a.en)) - Number(BASIC.has(b.en)) : 0) ||
    (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
  const selected = [];
  let fresh = 0, known = 0;
  for (const word of ranked) {
    if (word.status === 'new' && fresh >= allowFresh || word.status === 'known' && known >= 2) continue;
    if (selected.length >= MAX_CANDIDATES) break;
    const { rank, ...candidate } = word;
    const next = [...selected, candidate];
    if (vocabularyChars(next) > MAX_VOCABULARY_CHARS ||
        requestChars(next, { batch, level, language, density, shownToday }) > MAX_REQUEST_CHARS) continue;
    selected.push(candidate);
    if (word.status === 'new') fresh++;
    if (word.status === 'known') known++;
  }
  return selected;
}

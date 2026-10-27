// Browser-local recall state. The caller serializes read/modify/write and owns storage.
import { cleanLearning, validDay, RESERVATION_MS } from './learning.js';
import { localDay } from './events.js';
export const REVIEW_KEY = 'recallReview';
export const DAY_MS = 86400000;
export const AGAIN_MS = 10 * 60 * 1000;
const RATINGS = new Set(['again', 'hard', 'medium', 'easy']);

export function cleanReview(raw, words, now = Date.now()) {
  const cards = Object.create(null);
  const source = raw?.version === 1 && raw.cards && typeof raw.cards === 'object' && !Array.isArray(raw.cards)
    ? raw.cards : {};
  for (const { fr } of words) {
    const card = Object.hasOwn(source, fr) ? source[fr] : null;
    if (card && Number.isSafeInteger(card.due) && card.due >= 0 &&
        Number.isSafeInteger(card.interval) && card.interval >= 0 && card.interval <= 365 &&
        Number.isSafeInteger(card.reviews) && card.reviews >= 0 && card.reviews <= 10000) {
      cards[fr] = { due: card.due, interval: card.interval, reviews: card.reviews,
        ...(card.familiar === true ? { familiar: true } : {}),
        ...(Number.isSafeInteger(card.easyStreak) && card.easyStreak > 0 && card.easyStreak <= 3 ? { easyStreak: card.easyStreak } : {}),
        ...(validDay(card.introducedDay) ? { introducedDay: card.introducedDay } : {}),
        ...(validDay(card.introGateDay) ? { introGateDay: card.introGateDay } : {}) };
      const receipt = card.introReceipt;
      if (typeof receipt?.ticket === 'string' && /^[0-9a-f-]{36}$/.test(receipt.ticket) &&
          typeof receipt.ownerKey === 'string' && /^[0-9a-f]{16}$/.test(receipt.ownerKey) &&
          Number.isSafeInteger(receipt.until) && receipt.until > now && receipt.until <= now + RESERVATION_MS) {
        cards[fr].introReceipt = { ticket: receipt.ticket, ownerKey: receipt.ownerKey, until: receipt.until };
      }
    }
  }
  const current = raw?.version === 1 ? raw.current : null;
  const valid = current && Object.hasOwn(cards, current.word) &&
    typeof current.ticket === 'string' && /^[0-9a-f-]{36}$/.test(current.ticket) &&
    typeof current.revealed === 'boolean';
  const inline = raw?.version === 1 ? raw.inline : null;
  const validInline = inline && Object.hasOwn(cards, inline.word) &&
    typeof inline.ticket === 'string' && /^[0-9a-f-]{36}$/.test(inline.ticket) &&
    typeof inline.documentId === 'string' && inline.documentId.length <= 100 &&
    Number.isSafeInteger(inline.tabId) && Number.isSafeInteger(inline.frameId) &&
    typeof inline.revision === 'string' && inline.revision.length <= 100 &&
    typeof inline.revealed === 'boolean';
  return { version: 1, cards, current: valid
    ? { word: current.word, ticket: current.ticket, revealed: current.revealed } : null,
    learning: cleanLearning(raw?.learning, now), inline: validInline ? { word: inline.word, ticket: inline.ticket,
      documentId: inline.documentId, tabId: inline.tabId, frameId: inline.frameId,
      revision: inline.revision, revealed: inline.revealed } : null };
}

export function reviewCounts(state, words, now) {
  return {
    due: words.filter(({ fr }) => state.cards[fr]?.due <= now && !state.cards[fr]?.familiar).length,
    new: words.filter(({ fr }) => !Object.hasOwn(state.cards, fr)).length,
  };
}

export function introduce(state, words, now, count = 5) {
  const fresh = words.filter(({ fr }) => !Object.hasOwn(state.cards, fr)).slice(0, count);
  for (const { fr } of fresh) state.cards[fr] = { due: now, interval: 0, reviews: 0,
    introducedDay: localDay(new Date(now)) };
  return fresh.length;
}

export function nextReview(state, words, now, ticket = () => crypto.randomUUID()) {
  const active = state.current && words.find(({ fr }) => fr === state.current.word);
  if (!active || state.cards[active.fr]?.due > now || state.cards[active.fr]?.familiar) state.current = null;
  if (!state.current) {
    const due = words.filter(({ fr }) => state.cards[fr]?.due <= now && !state.cards[fr]?.familiar)
      .sort((a, b) => state.cards[a.fr].due - state.cards[b.fr].due);
    if (!due.length) return null;
    state.current = { word: due[0].fr, ticket: ticket(), revealed: false };
  }
  const word = words.find(({ fr }) => fr === state.current.word);
  return { ticket: state.current.ticket, en: word.en, revealed: state.current.revealed };
}

export function revealReview(state, words, ticket, now) {
  if (!state.current || state.current.ticket !== ticket || state.cards[state.current.word]?.due > now ||
      state.cards[state.current.word]?.familiar) return null;
  const word = words.find(({ fr }) => fr === state.current.word);
  if (!word) return null;
  state.current.revealed = true;
  return { fr: word.fr, en: word.en, hint: word.hint };
}

export function rateReview(state, ticket, rating, now, autoFamiliar = false) {
  const current = state.current;
  if (!RATINGS.has(rating) || !current || current.ticket !== ticket || !current.revealed) return null;
  const card = state.cards[current.word];
  if (!card || card.due > now || card.familiar) return null;
  const result = scheduleCard(card, rating, now, autoFamiliar);
  state.current = null;
  return result;
}

function scheduleCard(card, rating, now, autoFamiliar = false) {
  if (rating === 'again') {
    // A ten-minute retry is not a day interval; keeping interval at zero also
    // prevents a miss from carrying forward an old Easy/Medium interval.
    card.interval = 0;
    card.due = now + AGAIN_MS;
    card.reviews = Math.min(10000, card.reviews + 1);
    card.easyStreak = 0;
    // Keep a failed recall unmastered if another valid route ever reaches
    // this scheduler with a previously familiar card.
    delete card.familiar;
    return { due: card.due, interval: card.interval };
  }
  const interval = rating === 'hard' ? 1 : rating === 'medium'
    ? Math.max(3, card.interval * 2) : Math.max(7, card.interval * 3);
  card.interval = Math.min(365, interval);
  card.due = now + card.interval * DAY_MS;
  card.reviews = Math.min(10000, card.reviews + 1);
  card.easyStreak = rating === 'easy' ? Math.min(3, (card.easyStreak || 0) + 1) : 0;
  if (autoFamiliar && card.easyStreak >= 3) card.familiar = true;
  return { due: card.due, interval: card.interval };
}

export function markFamiliar(state, ticket, now) {
  const current = state.current;
  if (!current || current.ticket !== ticket || !current.revealed || state.cards[current.word]?.due > now ||
      state.cards[current.word]?.familiar) return false;
  state.cards[current.word].familiar = true;
  state.current = null;
  return true;
}

export function beginInline(state, word, sender, revision, now, ticket = () => crypto.randomUUID()) {
  const card = state.cards[word];
  if (!card || card.familiar || card.due > now || (card.introGateDay || card.introducedDay) >= localDay(new Date(now)) || !sender.documentId ||
      !Number.isSafeInteger(sender.tab?.id) || !Number.isSafeInteger(sender.frameId)) return null;
  state.inline = { word, ticket: ticket(), documentId: sender.documentId,
    tabId: sender.tab.id, frameId: sender.frameId, revision, revealed: false };
  return { ticket: state.inline.ticket };
}

export function matchesInline(state, ticket, sender, revision) {
  const active = state.inline;
  return !!active && active.ticket === ticket && active.revision === revision &&
    active.documentId === sender.documentId && active.tabId === sender.tab?.id &&
    active.frameId === sender.frameId;
}

export function revealInline(state, words, ticket, sender, revision, now) {
  if (!matchesInline(state, ticket, sender, revision) || state.cards[state.inline.word]?.due > now ||
      state.cards[state.inline.word]?.familiar) return null;
  const word = words.find((w) => w.fr === state.inline.word);
  if (!word) return null;
  state.inline.revealed = true;
  return { fr: word.fr, en: word.en, hint: word.hint };
}

export function finishInline(state, ticket, sender, revision, now, rating) {
  if (!matchesInline(state, ticket, sender, revision) || !state.inline.revealed ||
      state.cards[state.inline.word]?.due > now || state.cards[state.inline.word]?.familiar) return null;
  const card = state.cards[state.inline.word];
  if (rating === 'known') {
    card.familiar = true;
    state.inline = null;
    return { familiar: true };
  }
  if (!RATINGS.has(rating)) return null;
  const result = scheduleCard(card, rating, now, true);
  state.inline = null;
  return { ...result, familiar: card.familiar === true };
}

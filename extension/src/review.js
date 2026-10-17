// Browser-local recall state. The caller serializes read/modify/write and owns storage.
export const REVIEW_KEY = 'recallReview';
export const DAY_MS = 86400000;
const RATINGS = new Set(['hard', 'medium', 'easy']);

export function cleanReview(raw, words) {
  const cards = Object.create(null);
  const source = raw?.version === 1 && raw.cards && typeof raw.cards === 'object' && !Array.isArray(raw.cards)
    ? raw.cards : {};
  for (const { fr } of words) {
    const card = Object.hasOwn(source, fr) ? source[fr] : null;
    if (card && Number.isSafeInteger(card.due) && card.due >= 0 &&
        Number.isSafeInteger(card.interval) && card.interval >= 0 && card.interval <= 365 &&
        Number.isSafeInteger(card.reviews) && card.reviews >= 0 && card.reviews <= 10000) {
      cards[fr] = { due: card.due, interval: card.interval, reviews: card.reviews };
    }
  }
  const current = raw?.version === 1 ? raw.current : null;
  const valid = current && Object.hasOwn(cards, current.word) &&
    typeof current.ticket === 'string' && /^[0-9a-f-]{36}$/.test(current.ticket) &&
    typeof current.revealed === 'boolean';
  return { version: 1, cards, current: valid
    ? { word: current.word, ticket: current.ticket, revealed: current.revealed } : null };
}

export function reviewCounts(state, words, now) {
  return {
    due: words.filter(({ fr }) => state.cards[fr]?.due <= now).length,
    new: words.filter(({ fr }) => !Object.hasOwn(state.cards, fr)).length,
  };
}

export function introduce(state, words, now, count = 5) {
  const fresh = words.filter(({ fr }) => !Object.hasOwn(state.cards, fr)).slice(0, count);
  for (const { fr } of fresh) state.cards[fr] = { due: now, interval: 0, reviews: 0 };
  return fresh.length;
}

export function nextReview(state, words, now, ticket = () => crypto.randomUUID()) {
  const active = state.current && words.find(({ fr }) => fr === state.current.word);
  if (!active || state.cards[active.fr]?.due > now) state.current = null;
  if (!state.current) {
    const due = words.filter(({ fr }) => state.cards[fr]?.due <= now)
      .sort((a, b) => state.cards[a.fr].due - state.cards[b.fr]);
    if (!due.length) return null;
    state.current = { word: due[0].fr, ticket: ticket(), revealed: false };
  }
  const word = words.find(({ fr }) => fr === state.current.word);
  return { ticket: state.current.ticket, en: word.en, revealed: state.current.revealed };
}

export function revealReview(state, words, ticket, now) {
  if (!state.current || state.current.ticket !== ticket || state.cards[state.current.word]?.due > now) return null;
  const word = words.find(({ fr }) => fr === state.current.word);
  if (!word) return null;
  state.current.revealed = true;
  return { fr: word.fr, en: word.en, hint: word.hint };
}

export function rateReview(state, ticket, rating, now) {
  const current = state.current;
  if (!RATINGS.has(rating) || !current || current.ticket !== ticket || !current.revealed) return null;
  const card = state.cards[current.word];
  if (!card || card.due > now) return null;
  const interval = rating === 'hard' ? 1 : rating === 'medium'
    ? Math.max(3, card.interval * 2) : Math.max(7, card.interval * 3);
  card.interval = Math.min(365, interval);
  card.due = now + card.interval * DAY_MS;
  card.reviews = Math.min(10000, card.reviews + 1);
  state.current = null;
  return { due: card.due, interval: card.interval };
}

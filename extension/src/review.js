// Browser-local recall state. The caller serializes read/modify/write and owns storage.
import { cleanLearning, validDay, RESERVATION_MS } from './learning.js';
import { localDay } from './events.js';
import { storedFsrs, withFsrs, reviewCard, DEFAULT_RETENTION } from './fsrs.js';
export const REVIEW_KEY = 'recallReview';
export const DAY_MS = 86400000;
export const AGAIN_MS = 10 * 60 * 1000;
const RATINGS = new Set(['again', 'hard', 'medium', 'easy']);

export function cleanReview(raw, words, now = Date.now()) {
  const cards = Object.create(null);
  const source = raw?.version === 1 && raw.cards && typeof raw.cards === 'object' && !Array.isArray(raw.cards)
    ? raw.cards : {};
  // `words` is the full scope catalog, never a prompt window. Keep valid
  // historical orphans as well: a temporary catalog change must not erase a
  // card merely because its form cannot currently be offered for reading.
  for (const [fr, card] of Object.entries(source)) {
    if (!fr || fr.length > 100) continue;
    if (card && Number.isSafeInteger(card.due) && card.due >= 0 &&
        Number.isSafeInteger(card.interval) && card.interval >= 0 && card.interval <= 365 &&
        Number.isSafeInteger(card.reviews) && card.reviews >= 0 && card.reviews <= 10000) {
      cards[fr] = { due: card.due, interval: card.interval, reviews: card.reviews,
        ...(card.familiar === true ? { familiar: true } : {}),
        ...(Number.isSafeInteger(card.easyStreak) && card.easyStreak > 0 && card.easyStreak <= 3 ? { easyStreak: card.easyStreak } : {}),
        ...(validDay(card.introducedDay) ? { introducedDay: card.introducedDay } : {}),
        ...(validDay(card.introGateDay) ? { introGateDay: card.introGateDay } : {}) };
      // Keep FSRS memory state only while it still agrees with due/interval. A build that
      // schedules without FSRS changes due/interval, and the stale state then drops here.
      const fsrs = storedFsrs(card);
      if (fsrs) cards[fr].fsrs = fsrs;
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
  // When the prompt was first shown, for the worker-measured review time. Ephemeral, never exported.
  const shown = (value) => Number.isSafeInteger(value?.shownAt) && value.shownAt >= 0 ? { shownAt: value.shownAt } : {};
  const inline = raw?.version === 1 ? raw.inline : null;
  const validInline = inline && Object.hasOwn(cards, inline.word) &&
    typeof inline.ticket === 'string' && /^[0-9a-f-]{36}$/.test(inline.ticket) &&
    typeof inline.documentId === 'string' && inline.documentId.length <= 100 &&
    Number.isSafeInteger(inline.tabId) && Number.isSafeInteger(inline.frameId) &&
    typeof inline.revision === 'string' && inline.revision.length <= 100 &&
    typeof inline.revealed === 'boolean';
  // `practice`: the learner asked for this card now from My words, so it may be served before
  // it is due. FSRS still schedules it from the real elapsed time (an early review).
  const practice = (value) => value?.practice === true ? { practice: true } : {};
  return { version: 1, cards, current: valid
    ? { word: current.word, ticket: current.ticket, revealed: current.revealed, ...shown(current), ...practice(current) } : null,
    learning: cleanLearning(raw?.learning, now), inline: validInline ? { word: inline.word, ticket: inline.ticket,
      documentId: inline.documentId, tabId: inline.tabId, frameId: inline.frameId,
      revision: inline.revision, revealed: inline.revealed, ...shown(inline) } : null };
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

// Whether a card may be prompted now: due, or explicitly chosen for practice. Never a familiar card.
const askable = (state, current, now) => {
  const card = current && state.cards[current.word];
  return !!card && !card.familiar && (card.due <= now || current.practice === true);
};

export function nextReview(state, words, now, ticket = () => crypto.randomUUID()) {
  const active = state.current && words.find(({ fr }) => fr === state.current.word);
  if (!active || !askable(state, state.current, now)) state.current = null;
  // A practice ticket is created before the review page shows it; its latency starts here.
  if (state.current?.practice && !Number.isSafeInteger(state.current.shownAt)) state.current.shownAt = now;
  if (!state.current) {
    const due = words.filter(({ fr }) => state.cards[fr]?.due <= now && !state.cards[fr]?.familiar)
      .sort((a, b) => state.cards[a.fr].due - state.cards[b.fr].due);
    if (!due.length) return null;
    state.current = { word: due[0].fr, ticket: ticket(), revealed: false, shownAt: now };
  }
  const word = words.find(({ fr }) => fr === state.current.word);
  return { ticket: state.current.ticket, en: word.en, revealed: state.current.revealed };
}

export function revealReview(state, words, ticket, now) {
  if (!state.current || state.current.ticket !== ticket || !askable(state, state.current, now)) return null;
  const word = words.find(({ fr }) => fr === state.current.word);
  if (!word) return null;
  state.current.revealed = true;
  return { fr: word.fr, en: word.en, hint: word.hint };
}

// Milliseconds from first showing the prompt to now, or null when unknown or the clock went back.
export function reviewLatency(prompt, now) {
  return Number.isSafeInteger(prompt?.shownAt) && prompt.shownAt <= now ? now - prompt.shownAt : null;
}

export function rateReview(state, ticket, rating, now, autoFamiliar = false, retention = DEFAULT_RETENTION) {
  const current = state.current;
  if (!RATINGS.has(rating) || !current || current.ticket !== ticket || !current.revealed) return null;
  const card = state.cards[current.word];
  if (!askable(state, current, now)) return null;
  const result = scheduleCard(card, rating, now, autoFamiliar, retention);
  result.record = { word: current.word, latencyMs: reviewLatency(current, now), ...result.record };
  state.current = null;
  return result;
}

// Whole local calendar days from a stored introduction day to `now`'s local day.
function daysSinceIntroduction(day, now) {
  if (!validDay(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  const today = new Date(now);
  const diff = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(y, m - 1, d)) / DAY_MS);
  return diff >= 0 ? diff : null;
}

// FSRS-6 scheduling (fsrs.js). Again/Hard/Medium/Easy are FSRS Again/Hard/Good/Easy; Again keeps
// the ten-minute retry with interval 0. A card without consistent stored state is migrated from
// due/interval first. Familiar and the Easy streak are unchanged (familiar-maintenance is separate).
// Returns the new due/interval plus the learning-log record for this retrieval.
function scheduleCard(card, rating, now, autoFamiliar = false, retention = DEFAULT_RETENTION) {
  // Stored state is the scheduler's own; a migrated estimate is not, so its prediction is not
  // logged (it would contaminate the calibration test of the scheduler).
  const stored = storedFsrs(card);
  const prior = stored ?? withFsrs(card).fsrs ?? null;
  const reviewsBefore = card.reviews;
  const step = reviewCard(prior, rating, now, { retention, againStepMs: AGAIN_MS });
  card.fsrs = step.fsrs;
  card.interval = step.interval;
  card.due = step.due;
  card.reviews = Math.min(10000, card.reviews + 1);
  if (rating === 'again') {
    card.easyStreak = 0;
    // Keep a failed recall unmastered if another valid route ever reaches
    // this scheduler with a previously familiar card.
    delete card.familiar;
  } else {
    card.easyStreak = rating === 'easy' ? Math.min(3, (card.easyStreak || 0) + 1) : 0;
    if (autoFamiliar && card.easyStreak >= 3) card.familiar = true;
  }
  // A first rating has no prior FSRS review, so its gap is counted from the introduction day.
  const elapsedDays = step.elapsedDays ?? (reviewsBefore === 0 ? daysSinceIntroduction(card.introducedDay, now) : null);
  return { due: card.due, interval: card.interval, record: { prior: reviewsBefore, outcome: rating, elapsedDays,
    intervalDays: step.interval, predicted: stored ? step.predictedRecall : null } };
}

export function markFamiliar(state, ticket, now) {
  const current = state.current;
  if (!current || current.ticket !== ticket || !current.revealed || !askable(state, current, now)) return false;
  state.cards[current.word].familiar = true;
  state.current = null;
  return true;
}

export function beginInline(state, word, sender, revision, now, ticket = () => crypto.randomUUID()) {
  const card = state.cards[word];
  if (!card || card.familiar || card.due > now || (card.introGateDay || card.introducedDay) >= localDay(new Date(now)) || !sender.documentId ||
      !Number.isSafeInteger(sender.tab?.id) || !Number.isSafeInteger(sender.frameId)) return null;
  state.inline = { word, ticket: ticket(), documentId: sender.documentId,
    tabId: sender.tab.id, frameId: sender.frameId, revision, revealed: false, shownAt: now };
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

export function finishInline(state, ticket, sender, revision, now, rating, retention = DEFAULT_RETENTION) {
  if (!matchesInline(state, ticket, sender, revision) || !state.inline.revealed ||
      state.cards[state.inline.word]?.due > now || state.cards[state.inline.word]?.familiar) return null;
  const card = state.cards[state.inline.word];
  const prompt = { word: state.inline.word, latencyMs: reviewLatency(state.inline, now) };
  if (rating === 'known') {
    // "Already know" is a claim, logged as such, never as a recall.
    const record = { ...prompt, prior: card.reviews, outcome: 'known', elapsedDays: null, intervalDays: null, predicted: null };
    card.familiar = true;
    state.inline = null;
    return { familiar: true, record };
  }
  if (!RATINGS.has(rating)) return null;
  const result = scheduleCard(card, rating, now, true, retention);
  state.inline = null;
  return { ...result, record: { ...prompt, ...result.record }, familiar: card.familiar === true };
}

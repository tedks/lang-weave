// Browser-local recall state. The caller serializes read/modify/write and owns storage.
import { cleanLearning, validDay, RESERVATION_MS } from './learning.js';
import { localDay } from './events.js';
import { storedFsrs, withFsrs, reviewCard, DEFAULT_RETENTION } from './fsrs.js';
export const REVIEW_KEY = 'recallReview';
export const DAY_MS = 86400000;
export const AGAIN_MS = 10 * 60 * 1000;
export const MAINTENANCE_MS = 21 * DAY_MS;
const RATINGS = new Set(['again', 'hard', 'medium', 'easy']);

export function cleanReview(raw, words, now = Date.now(), gradual = false) {
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
        ...(gradual && (card.maintenance === true || card.familiar === true) ? { maintenance: true } : {}),
        ...(card.retiredReturn === false ? { retiredReturn: false }
          : card.familiar === true && (card.retiredReturn === true || gradual && card.maintenance !== true)
            ? { retiredReturn: true } : {}),
        ...(Number.isSafeInteger(card.easyStreak) && card.easyStreak > 0 && card.easyStreak <= 3 ? { easyStreak: card.easyStreak } : {}),
        ...(validDay(card.introducedDay) ? { introducedDay: card.introducedDay } : {}),
        ...(validDay(card.introGateDay) ? { introGateDay: card.introGateDay } : {}) };
      for (const kind of ['seen', 'peek']) {
        const day = card[`${kind}Day`], count = card[`${kind}Count`];
        if (validDay(day) && Number.isSafeInteger(count) && count >= 0 && count <= 3) {
          cards[fr][`${kind}Day`] = day;
          cards[fr][`${kind}Count`] = count;
        }
      }
      if (Number.isSafeInteger(card.claimAt) && card.claimAt >= 0 &&
          Number.isSafeInteger(card.claimDue) && card.claimDue >= card.claimAt)
        Object.assign(cards[fr], { claimAt: card.claimAt, claimDue: card.claimDue,
          ...(gradual ? { maintenance: true } : {}) });
      if (gradual && Number.isSafeInteger(card.peekDue) && card.peekDue >= 0 && card.peekDue <= card.due)
        cards[fr].peekDue = card.peekDue;
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
  // `practice`: the card's due time when the learner chose it with Practice now (My words).
  // While the card still has that due time it may be served before it is due; FSRS schedules it
  // from the real elapsed time (an early review). Any other write to the card voids the grant.
  const practice = (value) => Number.isSafeInteger(value?.practice) && value.practice >= 0 ? { practice: value.practice } : {};
  return { version: 1, cards, current: valid
    ? { word: current.word, ticket: current.ticket, revealed: current.revealed, ...shown(current), ...practice(current) } : null,
    learning: cleanLearning(raw?.learning, now), inline: validInline ? { word: inline.word, ticket: inline.ticket,
      documentId: inline.documentId, tabId: inline.tabId, frameId: inline.frameId,
      revision: inline.revision, revealed: inline.revealed, ...shown(inline) } : null };
}

export function reviewCounts(state, words, now) {
  return {
    due: words.filter(({ fr }) => dueAt(state.cards[fr]) <= now).length,
    new: words.filter(({ fr }) => !Object.hasOwn(state.cards, fr)).length,
  };
}

export const retiredReturnCount = (state, words, now) => words.filter(({ fr }) =>
  state.cards[fr]?.retiredReturn === true && state.cards[fr]?.maintenance === true &&
  dueAt(state.cards[fr]) <= now).length;

export const dueAt = (card) => card && (!card.familiar || card.maintenance)
  ? Math.max(Math.min(card.due, card.peekDue ?? Infinity), card.claimDue || 0) : Infinity;

// Earliest future review in the offered catalog, with all cards due on that local day.
// The effective due includes maintenance, peek acceleration and claim gates.
export function nextDue(state, words, now) {
  let first = null;
  let day = null;
  let nextCount = 0;
  for (const { fr } of words) {
    const card = state.cards[fr];
    const effective = dueAt(card);
    if (!Number.isSafeInteger(effective) || effective <= now ||
        !Number.isFinite(new Date(effective).getTime())) continue;
    const cardDay = localDay(new Date(effective));
    if (first === null || effective < first) {
      if (cardDay !== day) nextCount = 0;
      first = effective;
      day = cardDay;
    }
    if (cardDay === day) nextCount++;
  }
  return { nextDue: first, nextCount };
}
// A one-time migration pile must not jump ahead of cards still being learned.
export const reviewOrder = (a, b) => Number(a?.maintenance === true) - Number(b?.maintenance === true) ||
  dueAt(a) - dueAt(b);

// The claim gates the next retrieval without fabricating an FSRS review. FSRS memory and its
// scheduled due stay intact; a new/short-interval claim waits at least 21 days.
export function claimKnown(card, now) {
  card.familiar = true;
  card.maintenance = true;
  // A fresh claim was never retired; a migrated pending return keeps its marker.
  if (card.retiredReturn !== true) card.retiredReturn = false;
  card.claimAt = now;
  card.claimDue = Math.max(card.due, now + MAINTENANCE_MS);
}

// Only acknowledged sightings and peeks update these bounded, per-card day counters.
// The log's lifetime aggregates deliberately keep their existing schema.
export function countCardEncounter(card, kind, day, now) {
  if (!card || !['seen', 'peek'].includes(kind) || !validDay(day)) return false;
  const key = `${kind}Count`, dayKey = `${kind}Day`;
  if (card[dayKey] > day) return false; // clock rollback cannot mint a new day
  const beforeDay = card[dayKey], beforeCount = card[key], beforeDue = card.peekDue;
  card[key] = Math.min(3, (card[dayKey] === day ? card[key] || 0 : 0) + 1);
  card[dayKey] = day;
  if (kind === 'peek' && card[key] >= 2 && !card.maintenance && card.reviews > 0)
    card.peekDue = Math.min(card.peekDue ?? card.due, card.due, now + DAY_MS);
  return card[dayKey] !== beforeDay || card[key] !== beforeCount || card.peekDue !== beforeDue;
}

export function introduce(state, words, now, count = 5) {
  const fresh = words.filter(({ fr }) => !Object.hasOwn(state.cards, fr)).slice(0, count);
  for (const { fr } of fresh) state.cards[fr] = { due: now, interval: 0, reviews: 0,
    introducedDay: localDay(new Date(now)) };
  return fresh.length;
}

// Whether the ticket's card may be prompted now. Never a familiar card. A Practice now ticket is
// valid exactly while its grant holds (the card's due time is unchanged), due or not; once any
// write voids the grant it stays void, so a fresh ticket replaces it. Any other ticket needs a
// due card.
export function askable(state, current, now) {
  const card = current && state.cards[current.word];
  if (!card || card.familiar && !card.maintenance) return false;
  return Number.isSafeInteger(current.practice) ? current.practice === card.due && (card.claimDue || 0) <= now : dueAt(card) <= now;
}

export function nextReview(state, words, now, ticket = () => crypto.randomUUID()) {
  const active = state.current && words.find(({ fr }) => fr === state.current.word);
  if (!active || !askable(state, state.current, now)) state.current = null;
  // A Practice now ticket is created before the review page shows it; its latency starts here.
  if (Number.isSafeInteger(state.current?.practice) && !Number.isSafeInteger(state.current.shownAt)) state.current.shownAt = now;
  if (!state.current) {
    const due = words.filter(({ fr }) => dueAt(state.cards[fr]) <= now)
      .sort((a, b) => reviewOrder(state.cards[a.fr], state.cards[b.fr]));
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
  const result = scheduleCard(card, rating, now, autoFamiliar, retention, card.due > now);
  result.familiar = card.familiar === true;
  result.returnable = Number.isSafeInteger(dueAt(card));
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
// due/interval first. Three spaced Easy ratings enter maintenance without retiring the card.
// Returns the new due/interval plus the learning-log record for this retrieval.
// `early`: a Practice now review before the due time. It is scheduled by FSRS like any other,
// but an early Easy never extends the Easy streak (Hard or Medium still resets it), so
// automatic familiarity still needs three spaced Easy reviews.
function scheduleCard(card, rating, now, autoFamiliar = false, retention = DEFAULT_RETENTION, early = false) {
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
  delete card.peekDue;
  const returned = card.retiredReturn === true;
  if (rating === 'again') {
    card.easyStreak = 0;
    // Keep a failed recall unmastered if another valid route ever reaches
    // this scheduler with a previously familiar card.
    delete card.familiar;
    delete card.maintenance;
    delete card.claimAt;
    delete card.claimDue;
  } else if (early) {
    // An early pass may break the Easy streak but never extends it.
    if (rating !== 'easy') card.easyStreak = 0;
  } else {
    card.easyStreak = rating === 'easy' ? Math.min(3, (card.easyStreak || 0) + 1) : 0;
    if (autoFamiliar && card.easyStreak >= 3) { card.familiar = true; card.maintenance = true; }
  }
  if (returned || card.maintenance) card.retiredReturn = false;
  // A first rating has no prior FSRS review, so its gap is counted from the introduction day.
  const elapsedDays = step.elapsedDays ?? (reviewsBefore === 0 ? daysSinceIntroduction(card.introducedDay, now) : null);
  return { due: card.due, interval: card.interval, record: { prior: reviewsBefore, outcome: rating, elapsedDays,
    intervalDays: step.interval, predicted: stored ? step.predictedRecall : null } };
}

export function markFamiliar(state, ticket, now, gradual = false) {
  const current = state.current;
  if (!current || current.ticket !== ticket || !current.revealed || !askable(state, current, now)) return false;
  if (gradual) claimKnown(state.cards[current.word], now);
  else state.cards[current.word].familiar = true;
  state.current = null;
  return true;
}

export function beginInline(state, word, sender, revision, now, ticket = () => crypto.randomUUID()) {
  const card = state.cards[word];
  if (!card || dueAt(card) > now || (card.introGateDay || card.introducedDay) >= localDay(new Date(now)) || !sender.documentId ||
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
  if (!matchesInline(state, ticket, sender, revision) || dueAt(state.cards[state.inline.word]) > now) return null;
  const word = words.find((w) => w.fr === state.inline.word);
  if (!word) return null;
  state.inline.revealed = true;
  return { fr: word.fr, en: word.en, hint: word.hint };
}

export function finishInline(state, ticket, sender, revision, now, rating, retention = DEFAULT_RETENTION) {
  if (!matchesInline(state, ticket, sender, revision) || !state.inline.revealed ||
      dueAt(state.cards[state.inline.word]) > now) return null;
  const card = state.cards[state.inline.word];
  const prompt = { word: state.inline.word, latencyMs: reviewLatency(state.inline, now) };
  if (rating === 'known') {
    // "Already know" is a claim, logged as such, never as a recall.
    const record = { ...prompt, prior: card.reviews, outcome: 'known', elapsedDays: null, intervalDays: null, predicted: null };
    claimKnown(card, now);
    state.inline = null;
    return { familiar: true, record };
  }
  if (!RATINGS.has(rating)) return null;
  const result = scheduleCard(card, rating, now, true, retention);
  state.inline = null;
  return { ...result, record: { ...prompt, ...result.record }, familiar: card.familiar === true };
}

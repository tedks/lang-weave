// Browser-local gradual policy. Callers serialize mutations and persist before returning results.
import { localDay } from './events.js';
import { hashKey } from './hash.js';

export const DENSITIES = ['light', 'normal', 'heavy'];
export const RESERVATION_MS = 30 * 1000;
const RENEW_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING = 20;
const BASIC = new Set(['and', 'or', 'but', 'no', 'yes', 'with', 'for (purpose)', 'in', 'the', 'a']);
// Same effective review time as review.js, kept local to avoid a review/learning import cycle.
// Both callers classify retired familiar cards as known before invoking this helper.
const dueAt = (card) => Math.max(Math.min(card.due, card.peekDue ?? Infinity), card.claimDue || 0);
export const introductionOwner = (ticket, sender, revision) =>
  hashKey(JSON.stringify([ticket, sender.documentId, sender.tab?.id, sender.frameId, revision]));

export function validDay(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d\d)-(\d\d)$/.exec(value);
  if (!match) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]);
}

export function cleanLearning(raw, now = Date.now()) {
  const day = validDay(raw?.day) ? raw.day : '';
  const count = Number.isSafeInteger(raw?.count) && raw.count >= 0 && raw.count <= 20 ? raw.count : 0;
  const latest = now + RESERVATION_MS;
  const pending = Array.isArray(raw?.pending) ? raw.pending.filter((p) => p &&
    typeof p.word === 'string' && p.word.length <= 100 &&
    typeof p.ticket === 'string' && /^[0-9a-f-]{36}$/.test(p.ticket) &&
    validDay(p.day) && Number.isSafeInteger(p.until) && p.until > now - RENEW_GRACE_MS && p.until <= latest &&
    typeof p.revision === 'string' && p.revision.length <= 100 &&
    typeof p.ownerKey === 'string' && /^[0-9a-f]{16}$/.test(p.ownerKey)).slice(-MAX_PENDING) : [];
  return { day, count, pending };
}

export function activeReservations(learning, day, now, revision) {
  return learning.pending.filter((p) => p.day === day && p.until > now && p.revision === revision);
}

export function remaining(learning, day, budget, now = Date.now(), revision = '') {
  // A clock rollback cannot mint a second allowance for an earlier local date.
  if (learning.day > day) return 0;
  return Math.max(0, budget - (learning.day === day ? learning.count : 0) -
    (revision ? activeReservations(learning, day, now, revision).length : 0));
}

const dayNumber = (day) => {
  if (!validDay(day)) return null;
  const [year, month, date] = day.split('-').map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, date);
  return Math.floor(value.getTime() / 86400000);
};

export function futureBudgetDay(learning, day) {
  const saved = dayNumber(learning.day), today = dayNumber(day);
  return saved !== null && today !== null && saved - today > 7 ? learning.day : '';
}

export function policyWords(words, state, settings, now = Date.now(), day = localDay(new Date(now)), revision = '') {
  if (!settings.gradual) return words.map((w) => ({ ...w, status: 'active' }));
  const left = remaining(state.learning, day, settings.newWordsPerDay, now, revision);
  const reserved = new Set(activeReservations(state.learning, day, now, revision).map((p) => p.word));
  const due = [], learning = [], fresh = [], known = [];
  for (const w of words) {
    const card = state.cards[w.fr];
    if (card?.familiar || card?.maintenance) known.push({ ...w, status: 'known' });
    else if (card && dueAt(card) <= now) due.push({ ...w, status: 'due' });
    else if (card) learning.push({ ...w, status: 'active' });
    else if (left && !reserved.has(w.fr)) fresh.push({ ...w, status: 'new' });
  }
  due.sort((a, b) => dueAt(state.cards[a.fr]) - dueAt(state.cards[b.fr]));
  fresh.sort((a, b) => Number(BASIC.has(a.en)) - Number(BASIC.has(b.en)));
  // Familiar words are occasionally useful for readable density, but should never dominate.
  return [...due, ...learning, ...fresh, ...known.slice(0, 2)];
}

export function commitLearning(state, results, settings, sender, revision, now = Date.now(), day = localDay(new Date(now)), ticket = () => crypto.randomUUID()) {
  if (!settings.gradual) return results;
  // Keep a bounded set of expired tickets so a visible span can renew after
  // another delivery. Only live tickets count against the daily allowance.
  const recent = state.learning.pending.filter((p) => p.day === day && p.revision === revision &&
    p.until > now - RENEW_GRACE_MS);
  const live = recent.filter((p) => p.until > now).slice(-MAX_PENDING);
  const expired = recent.filter((p) => p.until <= now);
  state.learning.pending = [...expired.slice(Math.max(0, expired.length - Math.max(0, MAX_PENDING - live.length))), ...live];
  const left = remaining(state.learning, day, settings.newWordsPerDay, now, revision);
  let added = 0;
  const batch = new Map();
  const reservations = activeReservations(state.learning, day, now, revision);
  const reserved = new Set(reservations.map((p) => p.word));
  const owned = new Map(reservations.filter((p) => sender?.documentId && p.ownerKey ===
    introductionOwner(p.ticket, sender, revision)).map((p) => [p.word, p]));
  const output = {};
  for (const [key, swaps] of Object.entries(results)) {
    output[key] = [];
    for (const swap of swaps) {
      const card = state.cards[swap.word];
      // Recheck after model/cache awaits: another tab may have recorded the third sighting.
      if (card && !card.maintenance && card.seenDay === day && card.seenCount >= 3) continue;
      if (card?.familiar || card?.maintenance) {
        // Familiar filler is bounded per passage independently of model generosity.
        if (output[key].filter((s) => s.status === 'known').length >= 1) continue;
        output[key].push({ ...swap, status: 'known' });
      } else if (card) {
        output[key].push({ ...swap, status: dueAt(card) <= now ? 'due' : 'active',
          ...(dueAt(card) <= now && settings.inlineRecall && (!(card.introGateDay || card.introducedDay) ||
            (card.introGateDay || card.introducedDay) < day)
            ? { practice: true } : {}) });
      } else if (typeof swap.word === 'string' && (owned.has(swap.word) ||
          !reserved.has(swap.word) && (batch.has(swap.word) || added < left)) &&
          sender?.documentId && Number.isSafeInteger(sender.tab?.id) && Number.isSafeInteger(sender.frameId)) {
        let reservation = batch.get(swap.word) || owned.get(swap.word);
        if (!reservation) {
          const id = ticket();
          reservation = { word: swap.word, ticket: id, day, until: now + RESERVATION_MS,
            revision, ownerKey: introductionOwner(id, sender, revision) };
          state.learning.pending.push(reservation);
          added++;
        }
        batch.set(swap.word, reservation);
        output[key].push({ ...swap, status: 'new', introTicket: reservation.ticket });
      }
    }
  }
  if (state.learning.pending.length > MAX_PENDING) {
    const current = state.learning.pending.filter((p) => p.until > now).slice(-MAX_PENDING);
    const stale = state.learning.pending.filter((p) => p.until <= now);
    state.learning.pending = [...stale.slice(Math.max(0, stale.length - Math.max(0, MAX_PENDING - current.length))),
      ...current];
  }
  return output;
}

export function acknowledgeIntroduction(state, word, ticket, sender, revision, budget, now = Date.now(), day = localDay(new Date(now))) {
  const card = state.cards[word];
  const ownerKey = introductionOwner(ticket, sender, revision);
  if (card?.introReceipt?.ticket === ticket) return card.introReceipt.until > now &&
    card.introReceipt.ownerKey === ownerKey; // bounded, document-bound replay after a worker restart
  const p = state.learning.pending.find((item) => item.word === word && item.ticket === ticket);
  if (!p || p.until <= now || p.day !== day || p.revision !== revision || p.ownerKey !== ownerKey ||
      card || state.learning.day > day || (state.learning.day === day && state.learning.count >= budget)) return false;
  state.cards[word] = { due: now, interval: 0, reviews: 0, introducedDay: day,
    introReceipt: { ticket, ownerKey, until: now + RESERVATION_MS } };
  state.learning = { day, count: (state.learning.day === day ? state.learning.count : 0) + 1,
    pending: state.learning.pending.filter((item) => item.ticket !== ticket) };
  return true;
}

export function releaseIntroduction(state, ticket, sender, revision) {
  const before = state.learning.pending.length;
  state.learning.pending = state.learning.pending.filter((p) => !(p.ticket === ticket && p.revision === revision &&
    p.ownerKey === introductionOwner(ticket, sender, revision)));
  return state.learning.pending.length !== before;
}

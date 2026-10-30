// Review page handlers: the voluntary local recall queue.
import { REVIEW_KEY, reviewCounts, retiredReturnCount, nextDue, introduce, nextReview, revealReview, rateReview, markFamiliar, dueAt, reviewOrder,
  reviewLatency, askable } from './review.js';
import { DEFAULT_RETENTION } from './fsrs.js';
import { logRetrieval } from './learning-records.js';
import { RETRIEVALS_KEY, EXPOSURES_KEY, cleanRetrievals, cleanExposures, summarize } from './learning-log.js';
import { chromeStorage } from './cache.js';
import { scopedStorage } from './scope.js';
import { personalScope } from './worker-context.js';
import { languageName } from './languages.js';
import { PERSONAL_KEY } from './personal.js';
import { personalReview } from './review-state.js';

export function createReviewHandlers({ store, locked, context, reviewState }) {
  async function reviewStatus(ctx) {
    ctx ||= await context();
    const { state, words, language } = await reviewState(ctx);
    const own = personalReview(ctx);
    const now = Date.now();
    const oldCounts = reviewCounts(state, words, now);
    const ownCounts = reviewCounts(own.state, own.words, now);
    // Personal IDs carry a colon and never overlap catalog forms, so this is one offered deck.
    const upcoming = nextDue({ cards: { ...state.cards, ...own.state.cards } }, [...words, ...own.words], now);
    return { due: oldCounts.due + ownCounts.due, new: oldCounts.new,
      returned: retiredReturnCount(state, words, now) + retiredReturnCount(own.state, own.words, now),
      language: languageName(language), ...upcoming };
  }

  async function reviewIntroduce() {
    return locked(async () => {
      const { state, words, scoped } = await reviewState();
      const added = introduce(state, words, Date.now());
      if (added) await scoped.set({ [REVIEW_KEY]: state });
      return { added, ...reviewCounts(state, words, Date.now()) };
    });
  }

  async function reviewNext() {
    return locked(async () => {
      const ctx = await context();
      const { state, words, scoped, language } = await reviewState(ctx);
      const own = personalReview(ctx);
      const now = Date.now();
      const earliest = (s, ws) => ws.map(({ fr }) => s.cards[fr]).filter((card) => dueAt(card) <= now)
        .sort(reviewOrder)[0];
      const legacyDue = earliest(state, words);
      const personalDue = earliest(own.state, own.words);
      // A ticket already on offer (the card on screen, or one chosen with Practice now) keeps its
      // place across scopes, as nextReview keeps it within one scope.
      const keepsCurrent = (s, ws) => !!s.current && ws.some(({ fr }) => fr === s.current.word) && askable(s, s.current, now);
      const keepOwn = keepsCurrent(own.state, own.words), keepLegacy = keepsCurrent(state, words);
      const usePersonal = keepOwn !== keepLegacy ? keepOwn
        : personalDue && (!legacyDue || reviewOrder(personalDue, legacyDue) < 0);
      const card = usePersonal ? nextReview(own.state, own.words, now) : nextReview(state, words, now);
      if (usePersonal) {
        if (state.current) { state.current = null; await scoped.set({ [REVIEW_KEY]: state }); }
        await store.set({ [PERSONAL_KEY]: ctx.personal });
      } else {
        if (own.state.current) { own.state.current = null; await store.set({ [PERSONAL_KEY]: ctx.personal }); }
        await scoped.set({ [REVIEW_KEY]: state });
      }
      const counts = await reviewStatus(ctx);
      return { card, ...counts, language: languageName(language) };
    });
  }

  async function reviewReveal(msg) {
    return locked(async () => {
      const ctx = await context();
      const { state, words, scoped } = await reviewState(ctx);
      const own = personalReview(ctx);
      const personal = own.state.current?.ticket === msg.ticket;
      const answer = personal ? revealReview(own.state, own.words, msg.ticket, Date.now())
        : revealReview(state, words, msg.ticket, Date.now());
      if (!answer) return { error: 'This review card is no longer available. Reload the queue.' };
      if (personal) await store.set({ [PERSONAL_KEY]: ctx.personal });
      else await scoped.set({ [REVIEW_KEY]: state });
      return { answer: personal ? { ...answer, fr: own.byId.get(answer.fr)?.target || '' } : answer };
    });
  }

  async function reviewRate(msg) {
    return locked(async () => {
      const ctx = await context();
      const { state, words, scoped } = await reviewState(ctx);
      const own = personalReview(ctx);
      const personal = own.state.current?.ticket === msg.ticket;
      const target = personal ? own.state : state;
      const eligible = personal ? own.words : words;
      const now = Date.now();
      const result = target.current && eligible.some(({ fr }) => fr === target.current.word)
        ? rateReview(target, msg.ticket, msg.rating, now, ctx.settings.gradual,
          ctx.settings.desiredRetention ?? DEFAULT_RETENTION) : null;
      if (!result) return { error: 'This rating is stale or the answer has not been revealed.' };
      if (personal) await store.set({ [PERSONAL_KEY]: ctx.personal });
      else await scoped.set({ [REVIEW_KEY]: state });
      const { record, ...reply } = result;
      await logRetrieval(ctx, personal, record, 'standalone', now);
      return { ok: true, ...reply };
    });
  }

  async function reviewKnown(msg) {
    return locked(async () => {
      const ctx = await context();
      const { state, words, scoped } = await reviewState(ctx);
      const own = personalReview(ctx);
      const personal = own.state.current?.ticket === msg.ticket;
      const target = personal ? own.state : state;
      const eligible = personal ? own.words : words;
      const now = Date.now();
      const current = target.current;
      const claim = current && { word: current.word, prior: target.cards[current.word]?.reviews ?? 0,
        outcome: 'known', latencyMs: reviewLatency(current, now), elapsedDays: null, intervalDays: null, predicted: null };
      const ok = current && eligible.some(({ fr }) => fr === current.word) &&
        markFamiliar(target, msg.ticket, now, ctx.settings.gradual);
      if (!ok) return { error: 'Reveal the current due card before marking it familiar.' };
      if (personal) await store.set({ [PERSONAL_KEY]: ctx.personal });
      else await scoped.set({ [REVIEW_KEY]: state });
      await logRetrieval(ctx, personal, claim, 'standalone', now); // a claim, never a recall
      return { ok: true };
    });
  }
  // Read-only measurements (learning-science report section 9) for the active scope and its
  // personal scope, for a future "is this working?" surface. Local data only; nothing is sent.
  // Deliberately unlocked: a read racing a rating may see either side of it, which is harmless
  // for statistics and keeps this off the rating path's lock.
  async function learningStats() {
    const ctx = await context();
    const now = Date.now();
    const { state } = await reviewState(ctx);
    const own = personalReview(ctx);
    const retention = ctx.settings.desiredRetention ?? DEFAULT_RETENTION;
    const scopeSummary = async (storage, cards) => {
      const { [RETRIEVALS_KEY]: retrievals, [EXPOSURES_KEY]: exposures } = await storage.get([RETRIEVALS_KEY, EXPOSURES_KEY]);
      return summarize(cleanRetrievals(retrievals), cleanExposures(exposures), { now, retention,
        learningWords: Object.keys(cards).filter((id) => !cards[id].familiar) });
    };
    return { language: languageName(ctx.language), retention,
      scope: await scopeSummary(scopedStorage(chromeStorage, ctx.scope), state.cards),
      personal: await scopeSummary(personalScope(ctx.language), own.state.cards) };
  }
  return { reviewStatus, reviewIntroduce, reviewNext, reviewReveal, reviewRate, reviewKnown, learningStats };
}

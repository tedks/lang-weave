// Review page handlers: the voluntary local recall queue.
import { REVIEW_KEY, reviewCounts, introduce, nextReview, revealReview, rateReview, markFamiliar } from './review.js';
import { languageName } from './languages.js';
import { PERSONAL_KEY } from './personal.js';
import { personalReview } from './review-state.js';

export function createReviewHandlers({ store, locked, context, reviewState }) {
  async function reviewStatus(ctx) {
    ctx ||= await context();
    const { state, words, language } = await reviewState(ctx);
    const own = personalReview(ctx);
    const oldCounts = reviewCounts(state, words, Date.now());
    const ownCounts = reviewCounts(own.state, own.words, Date.now());
    return { due: oldCounts.due + ownCounts.due, new: oldCounts.new,
      language: languageName(language) };
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
      const legacyDue = words.filter((w) => state.cards[w.fr]?.due <= now && !state.cards[w.fr]?.familiar)
        .reduce((due, w) => Math.min(due, state.cards[w.fr].due), Infinity);
      const personalDue = own.words.filter((w) => own.state.cards[w.fr]?.due <= now && !own.state.cards[w.fr]?.familiar)
        .reduce((due, w) => Math.min(due, own.state.cards[w.fr].due), Infinity);
      const usePersonal = personalDue < legacyDue;
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
      const result = target.current && eligible.some(({ fr }) => fr === target.current.word)
        ? rateReview(target, msg.ticket, msg.rating, Date.now(), ctx.settings.gradual) : null;
      if (!result) return { error: 'This rating is stale or the answer has not been revealed.' };
      if (personal) await store.set({ [PERSONAL_KEY]: ctx.personal });
      else await scoped.set({ [REVIEW_KEY]: state });
      return { ok: true, ...result };
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
      const ok = target.current && eligible.some(({ fr }) => fr === target.current.word) &&
        markFamiliar(target, msg.ticket, Date.now());
      if (!ok) return { error: 'Reveal the current due card before marking it familiar.' };
      if (personal) await store.set({ [PERSONAL_KEY]: ctx.personal });
      else await scoped.set({ [REVIEW_KEY]: state });
      return { ok: true };
    });
  }
  return { reviewStatus, reviewIntroduce, reviewNext, reviewReveal, reviewRate, reviewKnown };
}

// Legacy (pack) and personal review state for the current context.
import { chromeStorage } from './cache.js';
import { REVIEW_KEY, cleanReview } from './review.js';
import { scopedStorage } from './scope.js';

export function personalReview(ctx) {
  const words = ctx.activePersonal.filter(({ entry }) => !entry.linkedLegacy)
    .map(({ entry }) => ({ fr: entry.id, en: entry.source, hint: '' }));
  const state = ctx.personal.history[ctx.language] ||= cleanReview(null, words);
  for (const card of Object.values(state.cards)) {
    if (ctx.settings.gradual && card.familiar) card.maintenance = true;
    if (!ctx.settings.gradual) { delete card.maintenance; delete card.peekDue; }
  }
  return { state, words, byId: new Map(ctx.activePersonal.map(({ entry }) => [entry.id, entry])) };
}

export function personalForTarget(ctx, target) {
  return ctx.personalAuto.find(({ entry }) => entry.target === target)?.entry;
}

export function createReviewState({ context }) {
  async function reviewState(ctx) {
    ctx ||= await context();
    const scoped = scopedStorage(chromeStorage, ctx.scope);
    const { [REVIEW_KEY]: raw } = await scoped.get([REVIEW_KEY]);
    return { state: cleanReview(raw, ctx.legacyAllWords, Date.now(), ctx.settings.gradual), words: ctx.legacyWords,
      scoped, scope: ctx.scope, language: ctx.language };
  }
  return { reviewState };
}

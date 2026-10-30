// Inline recall cues on enabled pages (gradual mode).
import { REVIEW_KEY, beginInline, revealInline, finishInline } from './review.js';
import { PERSONAL_KEY } from './personal.js';
import { activeOn } from './worker-context.js';
import { personalReview, personalForTarget } from './review-state.js';

export function createInlineRecall({ store, locked, context, reviewState }) {
  async function inlineAction(msg, sender) {
    return locked(async () => {
      const ctx = await context();
      if (!ctx.settings.gradual || !ctx.settings.inlineRecall || msg.revision !== ctx.revision ||
          !activeOn(ctx, sender.url) || sender.documentLifecycle && sender.documentLifecycle !== 'active')
        return { error: 'Inline recall is no longer available here.' };
      const { state, words, scoped } = await reviewState(ctx);
      const own = personalReview(ctx);
      const now = Date.now();
      if (msg.type === 'inlineBegin') {
        const entry = personalForTarget(ctx, msg.word);
        const target = entry ? own.state : state;
        const word = entry ? own.words.find((w) => w.fr === entry.id) : words.find((w) => w.fr === msg.word);
        const result = word && beginInline(target, word.fr, sender, ctx.revision, now);
        if (!result) return { error: 'This word is not due here.' };
        if (entry) await store.set({ [PERSONAL_KEY]: ctx.personal });
        else await scoped.set({ [REVIEW_KEY]: state });
        return result;
      }
      const personal = own.state.inline?.ticket === msg.ticket;
      const target = personal ? own.state : state;
      const eligible = personal ? own.words : words;
      if (msg.type === 'inlineReveal') {
        const answer = revealInline(target, eligible, msg.ticket, sender, ctx.revision, now);
        if (!answer) return { error: 'This recall cue is stale.' };
        if (personal) await store.set({ [PERSONAL_KEY]: ctx.personal });
        else await scoped.set({ [REVIEW_KEY]: state });
        return { answer: personal ? { ...answer, fr: own.byId.get(answer.fr)?.target || '' } : answer };
      }
      const result = finishInline(target, msg.ticket, sender, ctx.revision, now, msg.rating);
      if (!result) return { error: 'Reveal the current cue before rating it.' };
      if (personal) await store.set({ [PERSONAL_KEY]: ctx.personal });
      else await scoped.set({ [REVIEW_KEY]: state });
      return { ok: true, ...result };
    });
  }
  return { inlineAction };
}

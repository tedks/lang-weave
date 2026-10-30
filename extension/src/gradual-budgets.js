// Gradual mode: the shared daily new-word budget across pack and personal cards,
// introduction tickets and clock-skew budget recovery.
import { localDay } from './events.js';
import { REVIEW_KEY } from './review.js';
import { commitLearning, acknowledgeIntroduction, releaseIntroduction, futureBudgetDay, introductionOwner,
  activeReservations } from './learning.js';
import { PERSONAL_KEY } from './personal.js';
import { activeOn, laterDay } from './worker-context.js';
import { personalReview, personalForTarget } from './review-state.js';

export function spentElsewhere(state, day, revision, now) {
  return state.learning.day > day ? Number.MAX_SAFE_INTEGER :
    (state.learning.day === day ? state.learning.count : 0) +
    activeReservations(state.learning, day, now, revision).length;
}

export function combinedLearning(legacy, personal, ctx, day, now) {
  const a = legacy.learning, b = personal.learning;
  const maxDay = a.day > b.day ? a.day : b.day;
  const ids = new Map(ctx.personalAuto.map(({ entry }) => [entry.id, entry.target]));
  return { day: maxDay, count: (a.day === maxDay ? a.count : 0) + (b.day === maxDay ? b.count : 0),
    pending: [...a.pending, ...b.pending.filter((p) => ids.has(p.word))
      .map((p) => ({ ...p, word: ids.get(p.word) }))] };
}

export function createGradualBudgets({ store, locked, context, broadcast, reviewState }) {
  async function introduction(msg, sender) {
    return locked(async () => {
      const ctx = await context();
      if (!ctx.settings.gradual || msg.revision !== ctx.revision || !activeOn(ctx, sender.url) ||
          sender.documentLifecycle && sender.documentLifecycle !== 'active' ||
          !sender.documentId || !Number.isSafeInteger(sender.tab?.id) || !Number.isSafeInteger(sender.frameId))
        return { ok: false, stale: true };
      const display = ctx.words.find((w) => w.fr === msg.word);
      if (!display || typeof msg.ticket !== 'string') return { ok: false, stale: true };
      const personalEntry = display.personalId ? personalForTarget(ctx, display.fr) : null;
      const legacy = await reviewState(ctx);
      const owner = personalEntry ? personalReview(ctx) : legacy;
      const state = owner.state;
      const word = personalEntry ? personalEntry.id : display.fr;
      const persist = () => personalEntry ? store.set({ [PERSONAL_KEY]: ctx.personal })
        : legacy.scoped.set({ [REVIEW_KEY]: state });
      if (msg.type === 'introRelease') {
        if (releaseIntroduction(state, msg.ticket, sender, ctx.revision)) await persist();
        return { ok: true };
      }
      if (msg.type === 'introRenew') {
        const old = state.learning.pending.find((p) => p.word === word && p.ticket === msg.ticket &&
          p.ownerKey === introductionOwner(msg.ticket, sender, ctx.revision) && p.revision === ctx.revision);
        if (!old) return { ok: false, stale: true };
        // A lost renewal reply must return the already-live replacement ticket
        // to this same document, rather than strand a visible English span.
        const now = Date.now();
        const current = state.learning.pending.find((p) => p.word === word && p.ticket !== msg.ticket &&
          p.day === localDay(new Date(now)) && p.until > now && p.revision === ctx.revision &&
          p.ownerKey === introductionOwner(p.ticket, sender, ctx.revision));
        if (current) return { ticket: current.ticket };
        const before = JSON.stringify(state.learning);
        const other = personalEntry ? legacy.state : personalReview(ctx).state;
        const budget = Math.max(0, ctx.settings.newWordsPerDay -
          spentElsewhere(other, localDay(new Date(now)), ctx.revision, now));
        const renewed = commitLearning(state, { renew: [{ word }] },
          { ...ctx.settings, newWordsPerDay: budget }, sender, ctx.revision);
        if (JSON.stringify(state.learning) !== before) await persist();
        return renewed.renew[0]?.introTicket ? { ticket: renewed.renew[0].introTicket } : { ok: false, stale: true };
      }
      const other = personalEntry ? legacy.state : personalReview(ctx).state;
      const budget = Math.max(0, ctx.settings.newWordsPerDay -
        spentElsewhere(other, localDay(), ctx.revision, Date.now()));
      if (!acknowledgeIntroduction(state, word, msg.ticket, sender, ctx.revision,
        budget)) return { ok: false, stale: true };
      await persist();
      return { ok: true };
    });
  }

  async function recoverBudget(msg) {
    if (msg.confirm !== true) return { error: 'Confirm budget recovery first.' };
    const recovered = await locked(async () => {
      const ctx = await context();
      const { state, scoped } = await reviewState(ctx);
      const own = personalReview(ctx);
      const today = localDay();
      const legacyFuture = futureBudgetDay(state.learning, today);
      const personalFuture = futureBudgetDay(own.state.learning, today);
      if (!legacyFuture && !personalFuture || msg.day !== laterDay(legacyFuture, personalFuture) ||
          msg.scope !== ctx.scope)
        return false;
      // Keep the historical date while allowing due inline recall from the next
      // local day after an explicitly confirmed clock recovery.
      if (legacyFuture) {
        for (const card of Object.values(state.cards)) if (card.introducedDay > today) card.introGateDay = today;
        state.learning = { day: today, count: 0, pending: [] };
        await scoped.set({ [REVIEW_KEY]: state });
      }
      if (personalFuture) {
        for (const card of Object.values(own.state.cards)) if (card.introducedDay > today) card.introGateDay = today;
        own.state.learning = { day: today, count: 0, pending: [] };
        await store.set({ [PERSONAL_KEY]: ctx.personal });
      }
      return true;
    });
    if (recovered) await broadcast('retry');
    return { ok: recovered };
  }

  async function adaptiveReviewState(ctx, day = localDay(), now = Date.now()) {
    const legacy = await reviewState(ctx);
    const personal = personalReview(ctx);
    const cards = { ...legacy.state.cards };
    for (const { entry } of ctx.personalAuto) {
      const card = personal.state.cards[entry.id];
      if (card) cards[entry.target] = card;
    }
    return { legacy, personal, state: { cards, learning: combinedLearning(legacy.state,
      personal.state, ctx, day, now) } };
  }

  async function commitAdaptive(ctx, raw, sender, stillSafe) {
    const day = localDay(), now = Date.now();
    const { legacy, personal } = await adaptiveReviewState(ctx, day, now);
    if (!(await stillSafe())) throw Object.assign(new Error('Page context changed'), { stale: true });
    const legacyRaw = {}, personalRaw = {};
    for (const [key, swaps] of Object.entries(raw)) {
      legacyRaw[key] = []; personalRaw[key] = [];
      for (const swap of swaps) {
        const entry = personalForTarget(ctx, swap.word);
        if (entry) personalRaw[key].push({ ...swap, word: entry.id });
        else legacyRaw[key].push(swap);
      }
    }
    const beforeLegacy = JSON.stringify(legacy.state.learning);
    const beforePersonal = JSON.stringify(personal.state.learning);
    const legacyBudget = Math.max(0, ctx.settings.newWordsPerDay -
      spentElsewhere(personal.state, day, ctx.revision, now));
    const legacyOutput = commitLearning(legacy.state, legacyRaw,
      { ...ctx.settings, newWordsPerDay: legacyBudget }, sender, ctx.revision, now, day);
    if (!(await stillSafe())) throw Object.assign(new Error('Page context changed'), { stale: true });
    if (JSON.stringify(legacy.state.learning) !== beforeLegacy)
      await legacy.scoped.set({ [REVIEW_KEY]: legacy.state });
    const personalBudget = Math.max(0, ctx.settings.newWordsPerDay -
      spentElsewhere(legacy.state, day, ctx.revision, now));
    const personalOutput = ctx.personal.unsupported ? Object.fromEntries(Object.keys(raw).map((key) => [key, []])) :
      commitLearning(personal.state, personalRaw,
        { ...ctx.settings, newWordsPerDay: personalBudget }, sender, ctx.revision, now, day);
    if (!(await stillSafe())) throw Object.assign(new Error('Page context changed'), { stale: true });
    if (!ctx.personal.unsupported && JSON.stringify(personal.state.learning) !== beforePersonal)
      await store.set({ [PERSONAL_KEY]: ctx.personal });
    return Object.fromEntries(Object.keys(raw).map((key) => [key,
      [...(legacyOutput[key] || []), ...(personalOutput[key] || []).map((swap) => ({ ...swap,
        word: personal.byId.get(swap.word)?.target || swap.word }))]]));
  }
  return { introduction, recoverBudget, adaptiveReviewState, commitAdaptive };
}

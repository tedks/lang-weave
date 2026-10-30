// Progress and My words: a read-only summary (popup, options, words page), the merged word list
// and three word actions for the words page. Local data only; nothing is sent anywhere.
// Writes go through the worker lock and the same scoped stores the review handlers use, and each
// one names the scope the page listed, so a language or pack change in between is refused.
import { REVIEW_KEY, reviewCounts, introduce, claimKnown } from './review.js';
import { DEFAULT_RETENTION, withFsrs } from './fsrs.js';
import { RETRIEVALS_KEY, EXPOSURES_KEY, cleanRetrievals, cleanExposures, retrievalEntries } from './learning-log.js';
import { PENDING_KEY, SENT_KEY, localDay } from './events.js';
import { chromeStorage } from './cache.js';
import { scopedStorage } from './scope.js';
import { personalScope } from './worker-context.js';
import { languageName } from './languages.js';
import { PERSONAL_KEY } from './personal.js';
import { entryId } from './catalog.js';
import { personalReview } from './review-state.js';
import { verifiedWords, wordStage, stageCounts, todayCounts, activity, practisedThisWeek,
  measurements } from './progress.js';

const LOG_KEYS = [RETRIEVALS_KEY, EXPOSURES_KEY, SENT_KEY, PENDING_KEY];
const STALE = 'Your language or words changed. Reload the list and try again.';

export function createProgressHandlers({ store, locked, context, reviewState }) {
  // Everything the summaries need for the active scope and its personal scope.
  async function snapshot(ctx) {
    const legacy = await reviewState(ctx);
    const own = personalReview(ctx);
    const [a, b] = await Promise.all([scopedStorage(chromeStorage, ctx.scope).get(LOG_KEYS),
      personalScope(ctx.language).get(LOG_KEYS)]);
    // Scopes never share a word ID (personal IDs carry a colon, which catalog log IDs refuse),
    // so merging keeps each word's own retrieval order.
    const entries = [...retrievalEntries(cleanRetrievals(a[RETRIEVALS_KEY])),
      ...retrievalEntries(cleanRetrievals(b[RETRIEVALS_KEY]))];
    const exposures = { words: Object.assign(Object.create(null), cleanExposures(a[EXPOSURES_KEY]).words,
      cleanExposures(b[EXPOSURES_KEY]).words) };
    const cards = Object.assign(Object.create(null), legacy.state.cards, own.state.cards);
    const personalEntries = ctx.personal.entries.filter((entry) => entry.language === ctx.language);
    // Words the learner can have: the pack's full list and their own unlinked entries.
    // A linked personal entry shares its bundled card, so it is not counted twice.
    const ids = [...ctx.legacyAllWords.map((word) => word.fr),
      ...personalEntries.filter((entry) => !entry.linkedLegacy && !entry.archived).map((entry) => entry.id)];
    return { legacy, own, a, b, entries, exposures, cards, ids, personalEntries,
      verified: verifiedWords(entries, cards) };
  }

  async function progress() {
    const ctx = await context();
    const now = Date.now();
    const snap = await snapshot(ctx);
    const { legacy, own, entries, cards, ids, verified } = snap;
    const legacyCounts = reviewCounts(legacy.state, legacy.words, now);
    const ownCounts = reviewCounts(own.state, own.words, now);
    const strip = activity(entries, now);
    const labels = new Map(snap.personalEntries.map((entry) => [entry.id, entry.target]));
    const learningWords = ids.filter((id) => cards[id] && !cards[id].familiar);
    return {
      language: languageName(ctx.language),
      due: legacyCounts.due + ownCounts.due, new: legacyCounts.new,
      today: todayCounts([{ cards: legacy.state.cards, sent: snap.a[SENT_KEY], pending: snap.a[PENDING_KEY] },
        { cards: own.state.cards, sent: snap.b[SENT_KEY], pending: snap.b[PENDING_KEY] }], entries, now),
      stages: stageCounts(ids, cards, verified),
      verifiedKnown: ids.filter((id) => verified.has(id)).length,
      activity: strip, practisedThisWeek: practisedThisWeek(strip),
      measurements: measurements(entries, { now, retention: ctx.settings.desiredRetention ?? DEFAULT_RETENTION,
        exposures: snap.exposures, learningWords, label: (id) => labels.get(id) ?? id }),
    };
  }

  // The merged list for the words page: the pack's words, with a personal entry linked to one of
  // them shown as "saved" on that row, then the learner's unlinked entries for this language.
  async function wordsList() {
    const ctx = await context();
    if (ctx.personal.unsupported) return { error: 'Personal vocabulary uses a newer format. Update Lang Weave.' };
    const now = Date.now();
    const snap = await snapshot(ctx);
    const { cards, verified, exposures } = snap;
    const atLevel = new Set(ctx.legacyWords.map((word) => word.fr));
    const linked = new Map(snap.personalEntries.filter((entry) => entry.linkedLegacy)
      .map((entry) => [entry.linkedLegacy, entry]));
    const progressOf = (id) => {
      const card = cards[id];
      const exposure = exposures.words[id];
      return { stage: wordStage(card, verified.has(id)), due: card && !card.familiar ? card.due : null,
        reviews: card?.reviews ?? 0, familiar: card?.familiar === true, lapses: card ? withFsrs(card).fsrs?.lapses ?? 0 : 0,
        exposures: exposure ? exposure[0] : 0, days: exposure ? exposure[2] : 0,
        // What the page echoes back to Reset: the card it showed, so a rating in between is caught.
        version: card ? { due: card.due, reviews: card.reviews, familiar: card.familiar === true } : null };
    };
    const blocked = (id, card, { archived = false, level = true } = {}) => archived ? 'Archived'
      : card?.familiar ? 'Marked known. Reset it to practise again.'
        : !level ? 'Above your current reading level' : '';
    const rows = ctx.legacyAllWords.map((word) => {
      const saved = linked.get(entryId(ctx.scope, word));
      const p = progressOf(word.fr);
      const reason = blocked(word.fr, cards[word.fr], { level: atLevel.has(word.fr) });
      return { id: word.fr, kind: 'pack', target: word.fr, gloss: word.en, hint: word.hint || '', ...p,
        practise: !reason, reason, ...(saved ? { saved: { id: saved.id, archived: saved.archived } } : {}) };
    });
    const packIds = new Set(ctx.legacyAllWords.map((word) => entryId(ctx.scope, word)));
    for (const entry of snap.personalEntries) {
      if (entry.linkedLegacy && packIds.has(entry.linkedLegacy)) continue;
      const own = !entry.linkedLegacy;
      const p = own ? progressOf(entry.id) : progressOf('');
      const reason = own ? blocked(entry.id, cards[entry.id], { archived: entry.archived })
        : 'Its bundled word is not in this pack';
      rows.push({ id: entry.id, kind: 'personal', target: entry.target, gloss: entry.source,
        sense: entry.sense === entry.source ? '' : entry.sense, hint: '', ...p, archived: entry.archived,
        practise: !reason, reason });
    }
    return { language: languageName(ctx.language), scope: ctx.scope, now, rows };
  }

  // The card store a word action writes, after checking the page's scope and the word.
  async function target(ctx, msg) {
    if (ctx.personal.unsupported) return { error: 'Personal vocabulary uses a newer format. Update Lang Weave.' };
    if (typeof msg.id !== 'string' || msg.scope !== ctx.scope) return { error: STALE, stale: true };
    const legacy = await reviewState(ctx);
    const own = personalReview(ctx);
    const entry = ctx.personal.entries.find((item) => item.id === msg.id && item.language === ctx.language);
    if (entry) {
      if (entry.linkedLegacy) return { error: 'This saved word uses its bundled card. Use that row.' };
      return { state: own.state, other: legacy.state, entry, word: { fr: entry.id, en: entry.source },
        queue: !entry.archived, persist: () => store.set({ [PERSONAL_KEY]: ctx.personal }),
        persistOther: () => legacy.scoped.set({ [REVIEW_KEY]: legacy.state }) };
    }
    const word = ctx.legacyAllWords.find((item) => item.fr === msg.id);
    if (!word) return { error: STALE, stale: true };
    return { state: legacy.state, other: own.state, word,
      queue: ctx.legacyWords.some((item) => item.fr === word.fr),
      persist: () => legacy.scoped.set({ [REVIEW_KEY]: legacy.state }),
      persistOther: () => store.set({ [PERSONAL_KEY]: ctx.personal }) };
  }

  const dropTickets = (state, id) => {
    let changed = false;
    if (state.current?.word === id) { state.current = null; changed = true; }
    if (state.inline?.word === id) { state.inline = null; changed = true; }
    return changed;
  };

  // Practice now: make this word the review page's next card. A new word is introduced
  // first, as the review page's Add button and the capture page's "Add to review" do: an
  // explicit manual introduction, outside the gradual reading budget, which governs
  // automatic ones; a word not yet due becomes an early review that FSRS schedules
  // from the real elapsed time. Familiar, archived and above-level words are refused.
  async function wordPractice(msg) {
    return locked(async () => {
      const ctx = await context();
      const t = await target(ctx, msg);
      if (t.error) return t;
      if (!t.queue) return { error: t.entry?.archived ? 'Unarchive this word to practise it.' : 'This word is above your current reading level.' };
      if (!ctx.settings.gradual && t.state.cards[t.word.fr]?.familiar)
        return { error: 'You marked this word known. Reset it to practise again.' };
      const now = Date.now();
      if ((t.state.cards[t.word.fr]?.claimDue || 0) > now)
        return { error: 'This word has a later verification due. Return when it is ready.' };
      const introduced = !t.state.cards[t.word.fr] && introduce(t.state, [t.word], now, 1) === 1;
      if (t.other.current) { t.other.current = null; await t.persistOther(); }
      // The grant names the card's current due time: any later write to the card voids it.
      t.state.current = { word: t.word.fr, ticket: crypto.randomUUID(), revealed: false,
        practice: t.state.cards[t.word.fr].due };
      await t.persist();
      return { ok: true, introduced };
    });
  }

  // Already know: the same claim as the review page's button. It creates a familiar card for a
  // word never introduced. It is not logged: the log's sources are the two review surfaces, and
  // a third needs a log format change (docs/PROGRESS-MISSION.md).
  async function wordKnown(msg) {
    return locked(async () => {
      const ctx = await context();
      const t = await target(ctx, msg);
      if (t.error) return t;
      if (t.entry?.archived) return { error: 'Unarchive this word first.' };
      const now = Date.now();
      const card = t.state.cards[t.word.fr];
      if (!ctx.settings.gradual) {
        if (card?.familiar) return { ok: true };
        if (card) card.familiar = true;
        else t.state.cards[t.word.fr] = { due: now, interval: 0, reviews: 0,
          introducedDay: localDay(new Date(now)), familiar: true };
        dropTickets(t.state, t.word.fr);
        await t.persist();
        return { ok: true };
      }
      if (card?.claimDue) return { ok: true };
      if (card) claimKnown(card, now);
      else {
        t.state.cards[t.word.fr] = { due: now, interval: 0, reviews: 0,
          introducedDay: localDay(new Date(now)) };
        claimKnown(t.state.cards[t.word.fr], now);
      }
      dropTickets(t.state, t.word.fr);
      await t.persist();
      return { ok: true };
    });
  }

  // Reset: forget this word's card (schedule, FSRS memory, review count, "known"), so it is new
  // again. Guarded: the page must send confirm: true after a second click, and the card version
  // it showed; a rating, claim or reset since then makes the request stale. Open review and
  // inline tickets for the word are dropped, so a page holding one gets the existing stale reply.
  // The learning log keeps its history (its write paths are unchanged); verifiedWords ignores
  // passes from before the reset.
  async function wordReset(msg) {
    return locked(async () => {
      const ctx = await context();
      if (msg.confirm !== true) return { error: 'Confirm the reset first.' };
      const t = await target(ctx, msg);
      if (t.error) return t;
      const card = t.state.cards[t.word.fr];
      const seen = msg.version;
      if (!card) return { error: 'This word has no progress to reset.', stale: true };
      if (!seen || seen.due !== card.due || seen.reviews !== card.reviews || seen.familiar !== (card.familiar === true))
        return { error: 'This word changed since the list loaded. Reload and try again.', stale: true };
      delete t.state.cards[t.word.fr];
      dropTickets(t.state, t.word.fr);
      await t.persist();
      return { ok: true };
    });
  }

  return { progress, wordsList, wordPractice, wordKnown, wordReset };
}

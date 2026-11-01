// Reading: swaps for page text (cache, gradual policy, one model call at a time) and
// local reading events. Consent, title, revision and generations are rechecked after every await.
import { chromeStorage } from './cache.js';
import { requestSwaps } from './engine.js';
import { cleanQuotaState, newCooldownEntry, retainedRetryAt, safeModelStatus, STATUS_KEY, QUOTA_STATE_KEY,
  MODEL_IDS, rejectedForEpoch } from './quota-status.js';
import { exactTarget, isZeroFrench, wordCount } from './levels.js';
import { hashKey } from './hash.js';
import { localDay, queueEvents, shownToday } from './events.js';
import { DAILY_MODEL_CALLS, callsToday, countCall } from './quota.js';
import { policyWords, remaining, validDay } from './learning.js';
import { scopedStorage } from './scope.js';
import { catalogEntries, matchingEntries } from './catalog.js';
import { selectWorkingSet, capUnknownSwaps } from './adaptive.js';
import { ENCOUNTERS_KEY, cleanEncounters, countEncounters } from './encounters.js';
import { EXPOSURES_KEY, cleanExposures } from './learning-log.js';
import { REVIEW_KEY, countCardEncounter } from './review.js';
import { PERSONAL_KEY } from './personal.js';
import { activeOn, personalScope } from './worker-context.js';
import { logExposure, logRetrieval, retrievalsFor } from './learning-records.js';
import { MAX_LATENCY_MS, isGuess, reviewEntries } from './learning-log.js';
import { GUESS_LIMIT, guessChoices } from './guess.js';
import { wordStage, verifiedWords } from './progress.js';

// The tab title is local-only safety context. Refresh it after every asynchronous
// boundary that could precede cache delivery or a primary/fallback fetch.
export async function safePageTitle(msg, sender) {
  // Content scripts are registered for the top frame only. Fail closed if a
  // frame nevertheless reaches this handler: its live title is not tab.title.
  if (sender.frameId && sender.frameId !== 0) return false;
  if (isZeroFrench(msg.title || '') || isZeroFrench(sender.tab?.title || '')) return false;
  if (!Number.isSafeInteger(sender.tab?.id)) return false;
  try {
    const tab = await chrome.tabs.get(sender.tab.id);
    return typeof tab?.title === 'string' && !isZeroFrench(tab.title);
  } catch { return false; } // a closed/inaccessible tab cannot authorize disclosure
}

export async function liveGradualDocument(sender) {
  if (sender.frameId !== 0 || !sender.documentId ||
      sender.documentLifecycle && sender.documentLifecycle !== 'active') return false;
  try {
    const tab = await chrome.tabs.get(sender.tab?.id);
    return typeof tab?.url === 'string' && tab.url === sender.url;
  } catch { return false; }
}

export function createReading({ store, cache, locked, modelCall, worker, cooldown, cooldownKinds, context,
    adaptiveReviewState, commitAdaptive }) {
  // Model status is diagnostic; failure to save it must not hide a valid reading result.
  async function saveModelStatus(status, epoch) {
    try {
      await locked(async () => {
        const current = await store.get(['keyEpoch', STATUS_KEY]);
        if ((current.keyEpoch || '') !== epoch) return;
        const previous = safeModelStatus(current[STATUS_KEY]);
        const retryAt = status.retryAt ?? (status.coolingDown ? retainedRetryAt(previous,
          status.category, Date.now(), status.retryAfterMs) : undefined);
        await store.set({ [STATUS_KEY]: safeModelStatus({ at: Date.now(), ...status, keyEpoch: epoch, retryAt }) });
      });
    } catch { /* diagnostic only */ }
  }
  async function persistCooldown(model, category, wait, startedAt, epoch) {
    if (!MODEL_IDS.has(model) || !Number.isFinite(wait) || wait <= 0) return;
    await locked(async () => {
      const current = await store.get(['keyEpoch', QUOTA_STATE_KEY]);
      if ((current.keyEpoch || '') !== epoch) return;
      const now = Date.now();
      const state = cleanQuotaState(current[QUOTA_STATE_KEY], epoch, now);
      const kind = category === 'daily_quota' ? 'daily' : category === 'overloaded' ? 'overloaded'
        : category === 'rate_limit' ? 'short' : 'transient';
      const entry = newCooldownEntry(kind, wait, startedAt, now);
      if (!entry) return;
      state.cooldowns[model] = entry;
      await store.set({ [QUOTA_STATE_KEY]: state });
    });
  }

  async function swaps(msg, sender) {
    const ctx = await context();
    const consentGeneration = worker.permissionGeneration;
    const settingsAtStart = worker.settingsGeneration;
    let policyDay = '';
    const stillSafe = async () => {
      const latest = await context();
      if (latest.revision !== ctx.revision || !activeOn(latest, sender.url) ||
          !(await safePageTitle(msg, sender)) ||
          (ctx.settings.gradual && !(await liveGradualDocument(sender)))) return false;
      // Permission and gradual settings events can occur during either tab lookup.
      // Keep these checks synchronous and last before a write, fetch or delivery.
      return worker.permissionGeneration === consentGeneration &&
        (!ctx.settings.gradual || worker.settingsGeneration === settingsAtStart) &&
        (!policyDay || localDay() === policyDay);
    };
    if (msg.revision !== ctx.revision || !activeOn(ctx, sender.url)) return { results: {}, stale: true };
    if (!Array.isArray(msg.items) || msg.items.length > 8) throw new Error('Invalid text batch');
    const items = msg.items.filter((i) => i && typeof i.text === 'string' && i.text.length <= 2000 &&
      wordCount(i.text) >= 6 && !isZeroFrench(i.text) && i.key === `${ctx.revision}:${hashKey(i.text)}`);
    if (!items.length) return { results: {} };
    if (!(await safePageTitle(msg, sender))) return { results: Object.fromEntries(items.map((i) => [i.key, []])) };
    if (ctx.settings.gradual && !(await liveGradualDocument(sender))) return { results: {}, stale: true };
    const now = Date.now();
    const day = localDay(new Date(now));
    policyDay = ctx.settings.gradual ? day : '';
    let candidates, state, shown;
    if (ctx.settings.gradual) {
      // The content script sends only locally readable, near-viewport text. The
      // worker independently rechecks consent, top frame, title and revision at
      // each awaited storage boundary before recording a coarse catalog signal.
      const entries = catalogEntries(ctx.words, ctx.scope);
      const allEntries = catalogEntries(ctx.allWords, ctx.scope);
      const matches = matchingEntries(items, entries);
      if (!matches.length) return locked(async () => await stillSafe()
        ? { results: Object.fromEntries(items.map((i) => [i.key, []])) } : { results: {}, stale: true });
      let counts, exposures;
      try {
        counts = await locked(async () => {
          if (!(await stillSafe())) return null;
          const scoped = scopedStorage(chromeStorage, ctx.scope);
          const ownScoped = personalScope(ctx.language);
          const [{ [ENCOUNTERS_KEY]: raw, [EXPOSURES_KEY]: exposureRaw },
            { [ENCOUNTERS_KEY]: ownRaw, [EXPOSURES_KEY]: ownExposureRaw }] = await Promise.all([
            scoped.get([ENCOUNTERS_KEY, EXPOSURES_KEY]), ownScoped.get([ENCOUNTERS_KEY, EXPOSURES_KEY])]);
          if (!(await stillSafe())) return null;
          const ownIds = new Set(ctx.activePersonal.map(({ entry }) => entry.id));
          exposures = { ...cleanExposures(exposureRaw).words };
          const ownExposures = cleanExposures(ownExposureRaw).words;
          for (const { entry } of ctx.activePersonal) {
            const aggregate = ownExposures[entry.id];
            if (aggregate) exposures[entry.target] = aggregate;
          }
          const aggregate = cleanEncounters(raw, allEntries.filter((entry) => !ownIds.has(entry.id))
            .map((entry) => entry.id), day);
          const ownAggregate = cleanEncounters(ownRaw, ctx.personal.entries.filter((entry) =>
            entry.language === ctx.language).map((entry) => entry.id), day);
          const before = JSON.stringify(aggregate), ownBefore = JSON.stringify(ownAggregate);
          countEncounters(aggregate, matches.filter((entry) => !ownIds.has(entry.id)).map((entry) => entry.id), day);
          countEncounters(ownAggregate, matches.filter((entry) => ownIds.has(entry.id)).map((entry) => entry.id), day);
          if (JSON.stringify(aggregate) !== before) await scoped.set({ [ENCOUNTERS_KEY]: aggregate });
          // The first write may have yielded while consent changed. Do not start
          // the separate personal write using the earlier authorization.
          if (!(await stillSafe())) return null;
          if (JSON.stringify(ownAggregate) !== ownBefore) await ownScoped.set({ [ENCOUNTERS_KEY]: ownAggregate });
          return { ...aggregate.counts, ...ownAggregate.counts };
        });
        if (!counts) return { results: {}, stale: true };
        ({ state } = await adaptiveReviewState(ctx, day, now));
        const [oldShown, ownShown] = await Promise.all([shownToday(scopedStorage(chromeStorage, ctx.scope)),
          shownToday(personalScope(ctx.language))]);
        const ownTargets = new Map(ctx.activePersonal.map(({ entry }) => [entry.id, entry.target]));
        shown = [...oldShown, ...ownShown.map((id) => ownTargets.get(id)).filter(Boolean)];
      } catch { return { results: {}, error: 'Local reading storage failed' }; }
      if (!(await stillSafe())) return { results: {}, stale: true };
      candidates = selectWorkingSet({ batch: items, words: ctx.words,
        scope: ctx.scope, state, settings: ctx.settings, now, day, revision: ctx.revision,
        encounters: counts, exposures, sender, level: ctx.level, language: ctx.language, density: ctx.settings.density,
        shownToday: shown });
    } else {
      candidates = policyWords(ctx.words, null, ctx.settings, now, day, ctx.revision);
    }
    if (ctx.settings.gradual && !candidates.length) return locked(async () => {
      return await stillSafe()
        ? { results: Object.fromEntries(items.map((i) => [i.key, []])) }
        : { results: {}, stale: true };
    });
    const policy = ctx.settings.gradual ? hashKey(JSON.stringify([day,
      remaining(state.learning, day, ctx.settings.newWordsPerDay, now, ctx.revision),
      candidates.map(({ entryId, fr, status, reasonCode }) => [entryId, fr, status, reasonCode])])) : '';
    const cacheKey = (key) => policy ? `${key}:gradual:${policy}` : key;
    const cached = await cache.getMany(items.map((i) => cacheKey(i.key)));
    if (!(await safePageTitle(msg, sender))) return { results: {}, stale: true };
    const results = Object.fromEntries(items.filter((i) => cacheKey(i.key) in cached)
      .map((i) => [i.key, cached[cacheKey(i.key)]]));
    const misses = items.filter((i) => !(i.key in results));
    if (!misses.length && !ctx.settings.gradual) {
      return await locked(async () => await stillSafe()
        ? { results } : { results: {}, stale: true });
    }
    const deliver = async (raw, freshRaw) => locked(async () => {
      if (!(await stillSafe())) return { results: {}, stale: true };
      if (!ctx.settings.gradual) {
        if (freshRaw) await cache.setMany(freshRaw);
        return await stillSafe() ? { results: raw } : { results: {}, stale: true };
      }
      // A failed cache write must not spend an introduction that the page will
      // receive only as an error. Cached raw swaps remain policy-filtered on read.
      if (freshRaw) await cache.setMany(Object.fromEntries(Object.entries(freshRaw)
        .map(([key, swaps]) => [cacheKey(key), swaps])));
      const latest = await context();
      if (!(await stillSafe())) return { results: {}, stale: true };
      if (latest.revision !== ctx.revision) return { results: {}, stale: true };
      let output;
      try {
        const current = await adaptiveReviewState(latest, day, Date.now());
        if (!(await stillSafe())) return { results: {}, stale: true };
        output = await commitAdaptive(latest,
          capUnknownSwaps(raw, items, candidates, current.state.cards), sender, stillSafe);
      }
      catch (error) {
        if (error?.stale) return { results: {}, stale: true };
        throw error;
      }
      return await stillSafe() ? { results: output } : { results: {}, stale: true };
    });
    if (!misses.length) return deliver(results);
    let fresh;
    let requestEpoch = '';
    try {
      fresh = await modelCall(async () => {
        if ((await context()).revision !== ctx.revision) return null;
        const keyData = await store.get(['apiKey', 'keyEpoch', QUOTA_STATE_KEY, STATUS_KEY, 'consentShown']);
        const { apiKey } = keyData;
        // The only UI transition is false -> true. A false snapshot cannot dispatch, even
        // if the user chooses a policy while this request is queued.
        if (keyData.consentShown === false)
          throw Object.assign(new Error('Choose site access on the welcome page first'), { category: 'consent_required' });
        const keyEpoch = keyData.keyEpoch || '';
        requestEpoch = keyEpoch;
        if ((keyEpoch && worker.keyRejectedEpoch === keyEpoch) || rejectedForEpoch(keyData[STATUS_KEY], keyEpoch))
          throw Object.assign(new Error('Gemini rejected this key. Paste a new one.'), { category: 'key_rejected' });
        const persisted = cleanQuotaState(keyData[QUOTA_STATE_KEY], keyEpoch);
        if (await callsToday(chromeStorage) >= DAILY_MODEL_CALLS) {
          await saveModelStatus({ category: 'local_budget' }, requestEpoch);
          throw Object.assign(new Error('Daily local model-call budget reached'), { category: 'local_budget' });
        }
        cooldown.clear();
        cooldownKinds.clear();
        for (const [model, entry] of Object.entries(persisted.cooldowns)) {
          cooldown.set(model, entry.until);
          cooldownKinds.set(model, entry.kind);
        }
        const fetchImpl = async (...args) => {
          // Storage and review reads above can yield while a site is turned off. Dispatch under
          // the same lock as settings writes, and check again after counting the model call.
          const { response } = await locked(async () => {
            if (!(await stillSafe())) {
              throw Object.assign(new Error('Page context changed before model request'), { stale: true });
            }
            // Counting can yield to a browser permission change; keep the second check.
            try { await countCall(chromeStorage); }
            catch { throw Object.assign(new Error('Local reading storage failed'), { category: 'storage_failed' }); }
            if (!(await stillSafe())) {
              throw Object.assign(new Error('Page context changed before model request'), { stale: true });
            }
            return { response: fetch(...args) };
          });
          return response;
        };
        return requestSwaps({ apiKey, model: ctx.settings.model, level: ctx.level, language: ctx.language,
          density: ctx.settings.density, unknownLimit: ctx.settings.gradual, words: candidates, fetchImpl, cooldownKinds,
          shownToday: shown || await shownToday(scopedStorage(chromeStorage, ctx.scope)), cooldown, batch: misses.map((i) => ({ id: i.key, text: i.text })),
          onFailure: async (model, category, wait, startedAt) => {
            cooldownKinds.set(model, category === 'daily_quota' ? 'daily' : category === 'overloaded' ? 'overloaded'
              : category === 'rate_limit' ? 'short' : 'transient');
            await persistCooldown(model, category, wait, startedAt, keyEpoch);
          } });
      });
    } catch (e) {
      if (e?.stale) return { results: {}, stale: true };
      const category = e?.category || 'request_failed';
      // Provider rejection belongs to the key, not this page. A site/settings
      // change while the response was in flight cannot authorize another call.
      if (category === 'key_rejected') {
        worker.keyRejectedEpoch = requestEpoch;
        await saveModelStatus({ category }, requestEpoch);
      }
      const latest = await context();
      if (latest.revision !== ctx.revision || !activeOn(latest, sender.url)) return { results: {}, stale: true };
      const error = category === 'daily_quota' ? 'Daily model quota reached' : category === 'rate_limit'
        ? 'Model rate limit reached' : category === 'overloaded' ? 'Model service is busy'
        : category === 'key_rejected' ? 'Gemini rejected this key. Paste a new one.'
        : category === 'local_budget' ? 'Daily local model-call budget reached'
        : category === 'storage_failed' ? 'Local reading storage failed'
        : category === 'consent_required' ? 'Choose site access on the welcome page first' : 'Model request failed';
      // A missing site choice is local policy, not a model failure or quota diagnostic.
      if (category !== 'consent_required' && category !== 'key_rejected') await saveModelStatus({ category, retryAt: e?.retryAt,
        coolingDown: e?.coolingDown === true, retryAfterMs: e?.retryAfterMs }, requestEpoch);
      try {
        // Cache entries are raw validated swaps. They still need the current gradual
        // quota and cards, even when another item in this batch failed at the model.
        const delivered = await deliver(results);
        return { ...delivered, error, retryAfterMs: e?.retryAfterMs };
      } catch (storageError) {
        return { results: {}, error: 'Learning state could not be saved' };
      }
    }
    if (!fresh) return { results: {}, stale: true };
    try {
      const delivered = await deliver({ ...results, ...fresh.results }, fresh.results);
      if (!delivered.stale) {
        await saveModelStatus({ category: 'ok', model: fresh.model }, requestEpoch);
        // A popup save must not commit between this last context read and title lookup.
        return locked(async () => await stillSafe() ? delivered : { results: {}, stale: true });
      }
      return delivered;
    } catch (e) {
      if (e?.stale) return { results: {}, stale: true };
      const latest = await context();
      if (latest.revision !== ctx.revision || !activeOn(latest, sender.url)) return { results: {}, stale: true };
      const category = 'storage_failed';
      const error = 'Local reading storage failed';
      await saveModelStatus({ category }, requestEpoch);
      try {
        const cached = await deliver(results);
        return { ...cached, error, retryAfterMs: e?.retryAfterMs };
      } catch (storageError) {
        return { results: {}, error: 'Learning state could not be saved' };
      }
    }
  }

  // The page's word, resolved against the current catalog: its pack word and any personal entry.
  const resolveWord = (ctx, target) => {
    if (typeof target !== 'string') return null;
    const word = ctx.words.find((w) => exactTarget(w.fr, ctx.language) === exactTarget(target, ctx.language));
    if (!word) return null;
    return { word, personal: ctx.personalAuto.find(({ entry }) => entry.target === word.fr)?.entry };
  };

  // Events stay local and bounded. Sightings are not evidence of mastery; no automatic promotion.
  async function record(msg, sender) {
    return locked(async () => {
      const ctx = await context();
      if (msg.revision !== ctx.revision || !activeOn(ctx, sender.url) || !['seen', 'flip', 'peek'].includes(msg.event) || typeof msg.word !== 'string') return { ok: false };
      const found = resolveWord(ctx, msg.word);
      if (!found) return { ok: false };
      return applyEvent(ctx, found, msg.event, sender, worker.permissionGeneration);
    });
  }
  // One reading event for a resolved word. The caller holds the lock and has checked revision and
  // site access; `consent` is the permission generation it checked them under.
  async function applyEvent(ctx, { word, personal }, event, sender, consent) {
    await queueEvents(personal ? personalScope(ctx.language) : scopedStorage(chromeStorage, ctx.scope),
      [{ word: personal?.id || word.fr, kind: event }]);
    // Exposure aggregates for the learning log, at the same point as the reading events. The
    // event write yielded, so recheck consent before this separate write. A flip is a reveal
    // of the English, not an exposure.
    if (event !== 'flip') {
      const latest = await context();
      if (latest.revision === ctx.revision && activeOn(latest, sender.url) && worker.permissionGeneration === consent) {
        if (ctx.settings.gradual) {
          const now = Date.now(), day = localDay(new Date(now));
          const { legacy, personal: own } = await adaptiveReviewState(ctx, day, now);
          const card = personal ? own.state.cards[personal.id] : legacy.state.cards[word.fr];
          if (countCardEncounter(card, event, day, now)) {
            const fresh = await context();
            if (fresh.revision !== ctx.revision || !activeOn(fresh, sender.url) ||
                worker.permissionGeneration !== consent) return { ok: false };
            if (personal) await store.set({ [PERSONAL_KEY]: ctx.personal });
            else await legacy.scoped.set({ [REVIEW_KEY]: legacy.state });
          }
        }
        await logExposure(ctx, !!personal, personal?.id || word.fr, event, Date.now());
      }
    }
    return { ok: true };
  }

  // Guess first. guessBegin offers choices for a learning word whose guesses are under the cap
  // (at most one a local day), or answers { plain: true } so the page shows the gloss as before.
  // guessAnswer rechecks the same rules under the lock (another tab may have answered first),
  // then records one retrieval (source 'guess', direction receptive, correct/incorrect,
  // worker-measured latency) at the same consent-checked point as a peek. Only a recorded wrong
  // guess is then applied exactly as a peek; a right guess changes no card.
  // Open tickets live in chrome.storage.session, one per tab and document: they survive an idle
  // MV3 worker shutdown while the panel is open, are never exported, and end with the browser.
  // Only where the API is absent do they live in this worker's memory. A failed session read or
  // write fails closed: no ticket is offered, and an answer whose ticket cannot be consumed is
  // not recorded, so a ticket is never lost or answered twice.
  const TICKETS_KEY = 'guessTickets';
  const MAX_GUESS_TICKETS = 64;
  let memoryTickets = {};
  const ticketKey = (sender) => `${sender.tab?.id}:${sender.documentId || ''}`;
  // Returns the open tickets, or null when session storage cannot be read.
  async function readTickets() {
    const session = globalThis.chrome?.storage?.session;
    if (!session) return { ...memoryTickets };
    try {
      const { [TICKETS_KEY]: raw } = await session.get(TICKETS_KEY);
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch { return null; }
  }
  // Returns whether the tickets were stored.
  async function writeTickets(tickets, now) {
    const kept = Object.entries(tickets).filter(([, t]) => Number.isSafeInteger(t?.at) && t.at <= now &&
      now - t.at <= MAX_LATENCY_MS).sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_GUESS_TICKETS);
    const next = Object.fromEntries(kept);
    const session = globalThis.chrome?.storage?.session;
    if (!session) { memoryTickets = next; return true; }
    try { await session.set({ [TICKETS_KEY]: next }); return true; } catch { return false; }
  }
  const guessOn = (ctx, msg, sender) => ctx.settings.gradual && ctx.settings.guessFirst === true &&
    msg.revision === ctx.revision && activeOn(ctx, sender.url) && sender.frameId === 0 &&
    (!sender.documentLifecycle || sender.documentLifecycle === 'active') && Number.isSafeInteger(sender.tab?.id);
  async function guessCard(ctx, found, day, now) {
    const { legacy, personal: own } = await adaptiveReviewState(ctx, day, now);
    return found.personal ? own.state.cards[found.personal.id] : legacy.state.cards[found.word.fr];
  }
  // Whether this card may take a guess today. Guesses count within the card's current life, at
  // day granularity: a card keeps only its introduction day, and the log has no reset marker, so a
  // guess from the morning of a same-day Reset still counts (the word waits until tomorrow, which
  // the one-a-day rule would require anyway). Like verifiedWords' rule.
  async function guessAllowed(ctx, found, card, id, day) {
    if (!card || wordStage(card) !== 'learning') return false;
    const own = (await retrievalsFor(ctx, !!found.personal)).filter((e) => e.word === id);
    const introduced = card.introGateDay || card.introducedDay;
    let lifeStart = -Infinity; // local midnight of the introduction day
    if (validDay(introduced)) {
      const [y, m, d] = introduced.split('-').map(Number);
      lifeStart = new Date(y, m - 1, d).getTime();
    }
    const guesses = own.filter((e) => isGuess(e) && e.at >= lifeStart);
    return guesses.length < GUESS_LIMIT && !guesses.some((e) => localDay(new Date(e.at)) === day) &&
      !verifiedWords(reviewEntries(own), { [id]: card }).has(id);
  }
  async function guess(msg, sender) {
    return locked(async () => {
      const ctx = await context();
      if (!guessOn(ctx, msg, sender)) return { plain: true, stale: true };
      const now = Date.now(), day = localDay(new Date(now));
      if (msg.type === 'guessBegin') {
        const found = resolveWord(ctx, msg.word);
        if (!found) return { plain: true };
        const id = found.personal?.id || found.word.fr;
        const card = await guessCard(ctx, found, day, now);
        try { if (!(await guessAllowed(ctx, found, card, id, day))) return { plain: true }; }
        catch { return { plain: true }; }
        const offered = guessChoices(found.word, ctx.legacyAllWords, { wordId: id, day });
        if (!offered) return { plain: true };
        const ticket = crypto.randomUUID();
        const tickets = await readTickets();
        if (!tickets) return { plain: true, stale: true };
        tickets[ticketKey(sender)] = { ticket, id, target: found.word.fr, answer: offered.answer,
          count: offered.choices.length, at: now, revision: ctx.revision, url: sender.url };
        if (!(await writeTickets(tickets, now))) return { plain: true, stale: true };
        const latest = await context();
        if (!guessOn(latest, msg, sender) || latest.revision !== ctx.revision) return { plain: true, stale: true };
        return { ticket, choices: offered.choices };
      }
      // guessAnswer: one use per ticket, from the document that opened it.
      const stale = { error: 'This guess is stale.' };
      const tickets = await readTickets();
      const key = ticketKey(sender);
      const open = tickets?.[key];
      if (!open || open.ticket !== msg.ticket || open.revision !== ctx.revision || open.url !== sender.url) return stale;
      delete tickets[key];
      if (!(await writeTickets(tickets, now))) return stale; // not consumed: never recorded
      if (!Number.isSafeInteger(msg.choice) || msg.choice < 0 || msg.choice >= open.count ||
          now < open.at || now - open.at > MAX_LATENCY_MS) return stale;
      const correct = msg.choice === open.answer;
      const found = resolveWord(ctx, open.target);
      if (!found || (found.personal?.id || found.word.fr) !== open.id) return stale;
      const consent = worker.permissionGeneration;
      const card = await guessCard(ctx, found, day, now);
      let allowed;
      try { allowed = await guessAllowed(ctx, found, card, open.id, day); } catch { allowed = false; }
      if (!allowed) return stale; // e.g. another tab's answer for this word already counted today
      const latest = await context();
      if (latest.revision !== ctx.revision || !activeOn(latest, sender.url) ||
          worker.permissionGeneration !== consent) return stale;
      const logged = await logRetrieval(ctx, !!found.personal, { word: open.id, outcome: correct ? 'correct' : 'incorrect',
        prior: Number.isSafeInteger(card.reviews) ? card.reviews : 0, latencyMs: now - open.at }, 'guess', now);
      // An answer that could not be logged counts for nothing: no cap, no measurement, no peek.
      if (!logged) return { error: 'This guess could not be recorded.' };
      // A wrong guess is weak failure evidence, exactly a peek: it may bring a review earlier.
      if (!correct) {
        const fresh = await context();
        if (fresh.revision === ctx.revision && activeOn(fresh, sender.url) && worker.permissionGeneration === consent)
          await applyEvent(ctx, found, 'peek', sender, consent);
      }
      return { ok: true, correct, answer: open.answer, logged: true };
    });
  }
  return { swaps, record, guess };
}

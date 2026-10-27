// Standalone Spanish service worker: site access, one model call at a time and local reading events.
// Keys stay here; pages only get a config without them.
import { createCache, chromeStorage } from './cache.js';
import { requestSwaps } from './engine.js';
import { cleanQuotaState, newCooldownEntry, retainedRetryAt, safeModelStatus, STATUS_KEY, QUOTA_STATE_KEY, MODEL_IDS } from './quota-status.js';
import { cleanSettings, newSitesDefault, siteEnabled, hasSiteAccess } from './settings.js';
import { resolveLevel, exactTarget, isZeroFrench, wordCount, wordsForLevel } from './levels.js';
import { hashKey } from './hash.js';
import { localDay, queueEvents, shownToday, PENDING_KEY, SENT_KEY } from './events.js';
import { DAILY_MODEL_CALLS, callsToday, countCall } from './quota.js';
import { REVIEW_KEY, cleanReview, reviewCounts, introduce, nextReview, revealReview, rateReview, markFamiliar,
  beginInline, revealInline, finishInline } from './review.js';
import { policyWords, remaining, commitLearning, acknowledgeIntroduction, releaseIntroduction,
  futureBudgetDay, introductionOwner, activeReservations } from './learning.js';
import { PACKS_KEY, MAX_PACKS, cleanPacks, generatePack, languageCode, languageName, packWords } from './languages.js';
import { scopedStorage } from './scope.js';
import { catalogEntries, matchingEntries, englishAnchors, entryId } from './catalog.js';
import { selectWorkingSet } from './adaptive.js';
import { ENCOUNTERS_KEY, cleanEncounters, countEncounters } from './encounters.js';
import { PERSONAL_KEY, cleanPersonal, personalWords, suggestedMatches, addPersonal,
  exportPersonal, validForm, targetAliases } from './personal.js';

const store = chrome.storage.local;
const cache = createCache(chromeStorage);
const ALARM = 'updates';
const cooldown = new Map(); // hot copy; quotaState is the bounded restart-safe source
const cooldownKinds = new Map();
let permissionGeneration = 0; // permission events can arrive while the storage lock is held
let settingsGeneration = 0; // a popup change also invalidates a held dispatch before its write gets the lock
const CAPTURE_MENU = 'lang-weave-add-selection';
const CAPTURE_MS = 2 * 60 * 1000;
const captureDrafts = new Map(); // worker memory only; a restart invalidates every nonce
const completedCaptures = new Map(); // short-lived idempotent receipts; no draft/page metadata
const contentDocuments = new Map(); // tab -> top-frame document identity, never persisted
const CAPTURE_PATH = /\/(?:login|signin|sign-in|checkout|payment|billing|settings|account|medical|patient|portal|banking)(?:\/|$)/i;
const captureUrlSafe = (url) => {
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) && !CAPTURE_PATH.test(parsed.pathname); }
  catch { return false; }
};
// Catalog writes change reading policy, but they do not change the source page's
// consent, language, or document. Keep parallel confirmation pages usable.
const captureRevision = (ctx) => hashKey(JSON.stringify([ctx.settings, ctx.level, ctx.scope,
  ctx.language, ctx.origins, ctx.hasKey, ctx.captureEpoch, chrome.runtime.getManifest().version]));

const serial = () => {
  let chain = Promise.resolve();
  return (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
};
const modelCall = serial(); // one model call at a time
const locked = serial(); // storage read-modify-writes one at a time, or concurrent ones drop data
// When both queues are needed, enter modelCall before locked; reversing them can deadlock update reload.
// Model status is diagnostic; failure to save it must not hide a valid reading result.
async function saveModelStatus(status, epoch) {
  try {
    await locked(async () => {
      const current = await store.get(['keyEpoch', STATUS_KEY]);
      if ((current.keyEpoch || '') !== epoch) return;
      const previous = safeModelStatus(current[STATUS_KEY]);
      const retryAt = status.retryAt ?? (status.coolingDown ? retainedRetryAt(previous,
        status.category, Date.now(), status.retryAfterMs) : undefined);
      await store.set({ [STATUS_KEY]: safeModelStatus({ at: Date.now(), ...status, retryAt }) });
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

const ready = (async () => {
  // Content scripts run on every enabled site, so stored keys are kept out of their reach.
  if (store.setAccessLevel) await store.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const { settings } = await store.get('settings');
  if (settings?.apiKey) await store.set({ apiKey: settings.apiKey }); // 0.1 kept a pasted key in settings
  await store.set({ settings: cleanSettings(settings) });
  const { keyEpoch } = await store.get('keyEpoch');
  if (typeof keyEpoch !== 'string' || !keyEpoch) await store.set({ keyEpoch: crypto.randomUUID() });
})();

// What pages get. The revision changes whenever anything that affects swaps does, so stale replies are dropped.
async function context() {
  await ready;
  const data = await store.get(['settings', 'apiKey', 'epoch', PACKS_KEY, PERSONAL_KEY]);
  const saved = cleanSettings(data.settings);
  const packs = cleanPacks(data[PACKS_KEY]);
  if (saved.language !== 'es' && !packs[saved.language]) saved.language = 'es';
  const settings = { ...saved, newSitesEnabled: newSitesDefault(saved) };
  const level = resolveLevel(saved).effective;
  const pack = saved.language === 'es' ? null : packs[saved.language];
  const legacyAllWords = pack ? packWords(pack, 2) : wordsForLevel(2);
  const legacyWords = level <= 1 ? (pack ? packWords(pack, 1) : wordsForLevel(1)) : legacyAllWords;
  const personal = cleanPersonal(data[PERSONAL_KEY]);
  const activePersonal = personalWords(personal, saved.language, legacyAllWords);
  const personalAuto = activePersonal.filter(({ reviewOnly }) => !reviewOnly);
  const separate = activePersonal.filter(({ entry }) => !entry.linkedLegacy).map(({ entry }) => entry);
  const blockedLegacy = (word) => separate.some((entry) => {
    // An exact pack match is already teachable by the pack. Keep it available;
    // a separate personal ID survives if the generated pack is later removed.
    if (entry.source === word.en && entry.target === word.fr && entry.sense === word.en) return false;
    return targetAliases(entry.target, saved.language).some((target) =>
      targetAliases(word.fr, saved.language).includes(target)) ||
      englishAnchors({ en: entry.source }).some((anchor) => englishAnchors(word).includes(anchor));
  });
  const safeLegacyWords = legacyWords.filter((word) => !blockedLegacy(word));
  const autoWords = settings.gradual ? personalAuto.map(({ word }) => word) : [];
  const allWords = [...legacyAllWords, ...autoWords];
  const words = [...safeLegacyWords, ...autoWords];
  const scope = pack ? `${saved.language}:${pack.version}` : 'es';
  const hasKey = !!data.apiKey;
  const paused = false; // retained in the page config protocol; pause is settings.enabled
  const { origins = [] } = await chrome.permissions.getAll();
  const revision = hashKey(JSON.stringify([data.epoch || '', settings, level, scope,
    safeLegacyWords.map((word) => [word.fr, word.en]), personalAuto.map(({ entry }) =>
      [entry.id, entry.source, entry.target]), personal.unsupported === true,
    chrome.runtime.getManifest().version, hasKey, origins]));
  return { settings, level, revision, hasKey, paused, origins, captureEpoch: data.epoch || '',
    stage: 0, language: saved.language,
    scope, words, allWords, legacyWords, legacyAllWords, personal, activePersonal, personalAuto };
}

const activeOn = (ctx, url) => ctx.hasKey && !ctx.paused && siteEnabled(ctx.settings, url) && hasSiteAccess(url, ctx.origins);
const publicContext = ({ words, allWords, legacyWords, legacyAllWords, personal, captureEpoch,
  activePersonal, personalAuto, ...safe }) => safe;
const personalScope = (language) => scopedStorage(chromeStorage, `personal:${language}`);
const laterDay = (a, b) => a > b ? a : b; // ISO local dates or empty string

// The tab title is local-only safety context. Refresh it after every asynchronous
// boundary that could precede cache delivery or a primary/fallback fetch.
async function safePageTitle(msg, sender) {
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

async function liveGradualDocument(sender) {
  if (sender.frameId !== 0 || !sender.documentId ||
      sender.documentLifecycle && sender.documentLifecycle !== 'active') return false;
  try {
    const tab = await chrome.tabs.get(sender.tab?.id);
    return typeof tab?.url === 'string' && tab.url === sender.url;
  } catch { return false; }
}

async function broadcast(type = 'config') {
  const config = publicContext(await context());
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map((t) => chrome.tabs.sendMessage(t.id, { type, config })));
}

async function swaps(msg, sender) {
  const ctx = await context();
  const consentGeneration = permissionGeneration;
  const settingsAtStart = settingsGeneration;
  let policyDay = '';
  const stillSafe = async () => {
    const latest = await context();
    if (latest.revision !== ctx.revision || !activeOn(latest, sender.url) ||
        !(await safePageTitle(msg, sender)) ||
        (ctx.settings.gradual && !(await liveGradualDocument(sender)))) return false;
    // Permission and gradual settings events can occur during either tab lookup.
    // Keep these checks synchronous and last before a write, fetch or delivery.
    return permissionGeneration === consentGeneration &&
      (!ctx.settings.gradual || settingsGeneration === settingsAtStart) &&
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
    let counts;
    try {
      counts = await locked(async () => {
        if (!(await stillSafe())) return null;
        const scoped = scopedStorage(chromeStorage, ctx.scope);
        const ownScoped = personalScope(ctx.language);
        const [{ [ENCOUNTERS_KEY]: raw }, { [ENCOUNTERS_KEY]: ownRaw }] = await Promise.all([
          scoped.get([ENCOUNTERS_KEY]), ownScoped.get([ENCOUNTERS_KEY])]);
        if (!(await stillSafe())) return null;
        const ownIds = new Set(ctx.activePersonal.map(({ entry }) => entry.id));
        const aggregate = cleanEncounters(raw, allEntries.filter((entry) => !ownIds.has(entry.id))
          .map((entry) => entry.id), day);
        const ownAggregate = cleanEncounters(ownRaw, ctx.personal.entries.filter((entry) =>
          entry.language === ctx.language).map((entry) => entry.id), day);
        const before = JSON.stringify(aggregate), ownBefore = JSON.stringify(ownAggregate);
        countEncounters(aggregate, matches.filter((entry) => !ownIds.has(entry.id)).map((entry) => entry.id), day);
        countEncounters(ownAggregate, matches.filter((entry) => ownIds.has(entry.id)).map((entry) => entry.id), day);
        if (JSON.stringify(aggregate) !== before) await scoped.set({ [ENCOUNTERS_KEY]: aggregate });
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
      encounters: counts, sender, level: ctx.level, language: ctx.language, density: ctx.settings.density,
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
    try { output = await commitAdaptive(latest, raw, sender, stillSafe); }
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
      const keyData = await store.get(['apiKey', 'keyEpoch', QUOTA_STATE_KEY]);
      const { apiKey } = keyData;
      const keyEpoch = keyData.keyEpoch || '';
      requestEpoch = keyEpoch;
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
        density: ctx.settings.density, words: candidates, fetchImpl, cooldownKinds,
        shownToday: shown || await shownToday(scopedStorage(chromeStorage, ctx.scope)), cooldown, batch: misses.map((i) => ({ id: i.key, text: i.text })),
        onFailure: async (model, category, wait, startedAt) => {
          cooldownKinds.set(model, category === 'daily_quota' ? 'daily' : category === 'overloaded' ? 'overloaded'
            : category === 'rate_limit' ? 'short' : 'transient');
          await persistCooldown(model, category, wait, startedAt, keyEpoch);
        } });
    });
  } catch (e) {
    if (e?.stale) return { results: {}, stale: true };
    const latest = await context();
    if (latest.revision !== ctx.revision || !activeOn(latest, sender.url)) return { results: {}, stale: true };
    const category = e?.category || 'request_failed';
    const error = category === 'daily_quota' ? 'Daily model quota reached' : category === 'rate_limit'
      ? 'Model rate limit reached' : category === 'overloaded' ? 'Model service is busy'
      : category === 'local_budget' ? 'Daily local model-call budget reached'
      : category === 'storage_failed' ? 'Local reading storage failed' : 'Model request failed';
    await saveModelStatus({ category, retryAt: e?.retryAt,
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

// Events stay local and bounded. Sightings are not evidence of mastery; no automatic promotion.
async function record(msg, sender) {
  return locked(async () => {
    const ctx = await context();
    if (msg.revision !== ctx.revision || !activeOn(ctx, sender.url) || !['seen', 'flip', 'peek'].includes(msg.event) || typeof msg.word !== 'string') return { ok: false };
    const word = ctx.words.find((w) => exactTarget(w.fr, ctx.language) === exactTarget(msg.word, ctx.language));
    if (!word) return { ok: false };
    const personal = ctx.personalAuto.find(({ entry }) => entry.target === word.fr)?.entry;
    await queueEvents(personal ? personalScope(ctx.language) : scopedStorage(chromeStorage, ctx.scope),
      [{ word: personal?.id || word.fr, kind: msg.event }]);
    return { ok: true };
  });
}

async function clearCache() {
  const removed = await locked(async () => {
    await store.set({ epoch: crypto.randomUUID() });
    return cache.clear();
  });
  await broadcast('retry');
  return { ok: true, removed };
}

async function addLanguage(msg) {
  const code = languageCode(msg.code);
  if (!code) throw new Error('Enter a valid target-language code such as fr or ja');
  const before = await store.get(['settings', 'apiKey', PACKS_KEY]);
  const selected = cleanSettings(before.settings).language;
  if (!before.apiKey) throw new Error('Add your Gemini key first');
  if (cleanPacks(before[PACKS_KEY])[code]) throw new Error('This language is already available');
  if (Object.keys(cleanPacks(before[PACKS_KEY])).length >= MAX_PACKS) throw new Error(`Maximum of ${MAX_PACKS} generated languages reached`);
  const model = cleanSettings(before.settings).model;
  const pack = await modelCall(async () => {
    if (await callsToday(chromeStorage) >= DAILY_MODEL_CALLS) throw new Error('Daily model limit reached; try again tomorrow');
    return generatePack({ code, apiKey: before.apiKey, model,
      fetchImpl: async (...args) => { await countCall(chromeStorage); return fetch(...args); } });
  });
  await locked(async () => {
    const current = await store.get(['settings', 'apiKey', PACKS_KEY]);
    const packs = cleanPacks(current[PACKS_KEY]);
    if (packs[code] || Object.keys(packs).length >= MAX_PACKS) throw new Error('Languages changed while generating; try again');
    if (cleanSettings(current.settings).language !== selected) throw new Error('Selection changed while generating; try again');
    if (current.apiKey !== before.apiKey || cleanSettings(current.settings).model !== model) throw new Error('Model settings changed while generating; try again');
    await store.set({ epoch: crypto.randomUUID(), [PACKS_KEY]: { ...packs, [code]: pack },
      settings: cleanSettings({ ...current.settings, language: code }) });
  });
  await broadcast();
  return { ok: true, language: code };
}

async function removeLanguage(msg) {
  const code = languageCode(msg.code);
  if (!code) throw new Error('Choose a generated language to remove');
  await locked(async () => {
    const current = await store.get(['settings', PACKS_KEY]);
    const packs = cleanPacks(current[PACKS_KEY]);
    const pack = packs[code];
    if (!pack) throw new Error('This language is not available');
    const settings = cleanSettings(current.settings);
    if (settings.language !== code) throw new Error('The selected language changed; refresh and try again');
    delete packs[code];
    settings.language = 'es';
    await store.set({ epoch: crypto.randomUUID(), [PACKS_KEY]: packs, settings });
    const all = await store.get(null);
    const prefix = `lang:${code}:${pack.version}:`;
    const keys = Object.keys(all).filter((key) => key.startsWith(prefix));
    if (keys.length) await store.remove(keys);
  });
  await broadcast();
  return { ok: true };
}

// msg.settings: a partial patch; msg.siteOverride: { host, enabled: true | false | null (reset) }; msg.apiKey.
async function save(msg) {
  settingsGeneration++;
  await locked(async () => {
    const saved = await store.get(['settings', 'apiKey']);
    if (msg.settings && typeof msg.settings === 'object' && Object.hasOwn(msg.settings, 'language') &&
        msg.settings.language !== 'es' && languageCode(msg.settings.language) !== msg.settings.language) {
      throw new Error('Invalid language code');
    }
    const merged = { ...saved.settings, ...msg.settings };
    if (msg.siteOverride && typeof msg.siteOverride.host === 'string') {
      merged.siteOverrides = { ...saved.settings?.siteOverrides };
      if (msg.siteOverride.enabled === null) delete merged.siteOverrides[msg.siteOverride.host];
      else merged.siteOverrides[msg.siteOverride.host] = msg.siteOverride.enabled;
    }
    const next = cleanSettings(merged);
    if (next.language !== 'es' && !cleanPacks((await store.get(PACKS_KEY))[PACKS_KEY])[next.language]) {
      if (msg.settings && Object.hasOwn(msg.settings, 'language')) throw new Error('Choose a generated language pack');
      next.language = 'es';
    }
    // A settings round trip must not revive a result from its earlier revision.
    const patch = { settings: next };
    if (typeof msg.apiKey === 'string') {
      if (msg.apiKey.length > 500) throw new Error('Key is too long');
      patch.apiKey = msg.apiKey.trim();
    }
    if (JSON.stringify(next) !== JSON.stringify(cleanSettings(saved.settings)) ||
        (Object.hasOwn(patch, 'apiKey') && patch.apiKey !== saved.apiKey)) {
      patch.epoch = crypto.randomUUID();
      if (Object.hasOwn(patch, 'apiKey') && patch.apiKey !== saved.apiKey) {
        patch.keyEpoch = crypto.randomUUID();
        patch[QUOTA_STATE_KEY] = { keyEpoch: patch.keyEpoch, cooldowns: {} };
        patch[STATUS_KEY] = null;
        cooldown.clear();
        cooldownKinds.clear();
      }
      await store.set(patch);
    }
  });
  await broadcast();
  return { ok: true };
}

async function status() {
  const config = await context();
  const data = await store.get(['apiKey', 'keyEpoch', STATUS_KEY, QUOTA_STATE_KEY, PACKS_KEY]);
  const { state } = await reviewState(config);
  const quota = cleanQuotaState(data[QUOTA_STATE_KEY], data.keyEpoch);
  let modelStatus = safeModelStatus(data[STATUS_KEY]);
  if (modelStatus && ['daily_quota', 'rate_limit', 'overloaded'].includes(modelStatus.category)) {
    const kind = modelStatus.category === 'daily_quota' ? 'daily'
      : modelStatus.category === 'overloaded' ? 'overloaded' : 'short';
    if (!Object.values(quota.cooldowns).some((entry) => entry.kind === kind)) modelStatus = null;
  }
  if (modelStatus?.category === 'local_budget' && await callsToday(chromeStorage) < DAILY_MODEL_CALLS) modelStatus = null;
  if (['request_failed', 'storage_failed'].includes(modelStatus?.category) &&
      (!Number.isFinite(modelStatus.at) || modelStatus.at > Date.now() || Date.now() - modelStatus.at > 3600000)) modelStatus = null;
  return { config: publicContext(config), words: config.words.length,
    languages: [{ code: 'es', name: 'Spanish', experimental: false }, ...Object.keys(cleanPacks(data[PACKS_KEY])).map((code) => ({ code, name: languageName(code), experimental: true }))],
    pastedKey: !!data.apiKey, modelStatus,
    budgetWarning: laterDay(futureBudgetDay(state.learning, localDay()),
      futureBudgetDay(personalReview(config).state.learning, localDay())),
    review: await reviewStatus(config),
    update: await checkUpdate() };
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

async function reviewState(ctx) {
  ctx ||= await context();
  const scoped = scopedStorage(chromeStorage, ctx.scope);
  const { [REVIEW_KEY]: raw } = await scoped.get([REVIEW_KEY]);
  return { state: cleanReview(raw, ctx.legacyAllWords), words: ctx.legacyWords,
    scoped, scope: ctx.scope, language: ctx.language };
}

function personalReview(ctx) {
  const words = ctx.activePersonal.filter(({ entry }) => !entry.linkedLegacy)
    .map(({ entry }) => ({ fr: entry.id, en: entry.source, hint: '' }));
  const state = ctx.personal.history[ctx.language] ||= cleanReview(null, words);
  return { state, words, byId: new Map(ctx.activePersonal.map(({ entry }) => [entry.id, entry])) };
}

function personalForTarget(ctx, target) {
  return ctx.personalAuto.find(({ entry }) => entry.target === target)?.entry;
}

function spentElsewhere(state, day, revision, now) {
  return state.learning.day > day ? Number.MAX_SAFE_INTEGER :
    (state.learning.day === day ? state.learning.count : 0) +
    activeReservations(state.learning, day, now, revision).length;
}

function combinedLearning(legacy, personal, ctx, day, now) {
  const a = legacy.learning, b = personal.learning;
  const maxDay = a.day > b.day ? a.day : b.day;
  const ids = new Map(ctx.personalAuto.map(({ entry }) => [entry.id, entry.target]));
  return { day: maxDay, count: (a.day === maxDay ? a.count : 0) + (b.day === maxDay ? b.count : 0),
    pending: [...a.pending, ...b.pending.filter((p) => ids.has(p.word))
      .map((p) => ({ ...p, word: ids.get(p.word) }))] };
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

function capturePageSender(sender) {
  try {
    const url = new URL(sender.url);
    const own = new URL(chrome.runtime.getURL('src/capture.html'));
    return url.protocol === 'chrome-extension:' && url.host === own.host &&
      url.pathname === own.pathname;
  } catch { return false; }
}

function rememberDocument(sender) {
  if (sender.frameId === 0 && sender.documentId && Number.isSafeInteger(sender.tab?.id) &&
      /^https?:\/\//.test(sender.url || '')) {
    contentDocuments.set(sender.tab.id, { documentId: sender.documentId, url: sender.url });
    if (contentDocuments.size > 100) contentDocuments.delete(contentDocuments.keys().next().value);
  }
}

async function openCapture(draft) {
  for (const [nonce, prior] of captureDrafts) if (Date.now() - prior.createdAt > CAPTURE_MS)
    captureDrafts.delete(nonce);
  if (captureDrafts.size >= 20) captureDrafts.delete(captureDrafts.keys().next().value);
  captureDrafts.set(draft.nonce, draft);
  await chrome.tabs.create({ url: chrome.runtime.getURL(`src/capture.html?nonce=${encodeURIComponent(draft.nonce)}`) });
}

async function captureMenuClicked(info, tab) {
  if (info?.menuItemId !== CAPTURE_MENU) return;
  const nonce = crypto.randomUUID();
  const draft = { nonce, createdAt: Date.now(), error: '', selectedText: '' };
  const fail = async (message) => { draft.error = message; await openCapture(draft); };
  const selected = validForm(info.selectionText, { selection: true });
  if (!selected || info.editable || info.linkUrl || info.frameId !== 0 ||
      !Number.isSafeInteger(tab?.id) || !captureUrlSafe(info.pageUrl)) {
    await fail('Select a short word or phrase from readable page text on an enabled site.'); return;
  }
  const document = contentDocuments.get(tab.id);
  if (!document) { await fail('This page is not ready for capture. Reload it after enabling Lang Weave.'); return; }
  const settingsAtStart = settingsGeneration, permissionAtStart = permissionGeneration;
  const ctx = await context();
  if (!siteEnabled(ctx.settings, info.pageUrl) || !hasSiteAccess(info.pageUrl, ctx.origins) ||
      isZeroFrench(tab.title || '')) {
    await fail('Lang Weave is off or unavailable on this page. Check the site setting and permission.'); return;
  }
  try {
    const current = await chrome.tabs.get(tab.id);
    if (current?.url !== info.pageUrl || isZeroFrench(current.title || '') ||
        contentDocuments.get(tab.id)?.documentId !== document.documentId) throw new Error('Page changed');
    const response = await chrome.tabs.sendMessage(tab.id,
      { type: 'personalCaptureChallenge', text: selected, nonce },
      { documentId: document.documentId, frameId: 0 });
    if (response?.ok !== true || response.text !== selected) throw new Error('Selection unavailable');
    const latest = await context();
    const finalTab = await chrome.tabs.get(tab.id);
    if (captureRevision(latest) !== captureRevision(ctx) || finalTab?.url !== info.pageUrl ||
        isZeroFrench(finalTab.title || '') || contentDocuments.get(tab.id)?.documentId !== document.documentId ||
        settingsAtStart !== settingsGeneration || permissionAtStart !== permissionGeneration)
      throw new Error('Page or settings changed');
    Object.assign(draft, { selectedText: selected, tabId: tab.id, documentId: document.documentId,
      url: info.pageUrl, language: ctx.language, revision: captureRevision(ctx),
      settingsGeneration: settingsAtStart, permissionGeneration: permissionAtStart });
  } catch {
    draft.error = 'The selection changed, or this document is no longer available. Select it again on the page.';
  }
  await openCapture(draft);
}

async function captureIsCurrent(draft) {
  if (!draft?.tabId || !draft.documentId || Date.now() - draft.createdAt > CAPTURE_MS || draft.error) return null;
  const settingEpoch = settingsGeneration, permissionEpoch = permissionGeneration;
  if (settingEpoch !== draft.settingsGeneration || permissionEpoch !== draft.permissionGeneration) return null;
  const ctx = await context();
  if (ctx.language !== draft.language || captureRevision(ctx) !== draft.revision ||
      !siteEnabled(ctx.settings, draft.url) || !hasSiteAccess(draft.url, ctx.origins) ||
      !captureUrlSafe(draft.url) ||
      contentDocuments.get(draft.tabId)?.documentId !== draft.documentId) return null;
  try {
    const response = await chrome.tabs.sendMessage(draft.tabId, { type: 'personalCaptureAlive' },
      { documentId: draft.documentId, frameId: 0 });
    if (response?.ok !== true) return null;
    const tab = await chrome.tabs.get(draft.tabId);
    // Keep epoch comparisons synchronous and last after the final asynchronous tab lookup.
    if (tab?.url !== draft.url || isZeroFrench(tab.title || '') ||
        contentDocuments.get(draft.tabId)?.documentId !== draft.documentId ||
        settingsGeneration !== settingEpoch || permissionGeneration !== permissionEpoch) return null;
    return ctx;
  } catch { return null; }
}

async function captureDraft(msg) {
  const draft = captureDrafts.get(msg.nonce);
  if (!draft || Date.now() - draft.createdAt > CAPTURE_MS)
    return { error: 'Capture expired. Select the word again on the page.' };
  if (draft.error) return { selectedText: draft.selectedText, error: draft.error };
  const ctx = await captureIsCurrent(draft);
  if (!ctx) return { error: 'The source page, language or site permission changed. Select the word again.' };
  const matches = [...suggestedMatches(draft.selectedText, 'en-to-target', ctx.language,
    ctx.legacyAllWords, ctx.personal).map((match) => ({ ...match, direction: 'en-to-target' })),
    ...suggestedMatches(draft.selectedText, 'target-to-en', ctx.language,
      ctx.legacyAllWords, ctx.personal).map((match) => ({ ...match, direction: 'target-to-en' }))].slice(0, 24);
  const personalStatus = new Map(ctx.activePersonal.map(({ entry, reviewOnly }) => [entry.id, reviewOnly]));
  return { selectedText: draft.selectedText, language: ctx.language,
    matches: matches.map((match) => ({ ...match,
      ...(match.id ? { reviewOnly: personalStatus.get(match.id) === true,
        reason: 'shared spelling or phrase needs explicit review' } : {}) })) };
}

function captureKeepAlive(msg) {
  const draft = captureDrafts.get(msg.nonce);
  return { ok: !!draft && !draft.error && Date.now() - draft.createdAt <= CAPTURE_MS };
}

async function captureSave(msg) {
  return locked(async () => {
    const completed = completedCaptures.get(msg.nonce);
    if (completed && Date.now() - completed.at <= CAPTURE_MS) return completed.result;
    const draft = captureDrafts.get(msg.nonce);
    const ctx = await captureIsCurrent(draft);
    if (!ctx) return { error: 'Capture expired or the source page changed. Select the word again.' };
    const source = validForm(msg.source), target = validForm(msg.target);
    if (!source || !target || !['en-to-target', 'target-to-en'].includes(msg.direction) ||
        (msg.direction === 'en-to-target' ? source : target) !== draft.selectedText)
      return { error: 'The selected form must match the confirmed source or target exactly.' };
    const exactKnown = ctx.language === 'es' && (!msg.sense || msg.sense === source)
      ? ctx.legacyAllWords.find((word) => word.fr === target && word.en === source) : null;
    const samePackMeaning = ctx.legacyAllWords.some((word) => word.fr === target && word.en === source &&
      (!msg.sense || msg.sense === word.en));
    const collidesWithPack = ctx.legacyAllWords.some((word) =>
      targetAliases(word.fr, ctx.language).some((form) => targetAliases(target, ctx.language).includes(form)) ||
      englishAnchors(word).some((anchor) => englishAnchors({ en: source }).includes(anchor)));
    if (collidesWithPack && !samePackMeaning && msg.distinct !== true)
      return { error: 'This spelling already has another meaning in the current pack. Confirm “distinct meaning” to save it separately.' };
    let result;
    try {
      result = addPersonal(ctx.personal, { ...msg,
        provenance: exactKnown ? 'bundled-suggestion' : 'manual',
        linkedLegacy: exactKnown ? entryId(ctx.scope, exactKnown) : undefined }, ctx.language);
    } catch (error) { return { error: error.message }; }
    if (!result.duplicate) {
      try { await store.set({ [PERSONAL_KEY]: ctx.personal }); }
      catch { return { error: 'Personal vocabulary could not be saved. Retry or cancel.' }; }
    }
    captureDrafts.delete(msg.nonce);
    const { reviewOnly } = personalWords(ctx.personal, ctx.language, ctx.legacyAllWords)
      .find(({ entry }) => entry.id === result.entry.id) || { reviewOnly: true };
    const receipt = { ok: true, id: result.entry.id, duplicate: result.duplicate,
      archived: result.entry.archived, reviewOnly };
    completedCaptures.set(msg.nonce, { at: Date.now(), result: receipt });
    if (completedCaptures.size > 20) completedCaptures.delete(completedCaptures.keys().next().value);
    if (ctx.revision !== (await context()).revision) void broadcast('retry').catch(() => {});
    return receipt;
  });
}

async function personalList() {
  const ctx = await context();
  if (ctx.personal.unsupported) return { error: 'Personal vocabulary uses a newer format. Update Lang Weave.' };
  const status = new Map(personalWords(ctx.personal, ctx.language, ctx.legacyAllWords)
    .map(({ entry, reviewOnly }) => [entry.id, reviewOnly]));
  return { entries: ctx.personal.entries.map((entry) => ({ id: entry.id, language: entry.language,
    en: entry.source, fr: entry.target, target: entry.target, sense: entry.sense,
    archived: entry.archived, reviewOnly: entry.archived || entry.language !== ctx.language || status.get(entry.id),
    reason: entry.archived ? 'archived' : entry.language !== ctx.language ? 'select this language to use it' :
      entry.linkedLegacy ? 'linked to an existing bundled card' :
      status.get(entry.id) ? 'shared spelling or phrase needs explicit review' : '' })) };
}

async function personalArchive(msg) {
  return locked(async () => {
    const ctx = await context();
    if (ctx.personal.unsupported) return { error: 'Personal vocabulary uses a newer format. Update Lang Weave.' };
    const entry = ctx.personal.entries.find((item) => item.id === msg.id);
    if (!entry || typeof msg.archived !== 'boolean') return { error: 'Entry unavailable.' };
    if (entry.archived !== msg.archived) {
      entry.archived = msg.archived;
      ctx.personal.revision++;
      await store.set({ [PERSONAL_KEY]: ctx.personal });
      if (ctx.revision !== (await context()).revision) void broadcast('retry').catch(() => {});
    }
    return { ok: true };
  });
}

async function personalIntroduce(msg) {
  return locked(async () => {
    const ctx = await context();
    if (ctx.personal.unsupported) return { error: 'Personal vocabulary uses a newer format. Update Lang Weave.' };
    const entry = ctx.personal.entries.find((item) => item.id === msg.id && !item.archived);
    if (!entry) return { error: 'Entry unavailable.' };
    if (entry.linkedLegacy) {
      if (ctx.language !== entry.language) return { error: 'Select this entry’s language first.' };
      const legacy = await reviewState(ctx);
      const word = legacy.words.find((item) => entryId(ctx.scope, item) === entry.linkedLegacy);
      if (!word) return { error: 'Linked bundled card is not available at this level.' };
      const added = introduce(legacy.state, [word], Date.now(), 1);
      if (added) await legacy.scoped.set({ [REVIEW_KEY]: legacy.state });
      return { ok: true, added: !!added };
    }
    const review = personalReview({ ...ctx, language: entry.language });
    const added = introduce(review.state, [{ fr: entry.id, en: entry.source }], Date.now(), 1);
    if (added) await store.set({ [PERSONAL_KEY]: ctx.personal });
    return { ok: true, added: !!added };
  });
}

async function personalExportResult() {
  const { [PERSONAL_KEY]: raw } = await store.get(PERSONAL_KEY);
  if (cleanPersonal(raw).unsupported) return { error: 'Personal vocabulary uses a newer format. Update Lang Weave.' };
  const personal = cleanPersonal(raw);
  const feedback = {};
  for (const language of new Set(personal.entries.map((entry) => entry.language))) {
    const own = await personalScope(language).get([ENCOUNTERS_KEY, PENDING_KEY, SENT_KEY]);
    feedback[language] = { encounters: own[ENCOUNTERS_KEY] || null,
      events: own[PENDING_KEY] || [], shown: own[SENT_KEY] || null };
  }
  return { json: JSON.stringify({ ...exportPersonal(personal), feedback }, null, 2) };
}

// A git update can replace this folder on disk, but Chrome keeps
// running the loaded copy. Compare the manifest on disk with the running one and reload from disk by ourselves,
// once per disk version, after any model call in flight and pending storage writes. If the running copy still
// differs after that (or reload fails), mark the toolbar icon so the user can reload by hand.
export const RELOADED_KEY = 'reloadedFor';
async function checkUpdate() {
  try {
    const disk = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json();
    const waiting = disk.version && disk.version !== chrome.runtime.getManifest().version ? String(disk.version) : '';
    if (waiting && (await store.get(RELOADED_KEY))[RELOADED_KEY] !== waiting) {
      await store.set({ [RELOADED_KEY]: waiting });
      try {
        await modelCall(() => locked(() => chrome.runtime.reload()));
        return waiting; // normally not reached: the worker is gone
      } catch { /* fall back to the badge */ }
    }
    await chrome.action.setBadgeText({ text: waiting ? 'NEW' : '' });
    return waiting;
  } catch {
    return '';
  }
}

// Pages may only ask for config, swaps and events; everything else is popup-only.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || sender.id !== chrome.runtime.id) return false;
  const popup = sender.url === chrome.runtime.getURL('src/popup.html');
  const review = sender.url === chrome.runtime.getURL('src/review.html');
  const capture = capturePageSender(sender);
  const page = sender.tab && /^https?:\/\//.test(sender.url || '');
  if (page && ['config', 'captureReady'].includes(msg.type)) rememberDocument(sender);
  const handlers = {
    config: async () => publicContext(await context()),
    captureReady: async () => ({ ok: true }),
    swaps: () => swaps(msg, sender),
    event: () => record(msg, sender),
    status, clearCache,
    recoverBudget: () => recoverBudget(msg),
    save: () => save(msg),
    addLanguage: () => addLanguage(msg),
    removeLanguage: () => removeLanguage(msg),
    reviewStatus: () => reviewStatus(), reviewIntroduce, reviewNext,
    reviewReveal: () => reviewReveal(msg),
    reviewRate: () => reviewRate(msg),
    reviewKnown: () => reviewKnown(msg),
    inlineBegin: () => inlineAction(msg, sender),
    inlineReveal: () => inlineAction(msg, sender),
    inlineRate: () => inlineAction(msg, sender),
    introAck: () => introduction(msg, sender),
    introRelease: () => introduction(msg, sender),
    introRenew: () => introduction(msg, sender),
    captureDraft: () => captureDraft(msg), captureKeepAlive: () => captureKeepAlive(msg),
    captureSave: () => captureSave(msg),
    captureCancel: () => ({ ok: captureDrafts.delete(msg.nonce) }),
    personalList, personalArchive: () => personalArchive(msg),
    personalIntroduce: () => personalIntroduce(msg), personalExport: personalExportResult,
  };
  const reviews = ['reviewStatus', 'reviewIntroduce', 'reviewNext', 'reviewReveal', 'reviewRate', 'reviewKnown'];
  if (!handlers[msg.type] || !(popup && ['status', 'clearCache', 'save', 'addLanguage', 'removeLanguage', 'reviewStatus', 'recoverBudget'].includes(msg.type)) &&
      !(review && reviews.includes(msg.type)) &&
      !(capture && ['captureDraft', 'captureKeepAlive', 'captureSave', 'captureCancel', 'personalList',
        'personalArchive', 'personalIntroduce', 'personalExport'].includes(msg.type)) &&
      !(page && ['config', 'captureReady', 'swaps', 'event', 'inlineBegin', 'inlineReveal', 'inlineRate', 'introAck', 'introRelease', 'introRenew'].includes(msg.type))) return false;
  ready.then(handlers[msg.type]).then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true;
});

// Granted origins (all sites, or one at a time from the popup) decide where the content script is injected.
// X is in the manifest, so it works without a grant.
let registrations = Promise.resolve();
function registerSites() {
  const p = registrations.then(async () => {
    const { origins = [] } = await chrome.permissions.getAll();
    const matches = [...new Set(origins.flatMap((o) => o === '<all_urls>' ? ['http://*/*', 'https://*/*'] : [o]))]
      .filter((o) => /^(https?|\*):\/\//.test(o) && !o.includes('googleapis.com'));
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] });
    if (!matches.length) {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: ['weave-sites'] });
      return;
    }
    const script = { id: 'weave-sites', matches, js: ['src/content-loader.js'], css: ['src/content.css'], runAt: 'document_idle',
      excludeMatches: ['https://x.com/*', 'https://twitter.com/*'] };
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  });
  registrations = p.catch(() => {});
  return p;
}
const permissionsChanged = () => {
  // The event is observable before its epoch write can acquire a held dispatch lock.
  permissionGeneration++;
  return locked(async () => {
    // The final origin list can equal an earlier one after a remove/regrant round trip.
    await store.set({ epoch: crypto.randomUUID() });
  }).catch(() => {}).then(() => registerSites()).then(() => broadcast('retry')).catch(() => {});
};
chrome.permissions.onAdded.addListener(permissionsChanged);
chrome.permissions.onRemoved.addListener(permissionsChanged);

// create() replaces an alarm of the same name, so calling it on both events is safe. Startup matters
// because disabling and re-enabling the extension clears alarms without firing onInstalled.
function arm() {
  chrome.alarms.create(ALARM, { periodInMinutes: 30 });
  void checkUpdate();
}
chrome.runtime.onInstalled.addListener(arm);
chrome.runtime.onStartup.addListener(arm);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== ALARM) return;
  void checkUpdate();
});
function registerCaptureMenu() {
  if (!chrome.contextMenus?.create) return;
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) { console.warn('Lang Weave selection menu unavailable:', chrome.runtime.lastError.message); return; }
    chrome.contextMenus.create({ id: CAPTURE_MENU, title: 'Add to Lang Weave',
      contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] }, () => {
      if (chrome.runtime.lastError) console.warn('Lang Weave selection menu unavailable:', chrome.runtime.lastError.message);
    });
  });
}
const captureMenuListener = (info, tab) => { void captureMenuClicked(info, tab).catch(() => {}); };
chrome.contextMenus?.onClicked?.addListener(captureMenuListener);
chrome.tabs.onRemoved?.addListener((tabId) => {
  contentDocuments.delete(tabId);
  for (const [nonce, draft] of captureDrafts) if (draft.tabId === tabId) captureDrafts.delete(nonce);
});
chrome.runtime.onInstalled.addListener(registerCaptureMenu);
chrome.runtime.onStartup.addListener(registerCaptureMenu);
void ready.then(registerSites).catch(() => {});

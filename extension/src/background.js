// Standalone Spanish service worker: site access, one model call at a time and local reading events.
// Keys stay here; pages only get a config without them.
import { createCache, chromeStorage } from './cache.js';
import { requestSwaps } from './engine.js';
import { cleanSettings, newSitesDefault, siteEnabled, hasSiteAccess } from './settings.js';
import { resolveLevel, exactTarget, isZeroFrench, wordCount, wordsForLevel } from './levels.js';
import { hashKey } from './hash.js';
import { queueEvents, shownToday } from './events.js';
import { DAILY_MODEL_CALLS, callsToday, countCall } from './quota.js';
import { REVIEW_KEY, cleanReview, reviewCounts, introduce, nextReview, revealReview, rateReview } from './review.js';
import { PACKS_KEY, MAX_PACKS, cleanPacks, generatePack, languageCode, languageName, packWords } from './languages.js';
import { scopedStorage } from './scope.js';

const store = chrome.storage.local;
const cache = createCache(chromeStorage);
const ALARM = 'updates';
const cooldown = new Map(); // model -> rate-limit cooldown end; worker memory is enough

const serial = () => {
  let chain = Promise.resolve();
  return (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
};
const modelCall = serial(); // one model call at a time
const locked = serial(); // storage read-modify-writes one at a time, or concurrent ones drop data
// When both queues are needed, enter modelCall before locked; reversing them can deadlock update reload.

const ready = (async () => {
  // Content scripts run on every enabled site, so stored keys are kept out of their reach.
  if (store.setAccessLevel) await store.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const { settings } = await store.get('settings');
  if (settings?.apiKey) await store.set({ apiKey: settings.apiKey }); // 0.1 kept a pasted key in settings
  await store.set({ settings: cleanSettings(settings) });
})();

// What pages get. The revision changes whenever anything that affects swaps does, so stale replies are dropped.
async function context() {
  await ready;
  const data = await store.get(['settings', 'apiKey', 'epoch', PACKS_KEY]);
  const saved = cleanSettings(data.settings);
  const packs = cleanPacks(data[PACKS_KEY]);
  if (saved.language !== 'es' && !packs[saved.language]) saved.language = 'es';
  const settings = { ...saved, newSitesEnabled: newSitesDefault(saved) };
  const level = resolveLevel(saved).effective;
  const pack = saved.language === 'es' ? null : packs[saved.language];
  const allWords = pack ? packWords(pack, 2) : wordsForLevel(2);
  const words = level <= 1 ? (pack ? packWords(pack, 1) : wordsForLevel(1)) : allWords;
  const scope = pack ? `${saved.language}:${pack.version}` : 'es';
  const hasKey = !!data.apiKey;
  const paused = false; // retained in the page config protocol; pause is settings.enabled
  const { origins = [] } = await chrome.permissions.getAll();
  const revision = hashKey(JSON.stringify([data.epoch || '', settings, level, scope, chrome.runtime.getManifest().version, hasKey, origins]));
  return { settings, level, revision, hasKey, paused, origins, stage: 0, language: saved.language, scope, words, allWords };
}

const activeOn = (ctx, url) => ctx.hasKey && !ctx.paused && siteEnabled(ctx.settings, url) && hasSiteAccess(url, ctx.origins);

async function broadcast(type = 'config') {
  const config = await context();
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map((t) => chrome.tabs.sendMessage(t.id, { type, config })));
}

async function swaps(msg, sender) {
  const ctx = await context();
  if (msg.revision !== ctx.revision || !activeOn(ctx, sender.url)) return { results: {}, stale: true };
  if (!Array.isArray(msg.items) || msg.items.length > 8) throw new Error('Invalid text batch');
  const items = msg.items.filter((i) => i && typeof i.text === 'string' && i.text.length <= 2000 &&
    wordCount(i.text) >= 6 && !isZeroFrench(i.text) && i.key === `${ctx.revision}:${hashKey(i.text)}`);
  const results = await cache.getMany(items.map((i) => i.key));
  const misses = items.filter((i) => !(i.key in results));
  if (!misses.length) {
    const latest = await context();
    return latest.revision === ctx.revision && activeOn(latest, sender.url)
      ? { results } : { results: {}, stale: true };
  }
  try {
    const fresh = await modelCall(async () => {
      if ((await context()).revision !== ctx.revision) return null;
      if (await callsToday(chromeStorage) >= DAILY_MODEL_CALLS) throw new Error(`Daily limit of ${DAILY_MODEL_CALLS} model calls reached; try again tomorrow`);
      const { apiKey } = await store.get('apiKey');
      const fetchImpl = async (...args) => {
        // Storage and review reads above can yield while a site is turned off. Dispatch under
        // the same lock as settings writes, and check again after counting the model call.
        const { response } = await locked(async () => {
          const current = await context();
          if (current.revision !== ctx.revision || !activeOn(current, sender.url)) {
            throw Object.assign(new Error('Page context changed before model request'), { stale: true });
          }
          // Counting can yield to a browser permission change; keep the second check.
          await countCall(chromeStorage);
          const final = await context();
          if (final.revision !== ctx.revision || !activeOn(final, sender.url)) {
            throw Object.assign(new Error('Page context changed before model request'), { stale: true });
          }
          return { response: fetch(...args) };
        });
        return response;
      };
      return requestSwaps({ apiKey, model: ctx.settings.model, level: ctx.level, language: ctx.language,
        words: ctx.words.map((w) => ({ ...w, status: 'active' })), fetchImpl,
        shownToday: await shownToday(scopedStorage(chromeStorage, ctx.scope)), cooldown, batch: misses.map((i) => ({ id: i.key, text: i.text })) });
    });
    return await locked(async () => {
      if (!fresh || (await context()).revision !== ctx.revision) return { results: {}, stale: true };
      await cache.setMany(fresh.results);
      await store.set({ modelStatus: { at: Date.now(), error: '', model: fresh.model } });
      return { results: { ...results, ...fresh.results } };
    });
  } catch (e) {
    if (e?.stale) return { results: {}, stale: true };
    const latest = await context();
    if (latest.revision !== ctx.revision || !activeOn(latest, sender.url)) return { results: {}, stale: true };
    const error = e?.message || 'Model request failed';
    await store.set({ modelStatus: { at: Date.now(), error } });
    return { results, error, retryAfterMs: e?.retryAfterMs };
  }
}

// Events stay local and bounded. Sightings are not evidence of mastery; no automatic promotion.
async function record(msg, sender) {
  return locked(async () => {
    const ctx = await context();
    if (msg.revision !== ctx.revision || !activeOn(ctx, sender.url) || !['seen', 'flip', 'peek'].includes(msg.event) || typeof msg.word !== 'string') return { ok: false };
    const word = ctx.words.find((w) => exactTarget(w.fr, ctx.language) === exactTarget(msg.word, ctx.language));
    if (!word) return { ok: false };
    await queueEvents(scopedStorage(chromeStorage, ctx.scope), [{ word: word.fr, kind: msg.event }]);
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
      await store.set(patch);
    }
  });
  await broadcast();
  return { ok: true };
}

async function status() {
  const config = await context();
  const data = await store.get(['apiKey', 'modelStatus', PACKS_KEY]);
  return { config: { ...config, words: undefined, allWords: undefined }, words: config.words.length,
    languages: [{ code: 'es', name: 'Spanish', experimental: false }, ...Object.keys(cleanPacks(data[PACKS_KEY])).map((code) => ({ code, name: languageName(code), experimental: true }))],
    pastedKey: !!data.apiKey, modelStatus: data.modelStatus || null,
    review: await reviewStatus(config),
    update: await checkUpdate() };
}

async function reviewState(ctx) {
  ctx ||= await context();
  const scoped = scopedStorage(chromeStorage, ctx.scope);
  const { [REVIEW_KEY]: raw } = await scoped.get([REVIEW_KEY]);
  return { state: cleanReview(raw, ctx.allWords), words: ctx.words, scoped, scope: ctx.scope, language: ctx.language };
}

async function reviewStatus(ctx) {
  const { state, words, language } = await reviewState(ctx);
  return { ...reviewCounts(state, words, Date.now()), language: languageName(language) };
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
    const { state, words, scoped, language } = await reviewState();
    const card = nextReview(state, words, Date.now());
    await scoped.set({ [REVIEW_KEY]: state });
    return { card, ...reviewCounts(state, words, Date.now()), language: languageName(language) };
  });
}

async function reviewReveal(msg) {
  return locked(async () => {
    const { state, words, scoped } = await reviewState();
    const answer = revealReview(state, words, msg.ticket, Date.now());
    if (!answer) return { error: 'This review card is no longer available. Reload the queue.' };
    await scoped.set({ [REVIEW_KEY]: state });
    return { answer };
  });
}

async function reviewRate(msg) {
  return locked(async () => {
    const { state, words, scoped } = await reviewState();
    const result = state.current && words.some(({ fr }) => fr === state.current.word)
      ? rateReview(state, msg.ticket, msg.rating, Date.now()) : null;
    if (!result) return { error: 'This rating is stale or the answer has not been revealed.' };
    await scoped.set({ [REVIEW_KEY]: state });
    return { ok: true, ...result };
  });
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
  const page = sender.tab && /^https?:\/\//.test(sender.url || '');
  const handlers = {
    config: context,
    swaps: () => swaps(msg, sender),
    event: () => record(msg, sender),
    status, clearCache,
    save: () => save(msg),
    addLanguage: () => addLanguage(msg),
    removeLanguage: () => removeLanguage(msg),
    reviewStatus: () => reviewStatus(), reviewIntroduce, reviewNext,
    reviewReveal: () => reviewReveal(msg),
    reviewRate: () => reviewRate(msg),
  };
  const reviews = ['reviewStatus', 'reviewIntroduce', 'reviewNext', 'reviewReveal', 'reviewRate'];
  if (!handlers[msg.type] || !(popup && ['status', 'clearCache', 'save', 'addLanguage', 'removeLanguage', 'reviewStatus'].includes(msg.type)) &&
      !(review && reviews.includes(msg.type)) &&
      !(page && ['config', 'swaps', 'event'].includes(msg.type))) return false;
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
const permissionsChanged = () => locked(async () => {
  // The final origin list can equal an earlier one after a remove/regrant round trip.
  await store.set({ epoch: crypto.randomUUID() });
}).catch(() => {}).then(() => registerSites()).then(() => broadcast('retry')).catch(() => {});
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
void ready.then(registerSites).catch(() => {});

// Popup handlers: settings, key, language packs, cache and status.
import { chromeStorage } from './cache.js';
import { cleanQuotaState, safeModelStatus, STATUS_KEY, QUOTA_STATE_KEY } from './quota-status.js';
import { cleanSettings } from './settings.js';
import { localDay } from './events.js';
import { DAILY_MODEL_CALLS, callsToday, countCall } from './quota.js';
import { futureBudgetDay } from './learning.js';
import { PACKS_KEY, MAX_PACKS, cleanPacks, generatePack, languageCode, languageName } from './languages.js';
import { publicContext, laterDay } from './worker-context.js';
import { personalReview } from './review-state.js';

export function createSettingsHandlers({ store, cache, locked, modelCall, worker, cooldown, cooldownKinds,
    context, broadcast, reviewState, reviewStatus, checkUpdate }) {
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
    worker.settingsGeneration++;
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
  return { clearCache, addLanguage, removeLanguage, save, status };
}

// The page-facing reading context and its broadcast. Every handler derives consent and
// policy from context(); its revision changes whenever anything that affects swaps does.
import { chromeStorage } from './cache.js';
import { cleanSettings, newSitesDefault, siteEnabled, hasSiteAccess } from './settings.js';
import { resolveLevel } from './levels.js';
import { EXPANDED_PLACEMENT_WORDS, L2_EXTRA, wordsForLevel } from './vocabulary.js';
import { hashKey, sha256Hex } from './hash.js';
import { bundledLanguage, GUARANI_STARTER } from './language-name.js';
import { GUARANI_PACK } from './guarani.js';
import { PACKS_KEY, cleanPacks, packWords } from './languages.js';
import { scopedStorage } from './scope.js';
import { englishAnchors } from './catalog.js';
import { PERSONAL_KEY, cleanPersonal, personalWords, targetAliases } from './personal.js';
import { REVIEW_KEY, introducedReviewWords } from './review.js';

export const activeOn = (ctx, url) => ctx.hasKey && !ctx.paused && siteEnabled(ctx.settings, url) && hasSiteAccess(url, ctx.origins);
// Review scheduling only: never part of the reading revision or of what pages receive.
const pageSettings = ({ desiredRetention, ...settings }) => settings;
// Guess first changes only how a hover answers, not which words are swapped: pages receive it, but
// it stays out of the reading revision, so turning it on or off costs no cache or model call.
const readingSettings = ({ guessFirst, ...settings }) => pageSettings(settings);
export const publicContext = ({ words, allWords, legacyWords, legacyAllWords, personal, captureEpoch,
  activePersonal, personalAuto, retainedWordsKey, managedToken, managedTokenGeneration, settings, ...safe }) =>
  ({ ...safe, settings: pageSettings(settings) });
export const personalScope = (language) => scopedStorage(chromeStorage, `personal:${language}`);
export const laterDay = (a, b) => a > b ? a : b; // ISO local dates or empty string
export const availableLanguage = (code, packs) => bundledLanguage(code) || Object.hasOwn(packs, code) ? code : 'es';

async function readingOrigins(manifest) {
  const { origins = [] } = await chrome.permissions.getAll();
  const scriptable = new Set((manifest.content_scripts ?? []).flatMap(({ matches }) => matches));
  if (!scriptable.size) return origins;
  // getAll() merges explicit host grants with static content-script matches.
  // contains() requires both for an origin declared in both places.
  const available = await Promise.all(origins.map((origin) => scriptable.has(origin)
    ? chrome.permissions.contains({ origins: [origin] })
    : true));
  return origins.filter((_, index) => available[index]);
}

export function createContext({ store, ready, worker }) {
  // What pages get. The revision changes whenever anything that affects swaps does, so stale replies are dropped.
  async function context() {
    await ready;
    const data = await store.get(['settings', 'epoch', PACKS_KEY, PERSONAL_KEY, 'spanishPlacement',
      ...(!worker.keyIsolationUnavailable ? ['apiKey'] : [])]);
    const saved = cleanSettings(data.settings);
    const packs = cleanPacks(data[PACKS_KEY]);
    saved.language = availableLanguage(saved.language, packs);
    const settings = { ...saved, newSitesEnabled: newSitesDefault(saved) };
    const hasPlacement = saved.language === 'es' && [0, 1, 2].includes(data.spanishPlacement);
    const placement = hasPlacement ? data.spanishPlacement : 0;
    if (placement) settings.spanishPlacement = placement;
    const level = placement || resolveLevel(saved).effective;
    const pack = saved.language === GUARANI_STARTER ? GUARANI_PACK : packs[saved.language];
    const legacyAllWords = pack ? packWords(pack, 2) : wordsForLevel(2);
    let legacyWords = level === 1 ? (pack ? packWords(pack, 1) : wordsForLevel(1)) : legacyAllWords;
    let retainedWords = [];
    if (hasPlacement && level === 1) {
      // Narrowing or clearing placement only limits fresh words. Existing cards
      // stay available under the restored level after placement is cleared.
      const { [REVIEW_KEY]: raw } = await store.get(REVIEW_KEY);
      retainedWords = introducedReviewWords(raw, L2_EXTRA);
    } else if (placement === 2) {
      legacyWords = [...EXPANDED_PLACEMENT_WORDS];
    }
    const personal = cleanPersonal(data[PERSONAL_KEY], settings.gradual);
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
    const retainedReadingWords = settings.gradual ? retainedWords.filter((word) => !blockedLegacy(word)) : [];
    // Dynamic review membership is reading-batch policy. Changing one card
    // must leave the page revision and unrelated review tickets intact.
    const retainedWordsKey = JSON.stringify(retainedReadingWords.map(({ fr }) => fr));
    const autoWords = settings.gradual ? personalAuto.map(({ word }) => word) : [];
    const allWords = [...legacyAllWords, ...autoWords];
    const words = [...safeLegacyWords, ...retainedReadingWords, ...autoWords];
    const scope = pack ? `${saved.language}:${pack.version}` : 'es';
    const token = saved.managedProvider && !worker.keyIsolationUnavailable
      ? (await store.get('managedToken')).managedToken : undefined;
    const managedToken = typeof token === 'string' && token ? token : undefined;
    const managedTokenGeneration = managedToken ? await sha256Hex(new TextEncoder().encode(managedToken))
      : saved.managedProvider ? '' : undefined;
    const hasKey = saved.managedProvider ? !!managedToken : !!data.apiKey;
    const paused = false; // retained in the page config protocol; pause is settings.enabled
    const manifest = chrome.runtime.getManifest();
    const origins = await readingOrigins(manifest);
    const revision = hashKey(JSON.stringify([data.epoch || '', readingSettings(settings), level, scope,
      safeLegacyWords.map((word) => [word.fr, word.en]), personalAuto.map(({ entry }) =>
        [entry.id, entry.source, entry.target]), personal.unsupported === true,
      manifest.version, hasKey, origins]));
    return { settings, level, revision, hasKey, managedToken, managedTokenGeneration, paused, origins, captureEpoch: data.epoch || '',
      stage: 0, language: saved.language,
      scope, words, allWords, legacyWords: retainedWords.length ? [...legacyWords, ...retainedWords] : legacyWords,
      legacyAllWords, retainedWordsKey,
      personal, activePersonal, personalAuto };
  }

  async function broadcast(type = 'config') {
    const config = publicContext(await context());
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs.map((t) => chrome.tabs.sendMessage(t.id, { type, config })));
  }
  return { context, broadcast };
}

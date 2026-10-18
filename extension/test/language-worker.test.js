import { test, expect } from 'bun:test';
import { cleanPack } from '../src/languages.js';
import { hashKey } from '../src/hash.js';

const words = (target) => Array.from({ length: 24 }, (_, i) => ({
  fr: target === 'mot' && i === 10 ? 'no' : `${target}${i}`,
  en: target === 'mot' && i === 10 ? 'no' : `gloss ${i}`,
  hint: `sound ${i}`, level: i < 12 ? 1 : 2,
}));

test('worker preserves Spanish on upgrade, isolates reviews and events, and rejects stale language results after restart', async () => {
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const data = {
    settings: { enabled: true, newSitesEnabled: true, levelOverride: 1 },
    apiKey: 'synthetic-key',
    languagePacks: { fr: cleanPack({ words: words('mot') }, 'fr'), ja: cleanPack({ words: words('語') }, 'ja') },
  };
  const handlers = [];
  const permissionAdded = [];
  const permissionRemoved = [];
  let origins = ['<all_urls>'];
  let blockSeenRead = false;
  let seenReadStarted;
  let releaseSeenRead;
  let blockCacheRead = false;
  let cacheReadStarted;
  let releaseCacheRead;
  let blockCounterSet = false;
  let counterSetStarted;
  let releaseCounterSet;
  let failEpochOnce = false;
  let registrationCalls = 0;
  let reloadCalls = 0;
  let reloadMarked;
  let diskVersion = '0.5.0';
  const on = (arr = []) => ({ addListener: (fn) => arr.push(fn) });
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        if (blockCacheRead && Array.isArray(keys) && keys.some((key) => key.startsWith('c:'))) {
          blockCacheRead = false;
          cacheReadStarted();
          await new Promise((resolve) => { releaseCacheRead = resolve; });
        }
        if (blockSeenRead && Array.isArray(keys) && keys.includes('seenSent')) {
          blockSeenRead = false;
          seenReadStarted();
          await new Promise((resolve) => { releaseSeenRead = resolve; });
        }
        const pick = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
        return structuredClone(Object.fromEntries(pick.filter((k) => k in data).map((k) => [k, data[k]])));
      },
      async set(value) {
        if (blockCounterSet && Object.hasOwn(value, 'modelCalls')) {
          blockCounterSet = false;
          counterSetStarted();
          await new Promise((resolve) => { releaseCounterSet = resolve; });
        }
        if (failEpochOnce && Object.keys(value).length === 1 && Object.hasOwn(value, 'epoch')) {
          failEpochOnce = false;
          throw new Error('Storage unavailable');
        }
        Object.assign(data, structuredClone(value));
        if (Object.hasOwn(value, 'reloadedFor')) reloadMarked?.();
      },
      async remove(keys) { for (const key of keys) delete data[key]; },
    } },
    runtime: { id: 'lang-test', getURL: (path) => `chrome-extension://lang-test/${path}`,
      getManifest: () => ({ version: '0.5.0' }), reload: async () => { reloadCalls++; },
      onMessage: on(handlers), onInstalled: on(), onStartup: on() },
    tabs: { query: async () => [], sendMessage: async () => {} },
    action: { setBadgeText: async () => {} }, alarms: { create: async () => {}, onAlarm: on() },
    permissions: { getAll: async () => ({ origins }), onAdded: on(permissionAdded), onRemoved: on(permissionRemoved) },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => { registrationCalls++; },
      updateContentScripts: async () => { registrationCalls++; }, unregisterContentScripts: async () => {} },
  };
  globalThis.fetch = async () => { throw new Error('Unexpected model request'); };
  const popup = { id: 'lang-test', url: 'chrome-extension://lang-test/src/popup.html' };
  const review = { id: 'lang-test', url: 'chrome-extension://lang-test/src/review.html' };
  const page = { id: 'lang-test', url: 'https://example.com/article', tab: { id: 1 } };
  const dispatch = (msg, sender) => new Promise((resolve) => {
    if (!handlers.some((fn) => fn(msg, sender, resolve))) resolve(undefined);
  });
  try {
    await import('../src/background.js?language-worker');
    const first = await dispatch({ type: 'config' }, page);
    expect(first.language).toBe('es');
    expect(data.settings.language).toBe('es'); // idempotent migration
    expect((await dispatch({ type: 'reviewIntroduce' }, review)).added).toBe(5);
    const spanish = structuredClone(data.recallReview);
    expect(await dispatch({ type: 'event', word: 'no', event: 'seen', revision: first.revision }, page)).toEqual({ ok: true });
    expect((await dispatch({ type: 'save', settings: { language: 'fr' } }, popup)).ok).toBe(true);
    const french = await dispatch({ type: 'config' }, page);
    expect(french.language).toBe('fr');
    expect(french.revision).not.toBe(first.revision);
    expect(await dispatch({ type: 'event', word: 'no', event: 'seen', revision: first.revision }, page)).toEqual({ ok: false });
    expect((await dispatch({ type: 'reviewStatus' }, review)).new).toBe(12);
    expect((await dispatch({ type: 'reviewIntroduce' }, review)).added).toBe(5);
    expect(data.recallReview).toEqual(spanish);
    expect(data['lang:fr:' + data.languagePacks.fr.version + ':recallReview'].cards.mot0).toBeDefined();
    expect((await dispatch({ type: 'save', settings: { language: 'ja' } }, popup)).ok).toBe(true);
    expect((await dispatch({ type: 'reviewStatus' }, review)).new).toBe(12);
    expect((await dispatch({ type: 'save', settings: { language: 'es' } }, popup)).ok).toBe(true);
    const spanishAgain = await dispatch({ type: 'config' }, page);
    expect(spanishAgain.revision).not.toBe(first.revision);
    expect(await dispatch({ type: 'event', word: 'no', event: 'seen', revision: first.revision }, page)).toEqual({ ok: false });
    expect((await dispatch({ type: 'reviewStatus' }, review)).due).toBe(5);
    expect(data.recallReview).toEqual(spanish);
    expect(data.readingEvents[0].word).toBe('no');

    // A damaged stored pack must not prevent turning the extension or one site off.
    const validFrench = data.languagePacks.fr;
    data.settings.language = 'fr';
    data.languagePacks.fr = { version: 'damaged', words: [] };
    expect((await dispatch({ type: 'save', settings: { enabled: false } }, popup)).ok).toBe(true);
    expect(data.settings).toMatchObject({ language: 'es', enabled: false });
    expect((await dispatch({ type: 'save', siteOverride: { host: 'example.com', enabled: false } }, popup)).ok).toBe(true);
    expect(data.settings.siteOverrides['example.com']).toBe(false);
    expect((await dispatch({ type: 'save', settings: { language: 'fr' } }, popup)).error).toMatch(/pack/);
    expect(data.settings.language).toBe('es');
    expect(data.recallReview).toEqual(spanish);
    data.languagePacks.fr = validFrench;
    expect((await dispatch({ type: 'save', settings: { enabled: true } }, popup)).ok).toBe(true);
    expect((await dispatch({ type: 'save', siteOverride: { host: 'example.com', enabled: null } }, popup)).ok).toBe(true);

    // Removal clears only the selected generated pack's reading and recall history.
    expect((await dispatch({ type: 'save', settings: { language: 'ja' } }, popup)).ok).toBe(true);
    const japanese = await dispatch({ type: 'config' }, page);
    expect((await dispatch({ type: 'reviewIntroduce' }, review)).added).toBe(5);
    expect(await dispatch({ type: 'event', word: '語0', event: 'seen', revision: japanese.revision }, page)).toEqual({ ok: true });
    const japanesePrefix = `lang:ja:${data.languagePacks.ja.version}:`;
    expect(data[japanesePrefix + 'recallReview']).toBeDefined();
    expect(data[japanesePrefix + 'readingEvents']).toBeDefined();
    expect((await dispatch({ type: 'removeLanguage', code: 'es' }, popup)).error).toMatch(/generated/);
    expect((await dispatch({ type: 'removeLanguage', code: 'ja' }, page))).toBeUndefined();
    expect((await dispatch({ type: 'removeLanguage', code: 'ja' }, popup)).ok).toBe(true);
    expect(data.settings.language).toBe('es');
    expect(data.languagePacks.ja).toBeUndefined();
    expect(Object.keys(data).filter((key) => key.startsWith(japanesePrefix))).toEqual([]);
    expect(data['lang:fr:' + data.languagePacks.fr.version + ':recallReview'].cards.mot0).toBeDefined();
    expect(data.recallReview).toEqual(spanish);

    // A late model answer from French cannot be installed in the Spanish page cache.
    expect((await dispatch({ type: 'save', settings: { language: 'fr' } }, popup)).ok).toBe(true);
    const staleFrench = await dispatch({ type: 'config' }, page);
    const passage = 'Cats and dogs sleep all day long in the garden.';
    const key = `${staleFrench.revision}:${hashKey(passage)}`;
    let fetchStarted;
    const started = new Promise((resolve) => { fetchStarted = resolve; });
    let finishFetch;
    globalThis.fetch = async () => {
      fetchStarted();
      await new Promise((resolve) => { finishFetch = resolve; });
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: {
        parts: [{ text: JSON.stringify({ passages: [{ id: key, swaps: [] }] }) }],
      } }] }) };
    };
    const pending = dispatch({ type: 'swaps', revision: staleFrench.revision, items: [{ key, text: passage }] }, page);
    await started;
    expect((await dispatch({ type: 'save', settings: { language: 'es' } }, popup)).ok).toBe(true);
    expect((await dispatch({ type: 'save', settings: { language: 'fr' } }, popup)).ok).toBe(true);
    expect((await dispatch({ type: 'config' }, page)).revision).not.toBe(staleFrench.revision);
    finishFetch();
    expect((await pending).stale).toBe(true);
    expect(data[`c:${key}`]).toBeUndefined();
    expect((await dispatch({ type: 'save', settings: { language: 'es' } }, popup)).ok).toBe(true);

    // Site-off during a delayed review read must stop the model request before text leaves.
    const beforeSiteOff = await dispatch({ type: 'config' }, page);
    const noOpEpoch = data.epoch;
    expect((await dispatch({ type: 'save', settings: { language: 'es' } }, popup)).ok).toBe(true);
    expect(data.epoch).toBe(noOpEpoch);
    expect((await dispatch({ type: 'config' }, page)).revision).toBe(beforeSiteOff.revision);
    let modelFetches = 0;
    globalThis.fetch = async () => { modelFetches++; throw new Error('Unexpected model request'); };
    const readStarted = new Promise((resolve) => { seenReadStarted = resolve; });
    blockSeenRead = true;
    const siteOffPending = dispatch({ type: 'swaps', revision: beforeSiteOff.revision,
      items: [{ key: `${beforeSiteOff.revision}:${hashKey(passage)}`, text: passage }] }, page);
    await readStarted;
    expect((await dispatch({ type: 'save', settings: { enabled: false } }, popup)).ok).toBe(true);
    releaseSeenRead();
    expect((await siteOffPending).stale).toBe(true);
    expect(modelFetches).toBe(0);
    expect((await dispatch({ type: 'save', settings: { enabled: true } }, popup)).ok).toBe(true);

    // The same held read must not disclose text after an origin permission is revoked.
    const beforeRevocation = await dispatch({ type: 'config' }, page);
    const revokedReadStarted = new Promise((resolve) => { seenReadStarted = resolve; });
    blockSeenRead = true;
    const revokedPending = dispatch({ type: 'swaps', revision: beforeRevocation.revision,
      items: [{ key: `${beforeRevocation.revision}:${hashKey(passage)}`, text: passage }] }, page);
    await revokedReadStarted;
    origins = [];
    await Promise.all(permissionRemoved.map((notify) => notify()));
    releaseSeenRead();
    expect((await revokedPending).stale).toBe(true);
    expect(modelFetches).toBe(0);
    origins = ['<all_urls>'];
    await Promise.all(permissionAdded.map((notify) => notify()));

    // An unchanged, permitted page still makes exactly one model request.
    const allowed = await dispatch({ type: 'config' }, page);
    const allowedKey = `${allowed.revision}:${hashKey(passage)}`;
    globalThis.fetch = async () => {
      modelFetches++;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: {
        parts: [{ text: JSON.stringify({ passages: [{ id: allowedKey, swaps: [] }] }) }],
      } }] }) };
    };
    expect((await dispatch({ type: 'swaps', revision: allowed.revision,
      items: [{ key: allowedKey, text: passage }] }, page)).results[allowedKey]).toEqual([]);
    expect(modelFetches).toBe(1);

    // A cached answer must also be dropped when the site turns off during storage I/O.
    const cacheStarted = new Promise((resolve) => { cacheReadStarted = resolve; });
    blockCacheRead = true;
    const cachedPending = dispatch({ type: 'swaps', revision: allowed.revision,
      items: [{ key: allowedKey, text: passage }] }, page);
    await cacheStarted;
    expect((await dispatch({ type: 'save', settings: { enabled: false } }, popup)).ok).toBe(true);
    releaseCacheRead();
    expect((await cachedPending).stale).toBe(true);
    expect(modelFetches).toBe(1);
    expect((await dispatch({ type: 'save', settings: { enabled: true } }, popup)).ok).toBe(true);

    // Site-off after the primary send must also stop a fallback model send.
    expect((await dispatch({ type: 'save', settings: { model: 'gemini-3.8-flash' } }, popup)).ok).toBe(true);
    const beforeFallback = await dispatch({ type: 'config' }, page);
    const fallbackKey = `${beforeFallback.revision}:${hashKey(passage)}`;
    let primaryStarted;
    const startedPrimary = new Promise((resolve) => { primaryStarted = resolve; });
    let finishPrimary;
    const sentModels = [];
    globalThis.fetch = async (url) => {
      sentModels.push(url);
      if (!url.includes('gemini-3.8-flash')) throw new Error('Fallback disclosed page text');
      primaryStarted();
      return new Promise((resolve) => { finishPrimary = resolve; });
    };
    const fallbackPending = dispatch({ type: 'swaps', revision: beforeFallback.revision,
      items: [{ key: fallbackKey, text: passage }] }, page);
    await startedPrimary;
    expect((await dispatch({ type: 'save', settings: { enabled: false } }, popup)).ok).toBe(true);
    finishPrimary({ ok: false, status: 503, text: async () => '', headers: { get: () => null } });
    expect((await fallbackPending).stale).toBe(true);
    expect(sentModels).toHaveLength(1);
    expect((await dispatch({ type: 'save', settings: { enabled: true, model: 'gemini-3.5-flash-lite' } }, popup)).ok).toBe(true);

    // Permission loss while the daily counter is being written must stop the send
    // at the second, immediately pre-fetch check, even before its event gets the lock.
    let counterFetches = 0;
    globalThis.fetch = async () => { counterFetches++; throw new Error('Revoked origin disclosed page text'); };
    const beforeCounterRevoke = await dispatch({ type: 'config' }, page);
    const counterStarted = new Promise((resolve) => { counterSetStarted = resolve; });
    blockCounterSet = true;
    const counterPending = dispatch({ type: 'swaps', revision: beforeCounterRevoke.revision,
      items: [{ key: `${beforeCounterRevoke.revision}:${hashKey(passage)}`, text: passage }] }, page);
    await counterStarted;
    origins = [];
    const revokeDuringCount = Promise.all(permissionRemoved.map((notify) => notify()));
    releaseCounterSet();
    expect((await counterPending).stale).toBe(true);
    expect(counterFetches).toBe(0);
    await revokeDuringCount;
    origins = ['<all_urls>'];
    await Promise.all(permissionAdded.map((notify) => notify()));

    expect((await dispatch({ type: 'save', settings: { language: 'bad<script>' } }, popup)).error).toMatch(/Invalid/);
    expect(data.settings.language).toBe('es');
    expect(await dispatch({ type: 'addLanguage', code: 'de' }, page)).toBeUndefined();
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: {
      parts: [{ text: JSON.stringify({ words: words('wort').slice(0, 5) }) }],
    } }] }) });
    expect((await dispatch({ type: 'addLanguage', code: 'de' }, popup)).error).toMatch(/validation/);
    expect(data.settings.language).toBe('es');
    expect(data.languagePacks.de).toBeUndefined();
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: {
      parts: [{ text: JSON.stringify({ words: words('wort') }) }],
    } }] }) });
    expect((await dispatch({ type: 'addLanguage', code: 'de' }, popup)).ok).toBe(true);
    expect(data.settings.language).toBe('de');
    expect(data.languagePacks.de.words).toHaveLength(24);
    expect((await dispatch({ type: 'save', settings: { language: 'es' } }, popup)).ok).toBe(true);

    // Both generation calls may start from the same selection, but only one may commit.
    const beforeCount = Object.keys(data.languagePacks).length;
    const addResults = await Promise.all(['it', 'nl'].map((code) => dispatch({ type: 'addLanguage', code }, popup)));
    expect(addResults.filter((result) => result.ok)).toHaveLength(1);
    expect(addResults.filter((result) => result.error)).toHaveLength(1);
    expect(Object.keys(data.languagePacks)).toHaveLength(beforeCount + 1);
    expect(data.settings.language).toBe(addResults.find((result) => result.ok).language);
    expect(data.recallReview).toEqual(spanish);
    expect((await dispatch({ type: 'save', settings: { language: 'es' } }, popup)).ok).toBe(true);

    // Turkish casing can add a dotted capital I to a word stored with lowercase i.
    data.languagePacks.tr = cleanPack({ words: words('istanbul') }, 'tr');
    expect((await dispatch({ type: 'save', settings: { language: 'tr' } }, popup)).ok).toBe(true);
    const turkish = await dispatch({ type: 'config' }, page);
    expect(await dispatch({ type: 'event', word: 'İstanbul0', event: 'seen', revision: turkish.revision }, page)).toEqual({ ok: true });
    expect(data[`lang:tr:${data.languagePacks.tr.version}:readingEvents`][0].word).toBe('istanbul0');
    expect((await dispatch({ type: 'removeLanguage', code: 'fr' }, popup)).error).toMatch(/selected/);
    expect(data.languagePacks.fr).toBeDefined();
    expect((await dispatch({ type: 'removeLanguage', code: 'tr' }, popup)).ok).toBe(true);
    expect(data.settings.language).toBe('es');

    // A permission remove/regrant round trip must not revive an old page token.
    const beforePermission = await dispatch({ type: 'config' }, page);
    origins = [];
    await Promise.all(permissionRemoved.map((notify) => notify()));
    expect((await dispatch({ type: 'config' }, page)).revision).not.toBe(beforePermission.revision);
    origins = ['<all_urls>'];
    await Promise.all(permissionAdded.map((notify) => notify()));
    const afterPermission = await dispatch({ type: 'config' }, page);
    expect(afterPermission.revision).not.toBe(beforePermission.revision);
    expect(await dispatch({ type: 'event', word: 'no', event: 'seen', revision: beforePermission.revision }, page)).toEqual({ ok: false });
    expect((await dispatch({ type: 'swaps', revision: beforePermission.revision,
      items: [{ key: `${beforePermission.revision}:${hashKey(passage)}`, text: passage }] }, page)).stale).toBe(true);
    const registeredBeforeFailure = registrationCalls;
    failEpochOnce = true;
    await Promise.all(permissionAdded.map((notify) => notify()));
    expect(registrationCalls).toBeGreaterThan(registeredBeforeFailure);
    globalThis.fetch = async () => { throw new Error('Unexpected model request'); };

    // Update reload waits for model work before taking the storage lock. The reverse
    // order deadlocks against a swap waiting for its final consent check under that lock.
    const beforeReload = await dispatch({ type: 'config' }, page);
    const reloadReadStarted = new Promise((resolve) => { seenReadStarted = resolve; });
    blockSeenRead = true;
    const reloadSwap = dispatch({ type: 'swaps', revision: beforeReload.revision,
      items: [{ key: `${beforeReload.revision}:${hashKey(passage)}`, text: passage }] }, page);
    await reloadReadStarted;
    diskVersion = '0.5.1';
    globalThis.fetch = async (url) => {
      if (url === 'chrome-extension://lang-test/manifest.json') return { ok: true, json: async () => ({ version: diskVersion }) };
      throw new Error('Unexpected model request');
    };
    const marked = new Promise((resolve) => { reloadMarked = resolve; });
    const updatePending = dispatch({ type: 'status' }, popup);
    await marked;
    await Promise.resolve();
    await Promise.resolve();
    const offPending = dispatch({ type: 'save', settings: { enabled: false } }, popup);
    releaseSeenRead();
    const within = (promise) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('timed out'), 1000))]);
    expect(await within(reloadSwap)).toMatchObject({ stale: true });
    expect(await within(offPending)).toMatchObject({ ok: true });
    expect(await within(updatePending)).toHaveProperty('update', '0.5.1');
    expect(reloadCalls).toBe(1);
    expect((await dispatch({ type: 'save', settings: { enabled: true } }, popup)).ok).toBe(true);
    diskVersion = '0.5.0';
    const beforeRestart = await dispatch({ type: 'config' }, page);

    // A suspended MV3 worker is reconstructed from storage without resetting selection or histories.
    handlers.length = 0;
    await import('../src/background.js?language-restarted');
    const restarted = await dispatch({ type: 'config' }, page);
    expect(restarted.language).toBe('es');
    expect(restarted.revision).toBe(beforeRestart.revision);
    expect(await dispatch({ type: 'event', word: 'no', event: 'seen', revision: beforePermission.revision }, page)).toEqual({ ok: false });
    expect((await dispatch({ type: 'reviewStatus' }, review)).due).toBe(5);
    expect(data['lang:fr:' + data.languagePacks.fr.version + ':recallReview'].cards.mot0).toBeDefined();
  } finally { Object.assign(globalThis, saved); }
});

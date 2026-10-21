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
  let tabTitle = 'Ordinary reading';
  let blockSeenRead = false;
  let seenReadStarted;
  let releaseSeenRead;
  let blockPrefetchRead = '';
  let prefetchReadStarted;
  let releasePrefetchRead;
  let blockCacheRead = false;
  let cacheReadStarted;
  let releaseCacheRead;
  let blockCacheWrite = false;
  let cacheWriteStarted;
  let releaseCacheWrite;
  let blockModelStatusSet = false;
  let modelStatusSetStarted;
  let releaseModelStatusSet;
  let blockTitleAfterModelStatus = false;
  let blockCounterSet = false;
  let failCounterSetOnce = false;
  let counterSetStarted;
  let releaseCounterSet;
  let blockTitleAfterCounter = false;
  let blockTitleAfterCacheRead = false;
  let titleReadsUntilHold = 0;
  let holdNextTitle = false;
  let titleLookupStarted;
  let releaseTitleLookup;
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
        if (blockPrefetchRead && (keys === blockPrefetchRead ||
            (Array.isArray(keys) && keys.includes(blockPrefetchRead)))) {
          blockPrefetchRead = '';
          prefetchReadStarted();
          await new Promise((resolve) => { releasePrefetchRead = resolve; });
        }
        if (blockCacheRead && Array.isArray(keys) && keys.some((key) => key.startsWith('c:'))) {
          blockCacheRead = false;
          cacheReadStarted();
          await new Promise((resolve) => { releaseCacheRead = resolve; });
        }
        if (blockTitleAfterCacheRead && Array.isArray(keys) && keys.some((key) => key.startsWith('c:'))) {
          blockTitleAfterCacheRead = false;
          titleReadsUntilHold = 2; // post-cache title check, then final cached-delivery title check
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
        if (blockTitleAfterModelStatus && value.modelStatus?.category === 'ok') {
          blockTitleAfterModelStatus = false;
          holdNextTitle = true;
        }
        if (blockModelStatusSet && value.modelStatus?.category === 'ok') {
          blockModelStatusSet = false;
          modelStatusSetStarted();
          await new Promise((resolve) => { releaseModelStatusSet = resolve; });
        }
        if (blockCacheWrite && Object.keys(value).some((key) => key.startsWith('c:'))) {
          blockCacheWrite = false;
          cacheWriteStarted();
          await new Promise((resolve) => { releaseCacheWrite = resolve; });
        }
        if (blockTitleAfterCounter && Object.hasOwn(value, 'modelCalls')) {
          blockTitleAfterCounter = false;
          holdNextTitle = true;
        }
        if (blockCounterSet && Object.hasOwn(value, 'modelCalls')) {
          blockCounterSet = false;
          counterSetStarted();
          await new Promise((resolve) => { releaseCounterSet = resolve; });
        }
        if (failCounterSetOnce && Object.hasOwn(value, 'modelCalls')) {
          failCounterSetOnce = false;
          throw new Error('Private storage failure text');
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
    tabs: { get: async (id) => {
      if (holdNextTitle || (titleReadsUntilHold > 0 && --titleReadsUntilHold === 0)) {
        holdNextTitle = false;
        titleLookupStarted();
        await new Promise((resolve) => { releaseTitleLookup = resolve; });
      }
      return { id, title: tabTitle };
    }, query: async () => [], sendMessage: async () => {} },
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

    // The quota and key reads also yield before model dispatch. Either gap must
    // honor a site-off that commits before the held read resumes.
    for (const storageKey of ['modelCalls', 'apiKey']) {
      const beforeRead = await dispatch({ type: 'config' }, page);
      const readHeld = new Promise((resolve) => { prefetchReadStarted = resolve; });
      blockPrefetchRead = storageKey;
      const heldSwap = dispatch({ type: 'swaps', revision: beforeRead.revision,
        items: [{ key: `${beforeRead.revision}:${hashKey(passage)}`, text: passage }] }, page);
      await readHeld;
      expect((await dispatch({ type: 'save', settings: { enabled: false } }, popup)).ok).toBe(true);
      releasePrefetchRead();
      expect((await heldSwap).stale).toBe(true);
      expect(modelFetches).toBe(0);
      expect((await dispatch({ type: 'save', settings: { enabled: true } }, popup)).ok).toBe(true);
    }

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
    globalThis.fetch = async (_url, init) => {
      expect(JSON.stringify(init)).not.toContain('Ordinary reading');
      modelFetches++;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: {
        parts: [{ text: JSON.stringify({ passages: [{ id: allowedKey, swaps: [] }] }) }],
      } }] }) };
    };
    expect((await dispatch({ type: 'swaps', revision: allowed.revision,
      items: [{ key: allowedKey, text: passage }] }, page)).results[allowedKey]).toEqual([]);
    expect(modelFetches).toBe(1);

    // A neutral passage on a sensitive tab cannot reuse a cached answer or
    // leave for Gemini. A frame's own sensitive title also vetoes a safe tab.
    tabTitle = 'Bank robbery investigation';
    expect((await dispatch({ type: 'swaps', revision: allowed.revision,
      items: [{ key: allowedKey, text: passage }], title: 'Ordinary frame' },
      { ...page, frameId: 2 })).results[allowedKey]).toEqual([]);
    const otherText = 'We read books and share stories every afternoon.';
    const otherKey = `${allowed.revision}:${hashKey(otherText)}`;
    expect((await dispatch({ type: 'swaps', revision: allowed.revision,
      items: [{ key: otherKey, text: otherText }], title: 'Ordinary frame' }, page)).results[otherKey]).toEqual([]);
    expect(modelFetches).toBe(1);
    tabTitle = 'Ordinary reading';
    expect((await dispatch({ type: 'swaps', revision: allowed.revision,
      items: [{ key: otherKey, text: otherText }], title: 'Ordinary frame' },
      { ...page, frameId: 2 })).results[otherKey]).toEqual([]);
    expect((await dispatch({ type: 'swaps', revision: allowed.revision,
      items: [{ key: otherKey, text: otherText }], title: 'Hospital update' },
      { ...page, frameId: 2 })).results[otherKey]).toEqual([]);
    expect(modelFetches).toBe(1);

    // A title can change while cache I/O is held; the cached result must not
    // escape after the guard's first check.
    const titleCacheStarted = new Promise((resolve) => { cacheReadStarted = resolve; });
    blockCacheRead = true;
    const titleCachePending = dispatch({ type: 'swaps', revision: allowed.revision,
      items: [{ key: allowedKey, text: passage }], title: 'Ordinary reading' }, page);
    await titleCacheStarted;
    tabTitle = 'Court order';
    releaseCacheRead();
    expect((await titleCachePending).stale).toBe(true);
    expect(modelFetches).toBe(1);
    tabTitle = 'Ordinary reading';

    // The review/prefetch await and the final counter write are also dispatch
    // boundaries. Neither may leak after a title transition.
    const titleReadStarted = new Promise((resolve) => { seenReadStarted = resolve; });
    blockSeenRead = true;
    const titleReadPending = dispatch({ type: 'swaps', revision: allowed.revision,
      items: [{ key: otherKey, text: otherText }], title: 'Ordinary reading' }, page);
    await titleReadStarted;
    tabTitle = 'Crime rates today';
    releaseSeenRead();
    expect((await titleReadPending).stale).toBe(true);
    expect(modelFetches).toBe(1);
    tabTitle = 'Ordinary reading';

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
    let titlePrimaryStarted;
    const startedTitlePrimary = new Promise((resolve) => { titlePrimaryStarted = resolve; });
    let finishTitlePrimary;
    const titleModels = [];
    globalThis.fetch = async (url, init) => {
      titleModels.push(url);
      expect(JSON.stringify(init)).not.toContain('Court order'); // title stays local
      if (!url.includes('gemini-3.8-flash')) throw new Error('Title change disclosed page text to fallback');
      titlePrimaryStarted();
      return new Promise((resolve) => { finishTitlePrimary = resolve; });
    };
    const titleFallbackPending = dispatch({ type: 'swaps', revision: beforeFallback.revision,
      items: [{ key: fallbackKey, text: passage }], title: 'Ordinary reading' }, page);
    await startedTitlePrimary;
    tabTitle = 'Court order';
    finishTitlePrimary({ ok: false, status: 400, text: async () => '', headers: { get: () => null } });
    expect((await titleFallbackPending).stale).toBe(true);
    expect(titleModels).toHaveLength(1);
    tabTitle = 'Ordinary reading';

    // Permission loss during the final live-title lookup must block fallback.
    // The primary is allowed to fail; its response has already been sent.
    const beforeHeldFallback = await dispatch({ type: 'config' }, page);
    const heldFallbackKey = `${beforeHeldFallback.revision}:${hashKey(passage)}`;
    const heldFallbackUrls = [];
    globalThis.fetch = async (url) => {
      heldFallbackUrls.push(url);
      if (!url.includes('gemini-3.8-flash')) throw new Error('Revoked origin disclosed fallback text');
      blockTitleAfterCounter = true;
      return { ok: false, status: 400, text: async () => '', headers: { get: () => null } };
    };
    const heldFallbackStarted = new Promise((resolve) => { titleLookupStarted = resolve; });
    const heldFallback = dispatch({ type: 'swaps', revision: beforeHeldFallback.revision,
      items: [{ key: heldFallbackKey, text: passage }], title: 'Ordinary reading' }, page);
    await heldFallbackStarted;
    origins = [];
    const fallbackRevocation = Promise.all(permissionRemoved.map((notify) => notify()));
    releaseTitleLookup();
    expect((await heldFallback).stale).toBe(true);
    expect(heldFallbackUrls).toHaveLength(1);
    await fallbackRevocation;
    origins = ['<all_urls>'];
    await Promise.all(permissionAdded.map((notify) => notify()));

    // With permission held throughout that lookup, both primary and fallback send.
    const allowedFallback = await dispatch({ type: 'config' }, page);
    const allowedFallbackKey = `${allowedFallback.revision}:${hashKey(passage)}`;
    const allowedFallbackUrls = [];
    globalThis.fetch = async (url) => {
      allowedFallbackUrls.push(url);
      if (url.includes('gemini-3.8-flash')) {
        blockTitleAfterCounter = true;
        return { ok: false, status: 400, text: async () => '', headers: { get: () => null } };
      }
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: {
        parts: [{ text: JSON.stringify({ passages: [{ id: allowedFallbackKey, swaps: [] }] }) }],
      } }] }) };
    };
    const allowedFallbackStarted = new Promise((resolve) => { titleLookupStarted = resolve; });
    const allowedFallbackPending = dispatch({ type: 'swaps', revision: allowedFallback.revision,
      items: [{ key: allowedFallbackKey, text: passage }], title: 'Ordinary reading' }, page);
    await allowedFallbackStarted;
    releaseTitleLookup();
    expect((await allowedFallbackPending).results[allowedFallbackKey]).toEqual([]);
    expect(allowedFallbackUrls).toHaveLength(2);

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
    const beforeSiteOffFallback = await dispatch({ type: 'config' }, page);
    const siteOffFallbackKey = `${beforeSiteOffFallback.revision}:${hashKey(otherText)}`;
    const fallbackPending = dispatch({ type: 'swaps', revision: beforeSiteOffFallback.revision,
      items: [{ key: siteOffFallbackKey, text: otherText }] }, page);
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

    const beforeTitleCount = await dispatch({ type: 'config' }, page);
    const titleCounterStarted = new Promise((resolve) => { counterSetStarted = resolve; });
    blockCounterSet = true;
    const titleCounterPending = dispatch({ type: 'swaps', revision: beforeTitleCount.revision,
      items: [{ key: `${beforeTitleCount.revision}:${hashKey(passage)}`, text: passage }],
      title: 'Ordinary reading' }, page);
    await titleCounterStarted;
    tabTitle = 'Bank robbery';
    releaseCounterSet();
    expect((await titleCounterPending).stale).toBe(true);
    expect(counterFetches).toBe(0);
    tabTitle = 'Ordinary reading';

    // The final tabs.get yields after the last context() snapshot. A revoked
    // origin at that point must prevent a primary send as well.
    const beforeHeldPrimary = await dispatch({ type: 'config' }, page);
    const heldPrimaryKey = `${beforeHeldPrimary.revision}:${hashKey(passage)}`;
    let heldPrimaryFetches = 0;
    globalThis.fetch = async () => { heldPrimaryFetches++; throw new Error('Revoked origin disclosed primary text'); };
    const heldPrimaryStarted = new Promise((resolve) => { titleLookupStarted = resolve; });
    blockTitleAfterCounter = true;
    const heldPrimary = dispatch({ type: 'swaps', revision: beforeHeldPrimary.revision,
      items: [{ key: heldPrimaryKey, text: passage }], title: 'Ordinary reading' }, page);
    await heldPrimaryStarted;
    origins = [];
    const primaryRevocation = Promise.all(permissionRemoved.map((notify) => notify()));
    releaseTitleLookup();
    expect((await heldPrimary).stale).toBe(true);
    expect(heldPrimaryFetches).toBe(0);
    await primaryRevocation;
    origins = ['<all_urls>'];
    await Promise.all(permissionAdded.map((notify) => notify()));

    const allowedPrimary = await dispatch({ type: 'config' }, page);
    const allowedPrimaryKey = `${allowedPrimary.revision}:${hashKey(passage)}`;
    globalThis.fetch = async () => {
      heldPrimaryFetches++;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: {
        parts: [{ text: JSON.stringify({ passages: [{ id: allowedPrimaryKey, swaps: [] }] }) }],
      } }] }) };
    };
    const allowedPrimaryStarted = new Promise((resolve) => { titleLookupStarted = resolve; });
    blockTitleAfterCounter = true;
    const allowedPrimaryPending = dispatch({ type: 'swaps', revision: allowedPrimary.revision,
      items: [{ key: allowedPrimaryKey, text: passage }], title: 'Ordinary reading' }, page);
    await allowedPrimaryStarted;
    releaseTitleLookup();
    expect((await allowedPrimaryPending).results[allowedPrimaryKey]).toEqual([]);
    expect(heldPrimaryFetches).toBe(1);

    const allowedCachedStarted = new Promise((resolve) => { titleLookupStarted = resolve; });
    blockTitleAfterCacheRead = true;
    const allowedCached = dispatch({ type: 'swaps', revision: allowedPrimary.revision,
      items: [{ key: allowedPrimaryKey, text: passage }], title: 'Ordinary reading' }, page);
    await allowedCachedStarted;
    releaseTitleLookup();
    expect((await allowedCached).results[allowedPrimaryKey]).toEqual([]);
    expect(heldPrimaryFetches).toBe(1);

    // A cached result must also stay hidden if permission is revoked while
    // its final live-title check is held after the consent snapshot.
    const heldCachedStarted = new Promise((resolve) => { titleLookupStarted = resolve; });
    blockTitleAfterCacheRead = true;
    const heldCached = dispatch({ type: 'swaps', revision: allowedPrimary.revision,
      items: [{ key: allowedPrimaryKey, text: passage }], title: 'Ordinary reading' }, page);
    await heldCachedStarted;
    origins = [];
    const cacheRevocation = Promise.all(permissionRemoved.map((notify) => notify()));
    releaseTitleLookup();
    expect((await heldCached).stale).toBe(true);
    expect(heldPrimaryFetches).toBe(1);
    await cacheRevocation;
    origins = ['<all_urls>'];
    await Promise.all(permissionAdded.map((notify) => notify()));

    // A committed site-off must suppress a nonempty cached answer, even when
    // cache I/O began while the page was allowed.
    const allowedCacheRace = await dispatch({ type: 'config' }, page);
    const cachedText = 'Owls and foxes explore quiet fields at sunrise.';
    const cachedKey = `${allowedCacheRace.revision}:${hashKey(cachedText)}`;
    const cachedSwaps = [{ o: 'and', f: 'y', ctx: 'Owls and foxes', g: 'and', h: '' }];
    data[`c:${cachedKey}`] = { s: cachedSwaps, t: Date.now() };
    const cachedReadHeld = new Promise((resolve) => { cacheReadStarted = resolve; });
    blockCacheRead = true;
    const offBeforeDelivery = dispatch({ type: 'swaps', revision: allowedCacheRace.revision,
      items: [{ key: cachedKey, text: cachedText }], title: 'Ordinary reading' }, page);
    await cachedReadHeld;
    expect((await dispatch({ type: 'save', settings: { enabled: false } }, popup)).ok).toBe(true);
    releaseCacheRead();
    expect((await offBeforeDelivery).stale).toBe(true);
    expect((await dispatch({ type: 'save', settings: { enabled: true } }, popup)).ok).toBe(true);
    const allowedCachedAgain = await dispatch({ type: 'config' }, page);
    const cachedAgainKey = `${allowedCachedAgain.revision}:${hashKey(cachedText)}`;
    data[`c:${cachedAgainKey}`] = { s: cachedSwaps, t: Date.now() };

    // This second ordering checks the lock itself: a save queued during the
    // cached delivery's live-title lookup commits after the allowed reply.
    const cachedTitleHeld = new Promise((resolve) => { titleLookupStarted = resolve; });
    blockTitleAfterCacheRead = true;
    const cachedBeforeOff = dispatch({ type: 'swaps', revision: allowedCachedAgain.revision,
      items: [{ key: cachedAgainKey, text: cachedText }], title: 'Ordinary reading' }, page);
    await cachedTitleHeld;
    const queuedCachedOff = dispatch({ type: 'save', settings: { enabled: false } }, popup);
    expect(await Promise.race([queuedCachedOff.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 20))])).toBe(false);
    expect(data.settings.enabled).toBe(true);
    releaseTitleLookup();
    expect((await cachedBeforeOff).results[cachedAgainKey]).toEqual(cachedSwaps);
    expect((await queuedCachedOff).ok).toBe(true);
    expect(data.settings.enabled).toBe(false);
    expect((await dispatch({ type: 'swaps', revision: allowedCachedAgain.revision,
      items: [{ key: cachedAgainKey, text: cachedText }], title: 'Ordinary reading' }, page)).stale).toBe(true);
    expect(heldPrimaryFetches).toBe(1);
    expect((await dispatch({ type: 'save', settings: { enabled: true } }, popup)).ok).toBe(true);

    // The fresh-result cache write also yields after the first delivery check.
    // A revoke there must not return the newly generated result to the page.
    const beforeCacheWrite = await dispatch({ type: 'config' }, page);
    const cacheWriteKey = `${beforeCacheWrite.revision}:${hashKey(otherText)}`;
    let cacheWriteFetches = 0;
    let responseKey = cacheWriteKey;
    globalThis.fetch = async () => {
      cacheWriteFetches++;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: {
        parts: [{ text: JSON.stringify({ passages: [{ id: responseKey, swaps: [] }] }) }],
      } }] }) };
    };
    const cacheWriteHeld = new Promise((resolve) => { cacheWriteStarted = resolve; });
    blockCacheWrite = true;
    const pendingCacheWrite = dispatch({ type: 'swaps', revision: beforeCacheWrite.revision,
      items: [{ key: cacheWriteKey, text: otherText }], title: 'Ordinary reading' }, page);
    await cacheWriteHeld;
    origins = [];
    const cacheWriteRevocation = Promise.all(permissionRemoved.map((notify) => notify()));
    releaseCacheWrite();
    expect((await pendingCacheWrite).stale).toBe(true);
    expect(cacheWriteFetches).toBe(1);
    await cacheWriteRevocation;
    origins = ['<all_urls>'];
    await Promise.all(permissionAdded.map((notify) => notify()));

    const allowedCacheWrite = await dispatch({ type: 'config' }, page);
    responseKey = `${allowedCacheWrite.revision}:${hashKey(otherText)}`;
    const allowedCacheWriteHeld = new Promise((resolve) => { cacheWriteStarted = resolve; });
    blockCacheWrite = true;
    const pendingAllowedCacheWrite = dispatch({ type: 'swaps', revision: allowedCacheWrite.revision,
      items: [{ key: responseKey, text: otherText }], title: 'Ordinary reading' }, page);
    await allowedCacheWriteHeld;
    releaseCacheWrite();
    expect((await pendingAllowedCacheWrite).results[responseKey]).toEqual([]);
    expect(cacheWriteFetches).toBe(2);

    // Diagnostic status persistence yields after delivery too; it must not
    // delay a result into a page whose origin was revoked in that interval.
    const beforeStatusSet = await dispatch({ type: 'config' }, page);
    responseKey = `${beforeStatusSet.revision}:${hashKey(passage)}`;
    let statusFetches = 0;
    globalThis.fetch = async () => {
      statusFetches++;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: {
        parts: [{ text: JSON.stringify({ passages: [{ id: responseKey, swaps: [] }] }) }],
      } }] }) };
    };
    const statusSetHeld = new Promise((resolve) => { modelStatusSetStarted = resolve; });
    blockModelStatusSet = true;
    const pendingStatusSet = dispatch({ type: 'swaps', revision: beforeStatusSet.revision,
      items: [{ key: responseKey, text: passage }], title: 'Ordinary reading' }, page);
    await statusSetHeld;
    origins = [];
    const statusRevocation = Promise.all(permissionRemoved.map((notify) => notify()));
    releaseModelStatusSet();
    expect((await pendingStatusSet).stale).toBe(true);
    expect(statusFetches).toBe(1);
    await statusRevocation;
    origins = ['<all_urls>'];
    await Promise.all(permissionAdded.map((notify) => notify()));

    const allowedStatusSet = await dispatch({ type: 'config' }, page);
    responseKey = `${allowedStatusSet.revision}:${hashKey(passage)}`;
    const allowedStatusSetHeld = new Promise((resolve) => { modelStatusSetStarted = resolve; });
    blockModelStatusSet = true;
    const pendingAllowedStatusSet = dispatch({ type: 'swaps', revision: allowedStatusSet.revision,
      items: [{ key: responseKey, text: passage }], title: 'Ordinary reading' }, page);
    await allowedStatusSetHeld;
    releaseModelStatusSet();
    expect((await pendingAllowedStatusSet).results[responseKey]).toEqual([]);
    expect(statusFetches).toBe(2);

    // A popup site-off cannot commit through the final title lookup after
    // model-status persistence; delivery and the save share the storage lock.
    const beforeFinalTitle = await dispatch({ type: 'config' }, page);
    responseKey = `${beforeFinalTitle.revision}:${hashKey(otherText)}`;
    const finalTitleHeld = new Promise((resolve) => { titleLookupStarted = resolve; });
    blockTitleAfterModelStatus = true;
    const pendingFinalTitle = dispatch({ type: 'swaps', revision: beforeFinalTitle.revision,
      items: [{ key: responseKey, text: otherText }], title: 'Ordinary reading' }, page);
    await finalTitleHeld;
    const offDuringTitle = dispatch({ type: 'save', settings: { enabled: false } }, popup);
    expect(await Promise.race([offDuringTitle.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 20))])).toBe(false);
    expect(data.settings.enabled).toBe(true);
    releaseTitleLookup();
    expect((await pendingFinalTitle).results[responseKey]).toEqual([]);
    expect((await offDuringTitle).ok).toBe(true);
    expect(data.settings.enabled).toBe(false);
    expect((await dispatch({ type: 'save', settings: { enabled: true } }, popup)).ok).toBe(true);

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
    await new Promise((resolve) => setTimeout(resolve, 0)); // let update check queue its reload
    const offPending = dispatch({ type: 'save', settings: { enabled: false } }, popup);
    releaseSeenRead();
    const within = async (promise) => {
      let timer;
      try {
        return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve('timed out'), 3000); })]);
      } finally { clearTimeout(timer); }
    };
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

    // A response sent with a replaced key must not restore either quota state
    // or status, even when it arrives after the new key's save has committed.
    const lateText = 'People read books and discuss quiet evenings together.';
    const oldKeyEpoch = data.keyEpoch;
    const old = await dispatch({ type: 'config' }, page);
    const oldKey = `${old.revision}:${hashKey(lateText)}`;
    let startedOld;
    const oldSent = new Promise((resolve) => { startedOld = resolve; });
    let finishOld;
    globalThis.fetch = async () => {
      startedOld();
      return new Promise((resolve) => { finishOld = resolve; });
    };
    const lateFailure = dispatch({ type: 'swaps', revision: old.revision,
      items: [{ key: oldKey, text: lateText }] }, page);
    await oldSent;
    expect((await dispatch({ type: 'save', apiKey: 'replacement-key' }, popup)).ok).toBe(true);
    expect(data.keyEpoch).not.toBe(oldKeyEpoch);
    finishOld({ ok: false, status: 429, text: async () => JSON.stringify({ error: {
      status: 'quota_exceeded', message: 'secret old-key error',
    } }), headers: { get: () => null } });
    expect((await lateFailure).stale).toBe(true);
    expect(data.modelStatus).toBeNull();
    expect(data.quotaState.cooldowns).toEqual({});
    expect(JSON.stringify(data.quotaState)).not.toContain('replacement-key');

    const latest = await dispatch({ type: 'config' }, page);
    const successKey = `${latest.revision}:${hashKey(lateText)}`;
    let startedSuccess;
    const successSent = new Promise((resolve) => { startedSuccess = resolve; });
    let finishSuccess;
    globalThis.fetch = async () => {
      startedSuccess();
      return new Promise((resolve) => { finishSuccess = resolve; });
    };
    const lateSuccess = dispatch({ type: 'swaps', revision: latest.revision,
      items: [{ key: successKey, text: lateText }] }, page);
    await successSent;
    expect((await dispatch({ type: 'save', apiKey: 'newest-key' }, popup)).ok).toBe(true);
    finishSuccess({ ok: true, status: 200, json: async () => ({ candidates: [{ content: {
      parts: [{ text: JSON.stringify({ passages: [{ id: successKey, swaps: [] }] }) }],
    } }] }) });
    expect((await lateSuccess).stale).toBe(true);
    expect(data.modelStatus).toBeNull();
    expect(data.quotaState.cooldowns).toEqual({});

    // A failed local call-count write must stop before either the primary or
    // fallback fetch, and the error returned to the page is fixed local copy.
    expect((await dispatch({ type: 'save', settings: { model: 'gemini-3.8-flash' } }, popup)).ok).toBe(true);
    const beforeFailedCount = await dispatch({ type: 'config' }, page);
    const failedCountKey = `${beforeFailedCount.revision}:${hashKey(lateText)}`;
    let failedCountFetches = 0;
    globalThis.fetch = async () => { failedCountFetches++; throw new Error('Unexpected dispatch'); };
    failCounterSetOnce = true;
    const failedCount = await dispatch({ type: 'swaps', revision: beforeFailedCount.revision,
      items: [{ key: failedCountKey, text: lateText }] }, page);
    expect(failedCount.error).toBe('Local reading storage failed');
    expect(failedCountFetches).toBe(0);
    expect(JSON.stringify(data.modelStatus)).not.toContain('Private storage failure text');
    expect((await dispatch({ type: 'save', settings: { model: 'gemini-3.5-flash-lite' } }, popup)).ok).toBe(true);

    // A normal settings change rotates page revision but must keep the key's
    // operational cooldown, which is scoped to a separate random epoch.
    const sameKeyEpoch = data.keyEpoch;
    data.quotaState.cooldowns['gemini-3.8-flash'] = { until: Date.now() + 60000, kind: 'short',
      setAt: Date.now(), durationMs: 60000 };
    expect((await dispatch({ type: 'save', settings: { density: 'heavy' } }, popup)).ok).toBe(true);
    expect(data.keyEpoch).toBe(sameKeyEpoch);
    expect(data.quotaState.cooldowns['gemini-3.8-flash'].kind).toBe('short');
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: '0.5.0' }) });
    data.modelStatus = { at: Date.now(), category: 'daily_quota' };
    expect((await dispatch({ type: 'status' }, popup)).modelStatus).toBeNull();
    data.quotaState.cooldowns['gemini-3.8-flash'] = { until: Date.now() - 1, kind: 'daily' };
    expect((await dispatch({ type: 'status' }, popup)).modelStatus).toBeNull();
    data.quotaState.cooldowns['gemini-3.8-flash'] = { until: Date.now() + 60000, kind: 'daily',
      setAt: Date.now(), durationMs: 60000 };
    expect((await dispatch({ type: 'status' }, popup)).modelStatus.category).toBe('daily_quota');
    expect((await dispatch({ type: 'reviewStatus' }, review)).due).toBe(5);
  } finally { Object.assign(globalThis, saved); }
});

import { test, expect } from 'bun:test';
import { cleanPack } from '../src/languages.js';

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
  const on = (arr = []) => ({ addListener: (fn) => arr.push(fn) });
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        const pick = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
        return structuredClone(Object.fromEntries(pick.filter((k) => k in data).map((k) => [k, data[k]])));
      },
      async set(value) { Object.assign(data, structuredClone(value)); },
      async remove(keys) { for (const key of keys) delete data[key]; },
    } },
    runtime: { id: 'lang-test', getURL: (path) => `chrome-extension://lang-test/${path}`,
      getManifest: () => ({ version: '0.5.0' }), onMessage: on(handlers), onInstalled: on(), onStartup: on() },
    tabs: { query: async () => [], sendMessage: async () => {} },
    action: { setBadgeText: async () => {} }, alarms: { create: async () => {}, onAlarm: on() },
    permissions: { getAll: async () => ({ origins: ['<all_urls>'] }), onAdded: on(), onRemoved: on() },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
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
    expect((await dispatch({ type: 'reviewStatus' }, review)).due).toBe(5);
    expect(data.recallReview).toEqual(spanish);
    expect(data.readingEvents[0].word).toBe('no');
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
    globalThis.fetch = async () => { throw new Error('Unexpected model request'); };

    // A suspended MV3 worker is reconstructed from storage without resetting selection or histories.
    handlers.length = 0;
    await import('../src/background.js?language-restarted');
    expect((await dispatch({ type: 'config' }, page)).language).toBe('es');
    expect((await dispatch({ type: 'reviewStatus' }, review)).due).toBe(5);
    expect(data['lang:fr:' + data.languagePacks.fr.version + ':recallReview'].cards.mot0).toBeDefined();
  } finally { Object.assign(globalThis, saved); }
});

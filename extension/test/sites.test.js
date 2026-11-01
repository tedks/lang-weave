import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createSites } from '../src/sites.js';
import { storeManifest } from '../scripts/package.mjs';

const dev = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

// The dynamic registration excludes exactly the hosts the running manifest injects into itself. With the dev
// manifest that is X; the Store manifest declares no content script, so a granted X must be registered.
async function register(manifest, { origins, existing = [] }) {
  const saved = globalThis.chrome;
  const calls = [];
  globalThis.chrome = {
    runtime: { getManifest: () => structuredClone(manifest) },
    permissions: { getAll: async () => ({ origins }) },
    scripting: {
      getRegisteredContentScripts: async () => existing,
      registerContentScripts: async (scripts) => { calls.push(['register', scripts]); },
      updateContentScripts: async (scripts) => { calls.push(['update', scripts]); },
      unregisterContentScripts: async (filter) => { calls.push(['unregister', filter]); },
    },
  };
  try {
    await createSites({ store: {}, locked: (fn) => fn(), worker: {}, broadcast: () => {} }).registerSites();
  } finally { globalThis.chrome = saved; }
  return calls;
}

const granted = ['https://x.com/*', 'https://example.com/*', 'https://generativelanguage.googleapis.com/*'];

test('dev manifest: a granted X stays with the manifest content script, never registered twice', async () => {
  const [[kind, [script]]] = await register(dev, { origins: granted });
  expect(kind).toBe('register');
  expect(script.matches).toEqual(['https://x.com/*', 'https://example.com/*']);
  expect(script.excludeMatches).toEqual(['https://x.com/*', 'https://twitter.com/*']);
  expect(script.persistAcrossSessions).toBe(true);
});

test('store manifest: a granted X is registered like any other site, with an explicit empty exclusion', async () => {
  for (const existing of [[], [{ id: 'weave-sites' }]]) {
    const [[kind, [script]]] = await register(storeManifest(dev), { origins: granted, existing });
    expect(kind).toBe(existing.length ? 'update' : 'register');
    expect(script.matches).toEqual(['https://x.com/*', 'https://example.com/*']);
    expect(script.excludeMatches).toEqual([]); // explicit: update must clear a stale exclusion
    expect(script.js).toEqual(['src/content-loader.js']);
    expect(script.persistAcrossSessions).toBe(true);
  }
});

test('only manifest loader entries are excluded; an unrelated manifest script never blocks a granted host', async () => {
  const manifest = { ...structuredClone(dev), content_scripts: [...dev.content_scripts,
    { matches: ['https://example.com/*'], js: ['src/other.js'] }] };
  const [[, [script]]] = await register(manifest, { origins: granted });
  expect(script.excludeMatches).toEqual(['https://x.com/*', 'https://twitter.com/*']);
  expect(script.matches).toContain('https://example.com/*');
});

test('no grants: nothing registered, an earlier registration is removed', async () => {
  expect(await register(storeManifest(dev), { origins: ['https://generativelanguage.googleapis.com/*'] })).toEqual([]);
  expect(await register(dev, { origins: [], existing: [{ id: 'weave-sites' }] }))
    .toEqual([['unregister', { ids: ['weave-sites'] }]]);
});

test('startup recovery probes granted tabs, rechecks consent, and injects each absent script once', async () => {
  const saved = globalThis.chrome;
  const calls = [];
  let consentShown = true;
  const tabs = new Map([
    [1, { id: 1, url: 'https://example.com/article', title: 'Ordinary reading' }],
    [2, { id: 2, url: 'https://example.com/already', title: 'Ordinary reading' }],
    [3, { id: 3, url: 'https://mail.google.com/inbox', title: 'Inbox' }],
    [4, { id: 4, url: 'chrome-extension://test/src/welcome.html', title: 'Welcome' }],
    [5, { id: 5, title: 'Hidden URL' }],
    [7, { id: 7, url: 'https://example.com/importing', title: 'Ordinary reading' }],
  ]);
  const ctx = { hasKey: true, paused: false, settings: { enabled: true, newSitesEnabled: true, siteOverrides: {} },
    origins: ['<all_urls>'] };
  globalThis.chrome = {
    permissions: { getAll: async () => ({ origins: ['<all_urls>'] }) },
    tabs: {
      query: async (filter) => { calls.push(['query', filter]); return [...tabs.values()]; },
      get: async (id) => tabs.get(id),
      sendMessage: async (id, msg, options) => {
        calls.push(['ping', id, msg, options]);
        if (id === 2) return { ok: false }; // a false reply still proves a content handler is present
        throw new Error('No receiving end');
      },
    },
    scripting: {
      insertCSS: async (args) => { calls.push(['css', args]); },
      executeScript: async (args) => {
        calls.push([args.func ? 'marker' : 'script', args]);
        return args.func ? [{ result: args.target.tabId === 7 }] : [];
      },
    },
  };
  const store = { get: async () => ({ consentShown }) };
  try {
    const sites = createSites({ store, locked: (fn) => fn(), worker: {}, broadcast: () => {}, context: async () => ctx });
    await sites.recoverOpenTabs();
    await sites.recoverOpenTabs();
    expect(calls.filter(([kind]) => kind === 'query')).toHaveLength(2);
    expect(calls.find(([kind]) => kind === 'query')[1]).toEqual({ url: ['http://*/*', 'https://*/*'] });
    expect(calls.filter(([kind]) => kind === 'script')).toEqual([
      ['script', { target: { tabId: 1 }, files: ['src/content-loader.js'] }],
    ]);
    expect(calls.filter(([kind]) => kind === 'css')).toHaveLength(1);
    expect(calls.filter(([kind]) => kind === 'marker')).toHaveLength(3);
    expect(calls.filter(([kind]) => kind === 'ping').map(([, id]) => id)).toEqual([1, 2, 7, 2, 7]);
    consentShown = false;
    tabs.set(6, { id: 6, url: 'https://example.com/new', title: 'Ordinary reading' });
    await sites.recoverOpenTabs();
    expect(calls.filter(([kind]) => kind === 'script')).toHaveLength(1);
  } finally { globalThis.chrome = saved; }
});

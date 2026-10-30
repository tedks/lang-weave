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

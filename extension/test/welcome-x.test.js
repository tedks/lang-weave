import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { suggestX, allowSuggestedX } from '../src/welcome.js';
import { storeManifest } from '../scripts/package.mjs';
import { hasSiteAccess } from '../src/settings.js';

test('X suggestion follows the running manifest and grants from the click before saving', async () => {
  const previous = globalThis.chrome;
  const dev = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const calls = [];
  try {
    globalThis.chrome = { runtime: { getManifest: () => dev } };
    expect(suggestX()).toBe(false);
    globalThis.chrome.runtime.getManifest = () => storeManifest(dev);
    expect(suggestX()).toBe(true);
    expect(hasSiteAccess('https://x.com/someone/status/1', storeManifest(dev).optional_host_permissions)).toBe(true);
    const request = () => { calls.push('request'); return Promise.resolve(true); };
    const save = () => { calls.push('save'); return Promise.resolve(true); };
    const pending = allowSuggestedX({ request, save });
    expect(calls).toEqual(['request']);
    expect(await pending).toBe(true);
    expect(calls).toEqual(['request', 'save']);
    calls.length = 0;
    expect(await allowSuggestedX({ request: () => { calls.push('request'); return Promise.resolve(false); }, save })).toBe(false);
    expect(calls).toEqual(['request']);
  } finally { globalThis.chrome = previous; }
});

import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createUpdate, ALARM, RELOADED_KEY, selfUpdating } from '../src/update.js';
import { storeManifest } from '../scripts/package.mjs';

// The self-update runs only for an unpacked install. A Store or Edge install carries update_url in its
// installed manifest; that copy must never fetch its own manifest, reload itself, set the NEW badge or arm the alarm.
function fakeChrome(manifest, diskVersion) {
  const calls = [];
  globalThis.chrome = {
    runtime: {
      getManifest: () => structuredClone(manifest),
      getURL: (path) => `chrome-extension://gate-test/${path}`,
      reload: () => { calls.push('reload'); },
    },
    action: { setBadgeText: async ({ text }) => { calls.push(`badge:${text}`); } },
    alarms: { create: (name, info) => { calls.push(`alarm:${name}:${info.periodInMinutes}`); } },
  };
  globalThis.fetch = async (url) => {
    calls.push(`fetch:${url}`);
    return { json: async () => ({ ...manifest, version: diskVersion }) };
  };
  const data = {};
  const store = {
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (values) => { Object.assign(data, values); },
  };
  const update = createUpdate({ store, locked: (fn) => fn(), modelCall: (fn) => fn() });
  return { calls, data, update };
}

async function withGlobals(fn) {
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  try { await fn(); } finally { Object.assign(globalThis, saved); }
}
const settle = () => new Promise((done) => setTimeout(done, 10));

test('an unpacked install (no update_url) keeps the self-update: alarm, disk check, one reload', () => withGlobals(async () => {
  const { calls, data, update } = fakeChrome({ version: '1.0.0' }, '1.0.1');
  expect(selfUpdating()).toBe(true);
  update.arm();
  await settle();
  expect(calls).toEqual([`alarm:${ALARM}:30`, 'fetch:chrome-extension://gate-test/manifest.json', 'reload']);
  expect(data[RELOADED_KEY]).toBe('1.0.1');
  // Chrome kept the old copy: the second check shows NEW instead of reloading again.
  expect(await update.checkUpdate()).toBe('1.0.1');
  expect(calls.at(-1)).toBe('badge:NEW');
}));

test('a Store or Edge install (update_url present) never self-updates, badges or arms the alarm', () => withGlobals(async () => {
  for (const update_url of ['https://clients2.google.com/service/update2/crx',
    'https://edge.microsoft.com/extensionwebstorebase/v1/crx', '']) {
    const { calls, data, update } = fakeChrome({ version: '1.0.0', update_url }, '1.0.1');
    expect(selfUpdating()).toBe(false);
    update.arm();
    expect(await update.checkUpdate()).toBe('');
    await settle();
    expect(calls).toEqual([]);
    expect(data).toEqual({});
  }
}));

test('neither the source manifest nor the Store build carries update_url, so unpacked loads stay self-updating', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  expect(Object.hasOwn(manifest, 'update_url')).toBe(false);
  expect(Object.hasOwn(storeManifest(manifest), 'update_url')).toBe(false);
});

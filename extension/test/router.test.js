import { test, expect } from 'bun:test';
import { SURFACES, senderSurfaces, surfaceAllows } from '../src/router.js';

// Pinned from the pre-split authorization boolean (background.js at ac71cb7, lines 1243-1289),
// derived by evaluating that exact expression over every handler name. A change here is a
// change to who may send what: it needs its own review, never a drive-by edit.
const PINNED = {
  popup: ['recoverBudget', 'save', 'status'],
  options: ['addLanguage', 'clearCache', 'removeKey', 'removeLanguage', 'save', 'status', 'testKey'],
  welcome: ['save'],
  // learningStats (0.12.6): read-only local measurements, review page only.
  review: ['learningStats', 'reviewIntroduce', 'reviewKnown', 'reviewNext', 'reviewRate', 'reviewReveal', 'reviewStatus'],
  capture: ['captureCancel', 'captureDraft', 'captureKeepAlive', 'captureSave', 'personalArchive',
    'personalExport', 'personalIntroduce', 'personalList'],
  backup: ['learningExport', 'learningImport', 'learningPreview'],
  page: ['captureReady', 'config', 'event', 'inlineBegin', 'inlineRate', 'inlineReveal', 'introAck',
    'introRelease', 'introRenew', 'swaps'],
};
const HANDLERS = [...new Set(Object.values(PINNED).flat())].sort();
const TYPES = [...HANDLERS, 'constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', '',
  'Config', 'swaps ', 'nope', undefined, null, 7];

const ID = 'fw-router';
const BASE = `chrome-extension://${ID}/`;
const SENDERS = {
  popup: { id: ID, url: `${BASE}src/popup.html` },
  options: { id: ID, url: `${BASE}src/options.html` },
  welcome: { id: ID, url: `${BASE}src/welcome.html` },
  review: { id: ID, url: `${BASE}src/review.html` },
  capture: { id: ID, url: `${BASE}src/capture.html?nonce=abc` },
  backup: { id: ID, url: `${BASE}src/backup.html` },
  page: { id: ID, tab: { id: 1 }, frameId: 0, url: 'https://example.com/article' },
};
// Senders that match no surface, or a surface other than the one their URL suggests.
const NEAR_MISSES = [
  [{ id: ID, url: `${BASE}src/popup.html?x=1` }, []],
  [{ id: ID, url: `${BASE}src/popup.html#top` }, []],
  [{ id: ID, url: `${BASE}src/review.html?card=1` }, []],
  [{ id: ID, url: `${BASE}src/backup.html?x=1` }, []],
  [{ id: ID, url: `${BASE}src/options.html?x=1` }, []],
  [{ id: ID, url: `${BASE}src/options.html#top` }, []],
  [{ id: ID, url: `${BASE}src/welcome.html?x=1` }, []],
  [{ id: ID, url: `${BASE}src/welcome.html#privacy` }, []],
  [{ id: 'another-id', url: `${BASE}src/welcome.html` }, ['welcome']], // worker rejects the foreign ID first
  [{ id: ID, url: `${BASE}src/sidepanel.html` }, []],
  [{ id: ID, url: `${BASE}src/capture.htm` }, []],
  [{ id: ID, url: `${BASE}capture.html` }, []],
  [{ id: ID, url: 'chrome-extension://another-id/src/capture.html' }, []],
  [{ id: ID, url: 'https://example.com/src/capture.html' }, []],
  [{ id: ID, url: 'https://example.com/article' }, []], // a page surface needs a tab
  [{ id: ID, tab: { id: 1 }, url: 'file:///tmp/a.html' }, []],
  [{ id: ID, tab: { id: 1 }, url: 'ftp://example.com/' }, []],
  [{ id: ID, tab: { id: 1 } }, []],
  [{ id: ID }, []],
  [{ id: ID, tab: { id: 1 }, url: 'http://example.com/' }, ['page']],
  [{ id: ID, tab: { id: 2 }, url: `${BASE}src/popup.html` }, ['popup']], // popup opened in a tab
  [{ id: ID, tab: { id: 2 }, url: `${BASE}src/options.html` }, ['options']], // Chrome options in a tab
  [{ id: ID, tab: { id: 2 }, url: `${BASE}src/welcome.html` }, ['welcome']],
  [{ id: ID, tab: { id: 2 }, url: `${BASE}src/capture.html?nonce=x` }, ['capture']],
  [{ id: ID, url: `${BASE}src/capture.html` }, ['capture']], // personal list needs no selection nonce
  [{ id: 'another-id', url: `${BASE}src/backup.html` }, []], // backup also checks the sender id
];

// The pre-split boolean and its two predicates, verbatim apart from the `handlers` stand-in:
// a differential oracle that shares no code with router.js.
const backupPageUrl = () => chrome.runtime.getURL('src/backup.html');
const backupSender = (sender) => sender?.id === chrome.runtime.id && sender.url === backupPageUrl();
function capturePageSender(sender) {
  try {
    const url = new URL(sender.url);
    const own = new URL(chrome.runtime.getURL('src/capture.html'));
    return url.protocol === 'chrome-extension:' && url.host === own.host &&
      url.pathname === own.pathname;
  } catch { return false; }
}
function legacyAllows(msg, sender) {
  const handlers = Object.fromEntries(HANDLERS.map((type) => [type, () => {}]));
  const popup = sender.url === chrome.runtime.getURL('src/popup.html');
  const review = sender.url === chrome.runtime.getURL('src/review.html');
  const backup = backupSender(sender);
  const capture = capturePageSender(sender);
  const page = sender.tab && /^https?:\/\//.test(sender.url || '');
  const reviews = ['reviewStatus', 'reviewIntroduce', 'reviewNext', 'reviewReveal', 'reviewRate', 'reviewKnown', 'learningStats'];
  if (!handlers[msg.type] || !(popup && ['status', 'clearCache', 'save', 'addLanguage', 'removeLanguage', 'reviewStatus', 'recoverBudget'].includes(msg.type)) &&
      !(review && reviews.includes(msg.type)) &&
      !(capture && ['captureDraft', 'captureKeepAlive', 'captureSave', 'captureCancel', 'personalList',
        'personalArchive', 'personalIntroduce', 'personalExport'].includes(msg.type)) &&
      !(backup && ['learningExport', 'learningPreview', 'learningImport'].includes(msg.type)) &&
      !(page && ['config', 'captureReady', 'swaps', 'event', 'inlineBegin', 'inlineReveal', 'inlineRate', 'introAck', 'introRelease', 'introRenew'].includes(msg.type))) return false;
  return true;
}

const withChrome = (fn) => {
  const prior = globalThis.chrome;
  globalThis.chrome = { runtime: { id: ID, getURL: (path) => `${BASE}${path}` } };
  try { return fn(); } finally { globalThis.chrome = prior; }
};

test('router table pins exactly each surface message set', () => {
  expect(Object.fromEntries(SURFACES.map(({ name, messages }) => [name, [...messages].sort()]))).toEqual(PINNED);
  expect(Object.isFrozen(SURFACES)).toBe(true);
  for (const surface of SURFACES) {
    expect(Object.isFrozen(surface)).toBe(true);
    expect(Object.isFrozen(surface.messages)).toBe(true);
  }
});

test('each surface sender receives exactly its pinned messages and nothing else', () => withChrome(() => {
  for (const [name, sender] of Object.entries(SENDERS)) {
    const surfaces = senderSurfaces(sender);
    expect([...surfaces]).toEqual([name]);
    expect(TYPES.filter((type) => surfaceAllows(surfaces, type))).toEqual(PINNED[name]);
  }
  expect(TYPES.filter((type) => surfaceAllows(new Set(), type))).toEqual([]);
  for (const type of ['addLanguage', 'removeLanguage', 'clearCache', 'removeKey', 'testKey', 'reviewStatus'])
    expect(surfaceAllows(senderSurfaces(SENDERS.popup), type)).toBe(false);
}));

test('near-miss senders match no surface, or only the one the old boolean matched', () => withChrome(() => {
  for (const [sender, expected] of NEAR_MISSES) {
    expect([...senderSurfaces(sender)]).toEqual(expected);
    const allowed = TYPES.filter((type) => surfaceAllows(senderSurfaces(sender), type));
    expect(allowed).toEqual(expected.length ? PINNED[expected[0]] : []);
  }
}));

test('unmodified sender decisions equal the pre-split boolean', () => withChrome(() => {
  const senders = [...Object.entries(SENDERS).filter(([name]) => !['popup', 'options', 'welcome'].includes(name)).map(([, sender]) => sender),
    ...NEAR_MISSES.filter(([sender]) => !sender.url?.includes('/src/welcome.html') &&
      !['popup', 'options'].includes(sender.url?.split('/').at(-1)?.split('.')[0])).map(([sender]) => sender)];
  let checked = 0;
  for (const sender of senders) for (const type of TYPES.filter((type) => !['removeKey', 'testKey'].includes(type))) {
    expect([sender.url, type, surfaceAllows(senderSurfaces(sender), type)])
      .toEqual([sender.url, type, legacyAllows({ type }, sender)]);
    checked++;
  }
  expect(checked).toBe(senders.length * (TYPES.length - 2));
}));

// The production listener: the sender-id gate runs first, then the table; every pinned
// message has a handler (dispatched, so the listener returns true) and nothing else does.
test('worker listener dispatches exactly the pinned messages per surface and nothing for foreign senders', async () => {
  const saved = Object.fromEntries(['chrome', 'fetch', 'setTimeout'].map((k) => [k, globalThis[k]]));
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => (ms >= 10000 ? 0 : realTimeout(fn, ms, ...rest));
  const data = { settings: { enabled: true, newSitesEnabled: true } };
  const listeners = [];
  const on = (arr = []) => ({ addListener: (fn) => arr.push(fn) });
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        const pick = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
        return structuredClone(Object.fromEntries(pick.filter((k) => k in data).map((k) => [k, data[k]])));
      },
      async set(values) { for (const [k, v] of Object.entries(values)) data[k] = structuredClone(v); },
      async remove(keys) { for (const k of [keys].flat()) delete data[k]; },
    } },
    runtime: { id: ID, getURL: (path) => `${BASE}${path}`, getManifest: () => ({ version: '0.0.0' }),
      onMessage: on(listeners), onInstalled: on(), onStartup: on(), onConnect: on() },
    action: { setBadgeText: async () => {} },
    tabs: { get: async () => ({ id: 1, title: 'Reading', url: SENDERS.page.url }), query: async () => [],
      sendMessage: async () => {}, create: async () => ({ id: 9 }) },
    alarms: { create: async () => {}, onAlarm: on() },
    permissions: { getAll: async () => ({ origins: [] }), onAdded: on(), onRemoved: on() },
    scripting: { getRegisteredContentScripts: async () => [], updateContentScripts: async () => {},
      unregisterContentScripts: async () => {}, registerContentScripts: async () => {} },
  };
  globalThis.fetch = async () => { throw new Error('no network in router tests'); };
  // Returns the listener's synchronous decision, then waits for any dispatched reply so no
  // handler work leaks past this test.
  const dispatch = async (msg, sender) => {
    let replied;
    const reply = new Promise((done) => { replied = done; });
    const accepted = listeners.some((fn) => fn(msg, sender, replied));
    if (accepted) await Promise.race([reply, new Promise((done) => realTimeout(done, 2000))]);
    return accepted;
  };
  try {
    await import('../src/background.js?router');
    expect(listeners).toHaveLength(1);
    for (const [name, sender] of Object.entries(SENDERS)) {
      const accepted = [];
      for (const type of TYPES) if (await dispatch({ type }, sender)) accepted.push(type);
      expect([name, accepted]).toEqual([name, PINNED[name]]);
      for (const type of TYPES) expect(await dispatch({ type }, { ...sender, id: 'another-extension' })).toBe(false);
    }
    for (const [sender, expected] of NEAR_MISSES) {
      const accepted = [];
      for (const type of TYPES) if (await dispatch({ type }, sender)) accepted.push(type);
      expect([sender.url, accepted]).toEqual([sender.url,
        sender.id === ID && expected.length ? PINNED[expected[0]] : []]);
    }
    expect(await dispatch(null, SENDERS.popup)).toBe(false);
    expect(await dispatch(undefined, SENDERS.page)).toBe(false);
  } finally {
    for (const [k, v] of Object.entries(saved)) globalThis[k] = v;
  }
});

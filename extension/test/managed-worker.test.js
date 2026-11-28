import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { MAX_REQUEST_CHARS } from '../src/adaptive.js';
import { memoryStorage } from '../src/cache.js';
import { requestSwaps } from '../src/engine.js';
import { localDay, SENT_KEY } from '../src/events.js';
import { API_BASE } from '../src/gemini.js';
import { hashKey } from '../src/hash.js';
import { cleanPack, validField } from '../src/languages.js';
import { wordsForLevel } from '../src/levels.js';
import { MANAGED_BASE } from '../src/managed.js';
import { MAX_PERSONAL, PERSONAL_KEY, validForm } from '../src/personal.js';
import { createBackup, parseBackup, targetFresh } from '../src/portability.js';
import { DAILY_MODEL_CALLS } from '../src/quota.js';
import { statusLabel } from '../src/quota-status.js';
import { buildSwapRequest, canonicalSwapBody } from '../src/swap-request.js';
import { validPackForm } from '../src/word-form.js';
import { advanceDOMTime, restoreTimedDOM, useDOMClock } from './dom-clock.js';
import manifest from '../manifest.json';

const token = `lwk_${'z'.repeat(43)}`;
const article = 'I opened the window and looked out over the yard.';
const page = { id: 'managed-test', tab: { id: 1, title: 'Ordinary reading' }, frameId: 0,
  documentId: 'document-1', documentLifecycle: 'active', url: 'https://example.com/article' };
const extensionOrigin = 'chrome-extension://managed-test';
const options = { id: page.id, url: `${extensionOrigin}/src/options.html` };
const jsonError = (status, category, flags) => Response.json({ error: { category, ...flags } }, { status });
const success = (passages) => Response.json({ text: JSON.stringify({ passages: emptySwaps(passages) }),
  usage: null, costMicros: 7, balanceMicros: 1000 });
const emptySwaps = (passages) => passages.map(({ id }) => ({ id, swaps: [] }));

async function workerFixture({ initial = {}, isolation = true, respond }) {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const data = { epoch: 'reading-epoch', keyEpoch: 'byok-epoch', managedToken: token,
    settings: { managedProvider: true, enabled: true, newSitesEnabled: true, model: 'gemini-3.8-flash' }, ...initial };
  const calls = [], listeners = [], connections = [], accessLevels = [], gets = [];
  const on = (list = []) => ({ addListener: (fn) => list.push(fn) });
  const store = {
    async get(keys) {
      const names = keys == null ? Object.keys(data) : [keys].flat();
      gets.push(names);
      return structuredClone(Object.fromEntries(names.filter((key) => key in data).map((key) => [key, data[key]])));
    },
    async set(patch) { Object.assign(data, structuredClone(patch)); },
    async remove(keys) { for (const key of [keys].flat()) delete data[key]; },
  };
  if (isolation) store.setAccessLevel = async ({ accessLevel }) => { accessLevels.push(accessLevel); };
  globalThis.chrome = {
    storage: { local: store, session: memoryStorage() },
    runtime: { id: page.id, getURL: (path) => `${extensionOrigin}/${path}`, getManifest: () => manifest,
      onMessage: on(listeners), onConnect: on(connections), onInstalled: on(), onStartup: on() },
    action: { setBadgeText: async () => {} },
    tabs: { get: async () => ({ title: page.tab.title, url: page.url }), query: async () => [], sendMessage: async () => {} },
    permissions: { getAll: async () => ({ origins: ['https://example.com/*'] }), onAdded: on(), onRemoved: on() },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  };
  globalThis.fetch = async (url, { signal, ...init } = {}) => {
    if (url === `${extensionOrigin}/manifest.json`) return Response.json(manifest);
    calls.push({ url, ...init });
    if (!respond) throw new Error('Unexpected external request in worker fixture');
    return respond(url, init, calls.length);
  };
  const send = (msg, sender = page) => new Promise((done) => {
    if (!listeners.some((listener) => listener(msg, sender, done))) done(undefined);
  });
  const ask = async (texts = [article]) => {
    const { revision } = await send({ type: 'config' });
    const items = texts.map((text) => ({ key: `${revision}:${hashKey(text)}`, text }));
    const reply = await send({ type: 'swaps', revision, items, title: page.tab.title });
    return { reply, ids: items.map(({ key }) => key), items };
  };
  const backup = () => {
    const sender = { id: page.id, url: `${extensionOrigin}/src/backup.html`, documentId: 'backup-doc' };
    const messages = [], pageId = crypto.randomUUID();
    const port = { name: 'learning-backup-page', sender, onMessage: on(messages), onDisconnect: on(),
      postMessage: (reply) => expect(reply).toEqual({ ready: true, pageId }) };
    connections[0](port);
    messages[0]({ pageId });
    return (msg) => send({ ...msg, pageId }, sender);
  };
  try { await import(`../src/background.js?managed-worker-${crypto.randomUUID()}`); }
  catch (error) { Object.assign(globalThis, old); throw error; }
  return { calls, accessLevels, gets, data, send, ask, backup, restore() { Object.assign(globalThis, old); } };
}

test('a managed credential stays private, and unavailable isolation prevents activation and dispatch', async () => {
  const f = await workerFixture({ isolation: false, initial: { apiKey: 'synthetic-byok' } });
  try {
    const config = await f.send({ type: 'config' });
    expect(config.hasKey).toBe(false);
    expect(JSON.stringify(config)).not.toContain(token);
    expect((await f.ask()).reply).toEqual({ results: {}, stale: true });
    expect(f.calls).toHaveLength(0);
    expect(f.gets.some((keys) => keys.includes('managedToken'))).toBe(false);
    const error = statusLabel({ category: 'key_isolation_unavailable' });
    expect((await f.send({ type: 'status' }, options)).modelStatus).toEqual({ category: 'key_isolation_unavailable' });
    expect(await f.send({ type: 'save', settings: { managedProvider: true } }, options)).toEqual({ error });
    expect(f.data.managedToken).toBe(token);
    expect(f.data.settings.managedToken).toBeUndefined();
  } finally { f.restore(); }
});

test('managed reading maps proxy messages and keeps BYOK credentials and cooldowns separate', async () => {
  const byokStatus = { category: 'key_rejected', keyEpoch: 'byok-epoch' };
  const cases = [
    [409, 'managed_update_required', { ahead: true }, 'Managed reading is updating; try again later'],
    [409, 'managed_update_required', { ahead: false }, 'Update Lang Weave to keep using managed reading'],
    [401, 'managed_unauthorized', {}, 'Managed reading could not verify this token.'],
    [402, 'managed_balance', { dailyCap: true }, 'Managed reading has insufficient available credit.'],
    [503, 'managed_unavailable', {}, 'Managed reading is temporarily unavailable.'],
  ];
  const f = await workerFixture({ initial: { modelStatus: byokStatus }, respond(url, init, call) {
    expect(url).toBe(`${MANAGED_BASE}/v0/swaps`);
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(init.body).model).toBe('gemini-3.5-flash-lite');
    const [status, category, details] = cases[call - 1];
    return jsonError(status, category, details);
  } });
  try {
    const config = await f.send({ type: 'config' });
    expect(config.hasKey).toBe(true);
    expect(JSON.stringify(config)).not.toContain(token);
    expect(f.accessLevels).toEqual(['TRUSTED_CONTEXTS']);
    for (const [index, [, category, details, message]] of cases.entries()) {
      expect((await f.ask()).reply.error).toBe(message);
      const status = (await f.send({ type: 'status' }, options)).modelStatus;
      expect(status).toMatchObject({ category, ...(Object.hasOwn(details, 'ahead') ? { ahead: details.ahead } : {}) });
      expect(statusLabel(status)).toBe(message);
      expect(f.calls).toHaveLength(index + 1);
    }
    expect(f.data.modelStatus).toEqual(byokStatus);
    expect(f.data.quotaState).toBeUndefined();
  } finally { f.restore(); }
});

test('flag off preserves both BYOK requests byte for byte with a managed token present', async () => {
  const snapshots = [];
  for (const explicit of [{}, { managedProvider: false }]) {
    const f = await workerFixture({ initial: { apiKey: 'synthetic-byok', settings: { ...explicit, newSitesEnabled: true,
      model: 'gemini-3.8-flash' } }, respond(url, init, call) {
      expect(url).toStartWith(API_BASE);
      if (call === 1) return new Response('{}', { status: 503 });
      const body = JSON.parse(init.body);
      const passages = JSON.parse(body.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      const text = JSON.stringify({ passages: emptySwaps(passages) });
      return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
    } });
    try {
      const { reply, ids, items } = await f.ask();
      expect(reply).toEqual({ results: { [ids[0]]: [] } });
      const batch = items.map(({ key, text }) => ({ id: key, text }));
      const words = wordsForLevel(1).map((word) => ({ ...word, status: 'active' }));
      const body = JSON.stringify(buildSwapRequest({ batch, words, level: 1, language: 'es' }));
      expect(f.calls).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite'].map((model) => ({
        url: `${API_BASE}${model}:generateContent`, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'synthetic-byok' }, body,
      })));
      expect(f.gets.some((keys) => keys.includes('managedToken'))).toBe(false);
      snapshots.push(f.calls);
    } finally { f.restore(); }
  }
  expect(snapshots[0]).toEqual(snapshots[1]);
});

test('backup export drops the managed token and flag; import into a token-bearing profile is refused', async () => {
  const json = createBackup({ managedToken: token, settings: { managedProvider: true, managedToken: token } }, manifest.version);
  expect(parseBackup(json).state.preferences.language).toBe('es');
  for (const secret of [token, 'managedToken', 'managedProvider']) expect(json).not.toContain(secret);
  expect(() => targetFresh({ managedToken: token })).toThrow(/target has a managed token/);
  expect(() => targetFresh({ settings: { managedToken: token } })).toThrow(/target has a managed token/);
  expect(targetFresh({ settings: { managedProvider: true } })).toBe(true);
  const injected = JSON.parse(json);
  injected.state.preferences.managedToken = token;
  expect(() => parseBackup(JSON.stringify(injected))).toThrow(/unsupported preferences field/);

  const f = await workerFixture({});
  try {
    const backup = f.backup();
    expect((await backup({ type: 'learningExport' })).json).not.toContain(token);
    expect((await backup({ type: 'learningPreview', json })).error).toMatch(/target has a managed token/);
    expect(f.data.managedToken).toBe(token);
  } finally { f.restore(); }
});

function maximumCatalog() {
  const pack = cleanPack({ words: Array.from({ length: 80 }, (_, i) => ({
    fr: `wort${i}`.padEnd(50, 'a'), en: `description${i}`.padEnd(60, 'e'),
    hint: `sound${i}`.padEnd(60, 'i'), level: i < 40 ? 1 : 2,
  })) }, 'de');
  const entries = Array.from({ length: MAX_PERSONAL }, (_, i) => ({
    uuid: `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
    language: 'de', source: `personal${i}`.padEnd(80, 'o'), target: `eigen${i}`.padEnd(80, 'u'),
    sense: `meaning${i}`.padEnd(80, 'y'), direction: 'en-to-target',
  }));
  const texts = Array.from({ length: 8 }, (_, i) =>
    `Entry ${i} describes ${pack.words[0].en} and ${entries[0].source}. ${'A green tree grows beside a river. '.repeat(60)}`.slice(0, 2000));
  return { pack, entries, texts };
}

function validatedProxy(url, init) {
  expect(url).toBe(`${MANAGED_BASE}/v0/swaps`);
  const wire = JSON.parse(init.body);
  expect(init.body).toBe(canonicalSwapBody(wire));
  expect(new TextEncoder().encode(init.body).length).toBeLessThanOrEqual(192 * 1024);
  expect(wire.promptVersion).toBe('0.16');
  expect(wire.language).toBe('de');
  expect(wire.passages.length).toBeLessThanOrEqual(8);
  expect(wire.words.length).toBeLessThanOrEqual(400);
  expect(wire.shownToday.every((form) => wire.words.some(({ fr }) => fr === form))).toBe(true);
  for (const { id, text } of wire.passages) {
    expect(id.length).toBeLessThanOrEqual(64);
    expect(text.length).toBe(2000);
  }
  for (const { source, fr, en, status } of wire.words) {
    expect(['active', 'new', 'due', 'known']).toContain(status);
    if (source === 'pack') {
      expect(validPackForm(fr) && validField(en) && en.length <= 60 && /\p{L}/u.test(en)).toBe(true);
    } else {
      expect(source).toBe('personal');
      expect([validForm(fr), validForm(en)]).toEqual([fr, en]);
    }
  }
  const providerBody = buildSwapRequest({ ...wire, unknownLimit: wire.gradual, batch: wire.passages });
  expect(JSON.stringify(providerBody).length).toBeLessThanOrEqual(MAX_REQUEST_CHARS);
  return success(wire.passages);
}

for (const gradual of [true, false]) {
  test(`combined maximum catalog through the ${gradual ? 'gradual' : 'ordinary'} worker`, async () => {
    const { pack, entries, texts } = maximumCatalog();
    expect(pack.words).toHaveLength(80);
    expect(entries).toHaveLength(300);
    for (const row of pack.words) expect([row.fr.length, row.en.length, row.hint.length]).toEqual([50, 60, 60]);
    for (const row of entries) expect([row.source.length, row.target.length, row.sense.length]).toEqual([80, 80, 80]);
    expect(texts.map((text) => text.length)).toEqual(Array(8).fill(2000));
    const scope = `lang:de:${pack.version}`;
    const extras = Array.from({ length: 401 }, (_, i) => `unlisted${i}`);
    const shown = [pack.words[0].fr, ...extras, pack.words[0].fr, pack.words[0].fr.toUpperCase()];
    const f = await workerFixture({ initial: {
      settings: { managedProvider: true, gradual, language: 'de', levelOverride: 2, newSitesEnabled: true },
      languagePacks: { de: pack }, [PERSONAL_KEY]: { version: 1, revision: 1, entries },
      [`${scope}:${SENT_KEY}`]: { day: localDay(), words: shown },
      [`lang:personal:de:${SENT_KEY}`]: { day: localDay(), words: [`personal:de:${entries[0].uuid}`] },
    }, respond: validatedProxy });
    try {
      const { reply, ids } = await f.ask(texts);
      expect(reply.error).toBeUndefined();
      expect(Object.keys(reply.results)).toEqual(ids);
      const wire = f.calls.map(({ body }) => JSON.parse(body));
      expect(wire.map(({ passages }) => passages.map(({ id }) => id)))
        .toEqual(gradual ? [ids] : [ids.slice(0, 4), ids.slice(4)]);
      expect(wire.map(({ words }) => words.length)).toEqual(gradual ? [2] : [80, 80]);
      for (const request of wire) {
        expect(request.gradual).toBe(gradual);
        expect([...new Set(request.words.map(({ source }) => source))].sort())
          .toEqual(gradual ? ['pack', 'personal'] : ['pack']);
        const filtered = gradual ? [pack.words[0].fr, entries[0].target] : [pack.words[0].fr];
        expect(request.shownToday).toEqual(filtered);
        const prompt = buildSwapRequest({ ...request, batch: request.passages, unknownLimit: gradual });
        const selected = gradual ? [
          { ...pack.words[0], status: 'new' },
          { fr: entries[0].target, en: entries[0].source, status: 'new' },
        ] : pack.words.map((word) => ({ ...word, status: 'active' }));
        // The provider builder must see the same candidate order as the wire. Preserve
        // the real worker's order when the working-set selector ranks the two matches.
        const byForm = new Map(selected.map((word) => [word.fr, word]));
        const byokBodies = [];
        await requestSwaps({ level: 2, language: 'de', density: 'normal', unknownLimit: gradual,
          model: 'gemini-3.5-flash-lite', apiKey: 'synthetic-byok',
          words: request.words.map(({ fr }) => byForm.get(fr)), shownToday: filtered, batch: request.passages,
          fetchImpl: async (_url, { body }) => {
            byokBodies.push(body);
            const text = JSON.stringify({ passages: emptySwaps(request.passages) });
            return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
          },
        });
        expect(byokBodies).toEqual([JSON.stringify(prompt)]);
      }
      expect(f.data.modelCalls.count).toBe(wire.length);
    } finally { f.restore(); }
  });
}

test('the worker stops a managed split when the first half exhausts the local call cap', async () => {
  const { pack, texts } = maximumCatalog();
  const f = await workerFixture({ initial: { settings: { managedProvider: true, language: 'de', levelOverride: 2,
    newSitesEnabled: true }, languagePacks: { de: pack }, modelCalls: { day: localDay(), count: DAILY_MODEL_CALLS - 1 } },
  respond: validatedProxy });
  try {
    const { reply, ids } = await f.ask(texts);
    expect(reply.error).toBe('Daily local model-call budget reached');
    expect(Object.keys(reply.results)).toEqual(ids.slice(0, 4));
    expect(f.calls).toHaveLength(1);
    expect(f.data.modelCalls.count).toBe(DAILY_MODEL_CALLS);
  } finally { f.restore(); }
});

test('a managed reading failure leaves the page alone instead of starting the BYOK backoff timer', async () => {
  for (const managedProvider of [true, false]) {
    const win = new Window({ url: page.url });
    const previous = Object.fromEntries(['chrome', 'window', 'document', 'location', 'MutationObserver', 'IntersectionObserver']
      .map((name) => [name, globalThis[name]]));
    class IntersectionObserver {
      constructor(callback, options) { this.callback = callback; this.options = options; }
      observe(target) {
        if (this.options.rootMargin) queueMicrotask(() => this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }]));
      }
      unobserve() {}
      disconnect() {}
    }
    let requests = 0;
    Object.assign(globalThis, { window: win, document: win.document, location: win.location,
      MutationObserver: win.MutationObserver, IntersectionObserver,
      chrome: { runtime: { id: page.id, onMessage: { addListener() {} }, async sendMessage(msg) {
        if (msg.type === 'config') return { revision: 'reading', hasKey: true, paused: false,
          language: 'es', origins: ['https://example.com/*'],
          settings: { enabled: true, newSitesEnabled: true, siteOverrides: {}, managedProvider } };
        if (msg.type === 'swaps') {
          requests++;
          return { results: {}, error: 'Model rate limit reached', retryAfterMs: 5000 };
        }
        return { ok: true };
      } } },
    });
    try {
      useDOMClock();
      win.document.body.innerHTML = `<main><p>${article}</p></main>`;
      await import(`../src/content.js?managed-backoff-${managedProvider}`);
      await advanceDOMTime(400);
      expect(requests).toBe(1);
      await advanceDOMTime(5000);
      await advanceDOMTime(400);
      expect(requests).toBe(managedProvider ? 1 : 2);
      expect(win.document.querySelector('p').textContent).toBe(article);
    } finally { await restoreTimedDOM(win, previous); }
  }
});

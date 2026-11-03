import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { openWelcome } from '../src/update.js';
import { L1_WORDS } from '../src/vocabulary.js';
import { applySwaps, toggle } from '../src/text.js';
import { demoSwaps, chooseSitePolicy } from '../src/welcome.js';
import { hashKey } from '../src/hash.js';

test('welcome and options state the 18+ Gemini API requirement', () => {
  for (const name of ['welcome', 'options']) {
    const html = readFileSync(new URL(`../src/${name}.html`, import.meta.url), 'utf8');
    const win = new Window();
    win.document.write(html);
    const section = win.document.querySelector(name === 'welcome' ? '[aria-labelledby="privacyHeading"]' : '[aria-labelledby="sitesHeading"]');
    expect(section.textContent).toContain('The Gemini API requires users to be 18 or older.');
    win.close();
  }
});

test('only an install opens the first-run page', () => {
  const old = globalThis.chrome;
  const opened = [];
  globalThis.chrome = { runtime: { getURL: (path) => `chrome-extension://test/${path}` },
    tabs: { create: (tab) => { opened.push(tab); } } };
  try {
    for (const reason of ['update', 'chrome_update', 'shared_module_update', undefined]) openWelcome({ reason });
    expect(opened).toEqual([]);
    openWelcome({ reason: 'install' });
    expect(opened).toEqual([{ url: 'chrome-extension://test/src/welcome.html' }]);
  } finally { globalThis.chrome = old; }
});

test('demo selects fixed real Beginner words and uses page swap markup and flip', () => {
  const win = new Window();
  const p = win.document.createElement('p');
  p.textContent = 'Today I read with a friend, and we talk about an important idea. We always ask a question because learning is difficult, but it is possible.';
  const swaps = demoSwaps();
  expect(swaps.map((s) => s.f)).toEqual(['hoy', 'con', 'y', 'importante', 'siempre', 'porque', 'difícil', 'pero', 'posible']);
  expect(swaps.every((s) => L1_WORDS.some((w) => w.fr === s.f && w.en === s.g && w.hint === s.h))).toBe(true);
  expect(applySwaps(p, swaps)).toBe(swaps.length);
  const span = p.querySelector('.fw-word');
  expect(span.dataset.tip).toContain('today');
  expect(span.getAttribute('role')).toBe('button');
  expect(toggle(span)).toBe(true);
  expect(span.textContent).toBe('Today');
  expect(toggle(span)).toBe(false);
  expect(span.textContent).toBe('hoy');
  win.close();
});

test('site choice requests all-site permission before save; denial saves nothing; only-sites saves false', async () => {
  const calls = [];
  const request = async () => { calls.push('request'); return false; };
  const save = async (enabled) => { calls.push(`save:${enabled}`); return true; };
  const denied = chooseSitePolicy(true, { request, save });
  expect(calls).toEqual(['request']); // before the first await, while the click gesture is live
  expect(await denied).toBe(false);
  expect(calls).toEqual(['request']);
  calls.length = 0;
  expect(await chooseSitePolicy(false, { request, save })).toBe(true);
  expect(calls).toEqual(['save:false']);
  calls.length = 0;
  expect(await chooseSitePolicy(true, { request: async () => { calls.push('request'); return true; }, save })).toBe(true);
  expect(calls).toEqual(['request', 'save:true']);
});

test('fresh profile blocks reading Gemini dispatch until welcome save, while an existing profile remains allowed', async () => {
  const old = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const data = { apiKey: 'synthetic-key' }; // no settings means fresh install
  const listeners = [];
  const on = (arr = []) => ({ addListener: (fn) => arr.push(fn) });
  const id = 'welcome-test';
  const page = { id, url: 'https://reading.example/article', frameId: 0, tab: { id: 7, title: 'Reading' } };
  const welcome = { id, url: `chrome-extension://${id}/src/welcome.html` };
  let fetches = 0;
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) { const list = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
        return structuredClone(Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]]))); },
      async set(values) { Object.assign(data, structuredClone(values)); },
      async remove(keys) { for (const key of [keys].flat()) delete data[key]; },
    } },
    runtime: { id, getURL: (path) => `chrome-extension://${id}/${path}`, getManifest: () => ({ version: '0.12.8' }),
      onMessage: on(listeners), onInstalled: on(), onStartup: on(), onConnect: on() },
    tabs: { get: async () => ({ id: 7, title: 'Reading', url: page.url }), query: async () => [],
      sendMessage: async () => {}, create: async () => {} },
    permissions: { getAll: async () => ({ origins: ['https://reading.example/*'] }), onAdded: on(), onRemoved: on() },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    action: { setBadgeText: async () => {} }, alarms: { create: async () => {}, onAlarm: on() },
  };
  globalThis.fetch = async (url, init) => {
    expect(String(url)).toContain('generativelanguage.googleapis.com');
    fetches++;
    const items = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      passages: items.map(({ id: key }) => ({ id: key, swaps: [{ o: 'and', f: 'y', g: 'and', h: '', ctx: '' }] })),
    }) }] } }] }) };
  };
  const send = (msg, sender) => new Promise((resolve) => {
    if (!listeners.some((fn) => fn(msg, sender, resolve))) resolve(undefined);
  });
  const passage = 'We read books and enjoy quiet evenings every week.';
  const request = async (text = passage) => { const { revision } = await send({ type: 'config' }, page);
    return send({ type: 'swaps', revision, items: [{ text, key: `${revision}:${hashKey(text)}` }] }, page); };
  try {
    await import('../src/background.js?welcome-consent');
    expect(data.consentShown).toBe(false);
    expect((await request()).error).toContain('Choose site access');
    expect(fetches).toBe(0);
    expect(data.modelCalls).toBeUndefined();
    expect(data.modelStatus).toBeUndefined();
    expect(await send({ type: 'save', consentShown: true, settings: { newSitesEnabled: true } }, welcome)).toEqual({ ok: true });
    expect(data.consentShown).toBe(true);
    expect((await request()).results).toBeDefined();
    expect(fetches).toBe(1);
    expect(data.modelCalls.count).toBe(1);
    delete data.consentShown; // existing profiles have settings but no new flag
    expect((await request('We read books and share quiet evenings every week.')).results).toBeDefined();
    expect(fetches).toBe(2);
  } finally { globalThis.chrome = old.chrome; globalThis.fetch = old.fetch; }
}, 30000);

test('welcome page renders its notes and choice results as the exact English', async () => {
  const oldDocument = globalThis.document, oldChrome = globalThis.chrome;
  const window = new Window({ url: 'chrome-extension://fw-welcome/src/welcome.html' });
  window.document.write(readFileSync(new URL('../src/welcome.html', import.meta.url), 'utf8'));
  globalThis.document = window.document;
  let grant = true;
  let saveOk = true;
  globalThis.chrome = {
    runtime: { getManifest: () => ({ content_scripts: [] }), openOptionsPage: async () => {},
      sendMessage: async (msg) => (saveOk ? { ok: true } : { ok: false }) },
    permissions: { request: async () => grant },
  };
  const wait = async (predicate) => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise((done) => setTimeout(done, 0)); };
  try {
    await import('../src/welcome.js?welcome-english');
    const $ = (id) => window.document.getElementById(id);
    const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
    expect(text($('learnHeading').parentElement.querySelector('p:nth-of-type(2)'))).toBe('Reading level controls which bundled words can appear; Beginner is a good start.');
    expect(text($('learnHeading').parentElement.querySelector('p:nth-of-type(3)'))).toBe('Gradual learning starts on for new installs, at 5 new words a day. It introduces words from your reading and schedules short reviews. You can change the pace or turn it off in Settings.');
    expect($('suggestX').hidden).toBe(false);
    $('onlySites').click();
    await wait(() => $('choiceStatus').textContent !== '');
    expect($('choiceStatus').textContent).toBe('Only sites you turn on selected. Open the popup on a site to allow it.');
    $('allSites').click();
    await wait(() => $('choiceStatus').textContent.startsWith('All'));
    expect($('choiceStatus').textContent).toBe('All permitted sites selected. Sensitive sites still start off.');
    grant = false;
    $('allSites').click();
    await wait(() => $('choiceStatus').textContent.startsWith('Chrome'));
    expect($('choiceStatus').textContent).toBe('Chrome did not grant all-site access. Choose only sites you turn on, or try again.');
    saveOk = false;
    $('onlySites').click();
    await wait(() => $('choiceStatus').textContent === 'Could not save your choice');
    expect($('choiceStatus').textContent).toBe('Could not save your choice');
    $('allowX').click();
    await wait(() => $('xStatus').textContent !== '');
    expect($('xStatus').textContent).toBe('Chrome did not grant x.com access.');
    grant = true;
    $('allowX').click();
    await wait(() => $('xStatus').textContent === 'Could not enable x.com');
    expect($('xStatus').textContent).toBe('Could not enable x.com');
    saveOk = true;
    $('allowX').click();
    await wait(() => $('xStatus').textContent.startsWith('x.com allowed'));
    expect($('xStatus').textContent).toBe('x.com allowed. After setup, reload any open X page to start there.');
  } finally {
    globalThis.document = oldDocument;
    globalThis.chrome = oldChrome;
    window.happyDOM.abort();
  }
});

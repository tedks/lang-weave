import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { hashKey } from '../src/hash.js';
import { DAILY_MODEL_CALLS } from '../src/quota.js';
import { PENDING_KEY } from '../src/events.js';
import { wordsForLevel } from '../src/levels.js';

// The real worker and content modules together on a plain article page, with fake Gemini.
test('runtime: key isolation, local events, site controls, stale replies, retries and quota', async () => {
  const win = new Window({ url: 'https://example.com/article' });
  const originalGlobals = Object.fromEntries(['chrome', 'fetch', 'document', 'window', 'location', 'MutationObserver', 'IntersectionObserver', 'setInterval', 'Date'].map((k) => [k, globalThis[k]]));
  // Model a reader at UTC-05:00. Both instants are January 2 in UTC, but straddle local midnight.
  const RealDate = originalGlobals.Date;
  let clock = RealDate.parse('2026-01-02T04:59:00Z');
  class ReaderDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
    getFullYear() { return new RealDate(this.getTime() - 5 * 3600000).getUTCFullYear(); }
    getMonth() { return new RealDate(this.getTime() - 5 * 3600000).getUTCMonth(); }
    getDate() { return new RealDate(this.getTime() - 5 * 3600000).getUTCDate(); }
  }
  globalThis.Date = ReaderDate;
  const local = { settings: { apiKey: 'synthetic-gemini', enabled: true, levelOverride: 1 },
    hostKey: 'foreign-french-key', wordState: { version: 'french', words: [{ fr: 'et', en: 'and', status: 'active' }] } }; // foreign legacy data must be ignored
  const messageListeners = [], contentListeners = [];
  const toPages = [];
  const pageReplies = []; // replies to the content script's own requests // everything the worker sends to content scripts
  const originEvents = { added: [], removed: [] };
  let accessLevel;
  let origins = ['https://*/*', 'http://*/*'];
  let modelCalls = 0;
  let modelThrows = 0;
  let delayed = null;
  let release;
  let nativeCalls = 0;
  const listener = (arr) => ({ addListener: (fn) => arr.push(fn) });
  const storageArea = (data) => ({
    async setAccessLevel(v) { accessLevel = v.accessLevel; },
    async get(keys) { return structuredClone(keys == null ? data : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter((k) => k in data).map((k) => [k, data[k]]))); },
    async set(values) { for (const [k, v] of Object.entries(values)) data[k] = structuredClone(v); },
    async remove(keys) { for (const k of keys) delete data[k]; },
  });
  const page = () => ({ id: 'fw-test', tab: { id: 1 }, url: win.location.href });
  const popup = { id: 'fw-test', url: 'chrome-extension://fw-test/src/popup.html' };
  const dispatch = (msg, sender) => new Promise((done, reject) => {
    let handled = false;
    try { for (const fn of messageListeners) if (fn(msg, sender, done)) handled = true; }
    catch (e) { reject(e); }
    if (!handled) done(undefined);
  });
  const io = [];
  class IO {
    constructor(callback, options) { this.cb = callback; this.options = options; this.elements = new Set(); io.push(this); }
    observe(el) { this.elements.add(el); if (this.options.rootMargin) queueMicrotask(() => { if (this.elements.has(el)) this.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }]); }); }
    unobserve(el) { this.elements.delete(el); }
    disconnect() { this.elements.clear(); }
  }
  const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  Object.assign(globalThis, {
    window: win, document: win.document, location: win.location, MutationObserver: win.MutationObserver, IntersectionObserver: IO,
    setInterval: win.setInterval.bind(win),
    chrome: {
      storage: { local: storageArea(local) },
      runtime: {
        id: 'fw-test', getURL: (path) => `chrome-extension://fw-test/${path}`, getManifest: () => ({ version: '0.3.0' }),
        onMessage: listener(messageListeners), onInstalled: listener([]), onStartup: listener([]),
        sendMessage: (msg) => dispatch(msg, page()).then((r) => { pageReplies.push(JSON.stringify(r ?? null)); return r; }),
        sendNativeMessage: async () => { nativeCalls++; throw new Error('native host must never be called'); },
      },
      tabs: { get: async () => ({ id: 1, title: win.document.title }), query: async () => [{ id: 1, url: win.location.href }], sendMessage: async (_id, msg) => { toPages.push(JSON.stringify(msg)); for (const fn of contentListeners) fn(msg); } },
      alarms: { create: async () => {}, onAlarm: listener([]) },
      permissions: { getAll: async () => ({ origins }), onAdded: listener(originEvents.added), onRemoved: listener(originEvents.removed) },
      scripting: { getRegisteredContentScripts: async () => [], updateContentScripts: async () => {}, unregisterContentScripts: async () => {}, registerContentScripts: async () => {} },
    },
    fetch: async (url, init) => {
      if (String(url).endsWith('manifest.json')) return reply({ version: '0.3.0' });
      expect(url.startsWith('https://generativelanguage.googleapis.com/')).toBe(true);
      expect(init.headers['x-goog-api-key']).toBe('synthetic-gemini'); // a pasted key wins over the setup key
      modelCalls++;
      if (modelThrows > 0) { modelThrows--; throw new TypeError('Failed to fetch'); }
      if (delayed) { release = () => { delayed = null; }; await new Promise((done) => { const free = release; release = () => { free(); done(); }; }); }
      const body = JSON.parse(init.body);
      expect(body.systemInstruction.parts[0].text).toContain('y = and');
      expect(body.systemInstruction.parts[0].text).not.toContain('et = and');
      const items = JSON.parse(body.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      const passages = items.map(({ id, text }) => ({ id, swaps: text.includes(' and ') ? [{ o: 'and', f: 'y', ctx: '' }] : [] }));
      return reply({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] });
    },
  });
  const options = { id: 'fw-test', url: 'chrome-extension://fw-test/src/options.html' };
  const call = (msg) => dispatch(msg, msg.type === 'clearCache' ? options : popup);
  const wait = (ms = 400) => new Promise((done) => setTimeout(done, ms));
  // happy-dom has no isTrusted; real user input is marked by hand, a page's dispatchEvent is left untrusted.
  const user = (e) => Object.defineProperty(e, 'isTrusted', { value: true });
  try {
    await import('../src/background.js');
    let config = await dispatch({ type: 'config' }, page());
    expect(accessLevel).toBe('TRUSTED_CONTEXTS');
    expect(local.settings.apiKey).toBeUndefined();
    expect(local.apiKey).toBe('synthetic-gemini');
    expect(await dispatch({ type: 'status' }, page())).toBeUndefined();
    expect(await dispatch({ type: 'save', apiKey: 'stolen' }, page())).toBeUndefined();
    expect(await call({ type: 'syncWords' })).toBeUndefined();
    config = await dispatch({ type: 'config' }, page());
    expect(JSON.stringify(config)).not.toMatch(/synthetic-|foreign-french|"et"/);
    expect(config.paused).toBe(false);
    expect(config.stage).toBe(0);
    expect((await call({ type: 'status' })).words).toBe(wordsForLevel(config.level).length);
    // The standalone default enables permitted nonsensitive sites; an explicit popup choice wins.
    expect((await dispatch({ type: 'config' }, page())).settings.newSitesEnabled).toBe(true);

    // Route worker broadcasts to the content module without pretending they came from a page.
    const beforeContent = messageListeners.length;
    win.document.body.innerHTML = '<main><p id="reading">I enjoy cats and dogs every single day.</p><form><p>Private typing and secrets should stay exactly here.</p></form><p contenteditable="true">Private words and typing must never leave this editor.</p><p id="nested">Keep these and other words <span contenteditable="true">private typed text</span> here.</p><p>My doctor says medication and rest are important.</p><p lang="es">Hola y gracias por leer esta página cada día.</p></main>';
    await import('../src/content.js');
    contentListeners.push(...messageListeners.splice(beforeContent));
    await wait();
    expect(modelCalls).toBe(1);
    const el = win.document.querySelector('#reading');
    expect(el.querySelector('.fw-word')?.textContent).toBe('y');
    expect(win.document.querySelectorAll('.fw-word').length).toBe(1);
    // A SPA can change only its title. Existing swaps disappear, a late reply
    // cannot repaint them, and returning to a safe title permits reading.
    const safeCalls = modelCalls;
    win.document.title = 'Hospital medication update';
    await wait(20);
    expect(el.querySelector('.fw-word')).toBeNull();
    expect(el.textContent).toBe('I enjoy cats and dogs every single day.');
    expect(modelCalls).toBe(safeCalls);
    win.document.title = 'Ordinary reading';
    await wait(1300); // interval fallback also covers sites whose title mutation is not reported
    expect(el.querySelector('.fw-word')?.textContent).toBe('y');
    const sameSpan = el.querySelector('.fw-word');
    const safeTitleCalls = modelCalls;
    win.document.title = 'Another ordinary reading title';
    await wait(1300);
    expect(el.querySelector('.fw-word')).toBe(sameSpan);
    expect(modelCalls).toBe(safeTitleCalls);
    expect(local[PENDING_KEY] || []).toHaveLength(0); // prefetch is not exposure
    const visibility = io.findLast((o) => !o.options.rootMargin);
    const span = el.querySelector('.fw-word');
    visibility.cb([{ target: span, isIntersecting: true, intersectionRatio: 1 }]);
    await wait(20);
    expect(local[PENDING_KEY].map((e) => e.kind)).toEqual(['seen']);
    expect(span.dataset.fwStatus).toBe('active');
    // The gloss waits for a dwell; a passing pointer neither shows it nor records anything.
    span.dispatchEvent(user(new win.MouseEvent('mouseover', { bubbles: true })));
    await wait(100);
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();
    span.dispatchEvent(user(new win.MouseEvent('mouseout', { bubbles: true })));
    await wait(700);
    expect(span.classList.contains('fw-tip')).toBe(false);
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();
    expect(local[PENDING_KEY]).toHaveLength(1);
    // Focus shows the gloss for keyboard readers but never records a peek, since a page can focus a span from script.
    span.dispatchEvent(user(new win.FocusEvent('focusin', { bubbles: true })));
    await wait(800);
    expect(span.classList.contains('fw-tip')).toBe(true);
    expect(win.document.querySelector('div.fw-gloss-on')?.textContent).toBe('y · and · "ee"');
    expect(span.getAttribute('aria-label')).toBe('y: and · "ee". Show English');
    expect(win.document.querySelector('div.fw-gloss-on')?.getAttribute('aria-hidden')).toBe('true');
    expect(local[PENDING_KEY]).toHaveLength(1);
    span.dispatchEvent(user(new win.FocusEvent('focusout', { bubbles: true })));
    expect(span.classList.contains('fw-tip')).toBe(false);
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();
    span.dispatchEvent(user(new win.MouseEvent('mouseover', { bubbles: true })));
    await wait(800);
    expect(span.classList.contains('fw-tip')).toBe(true);
    expect(win.document.querySelectorAll('div.fw-gloss-on')).toHaveLength(1);
    expect(local[PENDING_KEY].map((e) => e.kind)).toEqual(['seen', 'peek']);
    span.dispatchEvent(user(new win.FocusEvent('focusin', { bubbles: true })));
    span.dispatchEvent(user(new win.MouseEvent('mouseout', { bubbles: true })));
    expect(win.document.querySelectorAll('div.fw-gloss-on')).toHaveLength(1); // keyboard focus now owns it
    span.dispatchEvent(user(new win.FocusEvent('focusout', { bubbles: true })));
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();
    span.dispatchEvent(user(new win.MouseEvent('mouseover', { bubbles: true })));
    await wait(800);
    expect(local[PENDING_KEY]).toHaveLength(2); // one peek per word per day
    span.dispatchEvent(user(new win.MouseEvent('mouseout', { bubbles: true })));
    const callsBeforeLocalMidnight = modelCalls;
    clock = RealDate.parse('2026-01-02T05:01:00Z');
    visibility.cb([{ target: span, isIntersecting: true, intersectionRatio: 1 }]);
    await wait(20);
    span.dispatchEvent(user(new win.MouseEvent('mouseover', { bubbles: true })));
    await wait(800);
    expect(local[PENDING_KEY].map((e) => `${e.day}:${e.kind}`)).toEqual([
      '2026-01-01:seen', '2026-01-01:peek', '2026-01-02:seen', '2026-01-02:peek',
    ]);
    // Repeated exposure within the new local day still produces only one seen and peek.
    span.dispatchEvent(user(new win.MouseEvent('mouseout', { bubbles: true })));
    visibility.cb([{ target: span, isIntersecting: true, intersectionRatio: 1 }]);
    span.dispatchEvent(user(new win.MouseEvent('mouseover', { bubbles: true })));
    await wait(800);
    expect(local[PENDING_KEY]).toHaveLength(4);
    span.dispatchEvent(user(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await wait(20);
    expect(span.textContent).toBe('and');
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();
    expect(local[PENDING_KEY].map((e) => e.kind)).toEqual(['seen', 'peek', 'seen', 'peek', 'flip']);
    expect(await dispatch({ type: 'event', word: 'bonjour', event: 'seen' }, page())).toEqual({ ok: false }); // not a known word
    expect(await dispatch({ type: 'event', word: 'et', event: 'seen' }, page())).toEqual({ ok: false }); // foreign state cannot add French words
    // Nothing in the DOM names the word or the revision; pages can't forge events with fake spans or synthetic input.
    expect(win.document.body.innerHTML).not.toMatch(/data-fw-(word|key)/);
    const fake = win.document.createElement('span');
    fake.className = 'fw-word';
    fake.dataset.fwWord = 'muy';
    fake.setAttribute('data-en', 'very');
    fake.textContent = 'muy';
    win.document.querySelector('main').append(fake);
    await wait(20);
    expect(span.isConnected).toBe(true);
    fake.dispatchEvent(user(new win.MouseEvent('click', { bubbles: true })));
    fake.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    span.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); // untrusted click on a real swap
    span.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
    await wait(800);
    expect(fake.textContent).toBe('muy');
    expect(span.textContent).toBe('and');
    expect(local[PENDING_KEY].map((e) => e.kind)).toEqual(['seen', 'peek', 'seen', 'peek', 'flip']);
    fake.remove(); await wait();

    // Feedback stays local and bounded to word, event kind and day.
    expect(local[PENDING_KEY].map((e) => `${e.word}:${e.kind}`)).toEqual(['y:seen', 'y:peek', 'y:seen', 'y:peek', 'y:flip']);
    expect(JSON.stringify(local[PENDING_KEY])).not.toContain('cats');
    expect(nativeCalls).toBe(0);

    const beforeClear = modelCalls;
    await call({ type: 'clearCache' }); await wait();
    expect(modelCalls).toBe(beforeClear + 1);
    expect(el.querySelector('.fw-word')?.textContent).toBe('y');
    await call({ type: 'save', siteOverride: { host: 'example.com', enabled: false } });
    expect(el.textContent).toBe('I enjoy cats and dogs every single day.');
    expect(el.querySelector('.fw-word')).toBeNull();
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();
    await call({ type: 'save', settings: { newSitesEnabled: false }, siteOverride: { host: 'example.com', enabled: true } });
    await wait(); expect(el.querySelector('.fw-word')).not.toBeNull();

    // Clearing/off during a delayed API request must not resurrect the old generation.
    delayed = true;
    await call({ type: 'clearCache' }); await wait();
    expect(typeof release).toBe('function');
    await call({ type: 'save', settings: { enabled: false } });
    release(); await wait();
    expect(el.querySelector('.fw-word')).toBeNull();
    expect(Object.keys(local).filter((k) => k.startsWith('c:'))).toHaveLength(0);

    // Clearing cache changes the revision; an old revision's request is stale.
    const oldRevision = (await dispatch({ type: 'config' }, page())).revision;
    await call({ type: 'clearCache' });
    config = await dispatch({ type: 'config' }, page());
    expect(config.revision).not.toBe(oldRevision);
    const text = 'I enjoy cats and dogs every single day.';
    const disabledReply = await dispatch({ type: 'swaps', revision: config.revision, items: [{ key: `${config.revision}:${hashKey(text)}`, text }] }, page());
    expect(disabledReply.stale).toBe(true);
    await call({ type: 'save', settings: { enabled: true } }); await wait();
    expect(el.querySelector('.fw-word')).not.toBeNull();
    const dynamic = win.document.createElement('p');
    dynamic.textContent = 'We enjoy books and music every quiet evening.';
    win.document.querySelector('main').append(dynamic); await wait();
    expect(dynamic.querySelector('.fw-word')).not.toBeNull();

    // The popup's enabled switch reverts pages and restores them on resume.
    await call({ type: 'save', settings: { enabled: false } }); await wait(20);
    expect(el.querySelector('.fw-word')).toBeNull();
    expect((await dispatch({ type: 'config' }, page())).paused).toBe(false);
    await call({ type: 'save', settings: { enabled: true } }); await wait();
    expect(el.querySelector('.fw-word')).not.toBeNull();

    // A failed model call is retried after a backoff instead of leaving the passage English.
    modelThrows = 1; // Flash-Lite, the default, has no fallback: one failed request, then the retry
    const retried = win.document.createElement('p');
    retried.textContent = 'They walk home and talk about the long week.';
    win.document.querySelector('main').append(retried); await wait();
    expect(retried.querySelector('.fw-word')).toBeNull();
    await wait(5500);
    expect(retried.querySelector('.fw-word')?.textContent).toBe('y');

    // Past the daily cap, no more Gemini requests until tomorrow.
    const callsBefore = modelCalls;
    const counted = local.modelCalls;
    local.modelCalls = { ...counted, count: DAILY_MODEL_CALLS };
    const capped = win.document.createElement('p');
    capped.textContent = 'She reads late and sleeps in on quiet mornings.';
    win.document.querySelector('main').append(capped); await wait();
    expect(modelCalls).toBe(callsBefore);
    expect(capped.querySelector('.fw-word')).toBeNull();
    expect(local.modelStatus.category).toBe('local_budget');
    local.modelCalls = counted;

    // Removing website access reverts the page.
    origins = [];
    for (const fn of originEvents.removed) fn();
    await wait(20);
    expect(el.querySelector('.fw-word')).toBeNull();
    expect(dynamic.querySelector('.fw-word')).toBeNull();
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();
    // Neither key ever reached the content-script side: not in broadcasts, not in replies to page requests.
    expect(toPages.length).toBeGreaterThan(5);
    expect(toPages.join('')).not.toContain('synthetic-');
    expect(pageReplies.join('')).not.toContain('synthetic-');
    expect(pageReplies.some((r) => r.includes('"hasKey":true'))).toBe(true);
    expect(local.modelCalls.count).toBe(modelCalls - callsBeforeLocalMidnight); // daily quota resets at local midnight
    expect(nativeCalls).toBe(0);
  } finally {
    if (release) release();
    await win.happyDOM.close();
    Object.assign(globalThis, originalGlobals);
  }
}, 30000);

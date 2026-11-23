import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';

const story = 'I enjoy cats and dogs every single day here.';
const wait = (ms = 400) => new Promise((done) => setTimeout(done, ms));
const swaps = (msg) => ({ results: Object.fromEntries(msg.items.map((i) => [i.key,
  [{ o: 'and', f: 'et', g: 'and', h: 'ay', ctx: '' }]])) });

async function withReader(module, run) {
  const win = new Window({ url: 'https://example.com/article' });
  const keys = ['chrome', 'document', 'window', 'location', 'MutationObserver', 'IntersectionObserver', 'setInterval', 'setTimeout'];
  const saved = Object.fromEntries(keys.map((k) => [k, globalThis[k]]));
  class IO {
    constructor(cb, options) { this.cb = cb; this.options = options; this.els = new Set(); }
    observe(el) { this.els.add(el); if (this.options.rootMargin) queueMicrotask(() => { if (this.els.has(el)) this.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }]); }); }
    unobserve(el) { this.els.delete(el); }
    disconnect() { this.els.clear(); }
  }
  const config = { settings: { enabled: true, newSitesEnabled: true, siteOverrides: {} }, level: 1, revision: 'r1', hasKey: true, paused: false, origins: ['<all_urls>'], stage: 1 };
  const requests = [];
  const listeners = [];
  const runtime = {
    id: 'fw-test',
    onMessage: { addListener: (listener) => listeners.push(listener) },
    sendMessage: async (msg) => {
      requests.push(msg);
      if (msg.type === 'config') return config;
      if (msg.type === 'swaps') return swaps(msg);
      return { ok: true };
    },
  };
  function deliver(message, sender) {
    let result;
    for (const listener of listeners) listener(message, sender, (reply) => { result = reply; });
    return result;
  }
  Object.assign(globalThis, { window: win, document: win.document, location: win.location, MutationObserver: win.MutationObserver,
    IntersectionObserver: IO, setInterval: win.setInterval.bind(win), chrome: { runtime } });
  try {
    win.document.body.innerHTML = `<main><p id="a">${story}</p>` +
      '<p id="b"><span class="fw-word" data-en="forged source">visible site text</span></p></main>';
    await import(`../src/content.js?${module}`);
    await wait();
    await run({ win, runtime, requests, deliver, config });
  } finally {
    await win.happyDOM.close();
    Object.assign(globalThis, saved);
  }
}

test('an orphaned content script stays quiet and restores its own English', () => withReader('orphan', async ({
  win, runtime, requests,
}) => {
  const user = (e) => Object.defineProperty(e, 'isTrusted', { value: true });
  const errors = [];
  const onError = (e) => errors.push(String(e?.reason || e?.message || e));
  process.on('unhandledRejection', onError);
  try {
    const span = win.document.querySelector('#a .fw-word');
    expect(span?.textContent).toBe('et');
    // The extension reloads: this copy loses its runtime.
    delete runtime.id;
    runtime.sendMessage = (msg) => { requests.push(msg); throw new Error('Extension context invalidated.'); };
    const before = requests.length;
    const p = win.document.createElement('p');
    p.textContent = 'We read books and drink tea on quiet evenings.';
    win.document.querySelector('main').append(p);
    span.dispatchEvent(user(new win.MouseEvent('mouseover', { bubbles: true })));
    await wait(800);
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();
    span.dispatchEvent(user(new win.MouseEvent('click', { bubbles: true })));
    await wait();
    expect(errors).toEqual([]);
    expect(requests.length - before).toBeLessThanOrEqual(1); // at most the one request that discovered the reload
    const after = requests.length;
    p.textContent = 'They walk home and talk about the long week.';
    await wait();
    expect(requests.length).toBe(after); // quiet from then on
    expect(win.document.querySelector('#a .fw-word')).toBeNull();
    expect(win.document.querySelector('#a').textContent).toBe(story);
    expect(win.document.querySelector('#b .fw-word').textContent).toBe('visible site text');
  } finally {
    process.off('unhandledRejection', onError);
  }
}), 30000);

test('only the worker can retire a live reader, and a failed reload resumes with fresh passages', () =>
  withReader('reload-hold', async ({ win, runtime, deliver, config }) => {
    let resume;
    const originalTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, delay, ...args) => {
      if (delay !== 5000) return originalTimeout(fn, delay, ...args);
      resume = fn;
      return -1;
    };
    const deferred = Promise.withResolvers();
    const requested = Promise.withResolvers();
    const originalSend = runtime.sendMessage;
    runtime.sendMessage = (msg) => {
      if (msg.type !== 'swaps') return originalSend(msg);
      requested.resolve(msg);
      return deferred.promise;
    };
    const passage = win.document.createElement('p');
    passage.textContent = 'We read books and drink tea on quiet evenings.';
    win.document.querySelector('main').append(passage);
    const pending = await requested.promise;
    const retire = { type: 'prepareReadingReload' };
    const sender = { id: runtime.id, url: `chrome-extension://${runtime.id}/src/background.js` };
    const original = win.document.querySelector('#a .fw-word');
    expect(original?.textContent).toBe('et');
    expect(deliver(retire, { ...sender, url: 'https://example.com/article' })).toBeUndefined();
    expect(original.isConnected).toBe(true);
    expect(deliver(retire, sender)).toEqual({ ok: true });
    expect(runtime.id).toBe('fw-test');
    expect(original.isConnected).toBe(false);
    expect(win.document.querySelector('#a').textContent).toBe(story);
    deliver({ type: 'retry', config }, sender);
    deferred.resolve(swaps(pending));
    await wait();
    expect(passage.querySelector('.fw-word')).toBeNull();
    runtime.sendMessage = originalSend;
    resume(); // Chrome kept this context alive past the bounded hold.
    await wait();
    expect(passage.querySelector('.fw-word')?.textContent).toBe('et');
  }));

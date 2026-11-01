// One painted swap, hovered, left, flipped twice and focused, run against a given content.js
// module URL. guess-content.test.js runs it on this build with guess first off and compares every
// DOM snapshot and message with the same scenario recorded on the base commit (9cd3dce, before
// guess first): with the setting off the page must be byte-for-byte unchanged.
import { Window } from 'happy-dom';

const trusted = (event) => Object.defineProperty(event, 'isTrusted', { value: true });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

export async function hoverScenario(moduleUrl, settings = {}) {
  const win = new Window({ url: 'https://example.com/article' });
  const names = ['chrome', 'document', 'window', 'location', 'MutationObserver', 'IntersectionObserver', 'setInterval'];
  const previous = Object.fromEntries(names.map((name) => [name, globalThis[name]]));
  const sent = [];
  const config = { settings: { enabled: true, newSitesEnabled: true, siteOverrides: {}, gradual: true, inlineRecall: false,
    ...settings }, revision: 'scenario', hasKey: true, paused: false, origins: ['<all_urls>'], language: 'es' };
  class IO {
    constructor(callback, options) { this.callback = callback; this.options = options; }
    observe(el) {
      if (this.options.rootMargin) queueMicrotask(() => this.callback([{ target: el, isIntersecting: true, intersectionRatio: 1 }]));
    }
    unobserve() {}
    disconnect() {}
  }
  Object.assign(globalThis, {
    window: win, document: win.document, location: win.location, MutationObserver: win.MutationObserver,
    IntersectionObserver: IO, setInterval: win.setInterval.bind(win),
    chrome: { runtime: { id: 'scenario', onMessage: { addListener: () => {} }, sendMessage: async (msg) => {
      sent.push(msg.type === 'event' ? `event:${msg.event}:${msg.word}` : msg.type);
      if (msg.type === 'config') return config;
      if (msg.type === 'swaps') return { results: Object.fromEntries(msg.items.map((item) => [item.key,
        [{ o: 'and', f: 'y', g: 'and', h: 'ee', word: 'y', status: 'active' }]])) };
      return { ok: true };
    } } },
  });
  const snapshots = [];
  // Description ids carry a random prefix and a counter shared by every page in the process;
  // number them by first appearance so runs compare.
  const ids = new Map();
  const snap = () => snapshots.push(win.document.documentElement.outerHTML.replace(/fw-d[0-9a-f]+-\d+/g, (id) => {
    if (!ids.has(id)) ids.set(id, `fw-d-ID-${ids.size + 1}`);
    return ids.get(id);
  }));
  try {
    win.document.body.innerHTML = '<main><p id="one">We read and write every evening.</p></main>';
    await import(moduleUrl);
    await wait(400);
    snap();
    const span = win.document.querySelector('.fw-word');
    span.dispatchEvent(trusted(new win.MouseEvent('mouseover', { bubbles: true })));
    await wait(750);
    snap();
    span.dispatchEvent(trusted(new win.MouseEvent('mouseout', { bubbles: true })));
    await wait(10);
    snap();
    span.dispatchEvent(trusted(new win.MouseEvent('click', { bubbles: true, cancelable: true })));
    await wait(10);
    snap();
    span.dispatchEvent(trusted(new win.MouseEvent('click', { bubbles: true, cancelable: true })));
    await wait(10);
    snap();
    span.focus();
    await wait(750);
    snap();
    span.dispatchEvent(trusted(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    span.dispatchEvent(trusted(new win.KeyboardEvent('keydown', { key: '2', bubbles: true })));
    await wait(10);
    snap();
    return { snapshots, sent };
  } finally {
    Object.assign(globalThis, previous);
    win.happyDOM.cancelAsync();
  }
}

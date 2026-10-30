import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';

const trusted = (event) => Object.defineProperty(event, 'isTrusted', { value: true });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

test('only two visible practice invitations render; a waiting word gains a slot after scrolling', async () => {
  const win = new Window({ url: 'https://example.com/article' });
  const names = ['chrome', 'document', 'window', 'location', 'MutationObserver', 'IntersectionObserver', 'setInterval'];
  const previous = Object.fromEntries(names.map((name) => [name, globalThis[name]]));
  class IO {
    constructor(callback, options) { this.callback = callback; this.options = options; }
    observe(el) {
      if (this.options.rootMargin) queueMicrotask(() => this.callback([{ target: el, isIntersecting: true, intersectionRatio: 1 }]));
    }
    unobserve() {}
    disconnect() {}
  }
  const config = { settings: { enabled: true, newSitesEnabled: true, siteOverrides: {}, gradual: true, inlineRecall: true },
    revision: 'cue-cap', hasKey: true, paused: false, origins: ['<all_urls>'], language: 'es' };
  Object.assign(globalThis, {
    window: win, document: win.document, location: win.location, MutationObserver: win.MutationObserver,
    IntersectionObserver: IO, setInterval: win.setInterval.bind(win),
    chrome: { runtime: { id: 'cue-test', onMessage: { addListener: () => {} }, sendMessage: async (msg) => {
      if (msg.type === 'config') return config;
      if (msg.type === 'swaps') return { results: Object.fromEntries(msg.items.map((item) => [item.key,
        [{ o: 'and', f: 'y', g: 'and', h: '', word: 'y', practice: true }]])) };
      if (msg.type === 'inlineBegin') return { ticket: 'owned-ticket' };
      if (msg.type === 'inlineReveal') return { answer: { fr: 'y', en: 'and', hint: '' } };
      return { ok: true };
    } } },
  });
  try {
    win.document.body.innerHTML = '<main><p id="one">We read and write every evening.</p><p id="two">We cook and eat every evening.</p><p id="three">We talk and listen every evening.</p></main>';
    await import('../src/content.js?cue-cap');
    await wait(400);
    const words = [...win.document.querySelectorAll('.fw-practice')];
    expect(words).toHaveLength(3); // positive control: all three due words were painted
    words.forEach((word, i) => { word.getBoundingClientRect = () => ({ left: 20, right: 80, top: 20 + i * 30, bottom: 42 + i * 30, width: 60, height: 22 }); });
    win.dispatchEvent(new win.Event('scroll'));
    expect(words.filter((word) => word.classList.contains('fw-practice-cue'))).toHaveLength(2);
    expect(words[0].textContent).toBe('and?');
    expect(words[0].querySelector('sup')?.getAttribute('aria-hidden')).toBe('true');
    expect(words[2].textContent).toBe('and');
    expect(words[2].hasAttribute('tabindex')).toBe(false);
    words[0].getBoundingClientRect = () => ({ left: 20, right: 80, top: -40, bottom: -18, width: 60, height: 22 });
    win.dispatchEvent(new win.Event('scroll'));
    expect(words[0].classList.contains('fw-practice-cue')).toBe(false);
    expect(words[2].classList.contains('fw-practice-cue')).toBe(true);
    expect(words[2].getAttribute('role')).toBe('button');
    expect(words[2].textContent).toBe('and?');

    words[2].dispatchEvent(trusted(new win.MouseEvent('click', { bubbles: true })));
    await wait(10);
    const panel = win.document.querySelector('.fw-recall');
    expect(panel?.getAttribute('role')).toBe('group');
    expect(panel?.querySelector('.fw-recall-status')?.getAttribute('aria-live')).toBe('polite');
    expect(win.document.activeElement?.textContent).toBe('Reveal answer');
    expect(panel?.querySelector('.fw-recall-ratings')).toBeNull();
    panel.querySelector('button').dispatchEvent(trusted(new win.MouseEvent('click', { bubbles: true })));
    await wait(10);
    expect([...panel.querySelectorAll('.fw-recall-ratings button')].map((button) => button.textContent))
      .toEqual(['Again', 'Hard', 'Medium', 'Easy']);
    expect(panel.querySelector('.fw-recall-secondary button')?.textContent).toBe('Already know');
    panel.dispatchEvent(trusted(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(win.document.querySelector('.fw-recall')).toBeNull();
    expect(win.document.activeElement).toBe(words[2]);
  } finally {
    Object.assign(globalThis, previous);
    win.happyDOM.cancelAsync();
  }
}, 30000);

test('cue placement chooses a fully available side and stays inside the viewport', async () => {
  const win = new Window({ url: 'https://example.com/article' });
  const names = ['chrome', 'document', 'window', 'location', 'MutationObserver', 'IntersectionObserver', 'setInterval'];
  const previous = Object.fromEntries(names.map((name) => [name, globalThis[name]]));
  Object.assign(globalThis, {
    window: win, document: win.document, location: win.location, MutationObserver: win.MutationObserver,
    IntersectionObserver: class { observe() {} disconnect() {} }, setInterval: win.setInterval.bind(win),
    chrome: { runtime: { id: 'placement-test', onMessage: { addListener: () => {} }, sendMessage: async () => ({}) } },
  });
  try {
    const { placeTip } = await import('../src/content.js?cue-placement');
    const span = win.document.createElement('span');
    const panel = win.document.createElement('div');
    panel.getBoundingClientRect = () => ({ width: 200, height: 100 });
    span.getBoundingClientRect = () => ({ left: 30, top: 20, bottom: 40 });
    placeTip(span, panel);
    expect(panel.style.top).toBe('48px'); // above does not fit; below does
    span.getBoundingClientRect = () => ({ left: 30, top: 230, bottom: 250 });
    placeTip(span, panel);
    expect(panel.style.top).toBe('122px'); // above fits and avoids the next line
    span.getBoundingClientRect = () => ({ left: 9999, top: 230, bottom: 250 });
    placeTip(span, panel);
    expect(Number.parseInt(panel.style.left)).toBeLessThan(win.innerWidth);
  } finally {
    Object.assign(globalThis, previous);
    win.happyDOM.cancelAsync();
  }
});

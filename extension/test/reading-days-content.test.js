import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { localDay } from '../src/events.js';

test('visible target faces count once per local day, including a page left open across midnight', async () => {
  const win = new Window({ url: 'https://example.com/article' });
  const names = ['chrome', 'document', 'window', 'location', 'MutationObserver', 'IntersectionObserver',
    'setTimeout', 'clearTimeout', 'setInterval', 'Date'];
  const previous = Object.fromEntries(names.map((name) => [name, globalThis[name]]));
  const RealDate = previous.Date;
  let now = new RealDate(2026, 9, 20, 23, 59).getTime();
  class Clock extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  let tick, observeVisibility;
  let state = 'visible', cssVisible = true;
  Object.defineProperty(win.document, 'visibilityState', { get: () => state });
  const seen = [];
  const config = { settings: { enabled: true, newSitesEnabled: true, siteOverrides: {}, gradual: false },
    revision: 'reading-days', hasKey: true, paused: false, origins: ['<all_urls>'], language: 'es' };
  class IO {
    constructor(callback, options) {
      this.callback = callback; this.near = !!options.rootMargin;
      if (!this.near) observeVisibility = callback;
    }
    observe(target) {
      if (this.near) queueMicrotask(() => this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }]));
    }
    unobserve() {}
    disconnect() {}
  }
  Object.assign(globalThis, {
    window: win, document: win.document, location: win.location, MutationObserver: win.MutationObserver,
    IntersectionObserver: IO, Date: Clock, setInterval: (callback) => { tick = callback; return 1; },
    setTimeout: win.setTimeout.bind(win), clearTimeout: win.clearTimeout.bind(win),
    chrome: { runtime: { id: 'reading-days-test', onMessage: { addListener() {} }, async sendMessage(msg) {
      if (msg.type === 'config') return config;
      if (msg.type === 'swaps') return { results: Object.fromEntries(msg.items.map(({ key }) => [key,
        [{ o: 'and', f: 'y', g: 'and', h: '', word: 'y' }]])) };
      if (msg.type === 'event' && msg.event === 'seen') seen.push(localDay());
      return { ok: true };
    } } },
  });
  try {
    win.document.body.innerHTML = '<main><p>We read and write every evening.</p></main>';
    await import('../src/content.js?reading-days');
    await win.happyDOM.waitUntilComplete();
    const span = win.document.querySelector('.fw-word');
    expect(span?.textContent).toBe('y');
    expect(seen).toEqual([]);
    Object.defineProperty(span, 'checkVisibility', { value: () => cssVisible });
    const observe = (intersectionRatio) => observeVisibility([{ target: span, intersectionRatio, isIntersecting: true }]);
    const visibilityChange = () => win.document.dispatchEvent(new win.Event('visibilitychange'));
    observe(0.49);
    state = 'hidden'; observe(1);
    state = 'visible'; cssVisible = false; visibilityChange();
    expect(seen).toEqual([]);
    cssVisible = true; visibilityChange(); observe(1);
    expect(seen).toEqual(['2026-10-20']);

    now = new RealDate(2026, 9, 21, 0, 1).getTime();
    tick(); tick(); // No new observer notification is needed while a target stays visible.
    expect(seen).toEqual(['2026-10-20', '2026-10-21']);

    const click = () => span.dispatchEvent(Object.defineProperty(new win.MouseEvent('click', { bubbles: true }),
      'isTrusted', { value: true }));
    click();
    expect(span.textContent).toBe('and');
    now = new RealDate(2026, 9, 22, 0, 1).getTime();
    tick();
    expect(seen).toHaveLength(2);
    click();
    expect(span.textContent).toBe('y');
    expect(seen).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);

    now = new RealDate(2026, 9, 20, 12).getTime();
    tick(); tick(); // The worker can retain this observed day again even if the old date aged out.
    expect(seen).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-20']);
  } finally {
    win.happyDOM.cancelAsync();
    Object.assign(globalThis, previous);
  }
});

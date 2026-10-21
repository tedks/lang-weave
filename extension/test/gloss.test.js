import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';

const user = (event) => Object.defineProperty(event, 'isTrusted', { value: true });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

test('hover and focus share one delayed gloss without losing hover peeks or focused fallback', async () => {
  const win = new Window({ url: 'https://example.com/article' });
  const names = ['chrome', 'document', 'window', 'location', 'MutationObserver', 'IntersectionObserver', 'setInterval'];
  const previous = Object.fromEntries(names.map((name) => [name, globalThis[name]]));
  const events = [];
  class IO {
    constructor(callback, options) { this.callback = callback; this.options = options; this.elements = new Set(); }
    observe(el) {
      this.elements.add(el);
      if (this.options.rootMargin) queueMicrotask(() => {
        if (this.elements.has(el)) this.callback([{ target: el, isIntersecting: true, intersectionRatio: 1 }]);
      });
    }
    unobserve(el) { this.elements.delete(el); }
    disconnect() { this.elements.clear(); }
  }
  const config = { settings: { enabled: true, newSitesEnabled: true, siteOverrides: {} },
    revision: 'gloss-overlap', hasKey: true, paused: false, origins: ['<all_urls>'], language: 'es' };
  Object.assign(globalThis, {
    window: win, document: win.document, location: win.location, MutationObserver: win.MutationObserver,
    IntersectionObserver: IO, setInterval: win.setInterval.bind(win),
    chrome: { runtime: { id: 'gloss-test', onMessage: { addListener: () => {} }, sendMessage: async (msg) => {
      if (msg.type === 'config') return config;
      if (msg.type === 'swaps') return { results: Object.fromEntries(msg.items.map((item) => [item.key,
        item.text.includes('books')
          ? [{ o: 'and', f: 'y', g: 'and', h: 'ee', word: 'y' }]
          : [{ o: 'and', f: 'junto', g: 'and', h: 'hoon-toh', word: 'junto' }]])) };
      if (msg.type === 'event') { events.push(msg); return { ok: true }; }
      return { ok: true };
    } } },
  });
  try {
    win.document.body.innerHTML = '<main><p id="one">They read books and drink tea every quiet evening.</p><p id="two">We write notes and review them on calm mornings.</p></main>';
    const content = await import('../src/content.js?gloss-overlap');
    await wait(400);
    const one = win.document.querySelector('#one .fw-word');
    const two = win.document.querySelector('#two .fw-word');
    expect(one?.textContent).toBe('y');
    expect(two?.textContent).toBe('junto');
    const ordinary = win.document.querySelector('main');
    expect(() => ordinary.dispatchEvent(user(new win.MouseEvent('mouseout', { bubbles: true })))).not.toThrow();
    expect(() => ordinary.dispatchEvent(user(new win.FocusEvent('focusout', { bubbles: true })))).not.toThrow();
    // happy-dom swallows listener exceptions; call the same handler directly to pin the null guard.
    expect(() => content.disarmTip({ isTrusted: true, target: ordinary, type: 'mouseout', relatedTarget: null })).not.toThrow();
    expect(() => content.disarmTip({ isTrusted: true, target: ordinary, type: 'focusout', relatedTarget: null })).not.toThrow();

    two.dispatchEvent(user(new win.FocusEvent('focusin', { bubbles: true })));
    await wait(750);
    expect(win.document.querySelector('.fw-gloss-on')?.textContent).toBe('junto · and · "hoon-toh"');
    two.dispatchEvent(user(new win.MouseEvent('mouseover', { bubbles: true })));
    await wait(250);
    expect(win.document.querySelector('.fw-gloss-on')?.textContent).toBe('junto · and · "hoon-toh"');
    expect(events.filter((e) => e.event === 'peek')).toHaveLength(0);
    two.dispatchEvent(user(new win.MouseEvent('mouseout', { bubbles: true })));
    two.dispatchEvent(user(new win.FocusEvent('focusout', { bubbles: true })));

    one.dispatchEvent(user(new win.MouseEvent('mouseover', { bubbles: true })));
    await wait(350);
    one.dispatchEvent(user(new win.FocusEvent('focusin', { bubbles: true })));
    await wait(200);
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();
    await wait(210); // 760 ms from hover, only 410 ms from focus
    expect(win.document.querySelector('.fw-gloss-on')?.textContent).toBe('y · and · "ee"');
    expect(events.filter((e) => e.event === 'peek').map((e) => e.word)).toEqual(['y']);
    one.dispatchEvent(user(new win.MouseEvent('mouseout', { bubbles: true })));
    expect(win.document.querySelector('.fw-gloss-on')?.textContent).toMatch(/^y ·/);

    two.dispatchEvent(user(new win.MouseEvent('mouseover', { bubbles: true })));
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();
    await wait(750);
    expect(win.document.querySelectorAll('.fw-gloss-on')).toHaveLength(1);
    expect(win.document.querySelector('.fw-gloss-on')?.textContent).toBe('junto · and · "hoon-toh"');
    two.dispatchEvent(user(new win.MouseEvent('mouseout', { bubbles: true })));
    await wait(20);
    expect(win.document.querySelectorAll('.fw-gloss-on')).toHaveLength(1);
    expect(win.document.querySelector('.fw-gloss-on')?.textContent).toBe('y · and · "ee"');
    expect(events.filter((e) => e.event === 'peek').map((e) => e.word)).toEqual(['y', 'junto']);
    one.dispatchEvent(user(new win.FocusEvent('focusout', { bubbles: true })));
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();

    two.dispatchEvent(user(new win.MouseEvent('mouseover', { bubbles: true })));
    await wait(750);
    expect(win.document.querySelector('.fw-gloss-on')?.textContent).toMatch(/^junto ·/);
    one.dispatchEvent(user(new win.FocusEvent('focusin', { bubbles: true })));
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();
    await wait(750);
    expect(win.document.querySelector('.fw-gloss-on')?.textContent).toMatch(/^y ·/);
    two.dispatchEvent(user(new win.MouseEvent('mouseout', { bubbles: true })));
    expect(win.document.querySelector('.fw-gloss-on')?.textContent).toMatch(/^y ·/);
    one.dispatchEvent(user(new win.FocusEvent('focusout', { bubbles: true })));

    one.dispatchEvent(user(new win.FocusEvent('focusin', { bubbles: true })));
    await wait(750);
    two.dispatchEvent(user(new win.MouseEvent('mouseover', { bubbles: true })));
    one.dispatchEvent(user(new win.FocusEvent('focusout', { bubbles: true })));
    two.dispatchEvent(user(new win.MouseEvent('mouseout', { bubbles: true })));
    await wait(30);
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull(); // lost focus cannot revive an old box

    one.focus(); // happy-dom does not mark its focus event trusted, so deliver the user event below
    one.dispatchEvent(user(new win.FocusEvent('focusin', { bubbles: true })));
    win.dispatchEvent(new win.Event('scroll')); // focus-induced scroll follows focusin
    await wait(750);
    expect(win.document.querySelector('.fw-gloss-on')?.textContent).toBe('y · and · "ee"');
    one.dispatchEvent(user(new win.FocusEvent('focusin', { bubbles: true })));
    win.dispatchEvent(new win.Event('scroll')); // already shown: reposition without another 700 ms gap
    expect(win.document.querySelector('.fw-gloss-on')?.textContent).toBe('y · and · "ee"');
    expect(events.filter((e) => e.event === 'peek').map((e) => e.word)).toEqual(['y', 'junto']);
    await wait(300);
    win.dispatchEvent(new win.Event('scroll')); // ordinary later scroll hides it
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull();
    one.dispatchEvent(user(new win.FocusEvent('focusin', { bubbles: true })));
    await wait(300);
    win.dispatchEvent(new win.Event('scroll'));
    await wait(450);
    expect(win.document.querySelector('.fw-gloss-on')).toBeNull(); // canceled timer cannot reveal later
  } finally {
    await win.happyDOM.close();
    Object.assign(globalThis, previous);
  }
}, 10000);

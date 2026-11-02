// Guess first in the content script (happy-dom): the panel, its keyboard and dismissal rules, the
// places it never appears, and the setting off leaving the page exactly as before.
import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hoverScenario } from './guess-scenario.js';

const trusted = (event) => Object.defineProperty(event, 'isTrusted', { value: true });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const read = (path) => readFileSync(resolve(import.meta.dir, '..', path), 'utf8');
const CHOICES = ['but', 'and', 'or', 'so'];

test('with guess first off the page is byte-for-byte what the base commit produced', async () => {
  const baseline = JSON.parse(read('test/guess-off-baseline.json'));
  expect(baseline.recordedFrom).toBe('9cd3dce');
  const off = await hoverScenario('../src/content.js?guess-off');
  expect(off.sent).toEqual(baseline.off.sent);
  expect(off.snapshots).toEqual(baseline.off.snapshots);
  expect(off.snapshots[1]).toContain('<div class="fw-gloss fw-gloss-on" aria-hidden="true"'); // positive control
  // The setting needs gradual learning: on without it is also unchanged.
  const ungradual = await hoverScenario('../src/content.js?guess-ungradual', { gradual: false, guessFirst: true });
  expect(ungradual.sent).toEqual(baseline.ungradual.sent);
  expect(ungradual.snapshots).toEqual(baseline.ungradual.snapshots);
}, 30000);

// A page with the setting on. `reply` answers guessBegin/guessAnswer; every message is kept.
async function page(name, { reply = {}, body } = {}) {
  const win = new Window({ url: 'https://example.com/article' });
  const names = ['chrome', 'document', 'window', 'location', 'MutationObserver', 'IntersectionObserver', 'setInterval'];
  const previous = Object.fromEntries(names.map((key) => [key, globalThis[key]]));
  const roots = new WeakMap();
  const originalAttach = win.HTMLElement.prototype.attachShadow;
  win.HTMLElement.prototype.attachShadow = function (options) {
    const root = originalAttach.call(this, options); roots.set(this, root); return root;
  };
  const sent = [];
  const listeners = [];
  const config = { settings: { enabled: true, newSitesEnabled: true, siteOverrides: {}, gradual: true, inlineRecall: false,
    guessFirst: true }, revision: 'guess', hasKey: true, paused: false, origins: ['<all_urls>'], language: 'es' };
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
    chrome: { runtime: { id: 'guess-test', onMessage: { addListener: (fn) => listeners.push(fn) }, sendMessage: async (msg) => {
      sent.push(structuredClone(msg));
      if (msg.type === 'config') return config;
      if (msg.type === 'swaps') return { results: Object.fromEntries(msg.items.map((item) => [item.key,
        [{ o: 'and', f: 'y', g: 'and', h: 'ee', word: 'y', status: 'active', guessEligible: true }]])) };
      if (msg.type === 'guessBegin') return reply.begin ? reply.begin(msg) : { ticket: 'ticket-1', choices: CHOICES };
      if (msg.type === 'guessAnswer') return reply.answer ? reply.answer(msg)
        : { ok: true, correct: msg.choice === 1, answer: 1, logged: true };
      return { ok: true };
    } } },
  });
  win.document.body.innerHTML = body || '<main><p id="one">We read and write every evening.</p></main>';
  await import(`../src/content.js?${name}`);
  await wait(400);
  const doc = win.document;
  const types = () => sent.map((m) => (m.type === 'event' ? `event:${m.event}` : m.type));
  const hover = async (span, ms = 750) => { span.dispatchEvent(trusted(new win.MouseEvent('mouseover', { bubbles: true }))); await wait(ms); };
  const key = (target, k, isTrusted = true, shiftKey = false) => {
    const event = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, shiftKey });
    target.dispatchEvent(isTrusted ? trusted(event) : event);
    return event;
  };
  const click = (target, isTrusted = true) => {
    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(isTrusted ? trusted(event) : event);
  };
  // happy-dom does not mark focus events trusted (as Chrome does for focus()), so deliver them.
  const focusIn = (span, relatedTarget = null) => {
    span.focus();
    span.dispatchEvent(trusted(new win.FocusEvent('focusin', { bubbles: true, relatedTarget })));
  };
  const focusOut = (span, relatedTarget = null) => {
    span.dispatchEvent(trusted(new win.FocusEvent('focusout', { bubbles: true, relatedTarget })));
    span.blur();
  };
  const guessPanels = () => [...doc.querySelectorAll('.fw-guess-host')].map((host) => roots.get(host)?.querySelector('.fw-guess')).filter(Boolean);
  const guessPanel = () => guessPanels()[0] || null;
  const guessActive = () => doc.activeElement?.matches?.('button') ? doc.activeElement
    : guessPanel()?.getRootNode().activeElement || doc.activeElement;
  return { win, doc, sent, types, hover, key, click, listeners, config, focusIn, focusOut, guessPanels, guessPanel, guessActive,
    restore: () => { Object.assign(globalThis, previous); win.happyDOM.cancelAsync(); } };
}

test('a hover dwell opens the choice panel instead of the gloss, and a choice reveals the meaning', async () => {
  const p = await page('guess-hover');
  try {
    const span = p.doc.querySelector('.fw-word');
    expect(span).toBeTruthy();
    await p.hover(span, 300);
    expect(p.guessPanel()).toBeNull(); // the same 700 ms beat as the gloss
    await wait(450);
    const panel = p.guessPanel();
    expect(panel).toBeTruthy();
    expect(p.doc.querySelector('.fw-gloss')).toBeNull();
    expect(p.types()).not.toContain('event:peek'); // the meaning is not shown yet
    expect(p.sent.find((m) => m.type === 'guessBegin')).toEqual({ type: 'guessBegin', word: 'y', revision: 'guess' });
    expect(panel.getRootNode().host.getAttribute('role')).toBe('group');
    expect(panel.getRootNode().host.getAttribute('aria-label')).toBe('Guess the meaning');
    expect(panel.getRootNode().host.shadowRoot).toBeNull();
    expect(span.getAttribute('aria-controls')).toBe(panel.getRootNode().host.id);
    expect(panel.querySelector('.fw-guess-status').textContent).toContain('Guess choices ready');
    expect(panel.querySelector('.fw-guess-word').textContent).toBe('y');
    expect(panel.querySelector('.fw-guess-word').getAttribute('lang')).toBe('es');
    expect(panel.querySelector('.fw-guess-status').getAttribute('aria-live')).toBe('polite');
    const buttons = [...panel.querySelectorAll('.fw-guess-choices button')];
    expect(buttons.map((b) => b.lastChild.textContent)).toEqual(CHOICES);
    expect(buttons.map((b) => b.querySelector('.fw-guess-key').textContent)).toEqual(['1', '2', '3', '4']);
    expect(buttons.every((b) => b.querySelector('.fw-guess-key').getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(p.guessActive()).not.toBe(buttons[0]); // a hover never takes focus
    // Leaving the word does not close it: the reader moves to the panel.
    span.dispatchEvent(trusted(new p.win.MouseEvent('mouseout', { bubbles: true })));
    await wait(20);
    expect(p.guessPanel()).toBe(panel);
    p.click(buttons[0], false); // page scripts cannot answer
    await wait(20);
    expect(p.types()).not.toContain('guessAnswer');
    p.click(buttons[0]);
    await wait(20);
    expect(p.sent.find((m) => m.type === 'guessAnswer')).toEqual({ type: 'guessAnswer', ticket: 'ticket-1', choice: 0, revision: 'guess' });
    expect(panel.querySelector('.fw-guess-status').textContent).toBe('Not quite: y · and · "ee"');
    expect(buttons[1].classList.contains('fw-guess-right')).toBe(true);
    expect(buttons[0].classList.contains('fw-guess-wrong')).toBe(true);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    p.click(buttons[1]);
    await wait(20);
    expect(p.types().filter((t) => t === 'guessAnswer')).toHaveLength(1);
    // The answered panel closes on a click away; the next hover today is the plain gloss with its peek.
    p.doc.body.dispatchEvent(trusted(new p.win.MouseEvent('pointerdown', { bubbles: true })));
    expect(p.guessPanel()).toBeNull();
    await p.hover(span);
    expect(p.doc.querySelector('.fw-gloss')?.textContent).toBe('y · and · "ee"');
    expect(p.types().filter((t) => t === 'guessBegin')).toHaveLength(1);
    expect(p.types()).toContain('event:peek');
  } finally { p.restore(); }
}, 30000);

test('a right answer says so; a failed answer still shows the meaning without judging it', async () => {
  let fail = false;
  const p = await page('guess-right', { reply: { answer: (msg) => (fail ? { error: 'stale' } : { ok: true, correct: true, answer: msg.choice }) } });
  try {
    const span = p.doc.querySelector('.fw-word');
    await p.hover(span);
    p.click(p.guessPanel().querySelectorAll('.fw-guess-choices button')[1]);
    await wait(20);
    expect(p.guessPanel().querySelector('.fw-guess-status').textContent).toBe('Right: y · and · "ee"');
    expect(p.guessPanel().querySelector('.fw-guess-wrong')).toBeNull();
    p.key(p.doc.body, 'Escape');
    expect(p.guessPanel()).toBeNull();
  } finally { p.restore(); }
  fail = true;
  const q = await page('guess-fail', { reply: { answer: () => ({ error: 'This guess is stale.' }) } });
  try {
    await q.hover(q.doc.querySelector('.fw-word'));
    q.click(q.guessPanel().querySelectorAll('.fw-guess-choices button')[2]);
    await wait(20);
    expect(q.guessPanel().querySelector('.fw-guess-status').textContent).toBe('y · and · "ee"');
    expect(q.guessPanel().querySelector('.fw-guess-right, .fw-guess-wrong')).toBeNull();
  } finally { q.restore(); }
}, 30000);

test('keyboard: arrows and 1-4 pick, Tab and Escape return focus, untrusted keys do nothing', async () => {
  const p = await page('guess-keys');
  try {
    const span = p.doc.querySelector('.fw-word');
    p.focusIn(span);
    await wait(750);
    const panel = p.guessPanel();
    expect(panel).toBeTruthy();
    expect(p.guessActive()).toBe(span); // opening never moves focus
    const buttons = [...panel.querySelectorAll('.fw-guess-choices button')];
    p.key(span, 'ArrowDown', false);
    expect(p.guessActive()).toBe(span);
    const down = p.key(span, 'ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(p.guessActive()).toBe(buttons[0]);
    p.key(buttons[0], '3');
    expect(p.guessActive()).toBe(buttons[2]);
    p.key(buttons[2], 'ArrowUp');
    expect(p.guessActive()).toBe(buttons[1]);
    p.key(buttons[1], 'ArrowLeft');
    expect(p.guessActive()).toBe(buttons[0]);
    p.key(buttons[0], 'ArrowUp'); // wraps
    expect(p.guessActive()).toBe(buttons[3]);
    p.key(buttons[3], '9'); // no such choice
    expect(p.guessActive()).toBe(buttons[3]);
    buttons[0].focus();
    p.key(buttons[0], 'Tab', true, true); // Shift+Tab returns to the word
    expect(p.guessActive()).toBe(span);
    p.key(span, 'Tab');
    expect(p.guessActive()).toBe(buttons[0]);
    expect(p.guessPanel()).toBe(panel);
    p.key(span, '2');
    expect(p.guessActive()).toBe(buttons[1]);
    const escape = p.key(buttons[1], 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(p.guessPanel()).toBeNull();
    expect(p.guessActive()).toBe(span); // focus return, as the inline cue does
    await wait(750);
    expect(p.guessPanel() || p.doc.querySelector('.fw-gloss')).toBeNull(); // dismissed: not reopened on its own
    expect(p.types()).not.toContain('guessAnswer');
    expect(p.types().filter((t) => t === 'guessBegin')).toHaveLength(1);
    // Enter on the word itself still flips it, closing any panel and recording nothing for the guess.
    p.focusOut(span);
    p.focusIn(span);
    await wait(750);
    expect(p.guessPanel()).toBeTruthy();
    p.key(span, 'Enter');
    expect(p.guessPanel()).toBeNull();
    expect(span.classList.contains('fw-en')).toBe(true);
    expect(p.types()).not.toContain('guessAnswer');
  } finally { p.restore(); }
}, 30000);

test('a click away or a dismissal records nothing; at most one panel is open', async () => {
  const p = await page('guess-one', { body: '<main><p id="one">We read and write every evening.</p><p id="two">We cook and eat every evening.</p></main>' });
  try {
    const [first, second] = p.doc.querySelectorAll('.fw-word');
    p.focusIn(first);
    await wait(750);
    expect(p.guessPanels()).toHaveLength(1);
    p.focusOut(first, second);
    expect(p.guessPanels()).toHaveLength(0); // focus left the panel and its word
    p.focusIn(second, first); // the keyboard moved on
    expect(p.guessPanels()).toHaveLength(0);
    await wait(750);
    expect(p.guessPanels()).toHaveLength(1);
    // A full hover dwell on the other word replaces the panel; a pass across it does not.
    p.focusOut(second, null); // a window blur keeps the panel
    expect(p.guessPanels()).toHaveLength(1);
    p.guessPanel()?.querySelector('.fw-guess-actions button').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
    expect(p.guessPanels()).toHaveLength(1); // untrusted dismissal ignored
    first.dispatchEvent(trusted(new p.win.MouseEvent('mouseover', { bubbles: true })));
    first.dispatchEvent(trusted(new p.win.MouseEvent('mouseout', { bubbles: true })));
    await wait(750);
    expect(p.guessPanels()).toHaveLength(1);
    await p.hover(first);
    expect(p.guessPanels()).toHaveLength(1);
    p.doc.body.dispatchEvent(trusted(new p.win.MouseEvent('pointerdown', { bubbles: true })));
    expect(p.guessPanels()).toHaveLength(0);
    await p.hover(second);
    p.click(p.guessPanel()?.querySelector('.fw-guess-actions button'));
    expect(p.guessPanels()).toHaveLength(0);
    expect(p.types()).not.toContain('guessAnswer');
  } finally { p.restore(); }
}, 30000);

test('a plain reply shows the gloss with its peek and is remembered for the day; a stale one is not', async () => {
  let stale = true;
  const p = await page('guess-plain', { reply: { begin: () => ({ plain: true, ...(stale ? { stale: true } : {}) }) } });
  try {
    const span = p.doc.querySelector('.fw-word');
    await p.hover(span);
    expect(p.doc.querySelector('.fw-gloss')?.textContent).toBe('y · and · "ee"');
    expect(p.guessPanel()).toBeNull();
    expect(p.types()).toContain('event:peek');
    span.dispatchEvent(trusted(new p.win.MouseEvent('mouseout', { bubbles: true })));
    stale = false;
    await p.hover(span);
    span.dispatchEvent(trusted(new p.win.MouseEvent('mouseout', { bubbles: true })));
    await p.hover(span);
    expect(p.types().filter((t) => t === 'guessBegin')).toHaveLength(1);
  } finally { p.restore(); }
}, 30000);

test('no panel inside a form or an editable region, and the setting turning off closes one', async () => {
  const p = await page('guess-places');
  try {
    const span = p.doc.querySelector('.fw-word');
    const main = p.doc.querySelector('main');
    main.setAttribute('contenteditable', 'true');
    await p.hover(span);
    expect(p.guessPanel()).toBeNull();
    expect(p.doc.querySelector('.fw-gloss')).toBeTruthy();
    expect(p.types()).not.toContain('guessBegin');
    span.dispatchEvent(trusted(new p.win.MouseEvent('mouseout', { bubbles: true })));
    main.removeAttribute('contenteditable');
    const form = p.doc.createElement('form');
    main.parentNode.insertBefore(form, main);
    form.append(main);
    await wait(20);
    const moved = p.doc.querySelector('form .fw-word');
    expect(moved).toBeTruthy(); // positive control: the swap survived the move
    await p.hover(moved);
    expect(p.guessPanel()).toBeNull();
    expect(p.types()).not.toContain('guessBegin');
    moved.dispatchEvent(trusted(new p.win.MouseEvent('mouseout', { bubbles: true })));
    p.doc.body.append(main);
    await wait(20);
    await p.hover(p.doc.querySelector('.fw-word'));
    expect(p.doc.querySelector('.fw-gloss')).toBeTruthy(); // the withheld meaning was released in the form
    const fresh = p.doc.createElement('p');
    fresh.id = 'fresh';
    fresh.textContent = 'We read and write every evening.';
    main.append(fresh);
    await wait(400);
    await p.hover(fresh.querySelector('.fw-word'));
    expect(p.guessPanel()).toBeTruthy(); // a fresh eligible swap still opens outside the form
    // The setting turns off in Settings: same revision, the panel closes and hovers are plain again.
    const { guessFirst, ...settings } = p.config.settings;
    for (const fn of p.listeners) fn({ type: 'config', config: { ...p.config, settings } });
    expect(p.guessPanel()).toBeNull();
    const word = fresh.querySelector('.fw-word');
    word.dispatchEvent(trusted(new p.win.MouseEvent('mouseout', { bubbles: true })));
    const before = p.types().filter((t) => t === 'guessBegin').length;
    await p.hover(word);
    expect(p.types().filter((t) => t === 'guessBegin')).toHaveLength(before);
    expect(p.doc.querySelector('.fw-gloss')).toBeTruthy();
  } finally { p.restore(); }
}, 30000);

test('the welcome demo never loads the content script or the guess panel', () => {
  const welcome = read('src/welcome.js');
  const html = read('src/welcome.html');
  expect(welcome).not.toMatch(/content\.js|guess/);
  expect(html).not.toMatch(/content\.js|guess/); // it links content.css for the demo's swap styles only
  // content.js only acts on http(s) pages: on() needs siteEnabled, which refuses other schemes.
  expect(read('src/content.js')).toMatch(/const on = \(\) => !orphaned && window\.top === window/);
});

test('the panel colours are the ui.css tokens, light and dark, with forced colours', () => {
  const ui = read('src/ui.css');
  const css = read('src/content.css');
  const block = (text, selector, media) => {
    const scope = media ? text.slice(text.indexOf(media)) : text;
    const start = scope.indexOf(`${selector} {`);
    return scope.slice(start, scope.indexOf('}', start));
  };
  const token = (text, name) => new RegExp(`--${name}:\\s*(#[0-9a-f]+)`).exec(text)?.[1];
  const uiLight = block(ui, ':root');
  const uiDark = block(ui, ':root', '@media (prefers-color-scheme: dark)');
  const light = block(css, '.fw-guess');
  const dark = block(css, '.fw-guess', '@media (prefers-color-scheme: dark) {\n  .fw-guess');
  for (const [mine, theirs] of [['text', 'text'], ['surface', 'surface'], ['border', 'border'], ['muted', 'muted'], ['danger', 'danger']]) {
    expect(token(light, `fw-${mine}`)).toBe(token(uiLight, `ui-${theirs}`));
    expect(token(dark, `fw-${mine}`)).toBe(token(uiDark, `ui-${theirs}`));
  }
  for (const name of ['control-text', 'control-bg', 'control-border'])
    expect(token(dark, `fw-${name}`)).toBe(token(uiDark, `ui-${name}`));
  expect(css).toMatch(/@media \(forced-colors: active\) \{\n  \.fw-guess \{ color: CanvasText; background: Canvas;/);
});

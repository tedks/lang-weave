import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

// Mount the shipped markup so these tests break when review.html and
// review-page.js drift apart.
const html = readFileSync(new URL('../src/review.html', import.meta.url), 'utf8');
const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('<script'));
const DAY_MS = 86400000;
const RETURNS = { again: 10 * 60 * 1000, hard: DAY_MS, medium: 3 * DAY_MS, easy: 7 * DAY_MS };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

async function mount(name, sendMessage) {
  const previous = { document: globalThis.document, chrome: globalThis.chrome };
  const window = new Window();
  window.document.body.innerHTML = body;
  globalThis.document = window.document;
  const listeners = [];
  globalThis.chrome = {
    runtime: { sendMessage },
    storage: { onChanged: { addListener: (fn) => listeners.push(fn) } },
  };
  await import(`../src/review-page.js?${name}`);
  const doc = window.document;
  return {
    window, doc,
    $: (id) => doc.getElementById(id),
    changed: (...args) => listeners.forEach((fn) => fn(...args)),
    press: (key, init = {}, target = doc.activeElement || doc.body) => {
      const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    },
    restore: async () => {
      Object.assign(globalThis, previous);
      await window.happyDOM.abort();
    },
  };
}

// A minimal stand-in for the worker's review queue: one card at a time, a
// reveal before any rating, and the due time the scheduler would return.
function fakeQueue(words, { language = 'Spanish', fresh = 0, returns = RETURNS } = {}) {
  const sent = [];
  let index = 0;
  let revealed = false;
  const sendMessage = async (message) => {
    sent.push(message);
    const word = words[index];
    if (message.type === 'reviewNext') return { language, due: words.length - index, new: fresh,
      card: word ? { ticket: `ticket-${index}`, en: word.en, revealed } : null };
    if (message.type === 'reviewReveal') { revealed = true; return { answer: { fr: word.fr, hint: '' } }; }
    if (message.type === 'reviewRate') {
      if (!revealed) return { error: 'This rating is stale or the answer has not been revealed.' };
      index++; revealed = false;
      return { ok: true, due: Date.now() + returns[message.rating], interval: 1 };
    }
    if (message.type === 'reviewKnown') { index++; revealed = false; return { ok: true }; }
    throw new Error(`Unexpected review request: ${message.type}`);
  };
  return { sent, sendMessage, ratings: () => sent.filter((m) => m.type === 'reviewRate').map((m) => m.rating) };
}

const WORDS = [
  { en: 'and', fr: 'y' }, { en: 'but', fr: 'pero' }, { en: 'or', fr: 'o' },
  { en: 'now', fr: 'ahora' }, { en: 'here', fr: 'aquí' },
];

test('an open review tab discards a revealed answer after language changes while refreshing', async () => {
  let releaseFrenchAnswer;
  let releaseSpanishQueue;
  let answerRequested;
  let queueRequested;
  const answerStarted = new Promise((resolve) => { answerRequested = resolve; });
  const queueStarted = new Promise((resolve) => { queueRequested = resolve; });
  let queues = 0;
  const page = await mount('language-refresh', ({ type }) => {
    if (type === 'reviewNext' && ++queues === 1) return Promise.resolve({
      language: 'French', due: 1, new: 0,
      card: { ticket: 'old', en: 'and', revealed: true },
    });
    if (type === 'reviewNext') {
      queueRequested();
      return new Promise((resolve) => { releaseSpanishQueue = resolve; });
    }
    if (type === 'reviewReveal') {
      answerRequested();
      return new Promise((resolve) => { releaseFrenchAnswer = resolve; });
    }
    throw new Error(`Unexpected review request: ${type}`);
  });
  try {
    await answerStarted;
    expect(page.$('language').textContent).toBe('Reviewing French');
    page.changed({ settings: {} }, 'local');
    releaseFrenchAnswer({ answer: { fr: 'et', hint: 'eh' } });
    await queueStarted;
    expect(page.$('solution').hidden).toBe(true);
    releaseSpanishQueue({ language: 'Spanish', due: 1, new: 0,
      card: { ticket: 'new', en: 'but', revealed: false } });
    await settle();
    expect(page.$('language').textContent).toBe('Reviewing Spanish');
    expect(page.$('prompt').textContent).toBe('but');

    // The same guard applies when a user clicks Reveal during a switch.
    const clickStarted = new Promise((resolve) => { answerRequested = resolve; });
    const nextQueueStarted = new Promise((resolve) => { queueRequested = resolve; });
    page.$('reveal').click();
    await clickStarted;
    page.changed({ languagePacks: {} }, 'local');
    releaseFrenchAnswer({ answer: { fr: 'pero', hint: 'peh-roh' } });
    await nextQueueStarted;
    expect(page.$('solution').hidden).toBe(true);
    releaseSpanishQueue({ language: 'Spanish', due: 0, new: 0, card: null });
    await settle();
  } finally {
    await page.restore();
  }
});

test('standalone Again is sent only after reveal and restores the queue after a saved rating', async () => {
  const sent = [];
  let queues = 0;
  const page = await mount('again-dom', async (message) => {
    sent.push(message);
    if (message.type === 'reviewNext') return { language: 'Spanish', due: queues++ ? 0 : 1, new: 0,
      card: queues === 1 ? { ticket: 'review-ticket', en: 'and', revealed: false } : null };
    if (message.type === 'reviewReveal') return { answer: { fr: 'y', hint: 'ee' } };
    if (message.type === 'reviewRate') return { ok: true };
    throw new Error(`Unexpected review request: ${message.type}`);
  });
  try {
    await settle();
    page.doc.querySelector('[data-rating="again"]').click();
    await settle();
    expect(sent.filter((m) => m.type === 'reviewRate')).toHaveLength(0);
    page.$('reveal').click();
    await settle();
    expect(page.$('solution').hidden).toBe(false);
    page.doc.querySelector('[data-rating="again"]').click();
    await settle();
    expect(sent.filter((m) => m.type === 'reviewRate')).toEqual([
      { type: 'reviewRate', ticket: 'review-ticket', rating: 'again' },
    ]);
    expect(page.$('question').hidden).toBe(true);
  } finally {
    await page.restore();
  }
});

test('focus lands on Reveal after load and on a rating after reveal, never on body', async () => {
  const queue = fakeQueue(WORDS.slice(0, 2));
  const page = await mount('focus-flow', queue.sendMessage);
  const main = page.doc.querySelector('main');
  const medium = page.doc.querySelector('[data-rating="medium"]');
  try {
    await settle();
    expect(page.doc.activeElement).toBe(page.$('reveal'));
    expect(page.$('progress').textContent).toBe('Card 1 of 2');
    expect([...page.doc.querySelectorAll('.language-name')].map((n) => n.textContent))
      .toEqual(['Spanish', 'Spanish']);
    expect(page.doc.body.textContent).not.toContain('selected language');

    page.$('reveal').click();
    expect(main.getAttribute('aria-busy')).toBe('true');
    await settle();
    expect(main.hasAttribute('aria-busy')).toBe(false);
    expect(page.$('solution').hidden).toBe(false);
    expect(page.doc.activeElement).toBe(medium);

    page.doc.querySelector('[data-rating="hard"]').click();
    await settle();
    expect(page.doc.activeElement).toBe(page.$('reveal'));
    expect(page.$('prompt').textContent).toBe('but');
    expect(page.$('progress').textContent).toBe('Card 2 of 2');

    page.$('reveal').click();
    await settle();
    expect(page.doc.activeElement).toBe(medium);
    page.doc.querySelector('[data-rating="easy"]').click();
    await settle();
    expect(page.$('question').hidden).toBe(true);
    expect(page.$('empty').hidden).toBe(true);
    expect(page.$('finish').hidden).toBe(false);
    expect(page.doc.activeElement).toBe(page.$('finish'));
    expect(page.$('finish-summary').textContent).toBe('You completed 2 reviews.');
    // Hard returns in one day; Easy in seven. The earliest is reported.
    expect(page.$('finish-next').textContent).toBe('Next review from this session: tomorrow, 1 word.');
    expect(queue.ratings()).toEqual(['hard', 'easy']);
    expect(page.doc.activeElement).not.toBe(page.doc.body);
  } finally {
    await page.restore();
  }
});

test('Space or Enter reveals and keys 1 to 4 rate Again, Hard, Medium and Easy', async () => {
  const queue = fakeQueue(WORDS);
  const page = await mount('keyboard-map', queue.sendMessage);
  const fromBody = (key, init) => { page.doc.activeElement?.blur?.(); return page.press(key, init, page.doc.body); };
  try {
    await settle();
    // Hints are visible and announced through aria-keyshortcuts.
    const hints = [...page.doc.querySelectorAll('[data-rating]')]
      .map((b) => [b.getAttribute('aria-keyshortcuts'), b.querySelector('kbd')?.textContent, b.dataset.rating]);
    expect(hints).toEqual([['1', '1', 'again'], ['2', '2', 'hard'], ['3', '3', 'medium'], ['4', '4', 'easy']]);
    expect(page.$('reveal').querySelector('kbd').textContent).toBe('Space');
    expect(page.$('known').hasAttribute('aria-keyshortcuts')).toBe(false);

    // Ratings before reveal are ignored; reveal-before-rating holds for keys too.
    fromBody('1');
    await settle();
    expect(queue.ratings()).toEqual([]);
    expect(page.$('solution').hidden).toBe(true);

    expect(fromBody(' ').defaultPrevented).toBe(true);
    await settle();
    expect(page.$('solution').hidden).toBe(false);
    // A held key, a modified digit, and 5 do nothing.
    expect(page.press('Enter', { repeat: true }).defaultPrevented).toBe(true);
    page.press('4', { ctrlKey: true });
    page.press('5');
    await settle();
    expect(queue.ratings()).toEqual([]);
    // A digit works while the focused control is a rating button.
    expect(page.doc.activeElement.dataset.rating).toBe('medium');
    page.press('1');
    await settle();
    expect(page.$('prompt').textContent).toBe('but');

    for (const [revealKey, rateKey] of [['Enter', '2'], [' ', '3'], ['Enter', '4']]) {
      fromBody(revealKey);
      await settle();
      expect(page.$('solution').hidden).toBe(false);
      fromBody(rateKey);
      await settle();
    }
    expect(queue.ratings()).toEqual(['again', 'hard', 'medium', 'easy']);
    expect(page.$('progress').textContent).toBe('Card 5 of 5');
    // Already know stays a deliberate click and counts as a completed review.
    page.$('reveal').click();
    await settle();
    page.$('known').click();
    await settle();
    expect(queue.sent.filter((m) => m.type === 'reviewKnown')).toHaveLength(1);
    expect(page.$('finish-summary').textContent).toBe('You completed 5 reviews.');
    expect(page.$('finish-next').textContent).toMatch(/^Next review from this session: today from .+, 1 word\.$/);
  } finally {
    await page.restore();
  }
});

test('the queue reloads itself; Reload queue appears only after a failure', async () => {
  let fail = true;
  const queue = fakeQueue([{ en: 'and', fr: 'y' }], { returns: { ...RETURNS, again: 20 } });
  const page = await mount('retry', async (message) => {
    if (message.type === 'reviewNext' && fail) { fail = false; return { error: 'Review is unavailable' }; }
    return queue.sendMessage(message);
  });
  try {
    expect(page.doc.getElementById('refresh')).toBeNull();
    await settle();
    expect(page.$('notice').textContent).toBe('Review is unavailable');
    expect(page.$('retry').hidden).toBe(false);
    expect(page.doc.activeElement).toBe(page.$('retry'));
    page.$('retry').click();
    await settle();
    expect(page.$('retry').hidden).toBe(true);
    expect(page.doc.activeElement).toBe(page.$('reveal'));

    // An Again rating due soon brings the card back without a refresh button.
    page.$('reveal').click();
    await settle();
    page.doc.querySelector('[data-rating="again"]').click();
    await settle();
    expect(page.$('finish').hidden).toBe(false);
    const loadsBefore = queue.sent.filter((m) => m.type === 'reviewNext').length;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await settle();
    expect(queue.sent.filter((m) => m.type === 'reviewNext').length).toBe(loadsBefore + 1);
  } finally {
    await page.restore();
  }
});

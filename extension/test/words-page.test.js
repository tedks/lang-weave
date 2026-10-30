import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const waitFor = async (predicate) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 0));
  }
  throw new Error('My words did not update');
};

const progress = {
  language: 'Spanish', due: 1, new: 3, verifiedKnown: 2, practisedThisWeek: 3,
  today: { day: '2026-10-30', introduced: 1, seen: 4, peeked: 0, flipped: 0, reviewed: 2 },
  stages: { new: 140, learning: 6, maintenance: 2, known: 1, verified: 2 },
  activity: Array.from({ length: 30 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, retrievals: i % 3 ? 0 : 2 })),
  measurements: {
    graded: 3, nextDayRecall: { n: 1, passed: 1, rate: 1, enough: false },
    longRetention: { n: 0, rate: null, target: 0.9, enough: false },
    calibration: { n: 0, brier: null, baselineBrier: null, beatsConstant: null, buckets: [], enough: false },
    leeches: { count: 0, words: [], enough: false },
    exposure: { words: 6, medianDays: 2, atTarget: 0, enough: true },
    workload: { reviewsPerDay: 0.2, medianSecondsPerReview: 4, enough: true },
  },
};

test('My words renders in batches, filters, moves focus by keyboard, and resets only after a second click', async () => {
  const oldDocument = globalThis.document, oldChrome = globalThis.chrome;
  const window = new Window({ url: 'chrome-extension://fw-words/src/words.html' });
  window.document.write(readFileSync(new URL('../src/words.html', import.meta.url), 'utf8'));
  globalThis.document = window.document;
  const now = Date.parse('2026-10-30T12:00:00Z');
  const rows = Array.from({ length: 150 }, (_, i) => ({ id: `w${i}`, kind: 'pack', target: `palabra${i}`, gloss: `word ${i}`,
    hint: '', stage: 'new', due: null, reviews: 0, familiar: false, lapses: 0, exposures: 0, days: 0, version: null,
    practise: true, reason: '' }));
  rows[3] = { ...rows[3], target: 'pájaro', gloss: 'bird', stage: 'learning', due: now + 2 * 86400000, reviews: 2,
    exposures: 5, days: 3, version: { due: now + 2 * 86400000, reviews: 2, familiar: false } };
  rows.push({ id: 'personal:es:x', kind: 'personal', target: 'brillar', gloss: 'shimmer', sense: 'glimmer', hint: '',
    stage: 'known', due: null, reviews: 0, familiar: true, lapses: 0, exposures: 0, days: 0,
    version: { due: now, reviews: 0, familiar: true }, archived: false, practise: false,
    reason: 'Marked known. Reset it to practise again.' });
  const sent = [];
  const opened = [];
  globalThis.chrome = {
    runtime: { getURL: (path) => `chrome-extension://fw-words/${path}`, openOptionsPage: async () => opened.push('options'),
      sendMessage: async (msg) => {
        sent.push(msg);
        if (msg.type === 'progress') return progress;
        if (msg.type === 'wordsList') return { language: 'Spanish', scope: 'es', now, rows };
        if (msg.type === 'wordReset') return { ok: true };
        if (msg.type === 'wordPractice') return { ok: true, introduced: false };
        throw new Error(`Unexpected ${msg.type}`);
      } },
    tabs: { create: async ({ url }) => { opened.push(url); return { id: 3 }; } },
  };
  try {
    await import('../src/words.js?page');
    const $ = (id) => window.document.getElementById(id);
    const items = () => [...$('words').children].filter((li) => li.dataset.id);
    await waitFor(() => items().length === 60);
    expect($('count').textContent).toBe('151 words');
    expect($('headline').textContent).toBe('2 words verified known');
    expect($('today').textContent).toBe('Today: 1 introduced · 4 seen · 2 reviewed');
    expect($('week').textContent).toBe('Practised on 3 days of the last 7');
    expect($('strip').children).toHaveLength(30);
    expect($('strip').getAttribute('aria-label')).toBe('Days with reviews in the last 30 days: 10');
    expect($('measures').children).toHaveLength(7);
    expect($('more').hidden).toBe(false);
    expect($('more').textContent).toBe('Show more (91 left)');
    $('more').click();
    expect(items()).toHaveLength(120);
    expect(window.document.body.textContent).not.toMatch(/https?:/);

    // Keyboard: ArrowDown from search enters the list; End renders everything; Home and ArrowUp go back.
    $('search').focus();
    $('search').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(window.document.activeElement.dataset.id).toBe('w0');
    const key = (k) => window.document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowDown');
    expect(window.document.activeElement.dataset.id).toBe('w1');
    key('End');
    expect(items()).toHaveLength(151);
    expect(window.document.activeElement.dataset.id).toBe('personal:es:x');
    key('Home');
    expect(window.document.activeElement.dataset.id).toBe('w0');
    key('ArrowUp');
    expect(window.document.activeElement).toBe($('search'));

    // Search folds accents and case, and matches glosses and senses.
    $('search').value = 'PAJARO';
    $('search').dispatchEvent(new window.Event('input'));
    expect(items().map((li) => li.dataset.id)).toEqual(['w3']);
    expect($('count').textContent).toBe('1 word of 151');
    expect(items()[0].textContent).toContain('Learning · Due in 2 days · seen 5 times on 3 days');
    $('search').value = 'glimmer';
    $('search').dispatchEvent(new window.Event('input'));
    expect(items().map((li) => li.dataset.id)).toEqual(['personal:es:x']);
    const known = items()[0];
    const buttons = (li) => [...li.querySelectorAll('button')].map((b) => [b.textContent, b.disabled]);
    expect(buttons(known)).toEqual([['Practice now', true], ['Reset', false], ['Archive', false]]);
    $('search').value = '';
    $('search').dispatchEvent(new window.Event('input'));
    $('stage').value = 'learning';
    $('stage').dispatchEvent(new window.Event('change'));
    expect(items().map((li) => li.dataset.id)).toEqual(['w3']);

    // Reset: the first click only asks; Cancel restores; the second click sends confirm and the version shown.
    const row = () => items()[0];
    const click = (label) => [...row().querySelectorAll('button')].find((b) => b.textContent === label).click();
    click('Reset');
    expect(sent.some((m) => m.type === 'wordReset')).toBe(false);
    expect(row().textContent).toContain('Reset pájaro?');
    click('Cancel');
    expect(buttons(row()).map(([label]) => label)).toEqual(['Practice now', 'Already know', 'Reset']);
    click('Reset');
    click('Confirm reset');
    await waitFor(() => sent.some((m) => m.type === 'wordReset'));
    expect(sent.find((m) => m.type === 'wordReset')).toEqual({ type: 'wordReset', id: 'w3', scope: 'es', confirm: true,
      version: rows[3].version });
    await waitFor(() => $('count').textContent.startsWith('pájaro was reset.'));

    // Practice now names the listed scope and opens the review page.
    click('Practice now');
    await waitFor(() => opened.includes('chrome-extension://fw-words/src/review.html'));
    expect(sent.find((m) => m.type === 'wordPractice')).toEqual({ type: 'wordPractice', id: 'w3', scope: 'es' });
  } finally {
    globalThis.document = oldDocument;
    globalThis.chrome = oldChrome;
    window.happyDOM.abort();
  }
});

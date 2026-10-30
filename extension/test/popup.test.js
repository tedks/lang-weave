import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 0));
  }
  throw new Error('Popup did not update');
};

test('popup shows one action and grants this site before saving or injecting', async () => {
  const oldDocument = globalThis.document, oldChrome = globalThis.chrome;
  const window = new Window({ url: 'chrome-extension://fw-popup/src/popup.html' });
  window.document.write(readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8'));
  globalThis.document = window.document;
  const events = [];
  let failSave = false;
  const state = { enabled: true, due: 3, available: 7, access: false, siteOverride: null, progressFails: false };
  const today = { day: '2026-10-30', introduced: 2, seen: 14, peeked: 3, flipped: 0, reviewed: 5 };
  const pageUrl = 'https://example.com/article';
  globalThis.chrome = {
    runtime: { getURL: (path) => `chrome-extension://fw-popup/${path}`,
      openOptionsPage: async () => { events.push('options-tab'); },
      sendMessage: async (msg) => {
        if (msg.type === 'status') return { config: {
          settings: { enabled: state.enabled, newSitesEnabled: true,
            siteOverrides: state.siteOverride === null ? {} : { 'example.com': state.siteOverride } },
          language: 'es', hasKey: true, origins: state.access ? ['https://example.com/*'] : [],
        }, review: { due: state.due, new: state.available }, budgetWarning: '', modelStatus: null };
        if (msg.type === 'progress') {
          if (state.progressFails) throw new Error('Progress unavailable');
          // Deliberately different from status.review: the button must follow this reply.
          return { due: state.due, new: state.available, today, practisedThisWeek: 3, verifiedKnown: 1 };
        }
        if (msg.type === 'save') {
          events.push('save');
          if (failSave) throw new Error('Save failed');
          if (msg.settings) state.enabled = msg.settings.enabled;
          if (msg.siteOverride) state.siteOverride = msg.siteOverride.enabled;
          return { ok: true };
        }
        throw new Error('Unexpected message');
      } },
    tabs: { query: async () => [{ id: 5, url: pageUrl }],
      create: async ({ url }) => { events.push(url); return { id: 9 }; } },
    permissions: { request: async () => { events.push('permission'); state.access = true; return true; } },
    scripting: { insertCSS: async () => { events.push('css'); },
      executeScript: async () => { events.push('script'); } },
  };
  try {
    await import('../src/popup.js?status-go');
    const $ = (id) => window.document.getElementById(id);
    await waitFor(() => $('primary').textContent === 'Review 3 due words');
    expect($('enabled').getAttribute('role')).toBe('switch');
    expect($('enabled').getAttribute('aria-label')).toBe('Lang Weave enabled');
    expect($('enabledLabel').getAttribute('aria-hidden')).toBe('true');
    expect($('enabledLabel').textContent).toBe('On');
    expect($('siteName').textContent).toBe('Turn on for this site');
    expect($('operation').textContent).toBe('This site needs your OK');
    expect($('today').textContent).toBe('Today: 2 introduced · 14 seen · 3 peeked · 5 reviewed');
    expect($('week').textContent).toBe('Practised on 3 days of the last 7 · 1 word verified known');
    expect($('openWords').getAttribute('href')).toBe('words.html');
    $('openSettings').click();
    await waitFor(() => events.includes('options-tab'));
    $('openWords').click();
    await waitFor(() => events.includes('chrome-extension://fw-popup/src/words.html'));
    events.length = 0;
    $('siteEnabled').checked = true;
    $('siteEnabled').dispatchEvent(new window.Event('change'));
    await waitFor(() => events.includes('script'));
    expect(events.slice(0, 4)).toEqual(['permission', 'save', 'css', 'script']);
    expect($('siteName').textContent).toBe('On for example.com');
    $('primary').click();
    await waitFor(() => events.includes('chrome-extension://fw-popup/src/review.html'));
    state.due = 0;
    $('enabled').dispatchEvent(new window.Event('change'));
    await waitFor(() => $('primary').textContent === 'Add words');
    state.available = 0;
    $('enabled').checked = false;
    $('enabled').dispatchEvent(new window.Event('change'));
    expect($('enabledLabel').textContent).toBe('Off');
    await waitFor(() => $('primary').textContent === 'Practice');
    expect($('enabledLabel').textContent).toBe('Off');
    events.length = 0;
    $('primary').click(); // nothing due or new: practise any word from My words
    await waitFor(() => events.includes('chrome-extension://fw-popup/src/words.html'));
    // A failed progress reply leaves the site controls working and falls back to status counts.
    state.progressFails = true;
    state.due = 2;
    $('enabled').dispatchEvent(new window.Event('change'));
    await waitFor(() => $('primary').textContent === 'Review 2 due words');
    expect($('today').textContent).toBe('');
    expect($('notice').textContent).toBe('');
    state.progressFails = false;
    state.due = 0;
    failSave = true;
    $('enabled').checked = true;
    $('enabled').dispatchEvent(new window.Event('change'));
    expect($('enabledLabel').textContent).toBe('On');
    await waitFor(() => $('notice').textContent === 'Save failed');
    expect($('enabled').checked).toBe(false);
    expect($('enabledLabel').textContent).toBe('Off');
  } finally {
    globalThis.document = oldDocument;
    globalThis.chrome = oldChrome;
    window.happyDOM.abort();
  }
});

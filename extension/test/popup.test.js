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

test('popup shows one action and sends a site choice in the click gesture', async () => {
  const oldDocument = globalThis.document, oldChrome = globalThis.chrome;
  const window = new Window({ url: 'chrome-extension://fw-popup/src/popup.html' });
  window.document.write(readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8'));
  globalThis.document = window.document;
  const events = [];
  let failSave = false;
  const state = { enabled: true, due: 3, available: 7, access: false, grant: false, siteOverride: null, progressFails: false, consentShown: true,
    isolationUnavailable: false, readingUpdated: false, ambiguous: false };
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
        }, review: { due: state.due, new: state.available }, budgetWarning: '', consentShown: state.consentShown,
          readingUpdated: state.readingUpdated,
          modelStatus: state.isolationUnavailable ? { category: 'key_isolation_unavailable' } : null };
        if (msg.type === 'progress') {
          if (state.progressFails) throw new Error('Progress unavailable');
          // Deliberately different from status.review: the button must follow this reply.
          return { due: state.due, new: state.available, today, practisedThisWeek: 3, verifiedKnown: 1 };
        }
        if (msg.type === 'openReview') { events.push(msg); return { ok: true }; }
        if (msg.type === 'setReadingSite') {
          events.push(msg);
          if (!state.grant) return { ok: false };
          state.access = true;
          state.siteOverride = msg.enabled;
          return { ok: true };
        }
        if (msg.type === 'save') {
          events.push('save');
          if (failSave) throw new Error('Save failed');
          if (msg.settings) state.enabled = msg.settings.enabled;
          return { ok: true };
        }
        throw new Error('Unexpected message');
      } },
    windows: { getCurrent: async () => ({ id: 23 }) },
    tabs: { query: async () => [{ id: 5, url: pageUrl }],
      sendMessage: async (id, msg, target) => {
        expect([id, msg, target]).toEqual([5, { type: 'readingReloadHint' }, { frameId: 0 }]);
        return { ambiguous: state.ambiguous };
      },
      create: async ({ url }) => { events.push(url); return { id: 9 }; } },
  };
  try {
    await import('../src/popup.js?status-go');
    const $ = (id) => window.document.getElementById(id);
    await waitFor(() => $('primary').textContent === 'Review 3 due words');
    expect($('enabled').getAttribute('role')).toBe('switch');
    expect($('enabled').getAttribute('aria-label')).toBe('Lang Weave enabled');
    expect($('openWelcome').textContent).toBe('Read a sample');
    expect($('openWelcome').getAttribute('href')).toBe('welcome.html');
    expect($('welcomeRoute').hidden).toBe(false);
    expect($('enabledLabel').getAttribute('aria-hidden')).toBe('true');
    expect($('enabledLabel').textContent).toBe('On');
    expect($('siteName').textContent).toBe('Turn on for this site');
    expect($('operation').textContent).toBe('This site needs your OK');
    state.isolationUnavailable = true;
    $('enabled').dispatchEvent(new window.Event('change'));
    await waitFor(() => $('operation').textContent === 'This browser cannot keep the key private. Update Chrome to 140 or newer.');
    state.isolationUnavailable = false;
    $('enabled').dispatchEvent(new window.Event('change'));
    await waitFor(() => $('operation').textContent === 'This site needs your OK');
    expect($('today').textContent).toBe('Today: 2 introduced · 14 seen · 3 peeked · 5 reviewed');
    expect($('week').textContent).toBe('Practised on 3 of the last 7 days (reading or review activity) · 1 word verified known');
    expect($('openWords').getAttribute('href')).toBe('words.html');
    $('openSettings').click();
    await waitFor(() => events.includes('options-tab'));
    $('openWords').click();
    await waitFor(() => events.includes('chrome-extension://fw-popup/src/words.html'));
    events.length = 0;
    const siteChoice = { type: 'setReadingSite', tabId: 5, url: pageUrl, enabled: true, requestAccess: true };
    $('siteEnabled').checked = true;
    $('siteEnabled').dispatchEvent(new window.Event('change'));
    expect(events).toEqual([siteChoice]); // the worker receives the gesture
    await waitFor(() => !$('siteEnabled').disabled);
    expect($('siteEnabled').checked).toBe(false);
    expect(events).toEqual([siteChoice]);
    state.grant = true;
    events.length = 0;
    $('siteEnabled').checked = true;
    $('siteEnabled').dispatchEvent(new window.Event('change'));
    await waitFor(() => !$('siteEnabled').disabled);
    expect(events).toEqual([siteChoice]);
    expect($('siteName').textContent).toBe('On for example.com');
    expect($('readingReload').hidden).toBe(true);
    // Chrome's own Reload does not set the automatic update marker.
    state.ambiguous = true;
    $('enabled').dispatchEvent(new window.Event('change'));
    await waitFor(() => !$('readingReload').hidden);
    expect($('readingReload').textContent).toMatch(/refresh this page when you’re ready/);
    state.ambiguous = false;
    $('enabled').dispatchEvent(new window.Event('change'));
    await waitFor(() => $('readingReload').hidden);
    $('primary').click();
    await waitFor(() => events.some((event) => event.type === 'openReview'));
    expect(events.at(-1)).toEqual({ type: 'openReview', windowId: 23 });
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
    state.consentShown = false;
    $('enabled').checked = true;
    $('enabled').dispatchEvent(new window.Event('change'));
    await waitFor(() => $('operation').textContent === 'Finish setup in the welcome page');
    expect($('welcomeRoute').hidden).toBe(false);
    expect($('openWelcome').textContent).toBe('Review privacy choices');
    $('openWelcome').click();
    await waitFor(() => events.includes('chrome-extension://fw-popup/src/welcome.html'));
    $('enabled').checked = false;
    $('enabled').dispatchEvent(new window.Event('change'));
    await waitFor(() => $('enabled').checked === false);
    expect($('welcomeRoute').hidden).toBe(false); // still reachable while the switch is off
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

test('popup status lines, site label and budget warning render the exact English', async () => {
  const oldDocument = globalThis.document, oldChrome = globalThis.chrome;
  const window = new Window({ url: 'chrome-extension://fw-popup/src/popup.html' });
  window.document.write(readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8'));
  globalThis.document = window.document;
  globalThis.chrome = {
    runtime: { getURL: (path) => `chrome-extension://fw-popup/${path}`,
      sendMessage: async (msg) => {
        if (msg.type === 'status') return { config: { settings: { enabled: true, newSitesEnabled: true, siteOverrides: {} },
          language: 'es', hasKey: false, origins: [] }, review: { due: 0, new: 0 }, budgetWarning: '2026-11-20', modelStatus: null };
        throw new Error('no progress');
      } },
    tabs: { query: async () => [{ id: 5, url: 'https://example.org/page' }] },
  };
  try {
    await import('../src/popup.js?budget-english');
    const $ = (id) => window.document.getElementById(id);
    await waitFor(() => $('budgetWarning').textContent !== '');
    expect($('budgetWarning').textContent).toBe("The saved introduction date (2026-11-20) is over seven days ahead of your local date. New introductions stay paused. Reset only today's introduction budget? Your reviews and progress stay saved.");
    expect($('budgetRecovery').hidden).toBe(false);
    expect($('siteName').textContent).toBe('Turn on for this site');
  } finally {
    globalThis.document = oldDocument;
    globalThis.chrome = oldChrome;
    window.happyDOM.abort();
  }
});

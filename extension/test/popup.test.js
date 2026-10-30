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
  const state = { enabled: true, due: 3, available: 7, access: false, siteOverride: null };
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
        if (msg.type === 'save') {
          events.push('save');
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
    expect($('today').textContent).toContain('3 due for review');
    expect($('openWords').getAttribute('href')).toBe('capture.html');
    $('openSettings').click();
    await waitFor(() => events.includes('options-tab'));
    $('openWords').click();
    await waitFor(() => events.includes('chrome-extension://fw-popup/src/capture.html'));
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
  } finally {
    globalThis.document = oldDocument;
    globalThis.chrome = oldChrome;
    window.happyDOM.abort();
  }
});

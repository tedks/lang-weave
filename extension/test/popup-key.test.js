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

test('popup guides setup and shows fixed save, test and removal results', async () => {
  const oldDocument = globalThis.document, oldChrome = globalThis.chrome;
  const window = new Window({ url: 'chrome-extension://fw-popup/src/popup.html' });
  window.document.write(readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8'));
  globalThis.document = window.document;
  let key = '', tests = 0;
  const config = () => ({ settings: { enabled: true, newSitesEnabled: true, siteOverrides: {},
    levelOverride: 0, gradual: false, newWordsPerDay: 5, density: 'normal', inlineRecall: false,
    model: 'gemini-3.5-flash-lite' }, language: 'es', hasKey: !!key, origins: ['<all_urls>'] });
  globalThis.chrome = {
    runtime: { id: 'fw-popup', getURL: (path) => `chrome-extension://fw-popup/${path}`,
      sendMessage: async (msg) => {
        if (msg.type === 'status') return { config: config(), update: '', budgetWarning: '',
          languages: [{ code: 'es', name: 'Spanish' }], words: 30, review: { due: 0 },
          pastedKey: !!key, modelStatus: null };
        if (msg.type === 'save') { key = msg.apiKey; return { ok: true }; }
        if (msg.type === 'testKey') { tests++; return { ok: false, category: 'key_rejected',
          providerText: 'secret-key in provider response' }; }
        if (msg.type === 'removeKey') { key = ''; return { ok: true }; }
        throw new Error('Unexpected message');
      } },
    tabs: { query: async () => [{ id: 1, url: 'https://example.com/' }] },
    permissions: { contains: async () => true },
  };
  try {
    await import('../src/popup.js?key-setup-test');
    const $ = (id) => window.document.getElementById(id);
    await waitFor(() => $('wordInfo').textContent.includes('Spanish words'));
    expect(window.document.querySelector('a[href="https://aistudio.google.com/apikey"]')).not.toBeNull();
    $('apiKey').value = 'synthetic-key';
    $('saveKey').click();
    await waitFor(() => $('keyFeedback').textContent === 'Saved ✓');
    expect($('apiKey').value).toBe('');
    expect($('testKey').disabled).toBe(false);
    $('testKey').click();
    await waitFor(() => $('keyFeedback').textContent === 'Gemini rejected this key. Paste a new one.');
    expect(tests).toBe(1);
    expect(window.document.body.textContent).not.toContain('secret-key');
    $('removeKey').click();
    await waitFor(() => $('keyFeedback').textContent === 'Key removed.');
    expect($('testKey').disabled).toBe(true);
    expect($('removeKey').disabled).toBe(true);
  } finally {
    globalThis.document = oldDocument;
    globalThis.chrome = oldChrome;
    window.happyDOM.abort();
  }
});

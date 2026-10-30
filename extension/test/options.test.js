import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createSettingsHandlers } from '../src/settings-handlers.js';
import { cleanSettings } from '../src/settings.js';

const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 0));
  }
  throw new Error('Options did not update');
};

test('options works without a tab; settings, exception reset and key removal round-trip through handlers', async () => {
  const oldDocument = globalThis.document, oldChrome = globalThis.chrome;
  const window = new Window({ url: 'chrome-extension://fw-options/src/options.html' });
  window.document.write(readFileSync(new URL('../src/options.html', import.meta.url), 'utf8'));
  let refreshTick;
  window.setInterval = (callback, delay) => {
    expect(delay).toBe(5 * 60 * 1000);
    refreshTick = callback;
    return 1;
  };
  globalThis.document = window.document;
  const data = {
    settings: cleanSettings({ siteOverrides: { 'example.com': false } }),
    apiKey: '', keyEpoch: 'before-key', epoch: 'before-settings',
    quotaState: { keyEpoch: 'before-key', cooldowns: {} }, modelStatus: null,
  };
  const store = {
    async get(keys) {
      const names = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
      return structuredClone(Object.fromEntries(names.filter((key) => key in data).map((key) => [key, data[key]])));
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of [keys].flat()) delete data[key]; },
  };
  const handlers = createSettingsHandlers({
    store, cache: { clear: async () => 2 }, locked: async (fn) => fn(), modelCall: async (fn) => fn(),
    worker: { settingsGeneration: 0 }, cooldown: new Map(), cooldownKinds: new Map(),
    context: async () => ({}), broadcast: async () => {}, reviewState: async () => ({}),
    reviewStatus: async () => ({}), checkUpdate: async () => '',
  });
  const messages = [];
  let storageChanged;
  let generateFails = false;
  let due = 2;
  const status = () => ({ config: { settings: cleanSettings(data.settings), language: 'es',
    hasKey: !!data.apiKey, origins: [] }, update: '', languages: [{ code: 'es', name: 'Spanish' }],
    words: 30, review: { due, new: 12 }, pastedKey: !!data.apiKey, modelStatus: null });
  globalThis.chrome = {
    runtime: { id: 'fw-options', getManifest: () => ({ version: '0.12.5' }),
      sendMessage: async (msg) => {
        messages.push({ ...msg, ...(msg.apiKey ? { apiKey: '[redacted]' } : {}) });
        if (msg.type === 'status') return status();
        if (msg.type === 'save') return handlers.save(msg);
        if (msg.type === 'removeKey') return handlers.removeKey();
        if (msg.type === 'clearCache') return handlers.clearCache();
        if (msg.type === 'testKey') return { ok: false, category: 'key_rejected',
          providerText: 'secret provider text' };
        if (msg.type === 'addLanguage') {
          if (generateFails) throw new Error('Generation failed');
          return { ok: true };
        }
        throw new Error('Unexpected message');
      } },
    storage: { onChanged: { addListener: (fn) => { storageChanged = fn; } } },
    permissions: { contains: async () => false, request: async () => true,
      onAdded: { addListener: () => {} }, onRemoved: { addListener: () => {} } },
    tabs: { create: async () => ({ id: 1 }) },
  };
  try {
    await import('../src/options.js?options-roundtrip');
    const $ = (id) => window.document.getElementById(id);
    await waitFor(() => $('version').textContent === '0.12.5');
    expect($('wordInfo').textContent).toBe('30 Spanish words');
    expect($('reviewInfo').textContent).toBe('2');
    expect(window.document.querySelector('a[href="https://aistudio.google.com/apikey"]')).not.toBeNull();
    expect($('siteList').textContent).toContain('example.com: off');
    $('density').value = 'heavy';
    $('density').dispatchEvent(new window.Event('change'));
    await waitFor(() => data.settings.density === 'heavy');
    expect(messages.some((m) => m.type === 'save' && m.settings?.density === 'heavy')).toBe(true);
    $('siteList').querySelector('button').click();
    await waitFor(() => $('siteList').textContent === 'None');
    expect(data.settings.siteOverrides).toEqual({});
    expect(messages.some((m) => m.siteOverride?.host === 'example.com' && m.siteOverride.enabled === null)).toBe(true);
    $('newLanguage').value = 'fr';
    $('addLanguage').click();
    await waitFor(() => $('operation').textContent === '' && !$('addLanguage').disabled);
    generateFails = true;
    $('addLanguage').click();
    await waitFor(() => $('notice').textContent === 'Generation failed');
    expect($('operation').textContent).toBe('');
    $('apiKey').value = 'unsaved-draft';
    data.settings.density = 'light';
    storageChanged({ settings: {} }, 'local');
    await waitFor(() => $('density').value === 'light');
    expect($('apiKey').value).toBe('unsaved-draft');
    due = 5;
    storageChanged({ recallReview: {} }, 'local');
    await waitFor(() => $('reviewInfo').textContent === '5');
    expect($('apiKey').value).toBe('unsaved-draft');
    due = 6;
    storageChanged({ 'lang:fr:version:recallReview': {} }, 'local');
    await waitFor(() => $('reviewInfo').textContent === '6');
    due = 7;
    refreshTick();
    await waitFor(() => $('reviewInfo').textContent === '7');
    expect($('apiKey').value).toBe('unsaved-draft');
    Object.defineProperty(window.document, 'hidden', { configurable: true, value: true });
    due = 8;
    const statusCalls = messages.filter((message) => message.type === 'status').length;
    refreshTick();
    expect(messages.filter((message) => message.type === 'status')).toHaveLength(statusCalls);
    expect($('reviewInfo').textContent).toBe('7');
    Object.defineProperty(window.document, 'hidden', { configurable: true, value: false });
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    await waitFor(() => $('reviewInfo').textContent === '8');
    $('apiKey').value = 'synthetic-key';
    $('saveKey').click();
    await waitFor(() => $('keyFeedback').textContent === 'Saved ✓');
    expect($('apiKey').value).toBe('');
    expect($('testKey').disabled).toBe(false);
    $('testKey').click();
    await waitFor(() => $('keyFeedback').textContent === 'Gemini rejected this key. Paste a new one.');
    expect(window.document.body.textContent).not.toContain('secret provider text');
    const beforeRemoval = { epoch: data.epoch, keyEpoch: data.keyEpoch };
    $('removeKey').click();
    await waitFor(() => $('keyFeedback').textContent === 'Key removed.');
    expect(data.apiKey).toBe('');
    expect(data.epoch).not.toBe(beforeRemoval.epoch);
    expect(data.keyEpoch).not.toBe(beforeRemoval.keyEpoch);
    expect(data.quotaState).toEqual({ keyEpoch: data.keyEpoch, cooldowns: {} });
    expect($('testKey').disabled).toBe(true);
    expect($('removeKey').disabled).toBe(true);
    expect(messages.some((m) => m.type === 'removeKey')).toBe(true);
    expect(messages.every((m) => m.apiKey !== 'synthetic-key')).toBe(true);
  } finally {
    globalThis.document = oldDocument;
    globalThis.chrome = oldChrome;
    window.happyDOM.abort();
  }
});

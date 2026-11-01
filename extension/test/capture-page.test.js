import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';

function markup() {
  return `<p id="selected"></p><p id="notice"></p><button id="retry"></button><section id="editor" hidden><p id="language"></p><div id="matches"></div>
    <form id="capture-form"><input type="radio" name="direction" value="en-to-target"><input type="radio" name="direction" value="target-to-en">
      <input id="source" name="source"><input id="target" name="target"><input id="sense" name="sense"><input id="distinct" type="checkbox"><button id="save"></button></form>
    <button id="cancel"></button></section><input id="entry-search"><button id="refresh"></button><button id="export"></button><ul id="entries"></ul>`;
}

test('capture page treats worker strings as text and manual introduction is explicit', async () => {
  const previous = { document: globalThis.document, location: globalThis.location,
    window: globalThis.window, chrome: globalThis.chrome };
  const window = new Window({ url: 'chrome-extension://id/src/capture.html?nonce=nonce-1234567890123456' });
  window.document.body.innerHTML = markup();
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.window = window;
  const sent = [];
  globalThis.chrome = { runtime: { sendMessage: async (message) => {
    sent.push(message);
    if (message.type === 'captureDraft') return { selectedText: '<img src=x onerror=1>', language: '<script>', error: '<b>Local lookup unavailable</b>', matches: [{ en: '<img src=x>', fr: 'el gato' }] };
    if (message.type === 'personalList') return { entries: [{ id: 'entry-1', en: '<b>cat</b>', fr: 'gato', reviewOnly: true, reason: '<svg>' }] };
    if (message.type === 'personalIntroduce') return { ok: true, added: true };
    throw new Error(`Unexpected message ${message.type}`);
  } } };
  try {
    await import('../src/capture-page.js?escape-and-introduce');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.document.getElementById('selected').textContent).toBe('<img src=x onerror=1>');
    expect(window.document.querySelector('#selected img')).toBeNull();
    expect(window.document.querySelector('#matches img')).toBeNull();
    expect(window.document.getElementById('language').textContent).toBe('Selected language: <script>');
    expect(window.document.getElementById('notice').textContent).toBe('<b>Local lookup unavailable</b>');
    const row = window.document.querySelector('#entries li');
    expect(row.textContent).toContain('<b>cat</b>');
    expect(row.querySelector('b,svg')).toBeNull();
    expect(row.textContent).toContain('Review only; automatic reading is disabled: <svg>');
    window.document.getElementById('entry-search').value = 'absent';
    window.document.getElementById('entry-search').dispatchEvent(new window.Event('input'));
    expect(window.document.querySelector('#entries li').textContent).toBe('No personal entries yet.');
    window.document.getElementById('entry-search').value = 'cat';
    window.document.getElementById('entry-search').dispatchEvent(new window.Event('input'));
    expect(window.document.querySelector('#entries li').textContent).toContain('<b>cat</b>');
    const found = window.document.querySelector('#entries li');
    found.querySelector('button').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.some((message) => message.type === 'personalIntroduce' && message.id === 'entry-1')).toBe(true);
  } finally {
    Object.assign(globalThis, previous);
    await window.happyDOM.abort();
  }
});

test('an open confirmation keeps its short-lived draft active and stops on cancel', async () => {
  const previous = { document: globalThis.document, location: globalThis.location,
    window: globalThis.window, chrome: globalThis.chrome,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
  const window = new Window({ url: 'chrome-extension://id/src/capture.html?nonce=nonce-1234567890123456' });
  window.document.body.innerHTML = markup();
  Object.assign(globalThis, { document: window.document, location: window.location, window });
  const sent = [], cleared = [];
  let tick;
  globalThis.setInterval = (fn, ms) => { expect(ms).toBe(15000); tick = fn; return 42; };
  globalThis.clearInterval = (id) => cleared.push(id);
  globalThis.chrome = { runtime: { sendMessage: async (message) => {
    sent.push(message);
    if (message.type === 'captureDraft') return { selectedText: 'glimmer', language: 'es', matches: [] };
    if (message.type === 'personalList') return { entries: [] };
    if (message.type === 'captureKeepAlive' || message.type === 'captureCancel') return { ok: true };
    throw new Error(`Unexpected message ${message.type}`);
  } } };
  try {
    await import('../src/capture-page.js?heartbeat');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(typeof tick).toBe('function');
    tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.some((message) => message.type === 'captureKeepAlive' &&
      message.nonce === 'nonce-1234567890123456')).toBe(true);
    window.document.getElementById('cancel').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cleared).toContain(42);
  } finally {
    Object.assign(globalThis, previous);
    await window.happyDOM.abort();
  }
});

test('capture page composes provenance, archive and save copy exactly as before', async () => {
  const previous = { document: globalThis.document, location: globalThis.location,
    window: globalThis.window, chrome: globalThis.chrome };
  const window = new Window({ url: 'chrome-extension://id/src/capture.html?nonce=nonce-1234567890123456' });
  window.document.body.innerHTML = markup();
  Object.assign(globalThis, { document: window.document, location: window.location, window });
  let saveResult = { archived: true };
  globalThis.chrome = { runtime: { sendMessage: async (message) => {
    if (message.type === 'captureDraft') return { selectedText: 'gato', matches: [
      { id: 'p1', en: 'cat', fr: 'gato', sense: 'animal', reviewOnly: true },
      { en: 'dog', fr: 'perro', provenance: 'bundled-suggestion' },
      { en: 'bird', fr: 'pájaro', reviewOnly: true, reason: 'ambiguous' },
      { en: 'fish', fr: 'pez' }] };
    if (message.type === 'personalList') return { entries: [
      { id: 'e1', en: 'cat', fr: 'gato', sense: 'animal', archived: true, reviewOnly: true },
      { id: 'e2', en: 'dog', fr: 'perro', reviewOnly: true, reason: 'ambiguous' }] };
    if (message.type === 'captureSave') return saveResult;
    throw new Error(`Unexpected message ${message.type}`);
  } } };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    await import('../src/capture-page.js?copy');
    await flush();
    const doc = window.document;
    expect(doc.getElementById('language').textContent).toBe('Selected language: unknown');
    const lines = [...doc.querySelectorAll('#matches article')].map((a) => [...a.querySelectorAll('p')].map((p) => p.textContent));
    expect(lines).toEqual([
      ['cat ⇄ gato · animal', 'Your saved personal entry · Review only: automatic reading is disabled for this entry'],
      ['dog ⇄ perro', 'Bundled suggestion; meaning has not been independently dictionary checked'],
      ['bird ⇄ pájaro', 'Local suggestion · Review only: ambiguous'],
      ['fish ⇄ pez', 'Local suggestion']]);
    expect(doc.querySelector('#matches h2').textContent).toBe('Local suggestions');
    expect(doc.querySelector('#matches button').textContent).toBe('Use suggestion');
    const rows = [...doc.querySelectorAll('#entries li')];
    expect(rows[0].textContent).toBe('cat ⇄ gato · animal · ArchivedReview only; automatic reading is disabled.Unarchive');
    expect(rows[1].textContent).toBe('dog ⇄ perroReview only; automatic reading is disabled: ambiguousAdd to reviewArchive');
    const save = async (result, expected) => {
      saveResult = result;
      doc.getElementById('capture-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
      await flush(); await flush();
      expect(doc.getElementById('notice').textContent).toBe(expected);
    };
    await save({ archived: true }, 'This entry already exists in your archive. Unarchive it below to use it.');
    // After a save the draft is gone, so a second save reports the expiry.
    doc.getElementById('capture-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    expect(doc.getElementById('notice').textContent).toBe('Capture expired. Retry from the page selection.');
  } finally {
    Object.assign(globalThis, previous);
    await window.happyDOM.abort();
  }
});

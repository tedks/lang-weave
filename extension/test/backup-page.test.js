import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';

const markup = `<button id="export"></button><input id="file" type="file"><button id="preview"></button>
  <section id="summary" hidden><p id="sourceVersion"></p><p id="counts"></p><p id="preferences"></p>
    <input id="confirm" type="checkbox"><button id="import" disabled></button></section><p id="notice"></p>`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function page(query, handler) {
  const previous = { document: globalThis.document, window: globalThis.window,
    chrome: globalThis.chrome, URL: globalThis.URL };
  const window = new Window({ url: 'chrome-extension://id/src/backup.html' });
  window.document.body.innerHTML = markup;
  globalThis.document = window.document;
  globalThis.window = window;
  const sent = [];
  const portMessages = [];
  let onDisconnect;
  let disconnected = false;
  globalThis.chrome = { runtime: {
    connect: ({ name }) => {
      expect(name).toBe('learning-backup-page');
      let onMessage;
      return {
        onMessage: { addListener(fn) { onMessage = fn; } },
        onDisconnect: { addListener(fn) { onDisconnect = fn; } },
        postMessage(message) {
          portMessages.push(message);
          if (!message.invalidate) queueMicrotask(() => onMessage({ ready: true, pageId: message.pageId }));
        },
        disconnect() { disconnected = true; onDisconnect?.(); },
      };
    },
    async sendMessage(message) { sent.push(message); return handler(message); },
  } };
  try {
    await import(`../src/backup-page.js?${query}`);
    await tick();
    return { window, sent, portMessages, get disconnected() { return disconnected; },
      setFile(file) {
        Object.defineProperty(window.document.getElementById('file'), 'files',
          { configurable: true, value: file ? [file] : [] });
        window.document.getElementById('file').dispatchEvent(new window.Event('change'));
      },
      async close() {
        window.dispatchEvent(new window.Event('pagehide'));
        Object.assign(globalThis, previous);
        await window.happyDOM.abort();
      },
    };
  } catch (error) {
    Object.assign(globalThis, previous);
    await window.happyDOM.abort();
    throw error;
  }
}

test('backup UI escapes preview, requires a file and explicit confirmation, and uses a live page binding', async () => {
  const ui = await page('preview-flow', async ({ type }) => {
    if (type === 'learningPreview') return { token: 'bound-token', preview: {
      exportedByVersion: '<img src=x>', languages: ['es', '<svg onload=1>'],
      packs: 1, cards: 5, personal: 2,
      preferences: { language: 'es', levelOverride: 2, gradual: true,
        newWordsPerDay: 3, density: 'heavy', inlineRecall: true },
    } };
    if (type === 'learningImport') return { ok: true };
    throw new Error(`Unexpected message ${type}`);
  });
  try {
    const $ = (id) => ui.window.document.getElementById(id);
    $('preview').click();
    await tick();
    expect($('notice').textContent).toMatch(/choose a learning backup/i);
    expect(ui.sent).toHaveLength(0);
    ui.setFile({ size: 16, text: async () => '{"valid":true}' });
    expect(ui.portMessages.at(-1)).toEqual({ pageId: ui.portMessages[0].pageId, invalidate: true });
    $('preview').click();
    await tick();
    expect($('summary').hidden).toBe(false);
    expect($('sourceVersion').textContent).toContain('<img src=x>');
    expect($('counts').textContent).toContain('<svg onload=1>');
    expect($('summary').querySelector('img,svg')).toBeNull();
    expect($('import').disabled).toBe(true);
    expect(ui.sent[0]).toEqual({ type: 'learningPreview', json: '{"valid":true}', pageId: expect.any(String) });
    $('confirm').checked = true;
    $('confirm').dispatchEvent(new ui.window.Event('change'));
    expect($('import').disabled).toBe(false);
    $('import').click();
    await tick();
    expect(ui.sent[1]).toEqual({ type: 'learningImport', token: 'bound-token', pageId: ui.sent[0].pageId });
    expect($('summary').hidden).toBe(true);
    expect($('import').disabled).toBe(true);
    expect($('notice').textContent).toMatch(/progress imported/i);
  } finally { await ui.close(); }
  expect(ui.disconnected).toBe(true);
  expect(ui.portMessages.at(-1)).toEqual({ pageId: ui.portMessages[0].pageId, invalidate: true });
});

test('file change invalidates an in-flight preview and oversized files never reach the worker', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const ui = await page('stale-file', async ({ type }) => {
    if (type === 'learningPreview') return pending;
    throw new Error(`Unexpected message ${type}`);
  });
  try {
    const $ = (id) => ui.window.document.getElementById(id);
    ui.setFile({ size: 2, text: async () => '{}' });
    $('preview').click();
    await tick();
    expect(ui.sent).toHaveLength(1);
    ui.setFile({ size: 2, text: async () => '{}' });
    release({ token: 'stale', preview: { exportedByVersion: '0.11.0' } });
    await tick();
    expect($('summary').hidden).toBe(true);
    expect($('import').disabled).toBe(true);
    ui.setFile({ size: 1024 * 1024 + 1, text: async () => { throw new Error('must not read'); } });
    $('preview').click();
    await tick();
    expect($('notice').textContent).toMatch(/1 MiB limit/);
    expect(ui.sent).toHaveLength(1);
  } finally { await ui.close(); }
});

test('pagehide disconnects and an import failure needs a new preview', async () => {
  const ui = await page('failed-import', async ({ type }) => {
    if (type === 'learningPreview') return { token: 'once', preview: { exportedByVersion: '0.11.0' } };
    if (type === 'learningImport') return { error: 'Target learning changed. Preview again.' };
    throw new Error(`Unexpected message ${type}`);
  });
  try {
    const $ = (id) => ui.window.document.getElementById(id);
    ui.setFile({ size: 2, text: async () => '{}' });
    $('preview').click();
    await tick();
    $('confirm').checked = true;
    $('confirm').dispatchEvent(new ui.window.Event('change'));
    $('import').click();
    await tick();
    expect($('notice').textContent).toContain('Target learning changed');
    expect($('import').disabled).toBe(true);
    expect($('summary').hidden).toBe(true);
    ui.window.dispatchEvent(new ui.window.Event('pagehide'));
    expect(ui.disconnected).toBe(true);
    $('preview').click();
    await tick();
    expect(ui.sent.filter((m) => m.type === 'learningPreview')).toHaveLength(1);
  } finally { await ui.close(); }
});

test('file choice is held during import and navigation disconnects before an awaited reply', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const ui = await page('navigation-import', async ({ type }) => {
    if (type === 'learningPreview') return { token: 'once', preview: { exportedByVersion: '0.11.0' } };
    if (type === 'learningImport') return pending;
    throw new Error(`Unexpected message ${type}`);
  });
  try {
    const $ = (id) => ui.window.document.getElementById(id);
    ui.setFile({ size: 2, text: async () => '{}' });
    $('preview').click();
    await tick();
    $('confirm').checked = true;
    $('confirm').dispatchEvent(new ui.window.Event('change'));
    $('import').click();
    await tick();
    expect($('file').disabled).toBe(true);
    expect($('preview').disabled).toBe(true);
    expect(ui.sent.at(-1).type).toBe('learningImport');
    ui.window.dispatchEvent(new ui.window.Event('pagehide'));
    expect(ui.disconnected).toBe(true);
    release({ ok: true });
    await tick();
    expect($('notice').textContent).not.toMatch(/progress imported/i);
  } finally { await ui.close(); }
});

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 1024 * 1024;
let previewToken = null;
let generation = 0;
let busy = false;
let active = true;
let heartbeat = null;
const pageId = crypto.randomUUID();
const port = chrome.runtime.connect({ name: 'learning-backup-page' });
const portReady = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 5000);
  port.onMessage.addListener((message) => {
    if (message?.ready === true && message.pageId === pageId) {
      clearTimeout(timer);
      resolve(true);
    }
  });
  port.onDisconnect.addListener(() => {
    if (heartbeat !== null) { clearInterval(heartbeat); heartbeat = null; }
    clearTimeout(timer);
    resolve(false);
    if (active) {
      active = false;
      clearPreview();
      notice('This backup page connection ended. Reload the page before importing.');
    }
  });
});
port.postMessage({ pageId });
void portReady.then((ready) => { if (ready && active) keepPageAlive(); });

async function send(type, fields = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...fields });
  if (!result || result.error) throw new Error(result?.error || 'Learning backup is unavailable.');
  return result;
}

function clearPreview() {
  generation++;
  previewToken = null;
  $('summary').hidden = true;
  $('confirm').checked = false;
  $('import').disabled = true;
}

function keepPageAlive() {
  if (heartbeat !== null) clearInterval(heartbeat);
  heartbeat = setInterval(() => { if (active) port.postMessage({ pageId, ping: true }); }, 20000);
}

function notice(message) { $('notice').textContent = String(message || ''); }

async function run(button, action) {
  if (busy || !active) return;
  busy = true;
  button.disabled = true;
  notice('');
  try { await action(); }
  catch (error) { notice(error.message || 'Learning backup failed.'); }
  finally {
    busy = false;
    button.disabled = !active || button.id === 'import' && (!previewToken || !$('confirm').checked);
    if (button.id === 'import') {
      $('file').disabled = !active;
      $('preview').disabled = !active;
    }
  }
}

function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : '?'; }

function renderPreview(preview) {
  const languages = Array.isArray(preview.languages) ? preview.languages.join(', ') : String(preview.languages ?? '?');
  const preferences = preview.preferences || {};
  $('sourceVersion').textContent = `Exported by Lang Weave ${String(preview.exportedByVersion ?? '?')}.`;
  $('counts').textContent = `Languages: ${languages || 'none'} · Generated packs: ${count(preview.packs)} · Review cards: ${count(preview.cards)} · Personal entries: ${count(preview.personal)}.`;
  $('preferences').textContent = `Learning preferences: language ${String(preferences.language ?? '?')}, level ${String(preferences.levelOverride ?? '?')}, gradual ${String(preferences.gradual ?? '?')}, new words/day ${String(preferences.newWordsPerDay ?? '?')}, density ${String(preferences.density ?? '?')}, inline recall ${String(preferences.inlineRecall ?? '?')}.`;
  $('summary').hidden = false;
}

$('file').addEventListener('change', () => {
  clearPreview();
  if (active) port.postMessage({ pageId, invalidate: true });
  notice('Choose Preview backup to validate the selected file.');
});

$('confirm').addEventListener('change', () => { $('import').disabled = !previewToken || !$('confirm').checked || busy; });

$('export').addEventListener('click', () => void run($('export'), async () => {
  const { json } = await send('learningExport');
  if (!active || typeof json !== 'string') throw new Error('The backup could not be prepared.');
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'lang-weave-learning-backup.json';
    anchor.click();
    notice('Learning backup downloaded. Keep the file private and the old installation intact.');
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}));

$('preview').addEventListener('click', () => void run($('preview'), async () => {
  clearPreview();
  const mine = generation;
  const file = $('file').files?.[0];
  if (!file) throw new Error('Choose a learning backup JSON file first.');
  if (file.size > MAX_BYTES) throw new Error('The backup file is over the 1 MiB limit.');
  const json = await file.text();
  if (!active || mine !== generation) return;
  if (new TextEncoder().encode(json).length > MAX_BYTES) throw new Error('The backup file is over the 1 MiB limit.');
  if (!await portReady) throw new Error('The backup page connection is unavailable. Reload this page.');
  const result = await send('learningPreview', { json, pageId });
  if (!active || mine !== generation) return;
  if (typeof result.token !== 'string' || !result.token || !result.preview) throw new Error('The preview was incomplete.');
  previewToken = result.token;
  renderPreview(result.preview);
  notice('Preview validated. Import requires your confirmation and a fresh target check.');
}));

$('import').addEventListener('click', () => void run($('import'), async () => {
  if (!previewToken || !$('confirm').checked) return;
  const token = previewToken;
  clearPreview(); // A failed or stale confirmation requires a new preview.
  $('file').disabled = true;
  $('preview').disabled = true;
  if (!await portReady) throw new Error('The backup page connection is unavailable. Reload this page.');
  const result = await send('learningImport', { token, pageId });
  if (!active) return;
  if (result.ok !== true) throw new Error('Import was not confirmed. Preview again.');
  notice(result.already ? 'This exact backup was already imported. No progress changed.' :
    'Learning progress imported. Open review to check it, then enter your key and choose sites separately.');
}));

window.addEventListener('pagehide', () => {
  if (!active) return;
  active = false;
  if (heartbeat !== null) { clearInterval(heartbeat); heartbeat = null; }
  clearPreview();
  port.postMessage({ pageId, invalidate: true });
  port.disconnect();
});

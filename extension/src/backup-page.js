import { localize, t } from './i18n.js';

localize();
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
      notice(t('backup_connection_ended'));
    }
  });
});
port.postMessage({ pageId });
void portReady.then((ready) => { if (ready && active) keepPageAlive(); });

async function send(type, fields = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...fields });
  if (!result || result.error) throw new Error(result?.error || t('backup_unavailable'));
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
  catch (error) { notice(error.message || t('backup_failed')); }
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
  $('sourceVersion').textContent = t('backup_source_version', String(preview.exportedByVersion ?? '?'));
  $('counts').textContent = t('backup_counts', languages || t('backup_languages_none'), count(preview.packs), count(preview.cards), count(preview.personal));
  const prefs = [String(preferences.language ?? '?'), String(preferences.levelOverride ?? '?'), String(preferences.gradual ?? '?'),
    String(preferences.newWordsPerDay ?? '?'), String(preferences.density ?? '?'), String(preferences.inlineRecall ?? '?')];
  $('preferences').textContent = Object.hasOwn(preferences, 'desiredRetention')
    ? t('backup_preferences_retention', ...prefs, String(preferences.desiredRetention))
    : t('backup_preferences', ...prefs);
  const omitted = [preview.omittedRetrievals, preview.omittedExposureWords].some((n) => n !== 0);
  $('measurements').textContent = omitted
    ? t('backup_measurements_omitted', count(preview.retrievals), count(preview.exposureWords), count(preview.omittedRetrievals), count(preview.omittedExposureWords))
    : t('backup_measurements', count(preview.retrievals), count(preview.exposureWords));
  $('summary').hidden = false;
}

$('file').addEventListener('change', () => {
  clearPreview();
  if (active) port.postMessage({ pageId, invalidate: true });
  notice(t('backup_choose_preview'));
});

$('confirm').addEventListener('change', () => { $('import').disabled = !previewToken || !$('confirm').checked || busy; });

$('export').addEventListener('click', () => void run($('export'), async () => {
  const { json } = await send('learningExport');
  if (!active || typeof json !== 'string') throw new Error(t('backup_not_prepared'));
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'lang-weave-learning-backup.json';
    anchor.click();
    notice(t('backup_downloaded'));
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}));

$('preview').addEventListener('click', () => void run($('preview'), async () => {
  clearPreview();
  const mine = generation;
  const file = $('file').files?.[0];
  if (!file) throw new Error(t('backup_choose_file'));
  if (file.size > MAX_BYTES) throw new Error(t('backup_too_large'));
  const json = await file.text();
  if (!active || mine !== generation) return;
  if (new TextEncoder().encode(json).length > MAX_BYTES) throw new Error(t('backup_too_large'));
  if (!await portReady) throw new Error(t('backup_port_unavailable'));
  const result = await send('learningPreview', { json, pageId });
  if (!active || mine !== generation) return;
  if (typeof result.token !== 'string' || !result.token || !result.preview) throw new Error(t('backup_preview_incomplete'));
  previewToken = result.token;
  renderPreview(result.preview);
  notice(t('backup_preview_validated'));
}));

$('import').addEventListener('click', () => void run($('import'), async () => {
  if (!previewToken || !$('confirm').checked) return;
  const token = previewToken;
  clearPreview(); // A failed or stale confirmation requires a new preview.
  $('file').disabled = true;
  $('preview').disabled = true;
  if (!await portReady) throw new Error(t('backup_port_unavailable'));
  const result = await send('learningImport', { token, pageId });
  if (!active) return;
  if (result.ok !== true) throw new Error(t('backup_import_unconfirmed'));
  notice(result.already ? t('backup_already_imported') : t('backup_imported'));
}));

window.addEventListener('pagehide', () => {
  if (!active) return;
  active = false;
  if (heartbeat !== null) { clearInterval(heartbeat); heartbeat = null; }
  clearPreview();
  port.postMessage({ pageId, invalidate: true });
  port.disconnect();
});

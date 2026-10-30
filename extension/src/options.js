import { statusLabel } from './quota-status.js';
import { resolveLevel } from './levels.js';
import { MODELS } from './gemini.js';

const $ = (id) => document.getElementById(id);
const ALL_SITES = ['http://*/*', 'https://*/*'];
let status;
let refreshGeneration = 0;

const send = async (msg) => {
  const res = await chrome.runtime.sendMessage(msg);
  if (res?.error && !('ok' in res)) throw new Error(res.error);
  return res;
};

async function refresh() {
  const generation = ++refreshGeneration;
  const next = await send({ type: 'status' });
  const all = await chrome.permissions.contains({ origins: ALL_SITES });
  if (generation !== refreshGeneration) return;
  status = next;
  const c = status.config;
  const s = c.settings;
  $('version').textContent = chrome.runtime.getManifest().version;
  $('update').hidden = !status.update;
  $('updateVersion').textContent = status.update || '';
  $('newSitesEnabled').value = String(s.newSitesEnabled);
  $('grantSites').hidden = all || !s.newSitesEnabled;
  $('accessNote').textContent = s.newSitesEnabled
    ? (all ? 'On for every site except the ones you turn off. Webmail, messaging, AI chat, banking, health, government and local addresses start off. Reload pages already open to start there.' : 'Chrome needs your OK before it can run on other sites.')
    : 'Off on sites until you turn them on here.';
  const { effective } = resolveLevel(s);
  $('levelInfo').textContent = `L${effective}`;
  $('levelOverride').value = String(s.levelOverride || 0);
  $('gradual').checked = s.gradual;
  $('newWordsPerDay').value = String(s.newWordsPerDay);
  $('newWordsPerDay').disabled = !s.gradual;
  $('density').value = s.density;
  $('inlineRecall').checked = s.inlineRecall;
  $('inlineRecall').disabled = !s.gradual;
  $('language').replaceChildren();
  for (const item of status.languages) {
    const option = document.createElement('option');
    option.value = item.code;
    option.textContent = `${item.name}${item.experimental ? ' · experimental' : ''}`;
    $('language').append(option);
  }
  $('language').value = c.language;
  $('removeLanguage').hidden = c.language === 'es';
  $('model').value = s.model;
  $('wordInfo').textContent = `${status.words} ${status.languages.find((item) => item.code === c.language)?.name || c.language} words`;
  $('reviewInfo').textContent = String(status.review.due);
  $('apiKey').placeholder = status.pastedKey ? 'saved (paste to replace)' : 'AIza…';
  $('testKey').disabled = !status.pastedKey;
  $('removeKey').disabled = !status.pastedKey;
  const list = $('siteList');
  list.replaceChildren();
  for (const [name, enabled] of Object.entries(s.siteOverrides)) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.textContent = `${name}: ${enabled ? 'on' : 'off'}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Reset';
    button.addEventListener('click', () => run(() => save({ siteOverride: { host: name, enabled: null } })));
    row.append(label, button);
    list.append(row);
  }
  if (!list.childNodes.length) list.textContent = 'None';
}

async function save(msg) {
  await send({ type: 'save', ...msg });
  await refresh();
}

async function run(fn) {
  $('notice').textContent = '';
  $('operation').textContent = '';
  try { await fn(); } catch (e) { $('notice').textContent = e.message || 'Could not do that'; }
}

for (const [id, label] of Object.entries(MODELS)) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = label;
  $('model').appendChild(opt);
}

$('newSitesEnabled').addEventListener('change', (e) => run(() => save({ settings: { newSitesEnabled: e.target.value === 'true' } })));
$('levelOverride').addEventListener('change', (e) => run(() => save({ settings: { levelOverride: Number(e.target.value) || 0 } })));
$('gradual').addEventListener('change', (e) => run(() => save({ settings: { gradual: e.target.checked } })));
$('newWordsPerDay').addEventListener('change', (e) => run(() => save({ settings: { newWordsPerDay: Number(e.target.value) } })));
$('density').addEventListener('change', (e) => run(() => save({ settings: { density: e.target.value } })));
$('inlineRecall').addEventListener('change', (e) => run(() => save({ settings: { inlineRecall: e.target.checked } })));
$('language').addEventListener('change', (e) => run(() => save({ settings: { language: e.target.value } })));
$('addLanguage').addEventListener('click', () => run(async () => {
  const button = $('addLanguage');
  button.disabled = true;
  $('operation').textContent = 'Generating experimental vocabulary…';
  try { await send({ type: 'addLanguage', code: $('newLanguage').value.trim() }); await refresh(); }
  finally { button.disabled = false; $('operation').textContent = ''; }
}));
$('removeLanguage').addEventListener('click', () => run(async () => {
  await send({ type: 'removeLanguage', code: status.config.language });
  await refresh();
}));
$('model').addEventListener('change', (e) => run(() => save({ settings: { model: e.target.value } })));
const saveKey = () => run(async () => {
  $('keyFeedback').textContent = '';
  const key = $('apiKey').value.trim();
  if (!key) { $('keyFeedback').textContent = 'Paste a key first.'; return; }
  await save({ apiKey: key });
  $('apiKey').value = '';
  $('keyFeedback').textContent = 'Saved ✓';
});
$('saveKey').addEventListener('click', saveKey);
$('apiKey').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); void saveKey(); }
});
$('testKey').addEventListener('click', () => run(async () => {
  const button = $('testKey');
  button.disabled = true;
  $('keyFeedback').textContent = 'Testing key…';
  try {
    const result = await send({ type: 'testKey' });
    await refresh();
    $('keyFeedback').textContent = result.ok ? 'Key works.' : result.category === 'no_key'
      ? 'Add a Gemini key first.' : result.category === 'changed' ? 'Key or settings changed. Test again.'
      : statusLabel({ category: result.category }) || 'Model request failed. Try again later.';
  } finally { button.disabled = !status?.pastedKey; }
}));
$('removeKey').addEventListener('click', () => run(async () => {
  $('keyFeedback').textContent = '';
  await send({ type: 'removeKey' });
  await refresh();
  $('apiKey').value = '';
  $('keyFeedback').textContent = 'Key removed.';
}));
$('grantSites').addEventListener('click', () => run(async () => {
  if (await chrome.permissions.request({ origins: ALL_SITES })) await refresh();
}));
$('clearCache').addEventListener('click', () => run(async () => {
  const res = await send({ type: 'clearCache' });
  await refresh();
  $('operation').textContent = `Cleared ${res.removed}`;
}));
$('openExtensions').addEventListener('click', () => {
  void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});

const refreshAfterExternalChange = () => {
  $('operation').textContent = '';
  void refresh().catch((e) => { $('notice').textContent = e.message || 'Could not refresh settings'; });
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((key) =>
    ['settings', 'apiKey', 'languagePacks', 'recallReview', 'personalVocabularyV1'].includes(key) ||
    key.endsWith(':recallReview'))) {
    refreshAfterExternalChange();
  }
});
chrome.permissions.onAdded.addListener(refreshAfterExternalChange);
chrome.permissions.onRemoved.addListener(refreshAfterExternalChange);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshAfterExternalChange();
});
// Due dates can pass without a storage write while this tab stays open.
const refreshTimer = document.defaultView.setInterval(() => {
  if (!document.hidden) refreshAfterExternalChange();
}, 5 * 60 * 1000);
document.defaultView.addEventListener('pagehide', () => {
  document.defaultView.clearInterval(refreshTimer);
}, { once: true });

void run(refresh);

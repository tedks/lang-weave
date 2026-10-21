import { statusLabel } from './quota-status.js';
import { resolveLevel } from './levels.js';
import { MODELS } from './gemini.js';
import { siteEnabled, siteOn, hasSiteAccess } from './settings.js';

const $ = (id) => document.getElementById(id);
const ALL_SITES = ['http://*/*', 'https://*/*'];
let status;
let tab;
let host = '';

const send = async (msg) => {
  const res = await chrome.runtime.sendMessage(msg);
  if (res?.error && !('ok' in res)) throw new Error(res.error);
  return res;
};

async function refresh() {
  status = await send({ type: 'status' });
  $('update').hidden = !status.update;
  $('updateVersion').textContent = status.update || '';
  const c = status.config;
  const s = c.settings; // newSitesEnabled resolved: popup choice, else setup's answer, else on
  const all = await chrome.permissions.contains({ origins: ALL_SITES });
  $('enabled').checked = s.enabled;
  $('newSitesEnabled').value = String(s.newSitesEnabled);
  $('siteEnabled').checked = !!host && siteOn(s, host) && hasSiteAccess(tab.url, c.origins);
  $('siteEnabled').disabled = !host;
  $('siteName').textContent = host || 'This page (not a website)';
  $('grantSites').hidden = all || !s.newSitesEnabled;
  $('accessNote').textContent = s.newSitesEnabled
    ? (all ? 'On for every site except the ones you turn off. Webmail, messaging, AI chat, banking, health, government and local addresses start off.' : 'Chrome needs your OK before it can run on other sites.')
    : 'Off on sites until you turn them on here.';
  const { effective } = resolveLevel(s);
  $('levelInfo').textContent = `L${effective}`;
  $('levelOverride').value = String(s.levelOverride || 0);
  $('gradual').checked = s.gradual;
  $('newWordsPerDay').value = String(s.newWordsPerDay);
  $('newWordsPerDay').disabled = !s.gradual;
  $('budgetRecovery').hidden = !status.budgetWarning;
  $('budgetWarning').textContent = status.budgetWarning
    ? `The saved introduction date (${status.budgetWarning}) is over seven days ahead of your local date. New introductions stay paused. Reset only today's introduction budget? Your reviews and progress stay saved.` : '';
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
  $('apiKey').value = '';
  $('apiKey').placeholder = status.pastedKey ? 'saved (paste to replace)' : 'AIza…';
  $('wordInfo').textContent = `${status.words} ${status.languages.find((item) => item.code === c.language)?.name || c.language} words`;
  $('reviewInfo').textContent = `${status.review.due} due`;
  $('operation').textContent = !s.enabled ? 'Off'
    : !c.hasKey ? 'Add a Gemini key to start'
    : host && !siteEnabled(s, tab.url) ? 'Off on this site'
    : host && !hasSiteAccess(tab.url, c.origins) ? 'This site needs your OK'
    : statusLabel(status.modelStatus) || 'On';
  const list = $('siteList');
  list.replaceChildren();
  for (const [name, enabled] of Object.entries(s.siteOverrides)) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.textContent = `${name}: ${enabled ? 'on' : 'off'}`;
    const button = document.createElement('button');
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
  try { await fn(); } catch (e) { $('notice').textContent = e.message || 'Could not do that'; }
}

// The registered content script only reaches pages loaded after a grant; this covers the open tab.
async function inject() {
  if (!tab?.id || !host) return;
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['src/content.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content-loader.js'] });
  } catch { $('notice').textContent = 'Reload this page to start. Chrome blocks extensions on some pages.'; }
}

for (const [id, label] of Object.entries(MODELS)) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = label;
  $('model').appendChild(opt);
}

$('enabled').addEventListener('change', (e) => run(() => save({ settings: { enabled: e.target.checked } })));
$('newSitesEnabled').addEventListener('change', (e) => run(() => save({ settings: { newSitesEnabled: e.target.value === 'true' } })));
$('levelOverride').addEventListener('change', (e) => run(() => save({ settings: { levelOverride: Number(e.target.value) || 0 } })));
$('gradual').addEventListener('change', (e) => run(() => save({ settings: { gradual: e.target.checked } })));
$('newWordsPerDay').addEventListener('change', (e) => run(() => save({ settings: { newWordsPerDay: Number(e.target.value) } })));
$('cancelBudget').addEventListener('click', () => { $('budgetRecovery').hidden = true; });
$('recoverBudget').addEventListener('click', () => run(async () => {
  const res = await send({ type: 'recoverBudget', confirm: true, day: status.budgetWarning, scope: status.config.scope });
  if (!res.ok) throw new Error('Budget changed. Refresh and try again.');
  await refresh();
}));
$('density').addEventListener('change', (e) => run(() => save({ settings: { density: e.target.value } })));
$('inlineRecall').addEventListener('change', (e) => run(() => save({ settings: { inlineRecall: e.target.checked } })));
$('language').addEventListener('change', (e) => run(() => save({ settings: { language: e.target.value } })));
$('addLanguage').addEventListener('click', () => run(async () => {
  const button = $('addLanguage');
  button.disabled = true;
  $('operation').textContent = 'Generating experimental vocabulary…';
  try { await send({ type: 'addLanguage', code: $('newLanguage').value.trim() }); await refresh(); }
  finally { button.disabled = false; }
}));
$('removeLanguage').addEventListener('click', () => run(async () => {
  await send({ type: 'removeLanguage', code: status.config.language });
  await refresh();
}));
$('model').addEventListener('change', (e) => run(() => save({ settings: { model: e.target.value } })));
$('apiKey').addEventListener('change', (e) => run(() => save({ apiKey: e.target.value })));
$('siteEnabled').addEventListener('change', (e) => run(async () => {
  const enabled = e.target.checked;
  if (enabled && !hasSiteAccess(tab.url, status.config.origins)) {
    // Chrome asks for this one site only; requests need the click that opened this, so it happens first.
    const accepted = await chrome.permissions.request({ origins: [`${new URL(tab.url).protocol}//${host}/*`] });
    if (!accepted) { await refresh(); return; }
  }
  await save({ siteOverride: { host, enabled } });
  if (enabled) await inject();
}));
$('grantSites').addEventListener('click', () => run(async () => {
  if (await chrome.permissions.request({ origins: ALL_SITES })) { await refresh(); await inject(); }
}));
$('clearCache').addEventListener('click', () => run(async () => {
  const res = await send({ type: 'clearCache' });
  await refresh();
  $('operation').textContent = `Cleared ${res.removed}`;
}));

void run(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { const u = new URL(tab?.url); if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/\.$/, ""); } catch { /* internal tab */ }
  await refresh();
});

$('openExtensions').addEventListener('click', () => {
  void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});
$('openReview').addEventListener('click', () => run(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/review.html') });
}));

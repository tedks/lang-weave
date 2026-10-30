import { statusLabel } from './quota-status.js';
import { siteEnabled, siteOn, hasSiteAccess } from './settings.js';

const $ = (id) => document.getElementById(id);
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
  const c = status.config;
  const s = c.settings;
  const access = !!host && hasSiteAccess(tab.url, c.origins);
  $('enabled').checked = s.enabled;
  $('siteEnabled').checked = !!host && siteOn(s, host) && access;
  $('siteEnabled').disabled = !host;
  $('siteName').textContent = !host ? 'This page is not a website'
    : !access || !siteOn(s, host) ? 'Turn on for this site' : `On for ${host}`;
  $('siteEnabled').setAttribute('aria-label', $('siteName').textContent);
  $('budgetRecovery').hidden = !status.budgetWarning;
  $('budgetWarning').textContent = status.budgetWarning
    ? `The saved introduction date (${status.budgetWarning}) is over seven days ahead of your local date. New introductions stay paused. Reset only today's introduction budget? Your reviews and progress stay saved.` : '';
  const due = status.review.due;
  const available = status.review.new;
  $('today').textContent = `Today · ${due} due for review · ${available} available to add`;
  $('primary').textContent = due > 0 ? `Review ${due} due ${due === 1 ? 'word' : 'words'}`
    : available > 0 ? 'Add words' : 'Practice';
  $('operation').textContent = !s.enabled ? 'Off'
    : !c.hasKey ? 'Add a Gemini key to start'
    : host && !siteEnabled(s, tab.url) ? 'Off on this site'
    : host && !access ? 'This site needs your OK'
    : statusLabel(status.modelStatus) || 'On';
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

$('enabled').addEventListener('change', (e) => run(async () => {
  await send({ type: 'save', settings: { enabled: e.target.checked } });
  await refresh();
}));
$('siteEnabled').addEventListener('change', (e) => run(async () => {
  if (!host || !tab?.url) return;
  const enabled = e.target.checked;
  if (enabled && !hasSiteAccess(tab.url, status.config.origins)) {
    // This request must be first in the click handler, before any await loses the gesture.
    const accepted = await chrome.permissions.request({ origins: [`${new URL(tab.url).protocol}//${host}/*`] });
    if (!accepted) { await refresh(); return; }
  }
  await send({ type: 'save', siteOverride: { host, enabled } });
  await refresh();
  if (enabled) await inject();
}));
$('cancelBudget').addEventListener('click', () => { $('budgetRecovery').hidden = true; });
$('recoverBudget').addEventListener('click', () => run(async () => {
  const res = await send({ type: 'recoverBudget', confirm: true, day: status.budgetWarning, scope: status.config.scope });
  if (!res.ok) throw new Error('Budget changed. Refresh and try again.');
  await refresh();
}));
$('primary').addEventListener('click', () => run(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/review.html') });
}));
$('openSettings').addEventListener('click', (e) => {
  e.preventDefault();
  void run(() => chrome.runtime.openOptionsPage());
});
$('openWords').addEventListener('click', (e) => {
  e.preventDefault();
  void run(() => chrome.tabs.create({ url: chrome.runtime.getURL('src/capture.html') }));
});

void run(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { const u = new URL(tab?.url); if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/\.$/, ''); } catch { /* internal tab */ }
  await refresh();
});

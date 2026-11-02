import { localize, t } from './i18n.js';
import { statusLabel } from './quota-status.js';
import { siteOn, hasSiteAccess } from './settings.js';
import { readingState } from './state.js';
import { todayLine, weekLine, headline, primaryAction } from './progress-text.js';

const $ = (id) => document.getElementById(id);
localize();
let status;
let tab;
let host = '';
let primary = { page: 'review.html' };

const send = async (msg) => {
  const res = await chrome.runtime.sendMessage(msg);
  if (res?.error && !('ok' in res)) throw new Error(res.error);
  return res;
};

async function refresh() {
  let progress;
  // Progress is informational: if it fails, the site controls still work and the button falls
  // back to the status reply's review counts.
  [status, progress] = await Promise.all([send({ type: 'status' }), send({ type: 'progress' }).catch(() => null)]);
  const c = status.config;
  const s = c.settings;
  const access = !!host && hasSiteAccess(tab.url, c.origins);
  $('enabled').checked = s.enabled;
  $('enabledLabel').textContent = s.enabled ? t('popup_switch_on') : t('popup_switch_off');
  $('siteEnabled').checked = !!host && siteOn(s, host) && access;
  $('siteEnabled').disabled = !host;
  $('siteName').textContent = !host ? t('popup_not_a_website')
    : !access || !siteOn(s, host) ? t('popup_turn_on_site') : t('popup_on_for_site', host);
  $('siteEnabled').setAttribute('aria-label', $('siteName').textContent);
  $('budgetRecovery').hidden = !status.budgetWarning;
  $('budgetWarning').textContent = status.budgetWarning
    ? t('popup_budget_warning', status.budgetWarning) : '';
  $('today').textContent = progress ? todayLine(progress.today) : '';
  $('week').textContent = progress ? `${weekLine(progress.practisedThisWeek)} · ${headline(progress.verifiedKnown)}` : '';
  primary = primaryAction(progress || status.review);
  $('primary').textContent = primary.label;
  const state = readingState(c, tab?.url, status.modelStatus, status.consentShown);
  $('welcomeRoute').hidden = state !== 'needs_setup';
  $('operation').textContent = status.modelStatus?.category === 'key_isolation_unavailable'
    ? statusLabel(status.modelStatus)
    : state === 'paused' ? t('popup_state_off')
    : state === 'needs_setup' ? t('popup_state_needs_setup')
    : state === 'needs_key' ? t('popup_state_needs_key')
    : ['site_off', 'sensitive'].includes(state) ? t('popup_state_site_off')
    : state === 'needs_site' ? t('popup_state_needs_site')
    : statusLabel(status.modelStatus) || t('popup_state_on');
}

async function run(fn) {
  $('notice').textContent = '';
  try { await fn(); } catch (e) { $('notice').textContent = e.message || t('popup_error_generic'); }
}

// The registered content script only reaches pages loaded after a grant; this covers the open tab.
async function inject() {
  if (!tab?.id || !host) return;
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['src/content.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content-loader.js'] });
  } catch { $('notice').textContent = t('popup_error_reload'); }
}

$('enabled').addEventListener('change', (e) => run(async () => {
  $('enabledLabel').textContent = e.target.checked ? t('popup_switch_on') : t('popup_switch_off');
  try { await send({ type: 'save', settings: { enabled: e.target.checked } }); }
  finally { await refresh(); }
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
  if (!res.ok) throw new Error(t('popup_error_budget_changed'));
  await refresh();
}));
$('primary').addEventListener('click', () => run(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL(`src/${primary.page}`) });
}));
$('openSettings').addEventListener('click', (e) => {
  e.preventDefault();
  void run(() => chrome.runtime.openOptionsPage());
});
$('openWords').addEventListener('click', (e) => {
  e.preventDefault();
  void run(() => chrome.tabs.create({ url: chrome.runtime.getURL('src/words.html') }));
});
$('openWelcome').addEventListener('click', (e) => {
  e.preventDefault();
  void run(() => chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome.html') }));
});

void run(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { const u = new URL(tab?.url); if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/\.$/, ''); } catch { /* internal tab */ }
  await refresh();
});

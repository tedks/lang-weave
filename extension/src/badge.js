// Toolbar state is tab-local and advisory. No page data or hostname enters a badge or title.
import { chromeStorage } from './cache.js';
import { DAILY_MODEL_CALLS, callsToday } from './quota.js';
import { cleanQuotaState, safeModelStatus, visibleModelStatus,
  STATUS_KEY, QUOTA_STATE_KEY } from './quota-status.js';
import { readingState } from './state.js';

// Matches the light --ui-danger and --ui-muted tokens in ui.css. White text is explicit
// so Chromium's toolbar theme cannot choose an unreadable badge foreground.
export const BADGE_ATTENTION = '#9b221b';
export const BADGE_MUTED = '#59636b';

export function badgeAppearance(state, modelStatus, quotaState, keyEpoch, now = Date.now()) {
  if (state === 'new') return { text: 'NEW', color: BADGE_ATTENTION, title: 'New Lang Weave version available; reload the extension' };
  if (state === 'working') return { text: '', color: BADGE_MUTED, title: 'Lang Weave is on here' };
  if (state === 'needs_key') return { text: '!', color: BADGE_ATTENTION, title: 'Add your Gemini key' };
  if (state === 'key_rejected') return { text: '!', color: BADGE_ATTENTION, title: 'Gemini rejected this key. Paste a new one.' };
  if (state === 'needs_site') return { text: '•', color: BADGE_ATTENTION, title: 'Click to turn on here' };
  if (state === 'paused') return { text: '–', color: BADGE_MUTED, title: 'Lang Weave is paused; click to turn it on' };
  if (state === 'sensitive') return { text: '–', color: BADGE_MUTED, title: 'Off on sensitive sites; click to turn on here' };
  if (state === 'site_off') return { text: '–', color: BADGE_MUTED, title: 'Off on this site; click to turn it on' };
  if (state === 'unavailable') return { text: '–', color: BADGE_MUTED, title: 'Open Lang Weave to check this page' };
  if (state === 'unsupported') return { text: '–', color: BADGE_MUTED, title: 'Open a website to use Lang Weave' };
  if (state === 'local_budget') return { text: '–', color: BADGE_MUTED, title: 'Daily model-call budget reached; review still works' };
  if (state === 'model_error') return { text: '–', color: BADGE_MUTED, title: 'Model request failed; review still works' };
  if (state !== 'cooldown') return { text: '–', color: BADGE_MUTED,
    title: 'Open Lang Weave to check this page' };
  const safe = safeModelStatus(modelStatus);
  const kind = safe?.category === 'daily_quota' ? 'daily'
    : safe?.category === 'overloaded' ? 'overloaded' : 'short';
  const quota = cleanQuotaState(quotaState, keyEpoch, now);
  const times = Object.values(quota.cooldowns).filter((entry) => entry.kind === kind).map((entry) => entry.until);
  const retryAt = safe?.retryAt > now && safe.retryAt <= now + 24 * 60 * 60 * 1000
    ? safe.retryAt : Math.min(...times);
  const clock = Number.isFinite(retryAt) ? new Date(retryAt).toLocaleTimeString([], {
    hour: 'numeric', minute: '2-digit',
  }) : null;
  return { text: '–', color: BADGE_MUTED,
    title: clock ? `Paused until ${clock}; review still works` : 'Reading is paused; review still works' };
}

export function createBadge({ context, store, updatePending }) {
  const generations = new Map();
  const writes = new Map();

  async function snapshot() {
    const [config, data] = await Promise.all([
      context(), store.get(['keyEpoch', STATUS_KEY, QUOTA_STATE_KEY]),
    ]);
    const stored = safeModelStatus(data[STATUS_KEY]);
    const budgetReached = stored?.category === 'local_budget' &&
      await callsToday(chromeStorage) >= DAILY_MODEL_CALLS;
    const status = visibleModelStatus(data[STATUS_KEY], data[QUOTA_STATE_KEY], data.keyEpoch, budgetReached);
    return { config, data, status };
  }

  async function refresh(tabId, sharedSnapshot) {
    if (!Number.isInteger(tabId) || tabId < 0) return;
    const generation = (generations.get(tabId) || 0) + 1;
    generations.set(tabId, generation);
    try {
      const [tab, { config, data, status }] = await Promise.all([
        chrome.tabs.get(tabId), sharedSnapshot || snapshot(),
      ]);
      const state = updatePending() ? 'new' : readingState(config, tab.url, status);
      const badge = badgeAppearance(state, status, data[QUOTA_STATE_KEY], data.keyEpoch);
      const options = { tabId };
      const write = (writes.get(tabId) || Promise.resolve()).catch(() => {}).then(async () => {
        if (generations.get(tabId) !== generation) return;
        await chrome.action.setBadgeBackgroundColor?.({ ...options, color: badge.color });
        await chrome.action.setBadgeTextColor?.({ ...options, color: '#ffffff' });
        await chrome.action.setBadgeText({ ...options, text: badge.text });
        await chrome.action.setTitle?.({ ...options, title: badge.title });
      });
      writes.set(tabId, write);
      await write;
      if (writes.get(tabId) === write) writes.delete(tabId);
    } catch {
      // A late update event after removal must not leave a worker-lifetime entry.
      if (generations.get(tabId) === generation) generations.delete(tabId);
    }
  }

  async function refreshAll() {
    const tabs = await chrome.tabs.query({});
    if (!tabs.length) return;
    const shared = snapshot(); // one word-list/settings/grant read for all tabs
    await Promise.allSettled(tabs.map((tab) => refresh(tab.id, shared)));
  }

  function removed(tabId) { generations.delete(tabId); }
  return { refresh, refreshAll, removed };
}

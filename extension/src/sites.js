// Content-script registration for granted origins, and the permission-change epoch.
import { activeOn } from './worker-context.js';
import { isZeroFrench } from './levels.js';

// The hosts where the manifest itself injects the loader. Only loader entries count: an unrelated manifest
// script must not stop the loader reaching a granted host. Always a list, possibly empty: updateContentScripts
// leaves an omitted property unchanged, so leaving it out could keep a stale exclusion from an earlier registration.
export const declaredMatches = () => [...new Set((chrome.runtime.getManifest().content_scripts ?? [])
  .filter((cs) => (cs.js ?? []).includes('src/content-loader.js')).flatMap((cs) => cs.matches ?? []))];

export function createSites({ store, locked, worker, broadcast, context }) {
  // Granted origins (all sites, or one at a time from the popup) decide where the content script is injected.
  // Hosts the manifest itself injects into are excluded so no page gets the loader twice: X in the unpacked
  // build, where it works without a grant. The Store build declares no content script (scripts/package.mjs
  // STORE_DELTAS), so there a granted X is registered like any other site.
  let registrations = Promise.resolve();
  const recoveredTabs = new Set(); // one recovery attempt per tab in this worker life
  const grantedMatches = (origins) => [...new Set(origins.flatMap((o) =>
    o === '<all_urls>' ? ['http://*/*', 'https://*/*'] : [o]))]
    .filter((o) => /^(https?|\*):\/\//.test(o) && !o.includes('googleapis.com'));
  function registerSites() {
    const p = registrations.then(async () => {
      const { origins = [] } = await chrome.permissions.getAll();
      const matches = grantedMatches(origins);
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] });
      if (!matches.length) {
        if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: ['weave-sites'] });
        return;
      }
      const script = { id: 'weave-sites', matches, js: ['src/content-loader.js'], css: ['src/content.css'], runAt: 'document_idle',
        excludeMatches: declaredMatches(), persistAcrossSessions: true };
      if (existing.length) await chrome.scripting.updateContentScripts([script]);
      else await chrome.scripting.registerContentScripts([script]);
    });
    registrations = p.catch(() => {});
    return p;
  }
  async function recoverOpenTabs() {
    if (!context) return; // registration-only callers need no tab recovery
    const { origins = [] } = await chrome.permissions.getAll();
    const matches = grantedMatches(origins);
    if (!matches.length) return;
    // URL filtering is part of the query: a host grant exposes these tab URLs without `tabs`.
    const tabs = await chrome.tabs.query({ url: matches });
    await Promise.allSettled(tabs.map(async ({ id, url }) => {
      if (!Number.isSafeInteger(id) || typeof url !== 'string' || recoveredTabs.has(id)) return;
      const eligible = async () => {
        const [ctx, consent, tab] = await Promise.all([context(), store.get('consentShown'), chrome.tabs.get(id)]);
        return consent.consentShown !== false && typeof tab.url === 'string' && tab.url === url &&
          typeof tab.title === 'string' && !isZeroFrench(tab.title) && activeOn(ctx, tab.url);
      };
      if (!(await eligible())) return;
      // Any reply (including {ok:false}) proves the content handler is present. An
      // importing loader might miss this ping; its isolated-world marker covers that race.
      const present = await Promise.race([
        chrome.tabs.sendMessage(id, { type: 'personalCaptureAlive' }, { frameId: 0 })
          .then(() => true, () => false),
        new Promise((resolve) => setTimeout(() => resolve(false), 250)),
      ]);
      if (present) return;
      // A delayed listener can miss the ping while its loader is importing. Probe
      // the extension's isolated world before injecting a second copy of either build.
      const marked = await chrome.scripting.executeScript({ target: { tabId: id }, func: () =>
        !!(globalThis[Symbol.for('lang-weave.content-loader')] ||
          globalThis[Symbol.for('lang-weave.content-bundle')]) }).then(([result]) => result?.result === true, () => false);
      if (marked || !(await eligible()) || recoveredTabs.has(id)) return;
      recoveredTabs.add(id);
      try {
        await chrome.scripting.insertCSS({ target: { tabId: id }, files: ['src/content.css'] });
        if (!(await eligible())) return;
        await chrome.scripting.executeScript({ target: { tabId: id }, files: ['src/content-loader.js'] });
      } catch { /* A closed or newly ungranted tab is no longer eligible. */ }
    }));
  }
  const permissionsChanged = () => {
    // The event is observable before its epoch write can acquire a held dispatch lock.
    worker.permissionGeneration++;
    return locked(async () => {
      // The final origin list can equal an earlier one after a remove/regrant round trip.
      await store.set({ epoch: crypto.randomUUID() });
    }).catch(() => {}).then(() => registerSites()).then(() => broadcast('retry')).catch(() => {});
  };
  return { registerSites, recoverOpenTabs, permissionsChanged };
}

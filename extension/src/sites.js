// Content-script registration for granted origins, and the permission-change epoch.

export function createSites({ store, locked, worker, broadcast }) {
  // Granted origins (all sites, or one at a time from the popup) decide where the content script is injected.
  // X is in the manifest, so it works without a grant.
  let registrations = Promise.resolve();
  function registerSites() {
    const p = registrations.then(async () => {
      const { origins = [] } = await chrome.permissions.getAll();
      const matches = [...new Set(origins.flatMap((o) => o === '<all_urls>' ? ['http://*/*', 'https://*/*'] : [o]))]
        .filter((o) => /^(https?|\*):\/\//.test(o) && !o.includes('googleapis.com'));
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] });
      if (!matches.length) {
        if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: ['weave-sites'] });
        return;
      }
      const script = { id: 'weave-sites', matches, js: ['src/content-loader.js'], css: ['src/content.css'], runAt: 'document_idle',
        excludeMatches: ['https://x.com/*', 'https://twitter.com/*'] };
      if (existing.length) await chrome.scripting.updateContentScripts([script]);
      else await chrome.scripting.registerContentScripts([script]);
    });
    registrations = p.catch(() => {});
    return p;
  }
  const permissionsChanged = () => {
    // The event is observable before its epoch write can acquire a held dispatch lock.
    worker.permissionGeneration++;
    return locked(async () => {
      // The final origin list can equal an earlier one after a remove/regrant round trip.
      await store.set({ epoch: crypto.randomUUID() });
    }).catch(() => {}).then(() => registerSites()).then(() => broadcast('retry')).catch(() => {});
  };
  return { registerSites, permissionsChanged };
}

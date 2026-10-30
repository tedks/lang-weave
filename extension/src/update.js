// Self-update check for unpacked installs.

export const ALARM = 'updates';

// A git update can replace this folder on disk, but Chrome keeps
// running the loaded copy. Compare the manifest on disk with the running one and reload from disk by ourselves,
// once per disk version, after any model call in flight and pending storage writes. If the running copy still
// differs after that (or reload fails), mark the toolbar icon so the user can reload by hand.
export const RELOADED_KEY = 'reloadedFor';

// The first-run page is an install event, never an update or an unpacked reload.
export function openWelcome(details) {
  if (details?.reason === 'install') {
    // Pending gradual-default-on-install-ruling: this is the sole install-time hook for gradual:true.
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome.html') });
  }
}

// Only an unpacked (development) install runs from files that can change under it. The Chrome Web Store and Edge
// Add-ons write update_url into the manifest they install, and the browser's own updater replaces those copies;
// the source manifest never carries one (test/update-gate.test.js pins that). Read synchronously, with no
// chrome.management call: a missing key means unpacked, so the fleet's unpacked installs keep the self-update.
export const selfUpdating = () => !Object.hasOwn(chrome.runtime.getManifest(), 'update_url');

export function createUpdate({ store, locked, modelCall }) {
  async function checkUpdate() {
    if (!selfUpdating()) return ''; // no disk fetch, reload, badge or popup banner for a packaged install
    try {
      const disk = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json();
      const waiting = disk.version && disk.version !== chrome.runtime.getManifest().version ? String(disk.version) : '';
      if (waiting && (await store.get(RELOADED_KEY))[RELOADED_KEY] !== waiting) {
        await store.set({ [RELOADED_KEY]: waiting });
        try {
          await modelCall(() => locked(() => chrome.runtime.reload()));
          return waiting; // normally not reached: the worker is gone
        } catch { /* fall back to the badge */ }
      }
      await chrome.action.setBadgeText({ text: waiting ? 'NEW' : '' });
      return waiting;
    } catch {
      return '';
    }
  }

  // create() replaces an alarm of the same name, so calling it on both events is safe. Startup matters
  // because disabling and re-enabling the extension clears alarms without firing onInstalled.
  function arm() {
    if (!selfUpdating()) return;
    chrome.alarms.create(ALARM, { periodInMinutes: 30 });
    void checkUpdate();
  }
  return { checkUpdate, arm };
}

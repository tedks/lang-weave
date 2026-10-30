import { hasSiteAccess, siteOn } from './settings.js';
import { COMMANDS } from './router.js';

export function createCommands({ tabs, runtime, context, save }) {
  let pauseQueue = Promise.resolve();
  async function pauseSite(tab) {
    const current = tab?.id != null ? tab : (await tabs.query({ active: true, currentWindow: true }))[0];
    if (!current?.id || !/^https?:\/\//.test(current.url || '')) return;
    const before = await context();
    const latest = await tabs.get(current.id);
    if (latest?.url !== current.url || !latest.active || !before.settings.enabled ||
        !hasSiteAccess(latest.url, before.origins)) return;
    const host = new URL(latest.url).hostname.toLowerCase().replace(/\.$/, '');
    const enabled = siteOn(before.settings, host);
    // An off-by-default site needs the popup's explicit site choice. A shortcut
    // resumes only a site that already has an explicit off override.
    if (!enabled && before.settings.siteOverrides[host] !== false) return;
    await save({ siteOverride: { host, enabled: !enabled } });
  }
  async function handle(command, tab) {
    if (command === COMMANDS.pauseSite) {
      const next = pauseQueue.then(() => pauseSite(tab));
      pauseQueue = next.catch(() => {});
      return next;
    }
    if (command === COMMANDS.openReview)
      return tabs.create({ url: runtime.getURL('src/review.html') });
  }
  return { handle };
}

// One decision order for the popup's state line and the per-tab badge.
// This is display state only; reading.js still owns every consent recheck.
import { siteEnabled, hasSiteAccess, offByDefault } from './settings.js';
import { safeModelStatus } from './quota-status.js';

export function readingState(config, url, modelStatus) {
  const settings = config.settings;
  if (!settings.enabled || config.paused) return 'paused';
  if (!config.hasKey) return 'needs_key';
  if (typeof url !== 'string') return 'unavailable'; // Chrome withholds URLs without a host grant or activeTab gesture
  let host;
  try {
    const parsed = new URL(url);
    if (/^https?:$/.test(parsed.protocol)) host = parsed.hostname;
  } catch { /* no website on this tab */ }
  if (!host) return 'unsupported';
  if (!siteEnabled(settings, url)) return offByDefault(host) &&
    !Object.hasOwn(settings.siteOverrides || {}, host.toLowerCase().replace(/\.$/, '')) ? 'sensitive' : 'site_off';
  if (!hasSiteAccess(url, config.origins)) return 'needs_site';
  const category = safeModelStatus(modelStatus)?.category;
  if (category === 'key_rejected') return 'key_rejected';
  if (['daily_quota', 'rate_limit', 'overloaded'].includes(category)) return 'cooldown';
  if (category === 'local_budget') return 'local_budget';
  if (['request_failed', 'storage_failed'].includes(category)) return 'model_error';
  return 'working';
}

import { localize, t } from './i18n.js';
import { declaredMatches } from './sites.js';
import { mountPlacement } from './placement-page.js';
import { mountWelcomeDemo } from './welcome-demo.js';

export function chooseSitePolicy(all, { request, save }) {
  // request() must be the first action on the all-sites click to retain Chrome's user gesture.
  return all ? request().then((granted) => granted ? save(true) : false) : save(false);
}

export const suggestX = () => !declaredMatches().includes('https://x.com/*');

export function allowSuggestedX({ request, save }) {
  // The permission request starts in the click gesture, before any async work.
  return request().then((granted) => granted ? save() : false);
}

if (typeof document !== 'undefined') {
  localize();
  const placementPanel = document.getElementById('placement');
  if (placementPanel) mountPlacement(placementPanel);
}
if (typeof document !== 'undefined' && document.getElementById('demo')) {
  void mountWelcomeDemo(document.getElementById('demo'), document.getElementById('demoLanguage'));

  const status = document.getElementById('choiceStatus');
  const buttons = [document.getElementById('onlySites'), document.getElementById('allSites')];
  const choose = async (all) => {
    buttons.forEach((button) => { button.disabled = true; });
    status.textContent = '';
    try {
      const saved = await chooseSitePolicy(all, {
        request: () => chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] }),
        save: async (enabled) => {
          const result = await chrome.runtime.sendMessage({ type: 'save', settings: { newSitesEnabled: enabled }, consentShown: true });
          if (!result?.ok) throw new Error(result?.error || t('welcome_error_save'));
          return true;
        },
      });
      status.textContent = saved ? (all ? t('welcome_chose_all') : t('welcome_chose_only'))
        : t('welcome_all_denied');
    } catch (error) { status.textContent = error.message || t('welcome_error_save'); }
    finally { buttons.forEach((button) => { button.disabled = false; }); }
  };
  buttons[0].addEventListener('click', () => { void choose(false); });
  buttons[1].addEventListener('click', () => { void choose(true); });
  if (suggestX()) {
    const suggestion = document.getElementById('suggestX');
    const allow = document.getElementById('allowX');
    const xStatus = document.getElementById('xStatus');
    suggestion.hidden = false;
    allow.addEventListener('click', () => {
      allow.disabled = true;
      xStatus.textContent = '';
      void allowSuggestedX({
        request: () => chrome.permissions.request({ origins: ['https://x.com/*'] }),
        save: async () => {
          const result = await chrome.runtime.sendMessage({ type: 'save', siteOverride: { host: 'x.com', enabled: true } });
          if (!result?.ok) throw new Error(result?.error || t('welcome_error_x'));
          return true;
        },
      }).then((saved) => { xStatus.textContent = saved ? t('welcome_x_allowed') : t('welcome_x_denied'); })
        .catch((error) => { xStatus.textContent = error.message || t('welcome_error_x'); })
        .finally(() => { allow.disabled = false; });
    });
  }
  document.getElementById('openSettings').addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
}

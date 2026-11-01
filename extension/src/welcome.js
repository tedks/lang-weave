import { localize, t } from './i18n.js';
import { L1_WORDS } from './vocabulary.js';
import { applySwaps, toggle, isSwap } from './text.js';
import { declaredMatches } from './sites.js';

// Keep the example fixed and sense-safe. Each entry must come from the bundled Beginner pack.
const DEMO_ENGLISH = ['Today', 'with', 'and', 'important', 'always', 'because', 'difficult', 'but', 'possible'];
export function demoSwaps() {
  return DEMO_ENGLISH.map((source) => {
    const word = L1_WORDS.find(({ en }) => en === source.toLowerCase());
    if (!word) throw new Error(`Missing Beginner demo word: ${source}`);
    return { o: source, f: word.fr, g: word.en, h: word.hint, ctx: '' };
  });
}

export function chooseSitePolicy(all, { request, save }) {
  // request() must be the first action on the all-sites click to retain Chrome's user gesture.
  return all ? request().then((granted) => granted ? save(true) : false) : save(false);
}

export const suggestX = () => !declaredMatches().includes('https://x.com/*');

export function allowSuggestedX({ request, save }) {
  // The permission request starts in the click gesture, before any async work.
  return request().then((granted) => granted ? save() : false);
}

if (typeof document !== 'undefined' && document.getElementById('demo')) {
  localize();
  const demo = document.getElementById('demo');
  applySwaps(demo, demoSwaps());
  let tipTimer;
  let tipBox;
  const hideTip = () => { clearTimeout(tipTimer); tipTimer = undefined; tipBox?.remove(); tipBox = undefined; };
  const showTip = (span) => {
    if (!span.isConnected) return;
    const box = document.createElement('div');
    box.className = 'fw-gloss fw-gloss-on';
    box.setAttribute('aria-hidden', 'true');
    box.textContent = `${span.dataset.fr} · ${span.dataset.tip}`;
    document.documentElement.append(box);
    const rect = span.getBoundingClientRect();
    const size = box.getBoundingClientRect();
    box.style.setProperty('left', `${Math.max(8, Math.min(rect.left, innerWidth - size.width - 8))}px`, 'important');
    box.style.setProperty('top', `${Math.max(8, rect.top - size.height - 8)}px`, 'important');
    tipBox = box;
  };
  demo.addEventListener('pointerover', (event) => {
    const span = event.target.closest?.('.fw-word');
    if (!span || !isSwap(span)) return;
    hideTip();
    tipTimer = setTimeout(() => showTip(span), 700);
  });
  demo.addEventListener('pointerout', hideTip);
  demo.addEventListener('focusin', (event) => {
    const span = event.target.closest?.('.fw-word');
    if (!span || !isSwap(span)) return;
    hideTip();
    tipTimer = setTimeout(() => showTip(span), 700);
  });
  demo.addEventListener('focusout', hideTip);
  const flip = (event) => {
    const span = event.target.closest?.('.fw-word');
    if (!span || !isSwap(span)) return;
    hideTip();
    toggle(span);
  };
  demo.addEventListener('click', flip);
  demo.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    flip(event);
  });

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

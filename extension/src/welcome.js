import { L1_WORDS } from './vocabulary.js';
import { applySwaps, toggle, isSwap } from './text.js';

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

if (typeof document !== 'undefined' && document.getElementById('demo')) {
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
          if (!result?.ok) throw new Error(result?.error || 'Could not save your choice');
          return true;
        },
      });
      status.textContent = saved ? (all ? 'All permitted sites selected. Sensitive sites still start off.'
        : 'Only sites you turn on selected. Open the popup on a site to allow it.')
        : 'Chrome did not grant all-site access. Choose only sites you turn on, or try again.';
    } catch (error) { status.textContent = error.message || 'Could not save your choice'; }
    finally { buttons.forEach((button) => { button.disabled = false; }); }
  };
  buttons[0].addEventListener('click', () => { void choose(false); });
  buttons[1].addEventListener('click', () => { void choose(true); });
  document.getElementById('openSettings').addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
}

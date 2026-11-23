import { GUARANI_PACK } from './guarani.js';
import { GUARANI_STARTER, languageName } from './language-name.js';
import { applySwaps, isSwap, revert, toggle } from './text.js';
import { L1_WORDS } from './vocabulary.js';

const SPANISH_ANCHORS = ['Today', 'with', 'and', 'important', 'always', 'because', 'difficult', 'but', 'possible'];
const GUARANI_ANCHORS = ['rain', 'tree', 'butterfly', 'flower', 'sun'];
const GUARANI_PASSAGE = 'After the rain, I walked past a tree toward the garden. A butterfly landed on a flower, and the sun warmed the path.';

// Keep both examples fixed and sense-safe, with words from their bundled Beginner lists.
export function demoSwaps(language = 'es') {
  const guarani = language === GUARANI_STARTER;
  const words = guarani ? GUARANI_PACK.words : L1_WORDS;
  return (guarani ? GUARANI_ANCHORS : SPANISH_ANCHORS).map((source) => {
    const word = words.find(({ en, level }) => en === source.toLowerCase() && (!guarani || level === 1));
    if (!word) throw new Error(`Missing Beginner demo word: ${source}`);
    return { o: source, f: word.fr, g: word.en, h: word.hint, ctx: '' };
  });
}

export async function mountWelcomeDemo(demo, picker) {
  const doc = demo.ownerDocument;
  const spanishPassage = demo.textContent;
  let tipTimer;
  let tipBox;
  const hideTip = () => {
    clearTimeout(tipTimer);
    tipBox?.remove();
    tipBox = undefined;
  };
  const languageTag = () => picker.value === GUARANI_STARTER ? 'gn-PY' : 'es';
  const render = () => {
    hideTip();
    revert(demo);
    demo.textContent = picker.value === GUARANI_STARTER ? GUARANI_PASSAGE : spanishPassage;
    applySwaps(demo, demoSwaps(picker.value), undefined, languageTag());
  };
  const swapAt = (event) => {
    const span = event.target.closest?.('.fw-word');
    return isSwap(span) ? span : null;
  };
  const scheduleTip = (event) => {
    const span = swapAt(event);
    if (!span) return;
    hideTip();
    tipTimer = setTimeout(() => {
      if (!span.isConnected) return;
      const box = doc.createElement('div');
      const target = doc.createElement('span');
      target.lang = languageTag();
      target.textContent = span.dataset.fr;
      box.className = 'fw-gloss fw-gloss-on';
      box.lang = 'en';
      box.setAttribute('aria-hidden', 'true');
      box.append(target, ` · ${span.dataset.tip}`);
      doc.documentElement.append(box);
      const rect = span.getBoundingClientRect();
      const size = box.getBoundingClientRect();
      box.style.setProperty('left', `${Math.max(8, Math.min(rect.left, doc.defaultView.innerWidth - size.width - 8))}px`, 'important');
      box.style.setProperty('top', `${Math.max(8, rect.top - size.height - 8)}px`, 'important');
      tipBox = box;
    }, 700);
  };
  demo.addEventListener('pointerover', scheduleTip);
  demo.addEventListener('pointerout', hideTip);
  demo.addEventListener('focusin', scheduleTip);
  demo.addEventListener('focusout', hideTip);
  const flip = (event) => {
    const span = swapAt(event);
    if (!span) return;
    event.preventDefault();
    hideTip();
    toggle(span, languageName(picker.value));
  };
  demo.addEventListener('click', flip);
  demo.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') flip(event);
  });

  for (const bundled of ['es', GUARANI_STARTER]) {
    const option = doc.createElement('option');
    option.value = bundled;
    option.textContent = languageName(bundled);
    picker.append(option);
  }
  // This trusted extension page only needs the language preference. The
  // preview makes no writes and generated catalog IDs use the Spanish sample.
  let savedLanguage;
  try { savedLanguage = (await chrome.storage.local.get('settings')).settings?.language; }
  catch { /* Spanish is the default if the preference cannot be loaded. */ }
  picker.value = savedLanguage === GUARANI_STARTER ? GUARANI_STARTER : 'es';
  render();
  const practiceLink = doc.getElementById('practiceParagraph');
  picker.addEventListener('change', () => {
    // A sample choice applies to this link only. The plain link follows Settings at open time.
    if (practiceLink) practiceLink.hash = picker.value === GUARANI_STARTER ? GUARANI_STARTER : 'es';
    render();
  });
  picker.disabled = false;
}

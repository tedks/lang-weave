import { t } from './i18n.js';
import { GUARANI_PACK } from './guarani.js';
import { GUARANI_STARTER, languageName } from './language-name.js';
import { applySwaps, isSwap, revert, toggle } from './text.js';
import { L1_WORDS } from './vocabulary.js';

// Each span specifies its Beginner target and, where needed, its full catalog sense.
const SPANISH_SAMPLES = [
  {
    title: () => t('welcome_sample_friend'),
    // The first Spanish passage is the readable fallback in welcome.html.
    words: [['Today', 'hoy'], ['with', 'con'], ['and', 'y'], ['important', 'importante'], ['always', 'siempre'],
      ['because', 'porque'], ['difficult', 'difícil'], ['but', 'pero'], ['possible', 'posible']],
  },
  {
    title: () => t('welcome_sample_train'),
    text: 'Before the train arrived, I folded the sweater and tucked it beside the bracelet in the suitcase. We leave for the coast tomorrow.',
    words: [['the sweater', 'el suéter'], ['the bracelet', 'la pulsera'], ['the suitcase', 'la maleta'], ['tomorrow', 'mañana']],
  },
  {
    title: () => t('welcome_sample_river'),
    text: 'I left the soup by the window to cool. Outside, the song from a passing bicycle faded as the rider crossed the river.',
    words: [['the soup', 'la sopa'], ['the window', 'la ventana'], ['the song', 'la canción'], ['the river', 'el río']],
  },
];

const GUARANI_SAMPLES = [
  {
    title: () => t('welcome_sample_garden'),
    text: 'After the rain, I walked past a tree toward the garden. A butterfly landed on a flower, and the sun warmed the path.',
    words: [['rain', 'ama'], ['tree', 'yvyra'], ['butterfly', 'panambi'], ['flower', 'yvoty'], ['sun', 'kuarahy']],
  },
  {
    title: () => t('welcome_sample_classroom'),
    text: 'Our teacher opened my book and handed me a sheet of paper. I drew the room as it looked from my chair.',
    words: [
      ['teacher', 'mbo’ehára', 'teacher (at school)'],
      ['book', 'aranduka', 'book (printed volume)'],
      ['paper', 'kuatia', 'paper (writing material)'],
      ['room', 'koty', 'room (indoors)'],
      ['chair', 'apyka', 'chair (seat)'],
    ],
  },
  {
    title: () => t('welcome_sample_moon'),
    text: 'At night we watched the moon rise over the road. A gust of wind rattled the door before dawn.',
    words: [
      ['night', 'pyhare', 'night (after dark)'],
      ['moon', 'jasy'],
      ['road', 'tape', 'road (route for travel)'],
      ['wind', 'yvytu'],
      ['door', 'okẽ', 'door (movable barrier)'],
    ],
  },
];

const samplesFor = (language) => language === GUARANI_STARTER ? GUARANI_SAMPLES : SPANISH_SAMPLES;

export function demoSwaps(language = 'es', index = 0) {
  const words = language === GUARANI_STARTER ? GUARANI_PACK.words.filter((word) => word.level === 1) : L1_WORDS;
  return samplesFor(language)[index].words.map(([source, target, sense = source.toLowerCase()]) => {
    const word = words.find(({ fr, en }) => fr === target && en === sense);
    if (!word) throw new Error(`Missing Beginner demo entry: ${target} (${sense})`);
    return { o: source, f: word.fr, g: word.en, h: word.hint, ctx: '' };
  });
}

export async function mountWelcomeDemo(demo, picker) {
  const doc = demo.ownerDocument;
  const spanishPassage = demo.textContent;
  const passagePicker = doc.getElementById('demoPassage');
  function populatePassages() {
    if (!passagePicker) return;
    passagePicker.replaceChildren();
    for (const sample of samplesFor(picker.value)) {
      const option = doc.createElement('option');
      option.textContent = sample.title();
      passagePicker.append(option);
    }
    passagePicker.selectedIndex = 0;
  }
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
    const index = passagePicker?.selectedIndex ?? 0;
    demo.textContent = samplesFor(picker.value)[index].text ?? spanishPassage;
    applySwaps(demo, demoSwaps(picker.value, index), undefined, languageTag());
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
  populatePassages();
  render();
  const practiceLink = doc.getElementById('practiceParagraph');
  picker.addEventListener('change', () => {
    // A sample choice applies to this link only. The plain link follows Settings at open time.
    if (practiceLink) practiceLink.hash = picker.value === GUARANI_STARTER ? GUARANI_STARTER : 'es';
    populatePassages();
    render();
  });
  if (passagePicker) {
    passagePicker.addEventListener('change', render);
    passagePicker.disabled = false;
  }
  picker.disabled = false;
}

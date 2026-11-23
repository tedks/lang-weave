import { localize, t } from './i18n.js';
import { GUARANI_STARTER, bundledLanguage, languageName } from './language-name.js';
import { MAX_PARAGRAPH_LENGTH, PARAGRAPH_EXAMPLES, paragraphLevel, paragraphMatches } from './paragraph-matches.js';
import { cleanSettings } from './settings.js';
import { applySwapAt, isSwap, revert, toggle } from './text.js';

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

function occurrenceLabel(text, { start, end }, index) {
  const left = text.slice(Math.max(0, start - 22), start).replace(/\s+/g, ' ');
  const word = text.slice(start, end).replace(/\s+/g, ' ');
  const right = text.slice(end, end + 22).replace(/\s+/g, ' ');
  return `${index + 1}. ${start > 22 ? '…' : ''}${left}[${word}]${right}${end + 22 < text.length ? '…' : ''}`;
}

export async function mountParagraph(doc, storage) {
  localize(doc);
  const $ = (id) => doc.getElementById(id);
  const language = $('language');
  const source = $('source');
  const occurrence = $('occurrence');
  const sense = $('sense');
  const occurrenceContext = $('occurrenceContext');
  const senseContext = $('senseContext');
  const preview = $('preview');
  const status = $('status');
  let matches = [];
  let matchedText = '';
  // The source and every derived view are transient even when Chrome keeps the page alive for back/forward.
  function clearPreview() {
    revert(preview);
    preview.textContent = '';
    $('result').hidden = true;
  }
  function clearMatches() {
    matches = [];
    matchedText = '';
    occurrence.replaceChildren();
    sense.replaceChildren();
    occurrenceContext.replaceChildren();
    senseContext.replaceChildren();
    $('choices').hidden = true;
    status.textContent = '';
    clearPreview();
  }
  function clearParagraph() {
    source.value = '';
    clearMatches();
  }
  source.addEventListener('input', clearMatches);
  doc.defaultView.addEventListener('pagehide', clearParagraph);
  $('clear').addEventListener('click', () => {
    clearParagraph();
    source.focus();
  });

  let saved;
  try { saved = await storage.get(['settings', 'spanishPlacement']); }
  catch { /* The bundled default is usable even if preferences are unavailable. */ }
  const settings = cleanSettings(saved?.settings ?? {});
  const level = () => paragraphLevel(settings, saved?.spanishPlacement, language.value);
  function option(text, value) {
    const el = doc.createElement('option');
    el.value = value;
    el.textContent = text;
    return el;
  }
  language.append(...['es', GUARANI_STARTER].map((code) => option(languageName(code), code)));
  const supported = bundledLanguage(settings.language);
  language.value = supported ? settings.language : 'es';
  $('languageNote').hidden = supported;
  function showTier() {
    $('level').textContent = level() === 1 ? t('paragraph_beginner') : t('paragraph_expanded');
  }
  showTier();
  language.addEventListener('change', () => {
    clearMatches();
    showTier();
  });
  $('example').addEventListener('click', () => {
    clearMatches();
    source.value = PARAGRAPH_EXAMPLES[language.value];
    source.focus();
  });

  const languageTag = () => language.value === GUARANI_STARTER ? 'gn-PY' : 'es';
  const chosenOccurrence = () => matches[occurrence.selectedIndex];
  const chosenSense = () => chosenOccurrence()?.senses[sense.selectedIndex];
  function showSenseContext() {
    clearPreview();
    const choice = chosenSense();
    senseContext.replaceChildren();
    if (!choice) return;
    const target = doc.createElement('span');
    target.lang = languageTag();
    target.textContent = choice.target;
    senseContext.append(target, ` · ${choice.gloss}`);
  }
  function showSenses() {
    const selected = chosenOccurrence();
    const choices = selected?.senses ?? [];
    occurrenceContext.replaceChildren();
    if (selected) {
      const { start, end } = selected;
      const { index, segment } = sentences.segment(matchedText).containing(start);
      const mark = doc.createElement('mark');
      mark.textContent = matchedText.slice(start, end);
      occurrenceContext.append(matchedText.slice(index, start), mark, matchedText.slice(end, index + segment.length));
    }
    sense.replaceChildren(...choices.map(({ target, gloss }, index) => option(`${target} · ${gloss}`, index)));
    showSenseContext();
  }
  occurrence.addEventListener('change', showSenses);
  sense.addEventListener('change', showSenseContext);
  $('find').addEventListener('click', () => {
    clearMatches();
    const text = source.value;
    if (!text.trim() || text.length > MAX_PARAGRAPH_LENGTH) {
      status.textContent = text.length > MAX_PARAGRAPH_LENGTH ? t('paragraph_limit') : t('paragraph_empty');
      source.focus();
      return;
    }
    matches = paragraphMatches(text, language.value, level());
    if (!matches.length) {
      status.textContent = t('paragraph_no_matches');
      return;
    }
    matchedText = text;
    occurrence.replaceChildren(...matches.map((match, index) => option(occurrenceLabel(text, match, index), index)));
    showSenses();
    $('choices').hidden = false;
    occurrence.focus();
  });
  $('practice').addEventListener('click', () => {
    const match = chosenOccurrence();
    const choice = chosenSense();
    if (!choice) return;
    if (source.value !== matchedText) { clearMatches(); source.focus(); return; }
    clearPreview();
    preview.textContent = matchedText;
    const span = applySwapAt(preview.firstChild, match.start, choice.swap, languageTag());
    if (!span) { clearMatches(); return; }
    $('result').hidden = false;
    span.focus();
  });
  function flip(event) {
    if (!isSwap(event.target)) return;
    event.preventDefault();
    if (!event.repeat) toggle(event.target, languageName(language.value));
  }
  preview.addEventListener('click', flip);
  preview.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') flip(event);
  });
  language.disabled = $('example').disabled = $('find').disabled = false;
}

if (typeof document !== 'undefined' && document.getElementById('paragraphHeading')) {
  void mountParagraph(document, chrome.storage.local);
}

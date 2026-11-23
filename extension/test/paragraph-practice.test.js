import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { GUARANI_STARTER } from '../src/language-name.js';
import { validateSwaps } from '../src/levels.js';
import { MAX_PARAGRAPH_LENGTH, PARAGRAPH_EXAMPLES, paragraphLevel, paragraphMatches } from '../src/paragraph-matches.js';
import { mountParagraph } from '../src/paragraph-page.js';
import { applySwaps } from '../src/text.js';

const spans = (text, language = 'es', level = 2) => paragraphMatches(text, language, level).map(({ start, end, senses }) =>
  [text.slice(start, end), senses.map(({ f }) => f)]);

test('each identical occurrence keeps its own offset and competing catalog senses', () => {
  const text = 'Admission is free. Admission is free.';
  const matches = paragraphMatches(text, 'es', 2);
  expect(matches.map(({ start, end }) => [start, end])).toEqual([[13, 17], [32, 36]]);
  for (const { senses } of matches) {
    expect(senses.map(({ word, g }) => [word, g])).toEqual([
      ['libre', 'free (unrestricted)'], ['gratis', 'free (no cost)'],
    ]);
  }
  expect(paragraphMatches(text, 'es', 1)).toEqual([]);
});

test('articles, case, whitespace, accents, overlapping phrases and gloss alternatives remain precise', () => {
  expect(spans('The\u00a0 tree shades a tree. My tree is tall.')).toEqual([
    ['The\u00a0 tree', ['El árbol']], ['tree', ['árbol']], ['tree', ['árbol']],
  ]);
  const overlaps = spans('I think that is enough.');
  expect(overlaps).toContainEqual(['I think that', ['creo que']]);
  expect(overlaps.some(([source]) => source === 'that')).toBe(true);
  expect(spans('I gave a little to a little bird.').filter(([source]) => source.includes('little')))
    .toEqual([['a little', ['un poco']], ['a little', ['un poco']]]);
  expect(spans('Little birds chirp.')).toEqual([]);
  expect(spans('I don’t know.')).toContainEqual(['I don’t know', ['no sé']]);
  expect(spans('The weather cleared.')).toContainEqual(['The weather', ['El tiempo']]);
  expect(paragraphMatches('The weather cleared.', 'es', 2)[0].senses[0].g).toBe('the weather');
});

test('names, all caps and joined or protected compound forms stay out of the choices', () => {
  const text = 'WINDOW. The window frame broke. A window‑shade snapped. A window’s latch clicked. I met River. The river rose.';
  expect(spans(text, 'es', 1)).toEqual([['The river', ['El río']]]);
  expect(spans('🪟 𐐀window. The window\u0301 stuck. The window stuck.', 'es', 1)).toEqual([['The window', ['La ventana']]]);
  expect(spans('An office chair held a book review. My chair held a book.', GUARANI_STARTER, 1)).toEqual([
    ['chair', ['apyka']], ['book', ['aranduka']],
  ]);
  expect(spans('Thank\nyou.', 'es', 1)).toEqual([]);
  expect(spans('I opened the window—it was cold.', 'es', 1)).toEqual([['the window', ['la ventana']]]);
});

test('manual practice accepts quoted dialogue while validation and web DOM placement still protect it', () => {
  const text = '“The window stuck.” Then I said, "try the window again." He said, “The window frame is broken.”';
  expect(spans(text, 'es', 1)).toEqual([['The window', ['La ventana']], ['the window', ['la ventana']]]);
  expect(spans('“I met River.” “The window’s latch caught.”', 'es', 1)).toEqual([]);
  expect(spans('She said, “The window stuck.” He asked, "The window frame too?"', 'es', 1))
    .toEqual([['The window', ['La ventana']]]);
  expect(spans('She said "Water is cold."', GUARANI_STARTER, 1)).toEqual([['Water', ['Y']]]);
  expect(spans('She said, " Water is cold."', GUARANI_STARTER, 1)).toEqual([['Water', ['Y']]]);
  expect(spans('I got an autograph from “River Song”.', 'es', 1)).toEqual([]);
  for (const spoken of ['"Come in," River said.', "'Come in,' River said.", '"Come in,"River said.']) {
    expect(spans(spoken, 'es', 1)).toEqual([]);
  }
  expect(spans('“A book,” she said. He replied, "the book is in my room."', GUARANI_STARTER, 1)).toEqual([
    ['book', ['aranduka']], ['book', ['aranduka']], ['room', ['koty']],
  ]);
  const swaps = [
    { o: 'The window', f: 'La ventana', g: 'the window', ctx: '“The window stuck.”' },
    { o: 'the window', f: 'la ventana', g: 'the window', ctx: '"try the window again."' },
  ];
  expect(validateSwaps(1, swaps, undefined, 'es', { text })).toEqual([]);
  const window = new Window();
  try {
    const passage = window.document.createElement('p');
    passage.textContent = text;
    expect(applySwaps(passage, swaps)).toBe(0);
    expect(passage.textContent).toBe(text);
  } finally { window.close(); }
});

test('the effective tier follows Spanish placement in Spanish and the shared reading level elsewhere', () => {
  expect(paragraphLevel({ levelOverride: 4 }, 1, 'es')).toBe(1);
  expect(paragraphLevel({ levelOverride: 1 }, 2, 'es')).toBe(2);
  expect(paragraphLevel({ levelOverride: 4 }, 1, GUARANI_STARTER)).toBe(2);
  expect(paragraphLevel({ levelOverride: 0 }, 2, GUARANI_STARTER)).toBe(1);
  expect(spans('Dew covered a room.', GUARANI_STARTER, 1)).toEqual([['room', ['koty']]]);
  expect(spans('Dew covered a room.', GUARANI_STARTER, 2)).toEqual([['Dew', ['Ysapy']], ['room', ['koty']]]);
  expect(spans('A room.', 'gn-PY', 2)).toEqual([]);
  expect(spans('The window. '.padEnd(MAX_PARAGRAPH_LENGTH))).not.toEqual([]);
  expect(spans('The window. '.padEnd(MAX_PARAGRAPH_LENGTH + 1))).toEqual([]);
});

test('both original examples have distinct Beginner options including Guaraní home and school vocabulary', () => {
  const exampleForms = (language) => new Set(paragraphMatches(PARAGRAPH_EXAMPLES[language], language, 1)
    .flatMap(({ senses }) => senses.map(({ word }) => word)));
  const spanish = exampleForms('es');
  for (const word of ['hoy', 'la ventana', 'el desayuno', 'el árbol', 'el río', 'la sopa', 'pero', 'la canción']) {
    expect(spanish.has(word)).toBe(true);
  }
  const guarani = exampleForms(GUARANI_STARTER);
  for (const word of ['óga', 'koty', 'apyka', 'mbo’ehao', 'mbo’ehára', 'aranduka', 'kuatia']) {
    expect(guarani.has(word)).toBe(true);
  }
});

const html = readFileSync(new URL('../src/paragraph.html', import.meta.url), 'utf8');

test('the exercise reads only preferences and discards every view on edit, reset or pagehide', async () => {
  const url = 'chrome-extension://fixture/src/paragraph.html';
  const window = new Window({ url });
  const doc = window.document;
  doc.body.innerHTML = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('<script'));
  const $ = (id) => doc.getElementById(id);
  const calls = [];
  const saved = { settings: { language: 'gn-PY', levelOverride: 1 }, spanishPlacement: 2 };
  await mountParagraph(doc, {
    get: async (keys) => { calls.push(keys); return saved; },
    set: (...args) => calls.push(args),
  });
  try {
    expect($('languageNote').hidden).toBe(false);
    expect($('language').getAttribute('aria-describedby')).toBe('level languageNote');
    expect($('language').value).toBe('es');
    expect($('level').textContent).toContain('Expanded');
    expect($('source').getAttribute('spellcheck')).toBe('false');
    expect($('source').getAttribute('autocomplete')).toBe('off');
    expect($('source').maxLength).toBe(MAX_PARAGRAPH_LENGTH);
    const original = 'Admission is free. Admission is free. <img src=x>';
    $('source').value = original;
    $('find').click();
    expect(doc.activeElement).toBe($('occurrence'));
    $('occurrence').selectedIndex = 1;
    $('occurrence').dispatchEvent(new window.Event('change'));
    expect($('occurrenceContext').textContent.trim()).toBe('Admission is free. <img src=x>');
    expect($('occurrenceContext').querySelector('mark').textContent).toBe('free');
    expect($('occurrenceContext').querySelector('img')).toBeNull();
    $('sense').selectedIndex = 1;
    $('sense').dispatchEvent(new window.Event('change'));
    expect($('senseContext').textContent).toBe('gratis · free (no cost)');
    $('practice').click();
    const word = $('preview').querySelector('[role="button"]');
    expect(word.textContent).toBe('gratis');
    expect(doc.activeElement).toBe(word);
    expect($('preview').textContent).toBe('Admission is free. Admission is gratis. <img src=x>');
    expect($('preview').querySelector('img')).toBeNull();
    word.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect($('preview').textContent).toBe(original);
    $('source').dispatchEvent(new window.Event('input'));
    expect($('choices').hidden).toBe(true);
    expect($('sense').options.length).toBe(0);
    expect($('occurrenceContext').textContent).toBe('');
    expect($('senseContext').textContent).toBe('');
    expect($('preview').textContent).toBe('');
    expect(doc.querySelector('.fw-descriptions').textContent).toBe('');
    $('find').click();
    $('source').value += ' A change without an input event.';
    $('practice').click();
    expect($('choices').hidden).toBe(true);
    expect(doc.activeElement).toBe($('source'));
    expect($('status').textContent).toBe('Find words again to refresh your choices.');

    for (const sentence of [
      'We waited for Dr. Smith by\nthe window.', 'We asked J. R. Tolkien about the window.', '“Is the window open?” she asked.',
    ]) {
      $('source').value = `${sentence} The tree grew.`;
      $('find').click();
      $('occurrence').selectedIndex = [...$('occurrence').options].findIndex((option) => option.textContent.includes('[the window]'));
      $('occurrence').dispatchEvent(new window.Event('change'));
      expect($('occurrenceContext').textContent.trim()).toBe(sentence);
      expect($('occurrenceContext').querySelector('mark').textContent).toBe('the window');
    }
    // When a lone capital could be an initial, keep the adjacent text rather than cut the sentence short.
    $('source').value = 'We chose plan B. The window opened.';
    $('find').click();
    $('occurrence').selectedIndex = [...$('occurrence').options].findIndex((option) => option.textContent.includes('[The window]'));
    $('occurrence').dispatchEvent(new window.Event('change'));
    expect($('occurrenceContext').textContent).toBe($('source').value);

    $('language').value = GUARANI_STARTER;
    $('language').dispatchEvent(new window.Event('change'));
    expect($('level').textContent).toContain('Beginner');
    $('example').click();
    expect($('source').value).toBe(PARAGRAPH_EXAMPLES[GUARANI_STARTER]);
    $('find').click();
    $('clear').click();
    expect(doc.activeElement).toBe($('source'));
    expect($('source').value).toBe('');
    $('example').click();
    $('find').click();
    $('practice').click();
    window.dispatchEvent(new window.Event('pagehide'));
    expect($('source').value).toBe('');
    expect($('occurrence').options.length).toBe(0);
    expect($('preview').textContent).toBe('');
    expect(calls).toEqual([['settings', 'spanishPlacement']]);
    expect(saved.settings.language).toBe('gn-PY');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(window.location.href).toBe(url);
  } finally { await window.happyDOM.abort(); }
});

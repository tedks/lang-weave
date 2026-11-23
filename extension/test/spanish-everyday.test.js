import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { selectWorkingSet } from '../src/adaptive.js';
import { isZeroSpanish, possibleSpanishPromptWords, validateSwaps, wordCount, wordsForLevel } from '../src/levels.js';
import { cleanReview } from '../src/review.js';
import { FRESH_INSTALL_SETTINGS } from '../src/settings.js';
import { sourceIssue } from '../src/semantic.js';

const corpus = JSON.parse(readFileSync(new URL('spanish-everyday-corpus.json', import.meta.url)));
const FORMER_BEGINNER_SIZE = 37;
// Pin the intended source and rendered forms independently of the runtime catalog.
const heldOutSwaps = [
  ['home', 0, 'the window', 'la ventana', 'la ventana'],
  ['meals', 0, 'the soup', 'la sopa', 'la sopa'],
  ['meals', 1, 'breakfast', 'el desayuno', 'desayuno'],
  ['outdoors', 0, 'tree', 'el árbol', 'árbol'],
  ['outdoors', 1, 'The river', 'el río', 'El río'],
  ['leisure', 0, 'the song', 'la canción', 'la canción'],
  ['leisure', 1, 'the movie', 'la película', 'la película'],
];

function spanProbes(text, words) {
  const tokens = [...text.matchAll(/[\p{L}\p{N}’'-]+/gu)];
  return tokens.flatMap((start, i) => tokens.slice(i, i + 4).flatMap((end) => {
    const o = text.slice(start.index, end.index + end[0].length);
    return words.map(({ fr: f }) => ({ o, f }));
  }));
}

test('all seven promotions were reachable in the Expanded discovery pool', () => {
  const words = wordsForLevel(2);
  const hits = new Map();
  for (const text of Object.values(corpus.discovery).flat()) {
    const possible = possibleSpanishPromptWords(2, words, [{ id: 'paragraph', text }]);
    const reached = new Set(validateSwaps(2, spanProbes(text, possible), words, 'es', { text })
      .map(({ word }) => word));
    for (const form of reached) hits.set(form, (hits.get(form) || 0) + 1);
  }
  const promotionCounts = Object.fromEntries(heldOutSwaps.map(([, , , form]) => [form, hits.get(form)]));
  expect(promotionCounts).toEqual({
    'la ventana': 2, 'el desayuno': 2, 'la sopa': 2, 'el árbol': 1, 'el río': 1, 'la canción': 1, 'la película': 1,
  });
});

test('all seven promotions are reachable on held-out Beginner reading in both modes', () => {
  const words = wordsForLevel(1);
  const before = words.slice(0, FORMER_BEGINNER_SIZE);
  const now = Date.parse('2026-11-23T12:00:00Z'), day = '2026-11-23';
  const reached = { ordinary: new Set(), gradual: new Set() };
  const opportunities = { ordinary: [0, 0], gradual: [0, 0] };
  for (const text of Object.values(corpus.heldOut).flat()) {
    expect(wordCount(text)).toBeGreaterThanOrEqual(6);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(isZeroSpanish(text)).toBe(false);
    const batch = [{ id: 'paragraph', text }];
    const probes = spanProbes(text, words);
    const measure = (catalog) => {
      const valid = new Set(validateSwaps(1, probes, catalog, 'es', { text }).map(({ word }) => word));
      const ordinary = possibleSpanishPromptWords(1, catalog, batch);
      const gradual = selectWorkingSet({ batch, words: catalog, scope: 'es', state: cleanReview(null, catalog, now),
        settings: FRESH_INSTALL_SETTINGS, now, day, level: 1, language: 'es' });
      return {
        ordinary: ordinary.map(({ fr }) => fr).filter((fr) => valid.has(fr)),
        gradual: gradual.map(({ fr }) => fr).filter((fr) => valid.has(fr)),
      };
    };
    const baseline = measure(before);
    const current = measure(words);
    for (const mode of ['ordinary', 'gradual']) {
      expect(current[mode]).toEqual(expect.arrayContaining(baseline[mode]));
      opportunities[mode][0] += baseline[mode].length;
      opportunities[mode][1] += current[mode].length;
      for (const form of current[mode]) {
        if (!baseline[mode].includes(form)) reached[mode].add(form);
      }
    }
  }
  expect(opportunities).toEqual({ ordinary: [14, 21], gradual: [13, 20] });
  const promotions = heldOutSwaps.map(([, , , form]) => form).sort();
  expect([...reached.ordinary].sort()).toEqual(promotions);
  expect([...reached.gradual].sort()).toEqual(promotions);
  for (const [topic, index, o, word, f] of heldOutSwaps) {
    expect(validateSwaps(1, [{ o, f: word }], words, 'es', { text: corpus.heldOut[topic][index] }))
      .toMatchObject([{ o, word, f }]);
  }
  expect(validateSwaps(1, [{ o: 'a tree', f: 'el árbol' }], words, 'es',
    { text: corpus.heldOut.outdoors[0] })).toEqual([]);
});

test('Beginner applies existing compound, context, quote and number guards to promoted nouns', () => {
  const cases = [
    ['The window', 'la ventana'],
    ['the movie', 'la película'],
    ['river', 'el río'],
    ['the song', 'la canción'],
    ['The trees', 'el árbol'],
  ];
  const words = wordsForLevel(1);
  for (const [source, f] of cases) {
    const { text } = corpus.contrasts.find((entry) => entry.source === source);
    expect(words.some(({ fr }) => fr === f)).toBe(true);
    expect(validateSwaps(1, [{ o: source, f }], words, 'es', { text })).toEqual([]);
  }
  for (const [source, f] of [['book', 'el libro'], ['pencil', 'el lápiz'], ['library', 'la biblioteca']]) {
    const { text } = corpus.contrasts.find((entry) => entry.source === source);
    const probe = [{ o: source, f }];
    expect(validateSwaps(2, probe, wordsForLevel(2), 'es', { text })).toMatchObject([{ word: f }]);
    expect(validateSwaps(1, probe, words, 'es', { text })).toEqual([]);
  }
});

test('standalone senses remain available and newly guarded compounds stay whole', () => {
  const cases = [
    ['I made breakfast while they set the table.', 'I bought breakfast cereal before we left for the weekend.',
      'breakfast', 'breakfast cereal', 'el desayuno'],
    ['I made breakfast while they set the table.', 'I put breakfast cereals out on the table before the guests arrived.',
      'breakfast', 'breakfast cereals', 'el desayuno'],
    ['We rested beside the tree before going home.', 'We drew a tree diagram to show how the choices were connected.',
      'tree', 'tree diagram', 'el árbol'],
    ['We rested beside the tree before going home.', 'My aunt drew the family tree from old notes in a drawer.',
      'tree', 'family tree', 'el árbol'],
    ['We opened the window to let the breeze in.', 'A row of jars stood in the shop window behind the sign.',
      'window', 'shop window', 'la ventana'],
    ['We opened the window to let the breeze in.', 'The bright sticker on the car window was hard to miss.',
      'window', 'car window', 'la ventana'],
    ['The soup is ready whenever you want a bowl.', 'The soup kitchen opened early for the first group of guests.',
      'soup', 'soup kitchen', 'la sopa'],
    ['We crossed the river by the old footbridge.', 'We rested on the river bank after a long walk.',
      'river', 'river bank', 'el río'],
    ['She played the song after reading the note.', 'I knew the theme song as soon as the new show began.',
      'song', 'theme song', 'la canción'],
  ];
  const words = wordsForLevel(1);
  for (const [standalone, compound, source, phrase, f] of cases) {
    const probe = [{ o: source, f }];
    expect(validateSwaps(1, probe, words, 'es', { text: standalone })).toMatchObject([{ word: f }]);
    expect(validateSwaps(1, probe, words, 'es', { text: compound })).toEqual([]);
    const from = compound.indexOf(phrase);
    expect(sourceIssue(compound, from, from + phrase.length, phrase)).toBe('');
  }
});

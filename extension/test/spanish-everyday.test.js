import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { selectWorkingSet } from '../src/adaptive.js';
import { possibleSpanishPromptWords, validateSwaps, wordsForLevel } from '../src/levels.js';
import { cleanReview } from '../src/review.js';
import { FRESH_INSTALL_SETTINGS } from '../src/settings.js';

const corpus = JSON.parse(readFileSync(new URL('spanish-everyday-corpus.json', import.meta.url)));
const promotions = ['la ventana', 'el desayuno', 'la sopa', 'el árbol', 'el río', 'la canción', 'la película'];

test('all seven promotions are reachable on held-out Beginner reading in both modes', () => {
  const words = wordsForLevel(1);
  const before = words.slice(0, 37);
  const now = Date.parse('2026-11-23T12:00:00Z'), day = '2026-11-23';
  const reached = { ordinary: new Set(), gradual: new Set() };
  const opportunities = { ordinary: [0, 0], gradual: [0, 0] };
  for (const text of Object.values(corpus.heldOut).flat()) {
    const batch = [{ id: 'paragraph', text }];
    const tokens = [...text.matchAll(/[\p{L}\p{N}’'-]+/gu)];
    const probes = tokens.flatMap((start, i) => tokens.slice(i, i + 4).flatMap((end) => {
      const o = text.slice(start.index, end.index + end[0].length);
      return words.map(({ fr: f }) => ({ o, f }));
    }));
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
  expect([...reached.ordinary].sort()).toEqual([...promotions].sort());
  expect([...reached.gradual].sort()).toEqual([...promotions].sort());
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
  for (const f of ['el libro', 'el lápiz', 'la biblioteca']) {
    expect(words.some(({ fr }) => fr === f)).toBe(false);
  }
});

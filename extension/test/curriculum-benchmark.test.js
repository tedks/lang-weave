import { expect, test } from 'bun:test';
import { performance } from 'node:perf_hooks';
import { catalogEntries, matchingEntries } from '../src/catalog.js';
import { selectWorkingSet } from '../src/adaptive.js';
import { validateSwaps, assertPackAnchors, MAX_PACK_ROWS } from '../src/levels.js';
import { buildSystemPrompt } from '../src/prompt.js';
import { cleanReview } from '../src/review.js';

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const time = (fn) => {
  for (let i = 0; i < 3; i++) fn();
  return median(Array.from({ length: 7 }, () => { const start = performance.now(); fn(); return performance.now() - start; }));
};

test('candidate selection, prompt construction and level matching scale to the measured pack ceiling', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  for (const size of [500, 1000, MAX_PACK_ROWS]) {
    const words = Array.from({ length: size }, (_, i) => ({ fr: `palabra${i}`, en: `term${i}`, hint: 'PAH-lah-brah', band: 1 }));
    const batch = [{ id: 'one', text: words.slice(0, 60).map(({ en }) => en).join(' ') }];
    const entries = catalogEntries(words, 'es');
    const state = cleanReview(null, words, now);
    const matchingMs = time(() => matchingEntries(batch, entries));
    const adaptiveMs = time(() => selectWorkingSet({ batch, words, scope: 'es', state,
      settings: { gradual: true, newWordsPerDay: 5 }, now, day: '2026-10-31', revision: 'bench',
      level: 2, language: 'es' }));
    const promptMs = time(() => buildSystemPrompt(2, words));
    const levelsMs = time(() => { assertPackAnchors(words); validateSwaps(2, [{ o: 'term1', f: 'palabra1' }], words); });
    console.log(`curriculum ${size}: matching=${matchingMs.toFixed(2)}ms adaptive=${adaptiveMs.toFixed(2)}ms prompt=${promptMs.toFixed(2)}ms levels=${levelsMs.toFixed(2)}ms`);
    expect(matchingMs).toBeLessThan(size === 3000 ? 300 : 100);
    expect(adaptiveMs).toBeLessThan(500);
    expect(promptMs).toBeLessThan(500);
    expect(levelsMs).toBeLessThan(500);
  }
});

import { expect, test } from 'bun:test';
import { addPersonal, cleanPersonal, exportPersonal, personalWords, suggestedMatches,
  validForm, MAX_PERSONAL } from '../src/personal.js';
import { L1_WORDS, L2_WORDS } from '../src/vocabulary.js';

const fresh = () => cleanPersonal(null);
const save = (state, source, target, sense = source, extra = {}) => addPersonal(state,
  { source, target, sense, direction: 'en-to-target', ...extra }, 'es', 123,
  `00000000-0000-4000-8000-${String(state.entries.length + 1).padStart(12, '0')}`);

test('personal UUID, exact dedup, distinct senses and accents survive cleaning/export', () => {
  const state = fresh();
  const first = save(state, 'cat', 'el gato');
  expect(first.duplicate).toBe(false);
  expect(first.entry.id).toBe('personal:es:00000000-0000-4000-8000-000000000001');
  expect(save(state, ' CAT ', ' el gato ', 'cat').entry.id).toBe(first.entry.id);
  expect(state.entries).toHaveLength(1);
  expect(() => save(state, 'cat', 'el gató', 'another')).toThrow(/distinct meaning/i);
  const second = save(state, 'cat', 'el gató', 'another', { distinct: true });
  expect(second.entry.id).not.toBe(first.entry.id);
  const roundTrip = cleanPersonal(structuredClone(state));
  expect(roundTrip.entries.map((e) => e.target)).toEqual(['el gato', 'el gató']);
  expect(exportPersonal(roundTrip).entries.map((e) => e.id)).toEqual(state.entries.map((e) => e.id));
  expect(JSON.stringify(exportPersonal(roundTrip))).not.toMatch(/https?:|pageTitle|surroundingText|apiKey/);
});

test('unsafe spelling or English anchors are review-only, distinct supported item can match', () => {
  const state = fresh();
  save(state, 'cat', 'el gato', 'cat', { linkedLegacy: 'es:legacy:el%20gato' });
  const safe = save(state, 'glimmer', 'brillo').entry;
  const ambiguous = save(state, 'bank', 'orilla', 'river edge').entry;
  const statuses = personalWords(state, 'es', L2_WORDS);
  expect(statuses.find(({ entry }) => entry.id === safe.id).reviewOnly).toBe(false);
  expect(statuses.find(({ entry }) => entry.id === ambiguous.id).reviewOnly).toBe(false);
  const duplicateTarget = save(state, 'shine', 'brillo', 'shine', { distinct: true }).entry;
  expect(personalWords(state, 'es', L2_WORDS).filter(({ entry }) =>
    [safe.id, duplicateTarget.id].includes(entry.id)).every(({ reviewOnly }) => reviewOnly)).toBe(true);
  expect(statuses.find(({ entry }) => entry.linkedLegacy)?.reviewOnly).toBe(true);
  expect(suggestedMatches('cat', 'en-to-target', 'es', L1_WORDS, state).length).toBeGreaterThan(0);
  const aliasState = fresh();
  save(aliasState, 'dwelling', 'casa');
  expect(personalWords(aliasState, 'es', [{ fr: 'la casa', en: 'home' }])[0].reviewOnly).toBe(true);
});

test('selection and fields reject controls, format, URL-like, markup and oversized input', () => {
  for (const value of ['x'.repeat(81), 'six words are too many here', 'https://example.com',
    'a\u200db', '<script>', 'a\u0000b', 'a\nb', 'a\u2028b', 'name@example.com'])
    expect(validForm(value, { selection: true })).toBeNull();
  expect(validForm('  sí  ')).toBe('sí');
  expect(validForm('uno dos tres cuatro cinco', { selection: true })).toBe('uno dos tres cuatro cinco');
  const state = fresh();
  expect(() => save(state, 'a\u200db', 'target')).toThrow();
  expect(cleanPersonal({ version: 2, entries: [{ source: 'future' }] }).unsupported).toBe(true);
  expect(() => addPersonal(cleanPersonal({ version: 2, entries: [] }),
    { source: 'word', target: 'palabra', sense: 'word', direction: 'en-to-target' }, 'es')).toThrow(/newer format/i);
  for (let i = 0; i < MAX_PERSONAL; i++) save(state, `anchor${i}`, `forma${i}`);
  expect(() => save(state, 'overflow', 'desborde')).toThrow(/full/i);
});

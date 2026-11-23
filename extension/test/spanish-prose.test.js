import { expect, test } from 'bun:test';
import { selectWorkingSet } from '../src/adaptive.js';
import { entryId } from '../src/catalog.js';
import { possibleSpanishPromptWords, validateSwaps } from '../src/levels.js';
import { paragraphMatches } from '../src/paragraph-matches.js';
import { createBackup, learningPatch, parseBackup } from '../src/portability.js';
import { cleanReview } from '../src/review.js';
import { FRESH_INSTALL_SETTINGS } from '../src/settings.js';
import { EXPANDED_PLACEMENT_WORDS, L1_WORDS, L2_WORDS } from '../src/vocabulary.js';

const formerBeginnerSize = 44;
const promoted = ['el jardín', 'el cielo', 'la puerta', 'la luna'];
const now = Date.parse('2026-11-23T12:00:00Z');
const day = '2026-11-23';
const examples = [
  ['The door scraped against the worn stone step.', 'The door', 'la puerta', 'La puerta'],
  ['An open hatch faced a garden beside the old mill.', 'garden', 'el jardín', 'jardín'],
  ['A narrow beam crossed the sky just past dusk.', 'the sky', 'el cielo', 'el cielo'],
  ['Their telescope followed the moon over the harbor.', 'the moon', 'la luna', 'la luna'],
];

const gradualWords = (text, words, saved) => selectWorkingSet({ batch: [{ id: 'paragraph', text }], words,
  scope: 'es', state: cleanReview(saved, words, now), settings: FRESH_INSTALL_SETTINGS, now, day, level: 1, language: 'es' });

test('original prose offers the four new forms in fresh Beginner ordinary, gradual and paragraph practice', () => {
  const before = L1_WORDS.slice(0, formerBeginnerSize);
  for (const [text, o, word, f] of examples) {
    const probe = [{ o, f: word }];
    expect(validateSwaps(1, probe, before, 'es', { text })).toEqual([]);
    const ordinary = possibleSpanishPromptWords(1, L1_WORDS, [{ id: 'paragraph', text }]);
    const gradual = gradualWords(text, L1_WORDS);
    expect(validateSwaps(1, probe, ordinary, 'es', { text })).toMatchObject([{ o, word, f }]);
    expect(validateSwaps(1, probe, gradual, 'es', { text })).toMatchObject([{ o, word, f, status: 'new' }]);
    expect(paragraphMatches(text, 'es', 1).flatMap(({ senses }) => senses))
      .toContainEqual(expect.objectContaining({ o, word, f }));
  }
});

test('Beginner keeps whole compounds, quotes, names and plural or indefinite phrases intact', () => {
  const cases = [
    ['The door handle dropped into the deep gravel.', 'The door', 'la puerta'],
    ['The garden paths were lined with terracotta pots.', 'The garden', 'el jardín'],
    ['The caretaker counted the doors in the old station.', 'the doors', 'la puerta'],
    ['An open hatch faced a garden beside the old mill.', 'a garden', 'el jardín'],
    ['Mina whispered, “The moon is rising behind you.”', 'The moon', 'la luna'],
    ['Mina introduced Sky to her new hiking group.', 'Sky', 'el cielo'],
    ['THE DOOR scraped against the worn stone step.', 'THE DOOR', 'la puerta'],
    ['The chair wobbled on the broken kitchen tiles.', 'The chair', 'la silla'],
    ['A sky-blue flag hung above the open rafters.', 'sky', 'el cielo'],
    ['A sky\u2010blue flag hung above the open rafters.', 'sky', 'el cielo'],
    ['The handmade\u2011door scraped against the worn floor.', 'door', 'la puerta'],
  ];
  for (const [text, o, f] of cases) expect(validateSwaps(1, [{ o, f }], L1_WORDS, 'es', { text })).toEqual([]);
});

test('promoted noun compounds stay whole in Beginner reading and local practice', () => {
  const cases = [
    ['The door frame splintered under the falling beam.', 'The door', 'la puerta'],
    ['The garden gate swung open in the breeze.', 'The garden', 'el jardín'],
    ['The garden door stuck against a fallen branch.', 'The garden', 'el jardín'],
    ['The garden door stuck against a fallen branch.', 'door', 'la puerta'],
    ['The garden books cover several kinds of seed.', 'The garden', 'el jardín'],
    ['They moved next door well before sunrise yesterday.', 'door', 'la puerta'],
    ['They saw the night sky through the clear panels.', 'sky', 'el cielo'],
    ['The moon rocks arrived in a padded crate.', 'The moon', 'la luna'],
    ['They set a special table only once in a blue moon.', 'moon', 'la luna'],
    ['We were over the moon when the shipment finally arrived.', 'the moon', 'la luna'],
  ];
  for (const [text, o, f] of cases) {
    const offline = paragraphMatches(text, 'es', 1).flatMap(({ senses }) => senses);
    const proposal = [{ o, f }];
    expect(validateSwaps(1, proposal, L1_WORDS, 'es', { text })).toEqual([]);
    expect(offline.some(({ word }) => word === f)).toBe(false);
    expect(validateSwaps(2, proposal, L2_WORDS, 'es', { text })).toMatchObject([{ word: f }]);
  }
});

test('joined English words do not supply short anchors for the promoted nouns', () => {
  const cases = [
    ['A thin envelope lay on the doorstep this morning.', 'door', 'la puerta'],
    ['The gardener picked a handful of ripe tomatoes.', 'garden', 'el jardín'],
    ['The skyline faded behind several layers of cloud.', 'sky', 'el cielo'],
    ['She crossed the narrow courtyard alone in moonlight.', 'moon', 'la luna'],
  ];
  for (const [text, o, f] of cases) {
    expect(validateSwaps(1, [{ o, f }], L1_WORDS, 'es', { text })).toEqual([]);
    expect(paragraphMatches(text, 'es', 1).flatMap(({ senses }) => senses).some(({ word }) => word === f)).toBe(false);
  }
});

test('promotions append in catalog order and preserve due and active cards and backup IDs', () => {
  const before = L1_WORDS.slice(0, formerBeginnerSize);
  const formerPromotions = ['el río', 'la ventana', 'el árbol', 'el desayuno', 'la película', 'la canción', 'la sopa'];
  expect(before.slice(-formerPromotions.length).map(({ fr }) => fr)).toEqual(formerPromotions);
  const expandedBefore = L2_WORDS.slice(30, -7).filter(({ fr }) => !formerPromotions.includes(fr));
  expect(EXPANDED_PLACEMENT_WORDS).toEqual([...expandedBefore, ...before]);
  expect(L1_WORDS.slice(formerBeginnerSize)).toEqual(promoted.map((fr) =>
    ({ ...expandedBefore.find((word) => word.fr === fr), band: 0 })));

  const door = 'la puerta', sky = 'el cielo';
  const id = 'es:legacy:la%20puerta';
  const saved = { version: 1, learning: { day, count: 2 }, cards: {
    [door]: { due: now - 1000, interval: 2, reviews: 2 },
    [sky]: { due: now + 86400000, interval: 7, reviews: 2 },
  } };
  const backup = parseBackup(createBackup({
    settings: { language: 'es', gradual: true },
    recallReview: saved, vocabularyEncounters: { version: 1, day, bucket: 2960,
      counts: { [id]: 3 }, touched: [id] },
  }, '0.15.2'));
  const restored = learningPatch(backup, {});
  expect(restored.recallReview.cards).toEqual(saved.cards);
  expect(restored.vocabularyEncounters.counts[id]).toBe(3);
  expect(entryId('es', L1_WORDS.find(({ fr }) => fr === door))).toBe(id);
  expect(gradualWords('From the door we saw the sky brighten above the garden.', L1_WORDS, restored.recallReview)
    .map(({ fr, status }) => [fr, status])).toEqual([[door, 'due'], [sky, 'active'], ['el jardín', 'new']]);
});

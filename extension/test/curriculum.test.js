import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';
import { L1_WORDS, L2_WORDS, MAX_PACK_ROWS, assertPackAnchors, exactFr, glossMatches, legacyInflects, normalizeFr,
  validateSwaps, wordsForLevel } from '../src/levels.js';
import { englishAnchors } from '../src/catalog.js';
import { selectWorkingSet } from '../src/adaptive.js';
import { buildSystemPrompt } from '../src/prompt.js';
import { cleanReview } from '../src/review.js';
import { policyWords, remaining } from '../src/learning.js';
import { memoryStorage } from '../src/cache.js';
import { scopedStorage } from '../src/scope.js';
import { cleanPersonal, personalWords } from '../src/personal.js';
import { personalReview } from '../src/review-state.js';
import { createContext } from '../src/worker-context.js';

const OLD_EXPANDED = 147;
const BEGINNER_CORE = 30;
const FORMER_BEGINNER = 37;
const FORMER_EXPANDED = 226;
const hash = (entries) => createHash('sha256').update(JSON.stringify(entries.map(({ fr, en, hint }) => ({ fr, en, hint })))).digest('hex');
const additions = () => L2_WORDS.slice(OLD_EXPANDED);
const clothing = () => L1_WORDS.slice(BEGINNER_CORE, FORMER_BEGINNER);

test('the original Beginner and Expanded entries retain their forms, glosses, hints and order', () => {
  expect(L1_WORDS).toHaveLength(48);
  expect(L2_WORDS).toHaveLength(233);
  expect(createHash('sha256').update(JSON.stringify(L1_WORDS.slice(0, FORMER_BEGINNER))).digest('hex'))
    .toBe('16c616741e36f3b789e0c16c517b737700c331aeb4d021ab73e1510b7af44e61');
  expect(createHash('sha256').update(JSON.stringify(L2_WORDS)).digest('hex'))
    .toBe('a44ea47d7d08af82953069925afad6776bd7bcaa5629d24d2e3c33ca5a1241c3');
  expect(hash(L1_WORDS.slice(0, BEGINNER_CORE))).toBe('95c5d607d1146c6e6d974d7829dfbe960fd24079b38066157be6ec98621ced37');
  expect(createHash('sha256').update(JSON.stringify(L2_WORDS.slice(0, FORMER_EXPANDED))).digest('hex'))
    .toBe('46761799be8dbbd3ba8992ab6ac583a8aed049538c0b4888ba5fdaafce36d4f2');
  expect(L2_WORDS.slice(FORMER_EXPANDED)).toEqual(clothing());
  expect(hash(L2_WORDS.slice(0, OLD_EXPANDED))).toBe('5f3fd6cc79a5bef41112c202422076abc7b482ab27673a27f9f7caafe780c6d1');
  expect(L2_WORDS.slice(0, OLD_EXPANDED).map((w) => w.fr)).toContain('el gato');
  expect(additions().map((w) => w.fr)).toContain('la ventana');
  expect(additions().map((w) => w.fr)).toContain('el libro');
});

test('Beginner additions have unique exact and folded forms and claim no legacy anchor', () => {
  const prior = L2_WORDS.slice(0, FORMER_EXPANDED);
  const spellings = new Set(prior.map(({ fr }) => normalizeFr(fr.replace(/^(?:el|la|los|las|un|una|unos|unas) /, ''))));
  assertPackAnchors(clothing());
  for (const noun of clothing()) {
    expect(noun.band).toBe(0);
    const bare = normalizeFr(noun.fr.replace(/^(?:el|la) /, ''));
    expect(spellings.has(bare)).toBe(false);
    spellings.add(bare);
    for (const anchor of englishAnchors(noun)) {
      expect(prior.find((word) => glossMatches(anchor, word.en, { inflections: legacyInflects(word) })))
        .toBeUndefined();
    }
  }
});

test('the bundled levels expose clothing and packing nouns to ordinary and gradual reading', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  const day = '2026-11-23';
  const passages = [
    ['The sweater dried beside the blouse.', ['el suéter', 'la blusa']],
    ['She packed the suitcase. A bracelet lay beside the necktie.', ['la maleta', 'la pulsera', 'la corbata']],
    ['The sandal was beside the slipper.', ['la sandalia', 'la pantufla']],
  ];
  for (const level of [1, 2]) {
    const words = wordsForLevel(level);
    const ordinary = buildSystemPrompt(level);
    const state = cleanReview(null, words, now);
    for (const [text, expected] of passages) {
      const selected = selectWorkingSet({ batch: [{ key: 'passage', text }], words, scope: 'es',
        state, settings: { gradual: true, newWordsPerDay: 5 }, now, day, level, language: 'es' });
      const prompt = buildSystemPrompt(level, selected);
      for (const fr of expected) {
        const word = selected.find((entry) => entry.fr === fr);
        expect(word).toMatchObject({ status: 'new' });
        expect(ordinary).toContain(`${fr} = ${word.en}`);
        expect(prompt).toContain(`${fr} = ${word.en}`);
      }
    }
  }
});

test('clothing swaps use the listed sense, number, article, and accent', () => {
  const swap = (text, o, f) => validateSwaps(1, [{ o, f }], undefined, 'es', { text })[0];
  expect(swap('The sweater dried beside the blouse.', 'The sweater', 'el sueter'))
    .toMatchObject({ f: 'El suéter', g: 'the sweater', h: 'el SWEH-tehr' });
  expect(swap('A bracelet lay beside the necktie.', 'bracelet', 'la pulsera'))
    .toMatchObject({ f: 'pulsera', g: 'bracelet', h: 'pool-SEH-rah' });
  expect(swap('A bracelet lay beside the necktie.', 'A bracelet', 'la pulsera')).toBeUndefined();
  expect(swap('The sandals were dry.', 'The sandals', 'la sandalia')).toBeUndefined();
  expect(swap('The teams ended in a tie.', 'tie', 'la corbata')).toBeUndefined();
  expect(swap('She said "the suitcase" twice.', 'the suitcase', 'la maleta')).toBeUndefined();
});

test('an earlier personal term keeps its review history when a bundled addition collides', async () => {
  const uuid = '4ad9f9d5-cd0a-4c47-a918-05a20b528109';
  const id = `personal:es:${uuid}`;
  const card = { due: 1800000000000, interval: 7, reviews: 3 };
  const history = { version: 1, cards: { [id]: card } };
  const saved = { version: 1, entries: [{ uuid, id, language: 'es', source: 'suitcase',
    target: 'maleta', sense: 'suitcase', direction: 'en-to-target' }], history: { es: history } };
  const store = memoryStorage({ settings: { gradual: true }, personalVocabularyV1: saved });
  const before = structuredClone(saved);
  expect(personalWords(cleanPersonal(saved, true), 'es', L2_WORDS.slice(0, FORMER_EXPANDED))[0].reviewOnly)
    .toBe(false);

  const previousChrome = globalThis.chrome;
  globalThis.chrome = { permissions: { getAll: async () => ({ origins: [] }) },
    runtime: { getManifest: () => ({ version: '0.12.27' }) } };
  try {
    const { context } = createContext({ store, ready: Promise.resolve(), worker: {} });
    const ctx = await context();
    expect(ctx.activePersonal[0]).toMatchObject({ entry: { id }, reviewOnly: true });
    expect(ctx.words.some((word) => word.fr === 'la maleta' || word.entryId === id)).toBe(false);
    expect(ctx.allWords.some((word) => word.fr === 'la maleta')).toBe(true);
    const review = personalReview(ctx);
    expect(review.words.some((word) => word.fr === id)).toBe(true);
    expect(review.state.cards[id]).toEqual(card);
    expect((await store.getAll()).personalVocabularyV1).toEqual(before);
  } finally { globalThis.chrome = previousChrome; }
});

test('new words are bounded, unique and normalized with articles and sound hints', () => {
  const added = additions();
  expect(added.length).toBeGreaterThanOrEqual(75);
  expect(L2_WORDS.length).toBeLessThanOrEqual(MAX_PACK_ROWS);
  const oldTargets = new Set(L2_WORDS.slice(0, OLD_EXPANDED).map((w) => normalizeFr(w.fr)));
  const oldGlosses = new Set(L2_WORDS.slice(0, OLD_EXPANDED)
    .map((w) => w.en.replace(/^the /, '').toLowerCase()));
  const targets = new Set(), glosses = new Set();
  for (const { fr, en, hint } of added) {
    expect(fr).toBe(fr.normalize('NFC'));
    expect(fr).toMatch(/^(?:el|la) [\p{L}]+$/u);
    expect(hint).toMatch(/^(?:el|lah) [A-Za-z-]+$/);
    expect(en).toMatch(/^(?:the )?[a-z]+(?: [a-z]+)*(?: \([a-z ]+\))?$/);
    expect(en).not.toContain('/');
    const target = normalizeFr(fr);
    expect(oldTargets.has(target)).toBe(false);
    expect(targets.has(target)).toBe(false);
    targets.add(target);
    const gloss = en.replace(/^the /, '').toLowerCase();
    expect(oldGlosses.has(gloss)).toBe(false);
    expect(glosses.has(gloss)).toBe(false);
    expect(exactFr(fr.replace(/^(?:el|la) /, ''))).not.toBe(gloss);
    glosses.add(gloss);
  }
});

test('curated nouns preserve sense, article, number, accent and safe source placement', () => {
  const one = (text, o, f) => validateSwaps(2, [{ o, f }], undefined, 'es', { text })[0];
  expect(one('We opened the window before dinner.', 'the window', 'la ventana'))
    .toMatchObject({ f: 'la ventana', g: 'the window', h: 'lah ben-TAH-nah' });
  expect(one('We opened a window before dinner.', 'window', 'la ventana'))
    .toMatchObject({ f: 'ventana', g: 'window', h: 'ben-TAH-nah' });
  expect(one('The kitchen smelled of soup.', 'The kitchen', 'la cocina')?.f).toBe('La cocina');
  expect(one('I sat at the table near the kitchen.', 'the kitchen', 'la cocina')?.f).toBe('la cocina');
  expect(one('We waited a little before leaving.', 'a little', 'un poco')?.f).toBe('un poco');
  expect(one('The photo is beside the book.', 'The photo', 'la foto')?.f).toBe('La foto');
  expect(one('The river runs near the town.', 'The river', 'el rio')?.f).toBe('El río');
  expect(one('We read the book near the window.', 'the book', 'el libro')?.f).toBe('el libro');
  expect(one('We watched the movie yesterday.', 'the movie', 'la película')?.f).toBe('la película');
  expect(one('The airplane crossed the clouds.', 'The airplane', 'el avión')?.f).toBe('El avión');

  expect(one('We opened the windows before dinner.', 'the windows', 'la ventana')).toBeUndefined();
  expect(one('We opened a window before dinner.', 'a window', 'la ventana')).toBeUndefined();
  expect(one('We opened a window before dinner.', 'a window', 'ventana')).toBeUndefined();
  expect(one('An airplane crossed the clouds.', 'An airplane', 'el avión')).toBeUndefined();
  expect(one('I saw a problem yesterday.', 'a problem', 'el problema')).toBeUndefined();
  expect(one('We opened the windows before dinner.', 'windows', 'la ventana')).toBeUndefined();
  expect(one('The password is private.', 'The password', 'la llave')).toBeUndefined();
  expect(one('The sentence is short.', 'The sentence', 'la frase')).toBeUndefined();
  expect(one('The photo is beside the book.', 'The photo', 'la película')).toBeUndefined();
  expect(one('The plane is a geometric surface.', 'The plane', 'el avión')).toBeUndefined();
  expect(one('The year ended.', 'The year', 'el ano')).toBeUndefined();
  expect(one('She read "the window" aloud.', 'the window', 'la ventana')).toBeUndefined();
  expect(one('The window frame is blue.', 'The window', 'la ventana')).toBeUndefined();
  expect(one('The movie theater opened.', 'The movie', 'la película')).toBeUndefined();
  expect(one('The garden path turns left.', 'The garden', 'el jardín')).toBeUndefined();
  expect(one('The book review was short.', 'The book', 'el libro')).toBeUndefined();
  expect(one('The computer program crashed.', 'The computer', 'la computadora')).toBeUndefined();
  expect(one('The page number is missing.', 'The page', 'la página')).toBeUndefined();
  expect(one('The window frames are blue.', 'The window', 'la ventana')).toBeUndefined();
  expect(one('The book reviews were short.', 'The book', 'el libro')).toBeUndefined();
  expect(one('The kitchen table is small.', 'The kitchen', 'la cocina')).toBeUndefined();
  expect(one('The office chairs are new.', 'The office', 'la oficina')).toBeUndefined();
  expect(validateSwaps(1, [{ o: 'the chair', f: 'la silla' }])).toEqual([]);
});

test('an Expanded upgrade retains Spanish ratings, budget and events without crossing generated-pack scopes', async () => {
  const now = Date.parse('2026-10-20T15:00:00Z');
  const saved = { version: 1, cards: {
    y: { due: now + 86400000, interval: 7, reviews: 3, familiar: true, easyStreak: 3, introducedDay: '2026-10-10' },
    'el gato': { due: now - 1000, interval: 3, reviews: 2, introducedDay: '2026-10-12' },
  }, current: { word: 'el gato', ticket: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', revealed: true },
  learning: { day: '2026-10-20', count: 3, pending: [] }, inline: null };
  const foreign = { version: 1, cards: { livre: { due: now, interval: 1, reviews: 1 } } };
  const events = [{ word: 'el gato', kind: 'seen', day: '2026-10-20' }];
  const storage = memoryStorage({ recallReview: saved, readingEvents: events,
    seenSent: { day: '2026-10-20', words: ['el gato'] },
    'lang:fr:v1:recallReview': foreign, 'lang:fr:v1:readingEvents': [{ word: 'livre', kind: 'seen', day: '2026-10-20' }] });
  const spanish = scopedStorage(storage, 'es');
  const upgraded = cleanReview((await spanish.get(['recallReview'])).recallReview, L2_WORDS, now);
  expect(upgraded.cards.y).toEqual(saved.cards.y);
  expect(upgraded.cards['el gato']).toEqual(saved.cards['el gato']);
  expect(upgraded.current).toEqual(saved.current);
  expect(upgraded.learning).toEqual(saved.learning);
  expect(remaining(upgraded.learning, '2026-10-20', 5)).toBe(2);
  expect(policyWords(L2_WORDS, upgraded, { gradual: true, newWordsPerDay: 5 }, now, '2026-10-20')[0].fr)
    .toBe('el gato');
  expect(upgraded.cards['la ventana']).toBeUndefined();
  await spanish.set({ recallReview: upgraded });
  const all = await storage.getAll();
  expect(all.readingEvents).toEqual(events);
  expect(all.seenSent.words).toEqual(['el gato']);
  expect(all['lang:fr:v1:recallReview']).toEqual(foreign);
  expect(all['lang:fr:v1:readingEvents']).toEqual([{ word: 'livre', kind: 'seen', day: '2026-10-20' }]);
});

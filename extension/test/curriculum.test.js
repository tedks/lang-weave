import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';
import { L1_WORDS, L2_WORDS, exactFr, normalizeFr, validateSwaps } from '../src/levels.js';
import { buildSystemPrompt } from '../src/prompt.js';
import { cleanReview } from '../src/review.js';
import { policyWords, remaining } from '../src/learning.js';
import { memoryStorage } from '../src/cache.js';
import { scopedStorage } from '../src/scope.js';

const OLD_EXPANDED = 147;
const hash = (entries) => createHash('sha256').update(JSON.stringify(entries)).digest('hex');
const additions = () => L2_WORDS.slice(OLD_EXPANDED);

test('the original Beginner and Expanded entries retain their forms, glosses, hints and order', () => {
  expect(L1_WORDS).toHaveLength(30);
  expect(hash(L1_WORDS)).toBe('95c5d607d1146c6e6d974d7829dfbe960fd24079b38066157be6ec98621ced37');
  expect(hash(L2_WORDS.slice(0, OLD_EXPANDED))).toBe('5f3fd6cc79a5bef41112c202422076abc7b482ab27673a27f9f7caafe780c6d1');
  expect(L2_WORDS.slice(0, OLD_EXPANDED).map((w) => w.fr)).toContain('el gato');
  expect(additions().map((w) => w.fr)).toContain('la ventana');
  expect(additions().map((w) => w.fr)).toContain('el libro');
});

test('new words are bounded, unique and normalized with articles and sound hints', () => {
  const added = additions();
  expect(added.length).toBeGreaterThanOrEqual(75);
  expect(L2_WORDS.length).toBeLessThanOrEqual(240);
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
  expect(validateSwaps(1, [{ o: 'the window', f: 'la ventana' }])).toEqual([]);
});

test('prompt growth stays bounded against the merged 0.6.2 candidate set', () => {
  const ordinary = buildSystemPrompt(2);
  const allNew = buildSystemPrompt(2, L2_WORDS.map((w) => ({ ...w, status: 'new' })));
  // Merged 0.6.2 baseline: 147 candidates, ordinary 4,997, all-new 5,184 characters.
  expect(L2_WORDS).toHaveLength(226);
  expect(ordinary.length).toBeLessThanOrEqual(7200);
  expect(allNew.length).toBeLessThanOrEqual(7400);
  expect(ordinary).toContain('la ventana = the window');
  expect(ordinary).toContain('el libro = the book');
  expect(ordinary).toContain('Keep English noun compounds intact');
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

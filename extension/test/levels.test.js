import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import {
  resolveLevel, L1_WORDS, L2_WORDS, validateSwaps, glossMatches, wordCount, isZeroFrench, normalizeFr, matchCase,
} from '../src/levels.js';

describe('level', () => {
  test('follows the synced stage, else 1; override wins; capped at the built level', () => {
    expect(resolveLevel({})).toEqual({ stage: 0, chosen: 1, effective: 1 });
    expect(resolveLevel({}, 2)).toEqual({ stage: 2, chosen: 2, effective: 2 });
    expect(resolveLevel({ levelOverride: 1 }, 2)).toEqual({ stage: 2, chosen: 1, effective: 1 });
    expect(resolveLevel({ levelOverride: 4 }, 1)).toEqual({ stage: 1, chosen: 4, effective: 2 });
    expect(resolveLevel({ levelOverride: 9 }, 7)).toEqual({ stage: 0, chosen: 1, effective: 1 });
  });
});

describe('word lists', () => {
  test('L1 is the bundled starter list', () => {
    const spec = ['y', 'pero', 'o', 'entonces', 'porque', 'con', 'sin', 'para', 'muy', 'también', 'bien', 'mucho', 'un poco', 'ahora', 'siempre', 'quizás', 'aquí', 'sí', 'no', 'gracias', 'el problema', 'la pregunta', 'la idea', 'la respuesta', 'importante', 'posible', 'difícil', 'hoy', 'mañana', 'nunca'];
    expect(L1_WORDS.map((w) => w.fr)).toEqual(spec);
  });
  test('L2 is about 150 words, includes L1 and the fixed phrases, every entry glossed with a hint', () => {
    expect(L2_WORDS.length).toBeGreaterThanOrEqual(140);
    expect(L2_WORDS.length).toBeLessThanOrEqual(160);
    const frs = L2_WORDS.map((w) => w.fr);
    for (const w of L1_WORDS) expect(frs).toContain(w.fr);
    for (const p of ['no sé', 'hay', 'creo que', 'hace falta']) expect(frs).toContain(p);
    expect(new Set(frs).size).toBe(frs.length);
    for (const w of L2_WORDS) {
      expect(w.en.length).toBeGreaterThan(0);
      expect(w.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('validateSwaps', () => {
  test('an English article left outside the swap gets the bare noun, never a double article', () => {
    const f = (o, fr) => validateSwaps(1, [{ o, f: fr, ctx: '' }])[0]?.f;
    expect(f('problem', 'el problema')).toBe('problema'); // "my problem", "a solved problem"
    expect(f('answer', 'la respuesta')).toBe('respuesta'); // "The answer is"
    expect(f('idea', "la idea")).toBe('idea');
    expect(f('the problem', 'el problema')).toBe('el problema');
    expect(f('The answer', 'la respuesta')).toBe('La respuesta');
  });
  test('keeps list words, canonicalizes accents, fills gloss and hint from the list', () => {
    const out = validateSwaps(1, [{ o: 'very', f: 'muy', g: 'x', h: 'y', ctx: 'is very good' }]);
    expect(out).toEqual([{ o: 'very', f: 'muy', g: 'very', h: 'mwee', ctx: 'is very good' }]);
  });
  test('drops words off the level list and malformed entries', () => {
    expect(validateSwaps(1, [{ o: 'in', f: 'en' }])).toEqual([]);
    expect(validateSwaps(2, [{ o: 'in', f: 'en' }])[0].f).toBe('en');
    expect(validateSwaps(1, [{ o: 'and' }, null, { f: 'y' }, { o: '  ', f: 'y' }])).toEqual([]);
    expect(validateSwaps(1, 'nope')).toEqual([]);
  });
  test('keeps synonym swaps with supplied and bundled vocabulary', () => {
    // Synonyms work with supplied vocabulary as well as the bundled list.
    const lexicon = [['grande', 'big'], ['solo', 'alone / only'], ['otro', 'other'], ['incluso', 'same / even'],
      ['creo que', 'I think that'], ["c'est", "it's"], ['hay', 'there is'], ['gracias', 'thank you'],
      ["de acuerdo", 'okay / agreed'], ['un poco', 'a little'], ['mucho', 'a lot'], ['quizás', 'maybe']]
      .map(([fr, en]) => ({ fr, en, hint: '', status: 'active' }));
    const pairs = [['large', 'grande'], ['huge', 'grande'], ['single', 'solo'], ['another', 'otro'], ['else', 'otro'],
      ['even', 'incluso'], ['I think', 'creo que'], ['it is', "c'est"], ["that's", "c'est"], ['there are', 'hay'],
      ['Thanks', 'gracias'], ['OK', "de acuerdo"], ['a bit', 'un poco'], ['so much', 'mucho'], ['perhaps', 'quizás']];
    const kept = validateSwaps(2, pairs.map(([o, f]) => ({ o, f, ctx: '' })), lexicon).map((s) => s.o);
    expect(kept).toEqual(pairs.map(([o]) => o));
    // The bundled level 2 examples in the prompt also survive.
    const bundled = [['I think', 'creo que'], ['there is', 'hay'], ['the world', 'el mundo'], ['today', 'hoy']];
    expect(validateSwaps(2, bundled.map(([o, f]) => ({ o, f, ctx: '' }))).map((s) => s.o)).toEqual(bundled.map(([o]) => o));
    // Issue #1 still drops.
    expect(validateSwaps(1, [{ o: 'to start', f: 'entonces', ctx: '' }])).toEqual([]);
  });

  test('drops a swap whose English is not the word\'s gloss (issue #1: "to start" -> entonces)', () => {
    expect(validateSwaps(1, [{ o: 'to start', f: 'entonces' }])).toEqual([]);
    expect(validateSwaps(1, [{ o: 'So', f: 'entonces' }])[0].f).toBe('Entonces');
    expect(validateSwaps(1, [{ o: 'really', f: 'muy' }])).toEqual([]);
  });
  test('accepts the bare noun and keeps accents', () => {
    const [s] = validateSwaps(1, [{ o: 'problem', f: 'problema' }]);
    expect(s.f).toBe('problema');
    expect(s.g).toBe('problem');
    const [t] = validateSwaps(1, [{ o: 'the problem', f: 'el problema' }]);
    expect(t.f).toBe('el problema');
  });
  test('matches capitalization of the original', () => {
    expect(validateSwaps(1, [{ o: 'And', f: 'y' }])[0].f).toBe('Y');
    expect(validateSwaps(1, [{ o: 'AND', f: 'y' }])).toEqual([]);
    expect(validateSwaps(1, [{ o: 'Because', f: 'porque' }])[0].f).toBe('Porque');
    expect(matchCase("la idea", 'The idea')).toBe("La idea");
  });
  test('keeps accented homographs distinct and rejects blank replacements', () => {
    expect(validateSwaps(2, [{ o: 'or', f: 'o' }])[0].f).toBe('o');
    expect(validateSwaps(2, [{ o: 'where', f: 'donde' }])[0].f).toBe('donde');
    expect(validateSwaps(2, [{ o: 'and', f: '' }, { o: 'and', f: '  ' }])).toEqual([]);
  });
  test('plugin words replace the bundled list and keep the event spelling and status', () => {
    const words = [{ fr: 'la luz', en: 'the light', hint: 'loos', status: 'active' }];
    expect(validateSwaps(1, [{ o: 'light', f: 'luz' }, { o: 'and', f: 'y' }], words))
      .toEqual([{ o: 'light', f: 'luz', g: 'light', h: 'loos', ctx: '', word: 'la luz', status: 'active' }]);
  });
  test('normalizeFr', () => {
    expect(normalizeFr(' Quizás ')).toBe('quizas');
    expect(normalizeFr(' MAÑANA ')).toBe('mañana');
  });
});

describe('guards', () => {
  test('wordCount', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('  one two\n\nthree ')).toBe(3);
  });
  test('zero-French topics', () => {
    expect(isZeroFrench('if you take ibuprofen talk to your doctor first')).toBe(true);
    expect(isZeroFrench('my lawyer says the lawsuit is fine')).toBe(true);
    expect(isZeroFrench('call 911 in an emergency')).toBe(true);
    expect(isZeroFrench('shipped the new onboarding flow today')).toBe(false);
    expect(isZeroFrench('the taxi was late again')).toBe(false);
    for (const title of ['Bank robbery investigation', 'The best index funds to buy',
      'Stocks and dividends', 'Teen driver injured in crash on Route 9',
      'He was arrested after a bar fight', 'ETF retirement plan', 'récent cancer diagnosis',
      "The bank's account was frozen", 'A bank’s account was frozen',
      'My checking account balance', 'Credit card payment due'])
      expect(isZeroFrench(title)).toBe(true);
    for (const title of ['A report about a river bank', 'Funding open source projects',
      'The app crash report', 'A taxi driver is late', 'Ira reads a guide',
      'prédoctorate studies', 'robberyish fiction', 'Investigating old records',
      'The account of a trip', 'Credit goes to the team'])
      expect(isZeroFrench(title)).toBe(false);
  });
});

describe('glossMatches', () => {
  test('matches any slash alternative, with or without a leading article', () => {
    expect(glossMatches('still', 'again / still')).toBe(true);
    expect(glossMatches('home', 'the house / home')).toBe(true);
    expect(glossMatches('the house', 'the house / home')).toBe(true);
    expect(glossMatches('house', 'the house / home')).toBe(true);
    expect(glossMatches('free', 'free (no cost)')).toBe(true);
  });
  test('accepts plain inflections and ignores case and punctuation', () => {
    expect(glossMatches('Problems', 'the problem')).toBe(true);
    expect(glossMatches('starting', 'to start')).toBe(true);
    expect(glossMatches('started', 'to start')).toBe(true);
    expect(glossMatches('making', 'to make')).toBe(true);
    expect(glossMatches('cities', 'the city')).toBe(true);
    expect(glossMatches('so,', 'so')).toBe(true);
    expect(glossMatches('it’s', "it's")).toBe(true);
  });
  test('QA 2026-10-15: right synonyms the gloss check used to drop', () => {
    for (const [o, en] of [['too', 'also'], ['as well', 'also'], ['hard', 'difficult'], ['in fact', 'actually'], ['However', 'but'], ['possibly', 'maybe'], ['too', 'too much']]) {
      expect(glossMatches(o, en)).toBe(true);
    }
    expect(glossMatches('sure', 'of course')).toBe(false); // "I'm not sure" is not bien sûr
  });
  test('rejects English that is not a gloss', () => {
    expect(glossMatches('to start', 'so')).toBe(false);
    expect(glossMatches('soon', 'so')).toBe(false);
    expect(glossMatches('', 'so')).toBe(false);
  });
});

describe('gloss check across every word list', () => {
  // CSV rows of the plugin lexicon and the starter lists (word or fr, en, ...); quoted fields allowed.
  const csv = (name) => readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8').replace(/^﻿/, '').trim()
    .split('\n').slice(1).map((line) => line.match(/("[^"]*"|[^,]*)(?:,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '')))
    .map(([fr, en]) => ({ fr, en, hint: '', status: 'active' }));
  const lists = { bundled: L2_WORDS, lexicon: csv('lexicon.csv'), spanish: csv('lexicons/spanish.csv'),
    japanese: csv('lexicons/japanese.csv'), indonesian: csv('lexicons/indonesian.csv') };
  const alternatives = (en) => en.split(/\s*[/;,]\s*/).filter((a) => a.trim());
  // 0.2.1 regression (gloss check with synonyms): a too-strict check dropped right swaps. Each word's own gloss passes.
  test('every gloss alternative of every word is accepted for that word', () => {
    for (const [name, words] of Object.entries(lists)) {
      expect(words.length).toBeGreaterThan(20);
      const dropped = words.flatMap((w) => alternatives(w.en).filter((alt) => !glossMatches(alt, w.en)).map((alt) => `${name}: ${w.fr} <- ${alt}`));
      expect(dropped).toEqual([]);
    }
  });
  // Issue #1 generalized: a model pairing a word with another word's English (wrong sense) is dropped.
  test("another word's gloss is rejected unless the two glosses share an alternative", () => {
    for (const [name, words] of Object.entries(lists)) {
      const wrong = [];
      for (let i = 0; i < words.length; i++) {
        const w = words[i], other = words[(i + 7) % words.length];
        const shared = alternatives(other.en).some((alt) => glossMatches(alt, w.en) && glossMatches(alternatives(w.en)[0], other.en));
        const english = alternatives(other.en)[0];
        if (!shared && glossMatches(english, w.en)) wrong.push(`${name}: ${w.fr} (${w.en}) <- ${english}`);
      }
      expect(wrong).toEqual([]);
    }
  });
});

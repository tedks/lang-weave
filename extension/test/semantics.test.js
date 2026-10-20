import { describe, test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { validateSwaps } from '../src/levels.js';
import { applySwaps, quotedRanges, sentenceStart } from '../src/text.js';
import { requestSwaps } from '../src/engine.js';

const W = (fr, en) => ({ fr, en, hint: '', status: 'active' });
const words = [W('y', 'and'), W('ahora', 'now'), W('porque', 'because'), W('busca', 'look for'),
  W('me gusta', 'like'), W('creo que', 'I think'), W('aplicación', 'app')];
const swap = (o, f, ctx = '') => ({ o, f, ctx, g: o, h: '' });
const kept = (text, o, f, ctx = '', list = words, language = 'es') =>
  validateSwaps(2, [swap(o, f, ctx)], list, language, { text });
const root = (text) => {
  const doc = new Window().document;
  const el = doc.createElement('p');
  el.textContent = text;
  return el;
};

describe('semantic source protections', () => {
  test('quoted ranges protect exact occurrences, including Unicode quotes; apostrophes and inch marks stay readable', () => {
    const source = 'She said “and now”, then said and again.';
    expect(kept(source, 'and', 'y', '“and now”')).toEqual([]);
    expect(kept(source, 'and', 'y', 'said and again')).toHaveLength(1);
    expect(quotedRanges("It's Hartley’s 12\" screen and a 'fine and good' choice.")
      .map(([a, b]) => "It's Hartley’s 12\" screen and a 'fine and good' choice.".slice(a, b)))
      .toEqual(["'fine and good'"]);
    expect(kept("It's Hartley’s 12\" screen and fine.", 'and', 'y')).toHaveLength(1);
    expect(kept('An unclosed “and now. Later and again.', 'and', 'y', '“and now')).toEqual([]);
    expect(kept('An unclosed “and now. Later and again.', 'and', 'y', 'Later and again')).toHaveLength(1);
    expect(kept('She called it ‘and now without ending it.', 'now', 'ahora')).toEqual([]);
    expect(kept("She called it 'and now ' today.", 'now', 'ahora')).toEqual([]);
    expect(kept("We heard 'tis and agreed.", 'and', 'y')).toHaveLength(1);
    expect(kept("We studied 'cause and effect' today.", 'and', 'y')).toEqual([]);
    const separate = "'tis and fun. I read 'word' aloud.";
    expect(kept(separate, 'and', 'y')).toHaveLength(1);
    expect(quotedRanges(separate).map(([a, b]) => separate.slice(a, b))).toEqual(["'word'"]);
  });

  test('ALL CAPS and name-like anchors stay English, ordinary words and OK survive', () => {
    expect(kept('We need AND now.', 'AND', 'y')).toEqual([]);
    expect(kept('We need AND now.', 'and', 'y')).toEqual([]); // model case cannot evade source casing
    expect(kept('We need and now.', 'and', 'y')).toHaveLength(1);
    expect(kept('We saw Home app yesterday.', 'app', 'aplicación')).toEqual([]);
    expect(kept('We saw an app yesterday.', 'app', 'aplicación')).toHaveLength(1);
    expect(kept('We saw And yesterday.', 'And', 'y')).toEqual([]);
    expect(kept('And then we left.', 'And', 'y')).toHaveLength(1);
    expect(kept('We met Dr. Now yesterday.', 'Now', 'ahora')).toEqual([]);
    expect(kept('Now we can begin.', 'Now', 'ahora')).toHaveLength(1);
    expect(kept('Dr. Smith said and left.', 'Smith', 'schmidt', '', [W('schmidt', 'Smith')], 'de')).toEqual([]);
    const ok = [W('vale', 'okay')];
    expect(kept('OK, we agree.', 'OK', 'vale', '', ok)).toHaveLength(1);
    expect(kept('We said OK today.', 'OK', 'vale', '', ok)).toHaveLength(1);
  });

  test('fixed phrases and contexts block only their affected anchor', () => {
    expect(kept('Do it right now, and now we can rest.', 'now', 'ahora', 'right now')).toEqual([]);
    expect(kept('Do it right now, and now we can rest.', 'now', 'ahora', 'and now we')).toHaveLength(1);
    expect(kept('We waited because of the rain.', 'because', 'porque')).toEqual([]);
    expect(kept('We waited because it rained.', 'because', 'porque')).toHaveLength(1);
    expect(kept('I like this song.', 'like', 'me gusta')).toHaveLength(1);
    expect(kept('It took like 20 minutes.', 'like', 'me gusta')).toEqual([]);
    expect(kept('We look for the answer.', 'look for', 'busca')).toHaveLength(1);
    expect(kept('We look for the answer.', 'for', 'para', '', [W('para', 'for')])).toEqual([]);
  });

  test('ambiguous duplicate anchors remain unplaced and generated target words get the same protection', () => {
    const generated = [W('und', 'and')];
    expect(kept('The cats and dogs and birds.', 'and', 'und', '', generated, 'de')).toEqual([]);
    expect(kept('The cats and dogs and birds.', 'and', 'und', 'dogs and birds', generated, 'de')).toHaveLength(1);
    const el = root('The cats and dogs and birds.');
    expect(applySwaps(el, [swap('and', 'und')])).toBe(0);
    expect(kept('She said “and” and left.', 'and', 'und', '“and”', generated, 'de')).toEqual([]);
    expect(kept('She said “and” and left.', 'and', 'und', 'and left', generated, 'de')).toHaveLength(1);
  });
});

test('placement rechecks cached swaps and cases pronoun I at the located sentence boundary', () => {
  expect(kept('Well, I think this works.', 'I think', 'creo que')[0].f).toBe('creo que');
  for (const [text, expected] of [
    ['I think this works.', 'Creo que this works.'],
    ['Well, I think this works.', 'Well, creo que this works.'],
    ['The first ended. I think this works.', 'The first ended. Creo que this works.'],
    ['A line ended!\nI think this works.', 'A line ended!\nCreo que this works.'],
    ['For example, e.g. I think this works.', 'For example, e.g. creo que this works.'],
  ]) {
    const el = root(text);
    expect(applySwaps(el, [swap('I think', 'creo que')])).toBe(1);
    expect(el.textContent).toBe(expected);
  }
  expect(sentenceStart('A sentence. (', 'A sentence. ('.length)).toBe(true);
  expect(sentenceStart('Well, ', 'Well, '.length)).toBe(false);
  const german = root('I think this works.');
  expect(applySwaps(german, [swap('I think', 'ich denke')])).toBe(1);
  expect(german.textContent).toBe('Ich denke this works.');
  const turkishStart = root('I think this works.');
  expect(applySwaps(turkishStart, [swap('I think', 'iyi düşünüyorum')], () => {}, 'tr')).toBe(1);
  expect(turkishStart.textContent).toBe('İyi düşünüyorum this works.');
  const turkishMid = root('Well, I think this works.');
  expect(applySwaps(turkishMid, [swap('I think', 'iyi düşünüyorum')], () => {}, 'tr')).toBe(1);
  expect(turkishMid.textContent).toBe('Well, iyi düşünüyorum this works.');
  const quoted = root('She said “and” and left.');
  expect(applySwaps(quoted, [swap('and', 'y', '“and”')])).toBe(0);
  expect(applySwaps(quoted, [swap('and', 'y', 'and left')])).toBe(1);
  const idiom = root('Do it right now.');
  expect(applySwaps(idiom, [swap('now', 'ahora')])).toBe(0);
  const capitals = root('AND now.');
  expect(applySwaps(capitals, [swap('AND', 'y')])).toBe(0);
  expect(applySwaps(capitals, [swap('and', 'y')])).toBe(0);
  const ordinary = root('and now.');
  expect(applySwaps(ordinary, [swap('and', 'y')])).toBe(1);
  const generated = root('We saw Home app yesterday.');
  expect(applySwaps(generated, [swap('app', 'anwendung')])).toBe(0);
});

test('engine filters unsafe model results per passage before caching', async () => {
  const text = 'Do it right now. We need and now.';
  const swaps = [swap('now', 'ahora', 'right now'), swap('and', 'y', 'need and now')];
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ tweets: [{ id: 'a', swaps }] }) }] } }],
  }) });
  const r = await requestSwaps({ apiKey: 'synthetic', model: 'gemini-3.5-flash-lite', level: 2,
    batch: [{ id: 'a', text }], words, fetchImpl });
  expect(r.results.a.map((s) => s.o)).toEqual(['and']);
});

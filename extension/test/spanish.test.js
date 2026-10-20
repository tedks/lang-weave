import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { validateSwaps, glossMatches, normalizeFr, L1_WORDS, L2_WORDS } from '../src/levels.js';
import { queueEvents, shownToday, PENDING_KEY } from '../src/events.js';
import { memoryStorage } from '../src/cache.js';

test('Spanish accents are restored when safe; ñ and accent homographs are distinct', () => {
  const swap = (o, f, level = 2) => validateSwaps(level, [{ o, f }])[0]?.f;
  expect(swap('also', 'tambien')).toBe('también');
  expect(swap('tomorrow', 'manana')).toBeUndefined();
  expect(swap('tomorrow', 'mañana')).toBe('mañana');
  expect(swap('the year', 'el ano')).toBeUndefined();
  expect(swap('the year', 'el año')).toBe('el año');
  expect(normalizeFr('AÑO')).toBe('año');
  expect(swap('yes', 'si', 1)).toBeUndefined(); // cannot repair to sí even when si is not in L1
  expect(swap('yes', 'sí', 1)).toBe('sí');
  expect(swap('if', 'si')).toBe('si');
  expect(swap('if', 'sí')).toBeUndefined();
  expect(swap('yes', 'si')).toBeUndefined();
  expect(swap('more', 'mas')).toBeUndefined();
  expect(swap('more', 'más')).toBe('más');
  expect(swap('how', 'como')).toBeUndefined();
  expect(swap('how', 'cómo')).toBe('cómo');
  expect(swap('like', 'como')).toBe('como');
});

test('Spanish articles stay with whole noun phrases and never double English determiners', () => {
  for (const [o, f, result] of [
    ['problem', 'el problema', 'problema'], ['the problem', 'el problema', 'el problema'],
    ['The answer', 'la respuesta', 'La respuesta'], ['answer', 'la respuesta', 'respuesta'],
    ['year', 'el año', 'año'], ['the year', 'el año', 'el año'],
  ]) expect(validateSwaps(2, [{ o, f }])[0]?.f).toBe(result);
  expect(validateSwaps(2, [{ o: 'to start', f: 'entonces' }])).toEqual([]);
  expect(validateSwaps(2, [{ o: 'so', f: 'entonces' }])[0]?.f).toBe('entonces');
  expect(validateSwaps(2, [{ o: 'and', f: 'et' }])).toEqual([]);
  expect(L1_WORDS).toHaveLength(30);
  expect(L2_WORDS).toHaveLength(226);
});

test('fork identity and permissions cannot collide with or contact the French companion', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  expect(manifest.name).toBe('Lang Weave');
  expect(manifest.key).toBeUndefined();
  expect(manifest.permissions).not.toContain('nativeMessaging');
  expect(manifest.background.service_worker).toBe('src/background.js');
  const worker = readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
  expect(worker).not.toContain('sendNativeMessage');
  expect(worker).not.toContain("from './hostsource.js'");
});

test('plural English anchors cannot become singular Spanish nouns, while listed plurals and verbs still work', () => {
  for (const [plural, singular, word] of [
    ['dogs', 'dog', 'el perro'], ['problems', 'problem', 'el problema'],
    ['weeks', 'week', 'la semana'], ['cities', 'city', 'la ciudad'],
  ]) {
    expect(validateSwaps(2, [{ o: plural, f: word }])).toEqual([]);
    expect(validateSwaps(2, [{ o: `the ${plural}`, f: word }])).toEqual([]);
    expect(validateSwaps(2, [{ o: singular, f: word }])[0]?.f).toBe(word.replace(/^(el|la) /, ''));
  }
  const words = [{ fr: 'los perros', en: 'the dogs', hint: 'lohs PEH-rrohs' },
    { fr: 'empezar', en: 'to start', hint: 'em-peh-SAHR' }];
  expect(validateSwaps(2, [{ o: 'dogs', f: 'los perros' }], words)[0]?.f).toBe('perros');
  expect(validateSwaps(2, [{ o: 'the dogs', f: 'los perros' }], words)[0]?.f).toBe('los perros');
  expect(validateSwaps(2, [{ o: 'started', f: 'empezar' }], words)[0]?.f).toBe('empezar');
  expect(glossMatches('starting', 'to start')).toBe(true);
});

test('local feedback is deduplicated daily and capped without retaining page text', async () => {
  const store = memoryStorage();
  await queueEvents(store, [{ word: 'Y', kind: 'seen' }, { word: 'y', kind: 'seen' },
    { word: 'y', kind: 'peek' }, { word: 'y', kind: 'peek' }], '2026-10-17');
  expect(await shownToday(store, '2026-10-17')).toEqual(['y']);
  expect((await store.get([PENDING_KEY]))[PENDING_KEY]).toHaveLength(2);
  await queueEvents(store, Array.from({ length: 510 }, () => ({ word: 'pero', kind: 'flip' })), '2026-10-18');
  const events = (await store.get([PENDING_KEY]))[PENDING_KEY];
  expect(events).toHaveLength(500);
  expect(events[0]).toEqual({ word: 'pero', kind: 'flip', day: '2026-10-18' });
  expect(await shownToday(store, '2026-10-17')).toEqual([]);
  await queueEvents(store, [{ word: 'y', kind: 'seen' }], '2026-10-18');
  expect(await shownToday(store, '2026-10-18')).toEqual(['y']);
});

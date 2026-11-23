import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateSwaps, glossMatches, normalizeFr } from '../src/levels.js';
import { queueEvents, shownToday, PENDING_KEY, SENT_KEY, READING_DAYS_KEY } from '../src/events.js';
import { memoryStorage } from '../src/cache.js';
import { relativeImports } from '../scripts/package.mjs';

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
});

test.each([
  ['hola', 'his', 'A traveler dropped his gloves outside the station.', 'hi', 'A traveler said hi after boarding.'],
  ['nuevo', 'news', 'We heard the news over breakfast.', 'new', 'Her bicycle still looks new after the trip.'],
  ['incluso', 'evening', 'They stayed until evening to watch the birds.', 'Even', 'Even the quiet guests laughed at the joke.'],
  ['como', 'likes', 'My cousin likes riding past the orchard.', 'as', 'We worked as guides during the summer.'],
  ['por favor', 'pleased', 'She looked pleased with the arrangement.', 'Please', 'Please leave the parcels beside the bench.'],
  ['gratis', 'freed', 'The gardener freed a moth from the curtain.', 'free', 'Admission is free until the end of August.'],
  ['rápido', 'fasting', 'The visitors began fasting before the festival.', 'fast', 'The train felt fast on the open plain.'],
  ['también', 'toos', 'The editor crossed out two repeated toos.', 'too', 'She came too after the concert.'],
  ['otro', 'others', 'The others followed the lights through the fog.', 'another', 'We heard another owl after midnight.'],
])('%s keeps the gloss or synonym and rejects a misleading suffix surface', (f, bad, negative, good, positive) => {
  expect(validateSwaps(2, [{ o: bad, f }], undefined, 'es', { text: negative })).toEqual([]);
  expect(validateSwaps(2, [{ o: good, f }], undefined, 'es', { text: positive })).toMatchObject([{ o: good }]);
});

test('fork identity and permissions cannot collide with or contact the French companion', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  // The name is a chrome.i18n message; the default locale must resolve it to the fork's own name.
  expect(manifest.name).toBe('__MSG_ext_name__');
  const messages = JSON.parse(readFileSync(new URL(`../_locales/${manifest.default_locale}/messages.json`, import.meta.url), 'utf8'));
  expect(messages.ext_name.message).toBe('Lang Weave');
  // Lang Weave pins its own public key (0.12.0): one ID across paths and hosts, distinct from French Weave.
  // Chrome's ID is the first 128 bits of sha256(DER public key), each hex digit mapped 0-f to a-p.
  const der = Buffer.from(manifest.key, 'base64');
  expect(der.toString('base64')).toBe(manifest.key); // Buffer ignores junk; demand canonical base64
  const digest = createHash('sha256').update(der).digest('hex').slice(0, 32);
  const id = [...digest].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
  expect(id).toBe('lkbkmlgogcpcacjmdmoecgacdbfddbnh');
  expect(manifest.permissions).not.toContain('nativeMessaging');
  expect(manifest.background.service_worker).toBe('src/background.js');
  // The worker is background.js plus its static imports; scan all of it, not just the entry file.
  // The hostsource check covers the files that were background.js before the split.
  const WORKER_FILES = ['background.js', 'router.js', 'worker-context.js', 'review-state.js', 'gradual-budgets.js',
    'reading.js', 'review-handlers.js', 'inline-recall.js', 'update.js', 'settings-handlers.js',
    'capture-handlers.js', 'backup-handlers.js', 'sites.js'];
  const seen = new Set();
  // Paths are relative to src/; the package script's scanner ignores comments and literal text.
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const source = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
    expect([name, source.includes('sendNativeMessage')]).toEqual([name, false]);
    for (const specifier of relativeImports(source)) {
      const next = new URL(specifier, `file:///src/${name}`).pathname;
      expect([name, specifier, next.startsWith('/src/')]).toEqual([name, specifier, true]);
      if (WORKER_FILES.includes(name)) expect([name, specifier, next]).not.toEqual([name, specifier, '/src/hostsource.js']);
      visit(next.slice('/src/'.length));
    }
  };
  visit('background.js');
  expect(WORKER_FILES.filter((name) => !seen.has(name))).toEqual([]);
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
  await queueEvents(store, [{ word: 'personal:es:00000000-0000-4000-8000-000000000001', kind: 'seen' },
    { word: 'personal:es:00000000-0000-4000-8000-000000000002', kind: 'peek' }], '2026-10-18');
  expect(await shownToday(store, '2026-10-18')).toEqual(['y', 'personal:es:00000000-0000-4000-8000-000000000001']);
});

test('reading dates share the event write, survive queue eviction and keep the most recent 30 observations', async () => {
  const store = memoryStorage({ [READING_DAYS_KEY]: { malformed: true }, [SENT_KEY]: { day: '2026-10-01', words: 42 },
    [PENDING_KEY]: [{ word: 'y', kind: 'seen', day: '2026-09-30' }, { word: 'outside', kind: 'seen', day: '2026-09-29' }] });
  const writes = [];
  const tracked = { ...store, async set(patch) { writes.push(patch); await store.set(patch); } };
  const flip = { word: 'y', kind: 'flip' }, seen = { word: 'y', kind: 'seen' };
  expect(await queueEvents(tracked, [seen], '2026-10-01', { wordIds: ['y'], canWrite: () => false })).toBeNull();
  expect(writes).toHaveLength(0);
  expect((await store.get([PENDING_KEY]))[PENDING_KEY]).toHaveLength(2);
  await queueEvents(tracked, [seen, seen], '2026-10-01', { wordIds: ['y'] });
  expect(writes).toHaveLength(1);
  expect(writes[0][READING_DAYS_KEY]).toEqual(['2026-09-30', '2026-10-01']);
  expect(writes[0][PENDING_KEY].slice(-1)).toEqual([{ word: 'y', kind: 'seen', day: '2026-10-01' }]);
  await queueEvents(tracked, Array.from({ length: 510 }, () => flip), '2026-10-02');
  expect((await store.getAll())[PENDING_KEY].every((event) => event.kind === 'flip')).toBe(true);
  expect((await store.getAll())[READING_DAYS_KEY]).toEqual(['2026-09-30', '2026-10-01']);
  for (let i = 2; i <= 31; i++) await queueEvents(tracked, [seen], `2026-10-${String(i).padStart(2, '0')}`);
  expect((await store.getAll())[READING_DAYS_KEY]).toHaveLength(30);
  expect((await store.getAll())[READING_DAYS_KEY][0]).toBe('2026-10-02');
  await queueEvents(tracked, [seen], '2026-10-01'); // clock rolled back to an evicted day
  expect((await store.getAll())[READING_DAYS_KEY]).toHaveLength(30);
  expect((await store.getAll())[READING_DAYS_KEY].at(-1)).toBe('2026-10-01');
  expect((await store.getAll())[READING_DAYS_KEY]).toContain('2026-10-31');
});

test('older accepted dates survive event eviction even when the scope already has reading dates', async () => {
  const store = memoryStorage({ [READING_DAYS_KEY]: ['2026-10-15'],
    [PENDING_KEY]: [{ word: 'y', kind: 'seen', day: '2026-10-18' }] });
  await queueEvents(store, Array.from({ length: 500 }, () => ({ word: 'y', kind: 'flip' })), '2026-10-20', { wordIds: ['y'] });
  const data = await store.getAll();
  expect(data[PENDING_KEY].some((event) => event.kind === 'seen')).toBe(false);
  expect(data[READING_DAYS_KEY]).toEqual(['2026-10-15', '2026-10-18']);
});

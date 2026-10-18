import { test, expect } from 'bun:test';
import { languageCode, cleanPack, cleanPacks, generatePack, packWords } from '../src/languages.js';
import { validateSwaps } from '../src/levels.js';
import { scopedStorage } from '../src/scope.js';
import { memoryStorage } from '../src/cache.js';
import { queueEvents, shownToday } from '../src/events.js';

const fixture = (target) => ({ words: Array.from({ length: 24 }, (_, i) => ({
  fr: `${target}${i}`, en: `gloss ${i}`, hint: `sound ${i}`, level: i < 12 ? 1 : 2,
})) });

test('language codes and generated packs are bounded, normalized, and reject malformed data', () => {
  expect(languageCode('fr')).toBe('fr');
  expect(languageCode('ja')).toBe('ja');
  for (const value of ['en', 'es', 'x', 'fr<script>', 'ja\nignore', 'this-is-not-a-language']) expect(languageCode(value)).toBeNull();
  const fr = cleanPack(fixture('mot'), 'fr');
  const ja = cleanPack(fixture('語'), 'ja');
  expect(fr.words).toHaveLength(24);
  expect(packWords(fr, 1)).toHaveLength(12);
  expect(packWords(ja, 2)[0].fr).toBe('語0');
  expect(cleanPack({ ...fr, version: 'tampered' }, 'fr')).toBeNull();
  expect(cleanPack({ words: [...fixture('mot').words, fixture('mot').words[0]] }, 'fr')).toBeNull();
  expect(cleanPack({ words: fixture('mot').words.map((w, i) => i ? w : { ...w, en: '<script>' }) }, 'fr')).toBeNull();
  expect(cleanPack({ words: fixture('mot').words.slice(0, 19) }, 'fr')).toBeNull();
  expect(cleanPacks({ fr, ja, invalid: { words: [] } })).toEqual({ fr, ja });
});

test('Latin and non-Latin packs require exact target forms and matching English glosses', () => {
  const fr = [{ fr: 'café', en: 'coffee', hint: 'kah FAY' }];
  const ja = [{ fr: '猫', en: 'cat', hint: 'neko' }];
  expect(validateSwaps(1, [{ o: 'coffee', f: 'café' }], fr, 'fr')[0].f).toBe('café');
  expect(validateSwaps(1, [{ o: 'coffee', f: 'cafe' }], fr, 'fr')).toEqual([]);
  expect(validateSwaps(1, [{ o: 'cat', f: '猫' }], ja, 'ja')[0].f).toBe('猫');
  expect(validateSwaps(1, [{ o: 'dog', f: '猫' }], ja, 'ja')).toEqual([]);
  expect(validateSwaps(1, [{ o: 'cats', f: '猫' }], ja, 'ja')).toEqual([]);
});

test('pack generation sends only an explicit code and validates synthetic model output', async () => {
  const calls = [];
  const response = (words) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ words }) }] } }] }) });
  const pack = await generatePack({ code: 'ja', apiKey: 'synthetic-key', model: 'gemini-3.5-flash-lite',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return response(fixture('語').words); } });
  expect(pack.words).toHaveLength(24);
  expect(calls[0].init.headers['x-goog-api-key']).toBe('synthetic-key');
  expect(JSON.parse(calls[0].init.body).contents[0].parts[0].text).toBe('{"targetLanguage":"ja","sourceLanguage":"en"}');
  await expect(generatePack({ code: 'fr', apiKey: 'synthetic-key', model: 'gemini-3.5-flash-lite',
    fetchImpl: async () => response(fixture('mot').words.slice(0, 5)) })).rejects.toThrow(/validation/);
});

test('legacy Spanish events survive while matching words in other packs remain isolated', async () => {
  const storage = memoryStorage();
  const spanish = scopedStorage(storage, 'es');
  const french = scopedStorage(storage, 'fr:v1');
  const japanese = scopedStorage(storage, 'ja:v1');
  await queueEvents(spanish, [{ word: 'no', kind: 'seen' }], '2026-10-18');
  await queueEvents(french, [{ word: 'no', kind: 'seen' }], '2026-10-18');
  expect(await shownToday(spanish, '2026-10-18')).toEqual(['no']);
  expect(await shownToday(french, '2026-10-18')).toEqual(['no']);
  expect(await shownToday(japanese, '2026-10-18')).toEqual([]);
  const all = await storage.getAll();
  expect(all.readingEvents).toHaveLength(1);
  expect(all['lang:fr:v1:readingEvents']).toHaveLength(1);
  expect(all['lang:ja:v1:readingEvents']).toBeUndefined();
});

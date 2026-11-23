import { expect, test } from 'bun:test';
import { selectWorkingSet } from '../src/adaptive.js';
import { createCache, memoryStorage } from '../src/cache.js';
import { entryId } from '../src/catalog.js';
import { requestSwaps } from '../src/engine.js';
import { GUARANI_STARTER } from '../src/language-name.js';
import { GUARANI_PACK } from '../src/guarani.js';
import { hashKey } from '../src/hash.js';
import { cleanPack, packWords } from '../src/languages.js';
import { assertPackAnchors, validateSwaps } from '../src/levels.js';
import { paragraphMatches } from '../src/paragraph-matches.js';
import { cleanReview } from '../src/review.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { createContext } from '../src/worker-context.js';
import { validPackForm } from '../src/word-form.js';
import { createBackup, learningPatch, parseBackup } from '../src/portability.js';

const ID = 'fw-guarani';
const BASE = `chrome-extension://${ID}/`;
const sender = (page) => ({ id: ID, url: `${BASE}src/${page}.html` });
const starterScope = `${GUARANI_STARTER}:${GUARANI_PACK.version}`;
const storageKey = (scope, suffix) => `lang:${scope}:${suffix}`;
const legacyScope = 'gn-PY-x-weave:0000000000000001';
const legacyWords = [
  ['y', 'water', 1], ['yvoty', 'flower', 1], ['kuarahy', 'sun', 1],
  ['jasy', 'moon', 1], ['ama', 'rain', 1], ['yvytu', 'wind', 1],
  ['panambi', 'butterfly', 1], ['yva', 'fruit', 1], ['yvyra', 'tree', 1],
  ['mainumby', 'hummingbird', 2], ['ysapy', 'dew', 2], ['ysyry', 'stream', 2],
  ['ytororõ', 'waterfall', 2], ['jasyrendy', 'moonlight', 2],
].map(([fr, en, level]) => ({ fr, en, level, hint: '' }));

const homeSchoolWords = [
  ['óga', 'house (dwelling)'], ['koty', 'room (indoors)'], ['apyka', 'chair (seat)'], ['tupa', 'bed (for sleeping)'],
  ['mbo’ehao', 'school (for students)'], ['mbo’ehára', 'teacher (at school)'],
  ['aranduka', 'book (printed volume)'], ['kuatia', 'paper (writing material)'],
].map(([fr, en]) => ({ fr, en, level: 1, hint: '' }));
const proseWords = [
  ['ára', 'day (calendar day)'], ['pyhare', 'night (after dark)'], ['okẽ', 'door (movable barrier)'],
  ['tata', 'fire (something burning)'], ['ita', 'stone (piece of rock)'], ['tape', 'road (route for travel)'],
].map(([fr, en]) => ({ fr, en, level: 1, hint: '' }));

test('all previous Guaraní rows and their stable IDs survive, with six Beginner rows appended', () => {
  const previousWords = [...legacyWords, ...homeSchoolWords];
  expect(starterScope).toBe(legacyScope);
  expect(GUARANI_PACK.words).toEqual([...previousWords, ...proseWords]);
  expect(packWords(GUARANI_PACK, 1)).toEqual([...previousWords.filter((word) => word.level === 1), ...proseWords]);
  expect(packWords(GUARANI_PACK, 2)).toHaveLength(28);
  expect(entryId(starterScope, { fr: 'ytororõ' })).toBe('gn-PY-x-weave:0000000000000001:legacy:ytoror%C3%B5');
  expect(() => assertPackAnchors(GUARANI_PACK.words)).not.toThrow();
});

test.each([1, 2])('Guaraní tier %i omits plainly verbal uses and preserves the matching nouns', (level) => {
  const words = packWords(GUARANI_PACK, level);
  const choices = (text) => paragraphMatches(text, GUARANI_STARTER, level).flatMap(({ senses }) => senses);
  for (const [o, f, negative, positive] of [
    ['book', 'aranduka', 'Please book a room near the station.', 'She read a book beside the window.'],
    ['chair', 'apyka', 'We will chair the discussion after lunch.', 'We carried a chair into the kitchen.'],
    ['water', 'y', 'The caretaker has to water the garden today.', 'The school needs access to water from the well.'],
    ['wind', 'yvytu', 'I need to wind the clock before bed.', 'We listened to wind through the shutters.'],
    ['fire', 'tata', 'They hope to fire the manager next week.', 'The travelers gathered beside the fire.'],
  ]) {
    const proposal = [{ o, f }];
    expect(choices(negative).map(({ word }) => word)).not.toContain(f);
    expect(validateSwaps(level, proposal, words, GUARANI_STARTER, { text: negative })).toEqual([]);
    expect(choices(positive)).toContainEqual(expect.objectContaining({ o, word: f }));
    expect(validateSwaps(level, proposal, words, GUARANI_STARTER, { text: positive })).toMatchObject([{ o, word: f }]);
  }
});

test('manual Guaraní keeps repeated noun occurrences, including dialogue, at their exact offsets', () => {
  const text = 'I read the book that told me how to book a room. She said, “Please, book it today.” He read the book again.';
  const target = 'aranduka';
  const offsets = paragraphMatches(text, GUARANI_STARTER, 1)
    .filter(({ senses }) => senses.some(({ word }) => word === target)).map(({ start }) => start);
  expect(offsets).toEqual([text.indexOf('book'), text.lastIndexOf('book')]);
  expect(paragraphMatches('He said, “Water tastes better here.”', GUARANI_STARTER, 1).flatMap(({ senses }) => senses))
    .toContainEqual(expect.objectContaining({ o: 'Water', word: 'y' }));
});

test('Guaraní recognizes bounded cues without interpreting every prepositional noun or unmarked homograph', () => {
  const offers = (text, target) => paragraphMatches(text, GUARANI_STARTER, 2)
    .some(({ senses }) => senses.some(({ word }) => word === target));
  for (const text of [
    'We’ll book a room on the second floor.', 'We should not book a room this far away.',
    'Could you book a room for my aunt?', 'Did you book a room on this side of town?',
  ]) expect(offers(text, 'aranduka')).toBe(false);
  for (const [text, word] of [
    ['They brought hope to fire survivors.', 'tata'],
    ['They were used to water from the mountain spring.', 'y'],
    ['She argued for the right to water and shelter.', 'y'],
    ['We carried water for the trip.', 'y'],
  ]) expect(offers(text, word)).toBe(true);
  expect(offers('Wind the clock before leaving.', 'yvytu')).toBe(true); // An unmarked imperative remains ambiguous to the matcher.
  expect(offers('They wrote about what people can\nBook fairs returned in spring.', 'aranduka')).toBe(true);
});

test.each([1, 2])('Guaraní tier %i validates ordinary and gradual replies at the located occurrence', async (level) => {
  const text = 'The book described how to book a room near the station.';
  const batch = [{ id: 'passage', text }];
  const catalog = packWords(GUARANI_PACK, level);
  const keep = { o: 'book', f: 'aranduka', ctx: 'The book described' };
  const refuse = { ...keep, ctx: 'how to book a room' };
  const day = '2026-11-23';
  const now = Date.parse(`${day}T12:00:00Z`);
  for (const gradual of [false, true]) {
    const words = gradual ? selectWorkingSet({ batch, words: catalog, scope: starterScope, language: GUARANI_STARTER,
      state: cleanReview(null, catalog, now, true), settings: { gradual: true, newWordsPerDay: 5 }, now, day, level }) :
      catalog.map((word) => ({ ...word, status: 'active' }));
    const result = await requestSwaps({ model: DEFAULT_SETTINGS.model, apiKey: 'synthetic-test', batch, level,
      words, language: GUARANI_STARTER, unknownLimit: gradual, fetchImpl: async (_url, { body }) => {
        expect(JSON.parse(body).systemInstruction.parts[0].text).toContain('"target":"aranduka"');
        const passages = [{ id: 'passage', swaps: [refuse, keep] }];
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] });
      } });
    expect(result.results.passage).toHaveLength(1);
    expect(result.results.passage).toMatchObject([keep]);
  }
});

test('generated Guaraní and a distinct personal sense keep their existing anchor rules', () => {
  const text = 'We should book a room near the station.';
  const f = 'aranduka';
  for (const language of ['gn', 'gn-PY']) {
    expect(validateSwaps(1, [{ o: 'book', f }], [{ fr: f, en: 'book', hint: '' }], language, { text }))
      .toMatchObject([{ o: 'book', f }]);
  }
  const personal = { fr: 'fixture', en: 'book (reserve)', anchors: ['book'], hint: '' };
  expect(validateSwaps(1, [{ o: 'book', f: personal.fr }], [personal], GUARANI_STARTER, { text }))
    .toMatchObject([{ o: 'book', f: personal.fr }]);
});

test('a new manifest version bypasses an old starter cache entry while keeping the history scope', async () => {
  const previous = globalThis.chrome;
  let version = '0.15.9';
  globalThis.chrome = { runtime: { getManifest: () => ({ version }) }, permissions: { getAll: async () => ({ origins: [] }) } };
  try {
    const store = memoryStorage({ settings: { language: GUARANI_STARTER, levelOverride: 2 }, epoch: 'fixture' });
    const { context } = createContext({ store, ready: Promise.resolve(), worker: { keyIsolationUnavailable: false } });
    const cache = createCache(store);
    const before = await context();
    const text = 'The visitor should book a room near the station.';
    const passage = hashKey(text);
    const stale = [{ o: 'book', f: 'aranduka', word: 'aranduka', g: 'book (printed volume)', h: '', ctx: '' }];
    const oldKey = `${before.revision}:${passage}`;
    await cache.setMany({ [oldKey]: stale });
    version = '0.15.12';
    const after = await context();
    expect(after.scope).toBe(before.scope);
    expect(after.words).toEqual(before.words);
    expect(after.revision).not.toBe(before.revision);
    expect(await cache.getMany([`${after.revision}:${passage}`])).toEqual({});
    expect(await cache.getMany([oldKey])).toEqual({ [oldKey]: stale });
  } finally { globalThis.chrome = previous; }
});

test('everyday passages that had no candidates now reach home and school words through the gradual selector', () => {
  const day = '2026-11-22';
  const now = Date.parse(`${day}T12:00:00Z`);
  const samples = [
    {
      text: 'At the house I rented last week, I carried a chair into the spare room and moved the bed away from the radiator.',
      forms: ['óga', 'apyka', 'koty', 'tupa'],
    },
    {
      text: 'I arrived early at the school and helped the teacher set out a book and a fresh sheet of paper for each desk.',
      forms: ['mbo’ehao', 'mbo’ehára', 'aranduka', 'kuatia'],
    },
    {
      // Lewis Carroll, Alice's Adventures in Wonderland, chapter I.
      // https://www.gutenberg.org/files/11/11-h/11-h.htm
      text: 'once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it',
      forms: ['aranduka'],
    },
  ];
  for (const { text, forms } of samples) for (const level of [1, 2]) {
    const select = (words) => selectWorkingSet({
      batch: [{ id: 'sample', text }], words, scope: starterScope, state: cleanReview(null, words, now, true),
      settings: { gradual: true, newWordsPerDay: 5 }, now, day, revision: 'fixture', language: GUARANI_STARTER, level,
    });
    expect(select(packWords({ words: legacyWords }, level))).toEqual([]);
    const candidates = select(packWords(GUARANI_PACK, level));
    expect(candidates.map(({ fr }) => fr).sort()).toEqual([...forms].sort());
    expect(candidates.every((word) => word.status === 'new' && word.entryId === entryId(legacyScope, word))).toBe(true);
  }
});

test('prior starter backups restore old Guaraní card, event, encounter and retrieval IDs and keep reading dates', () => {
  const day = '2026-11-22';
  const reviewedAt = Date.parse(`${day}T12:00:00Z`);
  const oldId = 'gn-PY-x-weave:0000000000000001:legacy:ytoror%C3%B5';
  const scope = 'lang:gn-PY-x-weave:0000000000000001';
  const fields = {
    review: { version: 1, cards: { ytororõ: { due: reviewedAt + 86400000, interval: 1, reviews: 2 } },
      learning: { day, count: 1 } },
    events: [{ word: 'ytororõ', kind: 'seen', day }],
    encounters: { version: 1, day, bucket: Math.floor(reviewedAt / (7 * 86400000)),
      counts: { [oldId]: 2 }, touched: [oldId] },
    retrievals: { version: 1, retrievals: [['ytororõ', reviewedAt, 'standalone', 'productive', 'medium', 1, 2000, 1, 1, 0.9]] },
  };
  // Literal scope and IDs pin the pre-addition backup contract independently of the current pack.
  const snapshots = [
    { schemaVersion: 2, exportedByVersion: '0.13.1', history: fields },
    { schemaVersion: 3, exportedByVersion: '0.14.1', history: { ...fields, readingDays: [day] } },
  ];
  for (const { schemaVersion, exportedByVersion, history } of snapshots) {
    const backup = parseBackup(JSON.stringify({
      format: 'lang-weave-learning-backup', schemaVersion, exportedByVersion,
      state: {
        preferences: { language: 'gn-PY-x-weave', levelOverride: 2, gradual: true, newWordsPerDay: 5,
          density: 'normal', inlineRecall: false },
        packs: {}, personal: { version: 1, revision: 0, entries: [], history: {} },
        scopes: { [scope]: history },
      },
    }));
    const restored = learningPatch(backup, {});
    expect(restored.settings.language).toBe(GUARANI_STARTER);
    expect(cleanReview(restored[`${scope}:recallReview`], GUARANI_PACK.words, reviewedAt, true).cards.ytororõ)
      .toEqual(history.review.cards.ytororõ);
    expect(restored[`${scope}:vocabularyEncounters`]).toEqual(history.encounters);
    expect(restored[`${scope}:readingDaysV1`]).toEqual(history.readingDays);
    const again = parseBackup(createBackup(restored, '0.14.2'));
    expect(again.schemaVersion).toBe(schemaVersion);
    expect(again.state.scopes[scope]).toEqual(history);
    expect(again.omitted).toEqual({ retrievals: 0, exposures: 0 });
  }
});

test('the starter is selectable without a key and its reviews round trip alongside earlier Guaraní packs', async () => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  // Both spellings of the generated locale can coexist with the starter, even
  // when a generated target form is also present in the bundled catalog.
  const generatedWords = Array.from({ length: 20 }, (_, i) => ({
    fr: i === 0 ? 'y' : `sample${i}`, en: i === 0 ? 'water' : `gloss ${i}`,
    hint: 'sample', level: i < 10 ? 1 : 2,
  }));
  const gn = cleanPack({ words: generatedWords }, 'gn');
  const gnPY = cleanPack({ words: generatedWords }, 'gn-PY');
  const generatedHistory = { version: 1, cards: { y: { due: 1000, interval: 1, reviews: 2 } },
    learning: { day: '', count: 0 } };
  const uuid = '7f82ab19-ee4a-4d7c-9eee-6235c0873101';
  const personalId = `personal:${GUARANI_STARTER}:${uuid}`;
  const data = {
    settings: { language: 'gn', levelOverride: 1 },
    languagePacks: { gn, 'gn-PY': gnPY },
    personalVocabularyV1: { version: 1, revision: 1, history: {}, entries: [{
      uuid, id: personalId, language: GUARANI_STARTER, source: 'hill', target: 'yvyty', sense: 'hill',
      direction: 'en-to-target', provenance: 'manual', createdAt: 1, archived: false,
    }] },
    [storageKey(`gn:${gn.version}`, 'recallReview')]: structuredClone(generatedHistory),
    [storageKey(`gn-PY:${gnPY.version}`, 'recallReview')]: structuredClone(generatedHistory),
  };
  const listeners = [];
  const event = (list = []) => ({ addListener: (fn) => list.push(fn) });
  globalThis.chrome = {
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) {
        const selected = keys == null ? Object.keys(data) : [keys].flat();
        return structuredClone(Object.fromEntries(selected.filter((key) => key in data).map((key) => [key, data[key]])));
      },
      async set(patch) { Object.assign(data, structuredClone(patch)); },
      async remove(keys) { for (const key of [keys].flat()) delete data[key]; },
    } },
    runtime: { id: ID, getURL: (path) => BASE + path, getManifest: () => ({ version: '0.12.27' }),
      getContexts: async () => [{ tabId: 1, windowId: 1, documentId: 'review' }],
      onMessage: event(listeners), onInstalled: event(), onStartup: event(), onConnect: event() },
    tabs: { query: async () => [], get: async () => ({ id: 1, windowId: 1, status: 'complete', active: true }),
      sendMessage: async () => ({ ok: true }) },
    windows: { getLastFocused: async () => ({ id: 1 }), update: async () => {} },
    alarms: { create: async () => {}, onAlarm: event() },
    permissions: { getAll: async () => ({ origins: [] }), onAdded: event(), onRemoved: event() },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {},
      updateContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  };
  const network = [];
  globalThis.fetch = async (url) => {
    if (String(url).startsWith(BASE)) return Response.json({ version: '0.12.27' });
    network.push(String(url));
    throw new Error('Unexpected network call');
  };
  const dispatch = (page, message) => new Promise((resolve) => {
    if (!listeners.some((fn) => fn(message, sender(page), resolve))) resolve(undefined);
  });

  try {
    await import('../src/background.js?guarani');
    const status = await dispatch('options', { type: 'status' });
    expect(status.config.language).toBe('gn');
    expect(status.config.scope).toBe(`gn:${gn.version}`);
    expect(status.languages).toEqual([
      { code: 'es', name: 'Spanish', experimental: false },
      { code: GUARANI_STARTER, name: 'Paraguayan Guaraní', experimental: false },
      { code: 'gn', name: expect.any(String), experimental: true },
      { code: 'gn-PY', name: expect.any(String), experimental: true },
    ]);
    const select = (language, levelOverride = 1) =>
      dispatch('options', { type: 'save', settings: { language, levelOverride } });
    expect((await select('gn-PY')).ok).toBe(true);
    expect((await dispatch('options', { type: 'status' })).config.scope).toBe(`gn-PY:${gnPY.version}`);
    expect((await select(GUARANI_STARTER, 2)).ok).toBe(true);
    const expanded = await dispatch('words', { type: 'wordsList' });
    expect(expanded.scope).toBe(starterScope);
    expect(expanded.rows.filter(({ kind }) => kind === 'pack')).toHaveLength(28);
    expect(expanded.rows.find(({ target }) => target === 'ytororõ')).toMatchObject({ gloss: 'waterfall', practise: true });
    expect(await dispatch('words', { type: 'wordPractice', id: 'ytororõ', scope: starterScope }))
      .toMatchObject({ ok: true });

    const { card } = await dispatch('review', { type: 'reviewNext' });
    expect(card.en).toBe('waterfall');
    expect((await dispatch('review', { type: 'reviewReveal', ticket: card.ticket })).answer.fr).toBe('ytororõ');
    expect((await dispatch('review', { type: 'reviewRate', ticket: card.ticket, rating: 'medium' })).ok).toBe(true);
    expect((await select(GUARANI_STARTER)).ok).toBe(true);
    expect(await dispatch('review', { type: 'reviewStatus' }))
      .toMatchObject({ language: 'Paraguayan Guaraní', new: 23 });
    expect((await dispatch('words', { type: 'wordsList' })).rows.find(({ target }) => target === 'ytororõ'))
      .toMatchObject({ reviews: 1, practise: false });

    expect(await dispatch('words', { type: 'wordPractice', id: personalId, scope: starterScope }))
      .toMatchObject({ ok: true });
    const personal = (await dispatch('review', { type: 'reviewNext' })).card;
    expect(personal.en).toBe('hill');
    expect((await dispatch('review', { type: 'reviewReveal', ticket: personal.ticket })).answer.fr).toBe('yvyty');
    expect((await dispatch('review', { type: 'reviewRate', ticket: personal.ticket, rating: 'medium' })).ok).toBe(true);

    const backup = parseBackup(createBackup(data, '0.12.27'));
    expect(backup.state.preferences.language).toBe(GUARANI_STARTER);
    expect(backup.state.packs).toEqual({ gn, 'gn-PY': gnPY });
    expect(backup.state.scopes[`lang:${starterScope}`].retrievals.retrievals[0][0]).toBe('ytororõ');
    expect(backup.state.scopes[`personal:${GUARANI_STARTER}`].retrievals.retrievals[0][0]).toBe(personalId);
    const restored = learningPatch(backup, {});
    expect(restored[storageKey(starterScope, 'recallReview')].cards.ytororõ.reviews).toBe(1);
    expect(restored[storageKey(`gn:${gn.version}`, 'recallReview')]).toEqual(generatedHistory);
    expect(restored[storageKey(`gn-PY:${gnPY.version}`, 'recallReview')]).toEqual(generatedHistory);
    expect((await dispatch('words', { type: 'wordsList' })).rows.find(({ target }) => target === 'mbo’ehára'))
      .toMatchObject({ id: 'mbo’ehára', gloss: 'teacher (at school)', practise: true });
    expect(await dispatch('words', { type: 'wordPractice', id: 'mbo’ehára', scope: legacyScope })).toMatchObject({ ok: true });
    const teacher = (await dispatch('review', { type: 'reviewNext' })).card;
    expect(teacher.en).toBe('teacher (at school)');
    expect((await dispatch('review', { type: 'reviewReveal', ticket: teacher.ticket })).answer.fr).toBe('mbo’ehára');
    expect((await dispatch('review', { type: 'reviewRate', ticket: teacher.ticket, rating: 'medium' })).ok).toBe(true);
    const updated = learningPatch(parseBackup(createBackup(data, '0.14.2')), {});
    expect(updated[storageKey(legacyScope, 'recallReview')].cards['mbo’ehára'].reviews).toBe(1);
    expect(updated[storageKey(legacyScope, 'recallReview')].cards.ytororõ.reviews).toBe(1);
    const bundledKey = storageKey(starterScope, 'recallReview');
    const bundledHistory = structuredClone(data[bundledKey]);
    expect((await dispatch('options', { type: 'removeLanguage', code: GUARANI_STARTER })).error).toBeTruthy();
    expect(data[bundledKey]).toEqual(bundledHistory);
    expect((await select('gn-PY')).ok).toBe(true);
    expect((await dispatch('options', { type: 'removeLanguage', code: 'gn-PY' })).ok).toBe(true);
    expect(data[storageKey(`gn-PY:${gnPY.version}`, 'recallReview')]).toBeUndefined();
    expect(data[storageKey(`gn:${gn.version}`, 'recallReview')]).toEqual(generatedHistory);
    expect(data[bundledKey]).toEqual(bundledHistory);
    expect((await select('es')).ok).toBe(true);
    expect(await dispatch('review', { type: 'reviewStatus' })).toMatchObject({ language: 'Spanish', new: 48 });
    expect(await dispatch('words', { type: 'wordPractice', id: 'el suéter', scope: 'es' }))
      .toMatchObject({ ok: true });
    const sweater = (await dispatch('review', { type: 'reviewNext' })).card;
    expect(sweater.en).toBe('the sweater');
    expect((await dispatch('review', { type: 'reviewReveal', ticket: sweater.ticket })).answer.fr).toBe('el suéter');
    expect((await dispatch('review', { type: 'reviewRate', ticket: sweater.ticket, rating: 'medium' })).ok).toBe(true);
    const spanishBackup = parseBackup(createBackup(data, '0.12.27'));
    expect(learningPatch(spanishBackup, {}).recallReview.cards['el suéter'].reviews).toBe(1);
    expect(network).toEqual([]);
  } finally {
    Object.assign(globalThis, original);
  }
});

test('reading validation keeps the listed Guaraní diacritics and rejects unlisted forms and glosses', () => {
  expect(new Set(GUARANI_PACK.words.map(({ fr }) => fr)).size).toBe(GUARANI_PACK.words.length);
  expect(new Set(GUARANI_PACK.words.map(({ en }) => en)).size).toBe(GUARANI_PACK.words.length);
  expect(GUARANI_PACK.words.every(({ fr }) => validPackForm(fr) && fr.normalize('NFC') === fr)).toBe(true);
  const validate = (o, f) => validateSwaps(2, [{ o, f, g: 'invented gloss', h: 'invented pronunciation' }],
    GUARANI_PACK.words, GUARANI_STARTER);
  expect(validate('waterfall', 'ytororõ'.normalize('NFD'))).toMatchObject([
    { o: 'waterfall', f: 'ytororõ', g: 'waterfall', h: '' },
  ]);
  expect(validate('waterfall', 'ytororo')).toEqual([]);
  expect(validate('fountain', 'ytororõ')).toEqual([]);
  expect(validate('teacher', 'mbo’ehára'.normalize('NFD'))).toMatchObject([
    { o: 'teacher', f: 'mbo’ehára', g: 'teacher (at school)', h: '' },
  ]);
  expect(validate('teacher', 'mbo’ehara')).toEqual([]);
  expect(validate('teacher', "mbo'ehára")).toEqual([]);
  expect(validate('instructor', 'mbo’ehára')).toEqual([]);
  for (const { fr, en } of proseWords) {
    const [source] = en.split(' ');
    expect(validate(source, fr.normalize('NFD'))).toMatchObject([{ o: source, f: fr, g: en }]);
  }
  for (const form of ['oke', 'rokẽ', 'hokẽ']) expect(validate('door', form)).toEqual([]);
  for (const form of ['rata', 'hata']) expect(validate('fire', form)).toEqual([]);
  expect(validate('day', 'ara')).toEqual([]);
  expect(validate('road', 'tata')).toEqual([]);
});

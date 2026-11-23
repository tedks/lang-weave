import { expect, test } from 'bun:test';
import { selectWorkingSet } from '../src/adaptive.js';
import { entryId } from '../src/catalog.js';
import { GUARANI_STARTER } from '../src/language-name.js';
import { GUARANI_PACK } from '../src/guarani.js';
import { cleanPack, packWords } from '../src/languages.js';
import { assertPackAnchors, validateSwaps } from '../src/levels.js';
import { cleanReview } from '../src/review.js';
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

test('the original Guaraní pack is an unchanged prefix with the same scope and level membership', () => {
  expect(starterScope).toBe(legacyScope);
  expect(GUARANI_PACK.words.slice(0, legacyWords.length)).toEqual(legacyWords);
  expect(packWords(GUARANI_PACK, 1).slice(0, 9)).toEqual(legacyWords.filter((word) => word.level === 1));
  expect(packWords(GUARANI_PACK, 1)).toHaveLength(17);
  expect(packWords(GUARANI_PACK, 2)).toHaveLength(22);
  expect(entryId(starterScope, { fr: 'ytororõ' })).toBe('gn-PY-x-weave:0000000000000001:legacy:ytoror%C3%B5');
  expect(() => assertPackAnchors(GUARANI_PACK.words)).not.toThrow();
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

test('a prior starter backup restores exact old Guaraní card, event, encounter and retrieval IDs', () => {
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
  const backup = parseBackup(JSON.stringify({
    format: 'lang-weave-learning-backup', schemaVersion: 2, exportedByVersion: '0.13.1',
    state: {
      preferences: { language: 'gn-PY-x-weave', levelOverride: 2, gradual: true, newWordsPerDay: 5,
        density: 'normal', inlineRecall: false },
      packs: {}, personal: { version: 1, revision: 0, entries: [], history: {} },
      scopes: { [scope]: fields },
    },
  }));
  const restored = learningPatch(backup, {});
  expect(restored.settings.language).toBe(GUARANI_STARTER);
  expect(cleanReview(restored[`${scope}:recallReview`], GUARANI_PACK.words, reviewedAt, true).cards.ytororõ)
    .toEqual(fields.review.cards.ytororõ);
  expect(restored[`${scope}:vocabularyEncounters`]).toEqual(fields.encounters);
  const again = parseBackup(createBackup(restored, '0.14.2'));
  expect(again.state.scopes[scope]).toEqual(fields);
  expect(again.omitted).toEqual({ retrievals: 0, exposures: 0 });
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
      onMessage: event(listeners), onInstalled: event(), onStartup: event(), onConnect: event() },
    tabs: { query: async () => [] },
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
    expect(expanded.rows.filter(({ kind }) => kind === 'pack')).toHaveLength(22);
    expect(expanded.rows.find(({ target }) => target === 'ytororõ')).toMatchObject({ gloss: 'waterfall', practise: true });
    expect(await dispatch('words', { type: 'wordPractice', id: 'ytororõ', scope: starterScope }))
      .toMatchObject({ ok: true });

    const { card } = await dispatch('review', { type: 'reviewNext' });
    expect(card.en).toBe('waterfall');
    expect((await dispatch('review', { type: 'reviewReveal', ticket: card.ticket })).answer.fr).toBe('ytororõ');
    expect((await dispatch('review', { type: 'reviewRate', ticket: card.ticket, rating: 'medium' })).ok).toBe(true);
    expect((await select(GUARANI_STARTER)).ok).toBe(true);
    expect(await dispatch('review', { type: 'reviewStatus' }))
      .toMatchObject({ language: 'Paraguayan Guaraní', new: 17 });
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
    expect(await dispatch('review', { type: 'reviewStatus' })).toMatchObject({ language: 'Spanish', new: 37 });
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
  expect(validate('instructor', 'mbo’ehára')).toEqual([]);
});

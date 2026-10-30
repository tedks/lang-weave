// Backup schemas: this build reads 1 and 2 and writes 2; schema 1 output stays available for
// installations that predate the tolerant reader (0.12.3).
import { test, expect } from 'bun:test';
import { createBackup, parseBackup, learningPatch, targetFresh, backupPreview, BACKUP_SCHEMA, MAX_BACKUP_BYTES,
  LOG_BUDGET_BYTES,
  READ_SCHEMAS } from '../src/portability.js';
import { alreadyImported } from '../src/backup-handlers.js';
import { cleanReview, nextReview, revealReview, rateReview, AGAIN_MS, DAY_MS } from '../src/review.js';
import { cleanSettings, DEFAULT_SETTINGS } from '../src/settings.js';
import { storedFsrs } from '../src/fsrs.js';
import { personalId, baseline } from './backup-fixture.js';
import { wordsForLevel } from '../src/levels.js';
import { hashKey } from '../src/hash.js';

// Storage as a schema 2 writer will leave it: FSRS state on cards, logs in three scopes,
// a desired retention, and one orphan log word that no catalog can verify.
function writerStorage() {
  const { source, version, spanish } = baseline();
  const all = structuredClone(source);
  all.settings.desiredRetention = 0.85;
  all.recallReview.cards[spanish].fsrs = { stability: 1.5, difficulty: 5, lastReview: 1000, lapses: 0 };
  all.recallReview.cards.pero.fsrs = { stability: 9, difficulty: 3, lastReview: 1, lapses: 2 }; // stale
  all.personalVocabularyV1.history.fr.cards[personalId].fsrs = { stability: 0.2, difficulty: 6.4, lastReview: 1000, lapses: 1 };
  const entry = (word, at) => [word, at, 'standalone', 'productive', 'medium', 1, 3000, 2, 3, 0.91];
  all.learningRetrievals = { version: 1, retrievals: [entry(spanish, 10), entry('palabraperdida', 11)] };
  all.learningExposures = { version: 1, words: { [spanish]: [3, 1, 2, '2026-10-01', '2026-10-05'],
    palabraperdida: [1, 0, 1, '2026-10-02', '2026-10-02'] } };
  all[`lang:fr:${version}:learningRetrievals`] = { version: 1, retrievals: [entry('mot0', 12)] };
  all['lang:personal:fr:learningRetrievals'] = { version: 1, retrievals: [entry(personalId, 13)] };
  all['lang:personal:fr:learningExposures'] = { version: 1, words: { [personalId]: [2, 0, 1, '2026-10-03', '2026-10-03'] } };
  return { all, version, spanish };
}
const freshTarget = () => ({ settings: { ...DEFAULT_SETTINGS, siteOverrides: {} } });

test('this build reads schemas 1 and 2 and writes schema 2', () => {
  expect(BACKUP_SCHEMA).toBe(2);
  expect([...READ_SCHEMAS]).toEqual([1, 2]);
});

test('a schema 1 export from writer storage is plain schema 1', () => {
  const { all } = writerStorage();
  const json = createBackup(all, '0.12.3', 1);
  const file = JSON.parse(json);
  expect(file.schemaVersion).toBe(1);
  for (const absent of ['fsrs', 'retrievals', 'exposures', 'desiredRetention', 'learningRetrievals', 'palabraperdida'])
    expect(json).not.toContain(absent);
  expect(parseBackup(json).schemaVersion).toBe(1);
});

test('a schema 2 file round-trips: FSRS state, logs and retention survive import and re-export', () => {
  const { all, version, spanish } = writerStorage();
  const json = createBackup(all, '0.13.0', 2);
  expect(json).not.toContain('palabraperdida'); // ruling B at export: unverified log words are left out
  const parsed = parseBackup(json);
  expect(parsed.schemaVersion).toBe(2);
  const es = parsed.state.scopes.es;
  expect(es.review.cards[spanish].fsrs).toEqual({ stability: 1.5, difficulty: 5, lastReview: 1000, lapses: 0 });
  expect(es.review.cards.pero.fsrs).toBeUndefined(); // stale state is dropped, re-derived later
  expect(parsed.state.personal.history.fr.cards[personalId].fsrs.lapses).toBe(1);
  expect(es.retrievals.retrievals.map(([w]) => w)).toEqual([spanish]);
  expect(Object.keys(es.exposures.words)).toEqual([spanish]);
  expect(parsed.state.preferences.desiredRetention).toBe(0.85);
  // The exporter's own ruling-B omissions travel in the file and reach the preview.
  expect(parsed.state.logOmitted).toEqual({ retrievals: 1, exposureWords: 1 });
  expect(backupPreview(parsed)).toMatchObject({ schemaVersion: 2, retrievals: 3, exposureWords: 2,
    omittedRetrievals: 1, omittedExposureWords: 1 });

  const target = freshTarget();
  expect(targetFresh(target)).toBe(true);
  const imported = { ...target, ...learningPatch(parsed, target.settings) };
  expect(imported.learningRetrievals.retrievals).toHaveLength(1);
  expect(imported[`lang:fr:${version}:learningRetrievals`].retrievals[0][0]).toBe('mot0');
  expect(imported['lang:personal:fr:learningRetrievals'].retrievals[0][0]).toBe(personalId);
  expect(imported['lang:personal:fr:learningExposures'].words[personalId]).toEqual([2, 0, 1, '2026-10-03', '2026-10-03']);
  expect(imported.settings.desiredRetention).toBe(0.85);
  expect(cleanSettings(imported.settings).desiredRetention).toBe(0.85);
  expect(cleanReview(imported.recallReview, []).cards[spanish].fsrs.stability).toBe(1.5);
  expect(() => targetFresh(imported)).toThrow(/target has/);
  expect(alreadyImported({ ...imported, learningImportReceiptV1: { schemaVersion: 1, hash: 'h' } }, parsed, 'h')).toBe(true);
  // A log key the backup did not write means the target changed after import.
  // The Spanish log keys are unprefixed, so only the learned-key list catches them.
  const withoutLog = structuredClone(parsed);
  delete withoutLog.state.scopes.es.retrievals;
  const receipt = { learningImportReceiptV1: { schemaVersion: 1, hash: 'h' } };
  expect(alreadyImported({ ...target, ...learningPatch(withoutLog, target.settings), ...receipt }, withoutLog, 'h')).toBe(true);
  expect(alreadyImported({ ...imported, ...receipt }, withoutLog, 'h')).toBe(false);

  const again = parseBackup(createBackup(imported, '0.13.0', 2));
  const { logOmitted, ...withoutOmissions } = parsed.state;
  expect(again.state).toEqual(withoutOmissions); // nothing left to omit after a clean import
});

test('ruling B: well-formed log entries for unknown words are omitted and counted, not fatal', () => {
  const { all, spanish } = writerStorage();
  const file = JSON.parse(createBackup(all, '0.13.0', 2));
  file.state.scopes.es.retrievals.retrievals.push(['palabraperdida', 20, 'inline', 'productive', 'again', 2, null, 3, 0, 0.7]);
  file.state.scopes.es.exposures.words.otraperdida = [1, 0, 1, '2026-10-04', '2026-10-04'];
  const parsed = parseBackup(JSON.stringify(file));
  expect(parsed.state.scopes.es.retrievals.retrievals.map(([w]) => w)).toEqual([spanish]);
  // One of each left out by the exporter (state.logOmitted) plus one of each dropped on import.
  expect(backupPreview(parsed)).toMatchObject({ omittedRetrievals: 2, omittedExposureWords: 2 });
});

test('malformed or out-of-schema schema 2 content fails closed', () => {
  const { all, spanish } = writerStorage();
  const v2 = JSON.parse(createBackup(all, '0.13.0', 2));
  const v1 = JSON.parse(createBackup(all, '0.12.3', 1));
  const altered = (base, mutate) => { const copy = structuredClone(base); mutate(copy); return JSON.stringify(copy); };
  const cases = [
    [v2, (b) => { b.state.scopes.es.review.cards[spanish].fsrs.stability = -1; }, /invalid FSRS state/],
    [v2, (b) => { b.state.scopes.es.review.cards[spanish].fsrs = 'x'; }, /FSRS state must be an object/],
    [v2, (b) => { b.state.scopes.es.review.cards[spanish].fsrs.passage = 'https://private.example/text'; }, /unsupported FSRS state field/],
    [v2, (b) => { delete b.state.scopes.es.review.cards[spanish].fsrs.lapses; }, /missing FSRS state field/],
    [v2, (b) => { b.state.logOmitted = { retrievals: -1, exposureWords: 0 }; }, /invalid omitted retrieval count/],
    [v2, (b) => { b.state.logOmitted = { retrievals: 1, exposureWords: 0, note: 'x' }; }, /unsupported log omissions field/],
    [v1, (b) => { b.state.logOmitted = { retrievals: 1, exposureWords: 0 }; }, /unsupported state field/],
    [v1, (b) => { b.state.scopes.es.review.cards[spanish].fsrs = { stability: 1, difficulty: 5, lastReview: 1000, lapses: 0 }; }, /unsupported card field/],
    [v1, (b) => { b.state.scopes.es.retrievals = { version: 1, retrievals: [] }; }, /unsupported scope field/],
    [v1, (b) => { b.state.preferences.desiredRetention = 0.9; }, /unsupported preferences field/],
    [v2, (b) => { b.state.preferences.desiredRetention = 0.95; }, /invalid desired retention/],
    [v2, (b) => { b.state.scopes.es.retrievals.version = 2; }, /unsupported retrieval log version/],
    [v2, (b) => { b.state.scopes.es.retrievals.extra = 1; }, /unsupported retrieval log field/],
    [v2, (b) => { b.state.scopes.es.retrievals.retrievals[0][2] = 'webpage'; }, /invalid retrieval log entry/],
    [v2, (b) => { b.state.scopes.es.retrievals.retrievals[0][0] = 'https://private.example/page'; }, /invalid retrieval log entry/],
    [v2, (b) => { b.state.scopes.es.retrievals.retrievals.push([spanish, 1, 'inline', 'productive', 'easy', 1, null, null, null, null, 'extra passage']); }, /invalid retrieval log entry/],
    [v2, (b) => { b.state.scopes.es.exposures.words[spanish] = [1, 0, 9, '2026-10-01', '2026-10-01']; }, /invalid exposure log entry/],
    [v2, (b) => { Object.defineProperty(b.state.scopes.es.exposures.words, '__proto__', { value: [1, 0, 1, '2026-10-01', '2026-10-01'], enumerable: true }); }, /unsafe exposure log key/],
    [v2, (b) => { b.schemaVersion = 3; }, /schema 3, and this version of Lang Weave reads schemas 1 and 2\. Update Lang Weave/],
  ];
  for (const [base, mutate, message] of cases) expect(() => parseBackup(altered(base, mutate))).toThrow(message);
});

test('a schema 2 file can carry the exporter\'s own omission counts into the preview', () => {
  const { all } = writerStorage();
  const file = JSON.parse(createBackup(all, '0.13.0', 2));
  file.state.logOmitted = { retrievals: 40, exposureWords: 2 };
  file.state.scopes.es.exposures.words.otraperdida = [1, 0, 1, '2026-10-04', '2026-10-04'];
  expect(backupPreview(parseBackup(JSON.stringify(file)))).toMatchObject({ omittedRetrievals: 40, omittedExposureWords: 3 });
});

test('schema 1 export ignores stored FSRS state entirely and drops scopes that held only logs', () => {
  const { all, spanish } = writerStorage();
  all.recallReview.cards[spanish].fsrs = { stability: 99999, difficulty: 5, lastReview: 1000, lapses: 0 };
  all['lang:it:bbbbbbbbbbbbbbbb:learningExposures'] = { version: 1, words: {} };
  const json = createBackup(all, '0.12.3', 1);
  expect(json).not.toContain('fsrs');
  expect(JSON.parse(json).state.scopes['lang:it:bbbbbbbbbbbbbbbb']).toBeUndefined();
  expect(backupPreview(parseBackup(json)).languages).toBe(3);
  // Schema 2 still refuses that invalid state.
  expect(() => createBackup(all, '0.13.0', 2)).toThrow(/invalid FSRS state/);
});

test('an empty log already in a fresh target does not hide a completed import', () => {
  const { all } = writerStorage();
  const parsed = parseBackup(createBackup(all, '0.12.3', 1));
  const target = { ...freshTarget(), learningExposures: { version: 1, words: {} } };
  expect(targetFresh(target)).toBe(true);
  const imported = { ...target, ...learningPatch(parsed, target.settings),
    learningImportReceiptV1: { schemaVersion: 1, hash: 'h' } };
  expect(Object.hasOwn(learningPatch(parsed, target.settings), 'learningExposures')).toBe(false);
  expect(alreadyImported(imported, parsed, 'h')).toBe(true);
  // A non-empty or unknown-shaped stray log still counts as a change.
  expect(alreadyImported({ ...imported, learningExposures: { version: 1, words: {}, extra: 1 } }, parsed, 'h')).toBe(false);
});

test('target checks understand the new keys: empty logs are fresh, logged progress or unknown shapes conflict', () => {
  const empty = { ...freshTarget(), learningRetrievals: { version: 1, retrievals: [] },
    learningExposures: { version: 1, words: {} } };
  expect(targetFresh(empty)).toBe(true);
  expect(() => targetFresh({ ...empty, learningRetrievals: { version: 1, retrievals: [['y', 1, 'inline', 'productive', 'easy', 0, null, null, null, null]] } }))
    .toThrow(/target has learning progress/);
  expect(() => targetFresh({ ...empty, learningExposures: { version: 2, words: {} } })).toThrow(/unknown learning log format/);
  expect(() => targetFresh({ ...empty, learningRetrievals: { version: 1, retrievals: [], extra: 'x' } })).toThrow(/unknown learning log format/);
  expect(() => targetFresh({ ...empty, learningExposures: { version: 1, words: [] } })).toThrow(/unknown learning log format/);
  expect(() => targetFresh({ ...freshTarget(), 'lang:personal:fr:learningRetrievals': { version: 1, retrievals: [] } }))
    .toThrow(/target has a learning scope/);
  expect(targetFresh({ ...freshTarget(), settings: { ...freshTarget().settings, desiredRetention: 0.9 } })).toBe(true);
});

test('stored FSRS state is kept only while it agrees with the card schedule', () => {
  const due = 50 * DAY_MS;
  const raw = { version: 1, cards: {
    a: { due, interval: 5, reviews: 2, fsrs: { stability: 5, difficulty: 4, lastReview: due - 5 * DAY_MS, lapses: 0 } },
    b: { due, interval: 5, reviews: 2, fsrs: { stability: 5, difficulty: 4, lastReview: due - 3 * DAY_MS, lapses: 0 } },
    c: { due, interval: 0, reviews: 2, fsrs: { stability: 0.2, difficulty: 6, lastReview: due - AGAIN_MS, lapses: 1 } },
    d: { due, interval: 5, reviews: 2, fsrs: { stability: -1, difficulty: 4, lastReview: 0, lapses: 0 } },
    e: { due, interval: 0, reviews: 0, fsrs: { stability: 0.2, difficulty: 6, lastReview: due - AGAIN_MS, lapses: 0 } },
    f: { due, interval: 5, reviews: 2, fsrs: { stability: 5, difficulty: 4, lastReview: due - 5 * DAY_MS, lapses: 3 } },
  }, learning: { day: '', count: 0 } };
  const cards = cleanReview(raw, []).cards;
  expect(cards.a.fsrs.stability).toBe(5);
  expect(cards.b.fsrs).toBeUndefined();
  expect(cards.c.fsrs.lapses).toBe(1);
  expect(cards.d.fsrs).toBeUndefined();
  expect(cards.d).toEqual({ due, interval: 5, reviews: 2 });
  expect(cards.e.fsrs).toBeUndefined(); // never rated
  expect(cards.f.fsrs).toBeUndefined(); // more lapses than reviews
});

test('the FSRS scheduler writes fresh state that later loads keep, for every rating', () => {
  const now = 100 * DAY_MS;
  const word = { fr: 'y', en: 'and', hint: '' };
  for (const rating of ['again', 'hard', 'medium', 'easy']) {
    const state = cleanReview({ version: 1, cards: { y: { due: now, interval: 0, reviews: 1,
      fsrs: { stability: 0.2, difficulty: 6, lastReview: now - AGAIN_MS, lapses: 0 } } },
      learning: { day: '', count: 0 } }, [word]);
    const card = nextReview(state, [word], now, () => 't');
    revealReview(state, [word], card.ticket, now);
    expect(rateReview(state, card.ticket, rating, now)).not.toBeNull();
    expect(state.cards.y.fsrs.lastReview).toBe(now);
    expect(storedFsrs(state.cards.y)).toEqual(state.cards.y.fsrs);
    expect(cleanReview(structuredClone(state), [word]).cards.y.fsrs).toEqual(state.cards.y.fsrs);
  }
});

test('desiredRetention is kept when valid and never defaulted into settings', () => {
  expect(Object.hasOwn(cleanSettings({}), 'desiredRetention')).toBe(false);
  expect(Object.hasOwn(DEFAULT_SETTINGS, 'desiredRetention')).toBe(false);
  expect(cleanSettings({ desiredRetention: 0.88 }).desiredRetention).toBe(0.88);
  for (const bad of [0.84, 0.91, '0.9', NaN]) expect(Object.hasOwn(cleanSettings({ desiredRetention: bad }), 'desiredRetention')).toBe(false);
});

test('full logs in three scopes export under 1 MiB: newest retrievals kept, the rest counted', () => {
  const { all, version, spanish } = writerStorage();
  const entry = (word, at) => [word, at, 'inline', 'productive', 'medium', 3, 2500, 4, 9, 0.8765];
  all.learningRetrievals = { version: 1, retrievals: Array.from({ length: 5000 }, (_, i) => entry(spanish, 1000 + i)) };
  all['lang:personal:fr:learningRetrievals'] = { version: 1,
    retrievals: Array.from({ length: 5000 }, (_, i) => entry(personalId, 100000 + i)) };
  all[`lang:fr:${version}:learningRetrievals`] = { version: 1,
    retrievals: Array.from({ length: 5000 }, (_, i) => entry('mot0', 200000 + i)) };
  const json = createBackup(all, '0.13.0');
  expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(MAX_BACKUP_BYTES);
  expect(json.startsWith('{"format"')).toBe(true); // compact serialization
  const parsed = parseBackup(json);
  const scopes = parsed.state.scopes;
  const kept = Object.values(scopes).flatMap((s) => s.retrievals?.retrievals || []);
  const omitted = parsed.state.logOmitted;
  expect(kept.length + omitted.retrievals).toBe(15000); // every entry is either kept or counted
  expect(omitted.retrievals).toBeGreaterThan(1);
  // Newest first across scopes: the pack's newest entries survive whole before older scopes.
  expect(scopes[`lang:fr:${version}`].retrievals.retrievals.at(-1)[1]).toBe(204999);
  const oldestKept = Math.min(...kept.map((t) => t[1]));
  const allTimes = [...all.learningRetrievals.retrievals, ...all['lang:personal:fr:learningRetrievals'].retrievals,
    ...all[`lang:fr:${version}:learningRetrievals`].retrievals].map((t) => t[1]);
  expect(allTimes.filter((t) => t >= oldestKept).length).toBe(kept.length);
  // Exposure aggregates of current scopes are kept first.
  expect(Object.keys(scopes.es.exposures.words)).toEqual([spanish]);
  expect(backupPreview(parsed)).toMatchObject({ retrievals: kept.length, omittedRetrievals: omitted.retrievals });
  // The budget bounds the serialized log: keys, wrappers and logOmitted included.
  const stripped = JSON.parse(json);
  delete stripped.state.logOmitted;
  for (const [id, fields] of Object.entries(stripped.state.scopes)) {
    delete fields.retrievals; delete fields.exposures;
    if (id !== 'es' && !Object.keys(fields).length) delete stripped.state.scopes[id];
  }
  expect(new TextEncoder().encode(json).length - new TextEncoder().encode(JSON.stringify(stripped)).length)
    .toBeLessThanOrEqual(LOG_BUDGET_BYTES);
  // Storage order within a scope is preserved (oldest first), only the old tail is cut.
  const es = scopes.es.retrievals?.retrievals || [];
  expect(es.every((t, i) => i === 0 || es[i - 1][1] < t[1])).toBe(true);
});

// Maximal valid non-log state (fixture adapted from the council's Anthropic seat): every Spanish
// card, five full packs with long glosses, 300 personal entries, 500 events in every scope.
function maximalStorage() {
  const { source } = baseline();
  const all = structuredClone(source);
  for (const key of Object.keys(all)) if (key.startsWith('lang:')) delete all[key];
  delete all.readingEvents; delete all.seenSent; delete all.vocabularyEncounters;
  const es = wordsForLevel(2);
  const card = (i) => ({ due: 1000 * DAY_MS + i, interval: 300, reviews: 9999, introducedDay: '2026-10-01',
    introGateDay: '2026-10-01', easyStreak: 2,
    fsrs: { stability: 300.123456789, difficulty: 5.123456789012, lastReview: 1000 * DAY_MS + i - 300 * DAY_MS, lapses: 3 } });
  all.recallReview.cards = Object.fromEntries(es.map((w, i) => [w.fr, card(i)]));
  all.languagePacks = {};
  for (const code of ['fr', 'de', 'it', 'pt', 'nl']) {
    const words = Array.from({ length: 80 }, (_, i) => ({ fr: `${code}${i}`.padEnd(12, 'x'),
      en: `word${i}`.padEnd(60, 'y'), hint: `h${i}`.padEnd(60, 'z'), level: i < 40 ? 1 : 2 }));
    const version = hashKey(JSON.stringify(words));
    all.languagePacks[code] = { version, words };
    all[`lang:${code}:${version}:recallReview`] = { version: 1, cards: Object.fromEntries(words.map((w, i) => [w.fr, card(i)])),
      current: null, inline: null, learning: { day: '2026-10-20', count: 1, pending: [] } };
  }
  const entries = [], history = {};
  for (let i = 0; i < 300; i++) {
    const id = `${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
    entries.push({ uuid: id, id: `personal:fr:${id}`, language: 'fr', source: 'a'.repeat(80), target: 'b'.repeat(40),
      sense: 'c'.repeat(80), direction: 'en-to-target', archived: false, provenance: 'manual', createdAt: 1234 + i });
    history[`personal:fr:${id}`] = card(i);
  }
  all.personalVocabularyV1 = { version: 1, revision: 9, entries, history: { fr: { version: 1, cards: history,
    current: null, inline: null, learning: { day: '2026-10-20', count: 1, pending: [] } } } };
  const events = (prefix, ids) => { all[`${prefix}readingEvents`] = Array.from({ length: 500 },
    (_, i) => ({ word: ids[i % ids.length].toLowerCase(), kind: 'flip', day: '2026-10-28' })); };
  events('', es.map((w) => w.fr));
  for (const code of Object.keys(all.languagePacks))
    events(`lang:${code}:${all.languagePacks[code].version}:`, all.languagePacks[code].words.map((w) => w.fr));
  events('lang:personal:fr:', entries.map((e) => e.id));
  return { all, es, entries };
}

test('the log budget shrinks to the room left by maximal learning state, so export still succeeds', () => {
  const { all, es, entries } = maximalStorage();
  const size = (json) => new TextEncoder().encode(json).length;
  const withoutLog = size(createBackup(all, '0.12.4'));
  const entry = (word, at) => [word, at, 'inline', 'productive', 'medium', 9999, 600000, 36500, 365, 0.8765];
  all.learningRetrievals = { version: 1, retrievals: Array.from({ length: 5000 }, (_, i) => entry(es[i % es.length].fr, 1e12 + i)) };
  all['lang:personal:fr:learningRetrievals'] = { version: 1, retrievals: Array.from({ length: 5000 }, (_, i) => entry(entries[i % 300].id, 1e12 + i)) };
  all.learningExposures = { version: 1, words: Object.fromEntries(es.map((w) => [w.fr, [1000000, 1000000, 200, '2026-01-01', '2026-10-01']])) };
  // The non-log state alone leaves less than LOG_BUDGET_BYTES of room under the 1 MiB file limit.
  expect(MAX_BACKUP_BYTES - withoutLog).toBeLessThan(LOG_BUDGET_BYTES);
  const json = createBackup(all, '0.12.4');
  expect(size(json)).toBeLessThanOrEqual(MAX_BACKUP_BYTES);
  const parsed = parseBackup(json);
  const kept = Object.values(parsed.state.scopes).flatMap((scope) => scope.retrievals?.retrievals || []);
  expect(kept.length).toBeGreaterThan(0);
  expect(kept.length + parsed.state.logOmitted.retrievals).toBe(10000);
});

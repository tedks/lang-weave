// Tolerant reader: this build reads backup schemas 1 and 2 but writes schema 1.
import { test, expect } from 'bun:test';
import { createBackup, parseBackup, learningPatch, targetFresh, backupPreview, BACKUP_SCHEMA,
  READ_SCHEMAS } from '../src/portability.js';
import { alreadyImported } from '../src/backup-handlers.js';
import { cleanReview, AGAIN_MS, DAY_MS } from '../src/review.js';
import { cleanSettings, DEFAULT_SETTINGS } from '../src/settings.js';
import { personalId, baseline } from './backup-fixture.js';

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

test('this build reads schemas 1 and 2 and still writes schema 1', () => {
  expect(BACKUP_SCHEMA).toBe(1);
  expect([...READ_SCHEMAS]).toEqual([1, 2]);
});

test('export from writer storage succeeds and writes plain schema 1', () => {
  const { all } = writerStorage();
  const json = createBackup(all, '0.12.3');
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
  expect(backupPreview(parsed)).toMatchObject({ schemaVersion: 2, retrievals: 3, exposureWords: 2,
    omittedRetrievals: 0, omittedExposureWords: 0 });

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
  expect(again.state).toEqual(parsed.state);
});

test('ruling B: well-formed log entries for unknown words are omitted and counted, not fatal', () => {
  const { all, spanish } = writerStorage();
  const file = JSON.parse(createBackup(all, '0.13.0', 2));
  file.state.scopes.es.retrievals.retrievals.push(['palabraperdida', 20, 'inline', 'productive', 'again', 2, null, 3, 0, 0.7]);
  file.state.scopes.es.exposures.words.otraperdida = [1, 0, 1, '2026-10-04', '2026-10-04'];
  const parsed = parseBackup(JSON.stringify(file));
  expect(parsed.state.scopes.es.retrievals.retrievals.map(([w]) => w)).toEqual([spanish]);
  expect(backupPreview(parsed)).toMatchObject({ omittedRetrievals: 1, omittedExposureWords: 1 });
});

test('malformed or out-of-schema schema 2 content fails closed', () => {
  const { all, spanish } = writerStorage();
  const v2 = JSON.parse(createBackup(all, '0.13.0', 2));
  const v1 = JSON.parse(createBackup(all, '0.12.3'));
  const altered = (base, mutate) => { const copy = structuredClone(base); mutate(copy); return JSON.stringify(copy); };
  const cases = [
    [v2, (b) => { b.state.scopes.es.review.cards[spanish].fsrs.stability = -1; }, /invalid FSRS state/],
    [v2, (b) => { b.state.scopes.es.review.cards[spanish].fsrs = 'x'; }, /invalid FSRS state/],
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

test('target checks understand the new keys: empty logs are fresh, logged progress or unknown shapes conflict', () => {
  const empty = { ...freshTarget(), learningRetrievals: { version: 1, retrievals: [] },
    learningExposures: { version: 1, words: {} } };
  expect(targetFresh(empty)).toBe(true);
  expect(() => targetFresh({ ...empty, learningRetrievals: { version: 1, retrievals: [['y', 1, 'inline', 'productive', 'easy', 0, null, null, null, null]] } }))
    .toThrow(/target has learning progress/);
  expect(() => targetFresh({ ...empty, learningExposures: { version: 2, words: {} } })).toThrow(/unknown learning log format/);
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
  }, learning: { day: '', count: 0 } };
  const cards = cleanReview(raw, []).cards;
  expect(cards.a.fsrs.stability).toBe(5);
  expect(cards.b.fsrs).toBeUndefined();
  expect(cards.c.fsrs.lapses).toBe(1);
  expect(cards.d.fsrs).toBeUndefined();
  expect(cards.d).toEqual({ due, interval: 5, reviews: 2 });
});

test('desiredRetention is kept when valid and never defaulted into settings', () => {
  expect(Object.hasOwn(cleanSettings({}), 'desiredRetention')).toBe(false);
  expect(Object.hasOwn(DEFAULT_SETTINGS, 'desiredRetention')).toBe(false);
  expect(cleanSettings({ desiredRetention: 0.88 }).desiredRetention).toBe(0.88);
  for (const bad of [0.84, 0.91, '0.9', NaN]) expect(Object.hasOwn(cleanSettings({ desiredRetention: bad }), 'desiredRetention')).toBe(false);
});

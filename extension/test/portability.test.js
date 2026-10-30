import { test, expect } from 'bun:test';
import { createBackup, parseBackup, learningPatch, targetFresh, backupPreview, MAX_BACKUP_BYTES } from '../src/portability.js';
import { hashKey } from '../src/hash.js';
import { wordsForLevel } from '../src/levels.js';
import { remaining, futureBudgetDay } from '../src/learning.js';
import { AGAIN_MS, DAY_MS } from '../src/review.js';

import { uuid, personalId, baseline } from './backup-fixture.js';

test('old Spanish, personal and versioned pack learning round-trip into a distinct fresh fixture', () => {
  const { source, version, spanish } = baseline();
  const spanishEntry = `es:legacy:${encodeURIComponent(spanish)}`;
  const before = structuredClone(source);
  const json = createBackup(source, '0.11.0');
  expect(source).toEqual(before); // export is read-only
  for (const forbidden of ['actual-secret', 'legacy-secret', 'private-url', 'https://', 'siteOverrides',
    'enabled', 'quotaState', 'modelCalls', 'modelStatus', 'owner-secret', 'pending-secret',
    'reveal-secret', 'document-secret', 'secret-ticket']) expect(json).not.toContain(forbidden);
  const parsed = parseBackup(json);
  const preview = backupPreview(parsed);
  expect(preview).toMatchObject({ exportedByVersion: '0.11.0', languages: 3, packs: 1,
    cards: 5, personal: 1, preferences: { language: 'fr', gradual: true, density: 'heavy' } });
  const target = { settings: { enabled: false, newSitesEnabled: false,
    siteOverrides: { 'target.example': false }, model: 'gemini-3.5-flash-lite',
    language: 'es', levelOverride: 0, gradual: false, newWordsPerDay: 5, density: 'normal', inlineRecall: false },
    keyEpoch: 'target-key-epoch', 'c:target': { s: 'target cache' }, modelCalls: { count: 4 } };
  expect(targetFresh(target)).toBe(true);
  const imported = { ...target, ...learningPatch(parsed, target.settings) };
  expect(imported.settings.enabled).toBe(false);
  expect(imported.settings.newSitesEnabled).toBe(false);
  expect(imported.settings.siteOverrides).toEqual({ 'target.example': false });
  expect(imported.settings.model).toBe('gemini-3.5-flash-lite');
  expect(imported.apiKey).toBeUndefined();
  expect(imported.keyEpoch).toBe('target-key-epoch');
  expect(imported['c:target']).toEqual({ s: 'target cache' });
  expect(imported.recallReview.cards[spanish].due).toBe(1000 + DAY_MS);
  expect(imported.recallReview.cards.pero.familiar).toBe(true);
  expect(imported.recallReview.cards[spanish].introReceipt).toBeUndefined();
  expect(imported.recallReview.learning.count).toBe(3);
  expect(imported.personalVocabularyV1.history.fr.cards[personalId].reviews).toBe(3);
  expect(imported.personalVocabularyV1.history.fr.learning.count).toBe(2);
  expect(imported.personalVocabularyV1.entries[0].archived).toBe(true);
  expect(imported[`lang:fr:${version}:recallReview`].cards.mot0.reviews).toBe(1);
  expect(imported[`lang:fr:${version}:recallReview`].learning.count).toBe(2);
  expect(imported.vocabularyEncounters.counts[spanishEntry]).toBe(4);
  expect(imported[`lang:fr:${version}:vocabularyEncounters`].counts[`fr:${version}:legacy:mot0`]).toBe(3);
  expect(imported['lang:de:aaaaaaaaaaaaaaaa:recallReview'].learning.count).toBe(1);
  expect(remaining(imported.recallReview.learning, '2026-10-28', 3)).toBe(0);
  expect(futureBudgetDay(imported.recallReview.learning, '2026-10-28')).toBe('2026-11-11');
  expect(imported.personalVocabularyV1.history.fr.learning.day).toBe('2026-11-10');
  expect(imported.personalVocabularyV1.history.fr.cards[personalId].due).toBe(1000 + AGAIN_MS);
  expect(() => targetFresh(imported)).toThrow(/target has/);
});

test('hostile and unsupported files fail closed', () => {
  const { source } = baseline();
  const raw = JSON.parse(createBackup(source, '0.11.0'));
  const altered = (mutate) => { const copy = structuredClone(raw); mutate(copy); return JSON.stringify(copy); };
  for (const json of ['{', ' '.repeat(MAX_BACKUP_BYTES + 1),
    altered((b) => { b.schemaVersion = 3; }),
    altered((b) => { b.schemaVersion = '2'; }),
    altered((b) => { b.state.scopes.es.review.version = 2; }),
    altered((b) => { b.state.personal.version = 2; }),
    altered((b) => { b.state.preferences.enabled = true; }),
    altered((b) => { Object.defineProperty(b.state.scopes, '__proto__', { value: {}, enumerable: true }); }),
    altered((b) => { b.state.scopes.es.review.cards['https://private.example/story'] = { due: 0, interval: 0, reviews: 0 }; }),
    altered((b) => { b.state.scopes.es.review.cards['my oncology appointment is on Monday'] = { due: 0, interval: 0, reviews: 0 }; }),
    altered((b) => { b.state.personal.entries[0].id = 'personal:fr:constructor'; }),
    altered((b) => { b.state.scopes.es.events[0].word = 'raw page passage'; }),
  ]) expect(() => parseBackup(json)).toThrow();
  expect(() => createBackup({ ...source, 'unrecognizedLearningV2': {} }, '0.11.0')).toThrow(/unknown storage/);
  expect(() => createBackup({ ...source, recallReview: { ...source.recallReview, version: 2 } }, '0.11.0')).toThrow();
  expect(() => createBackup({ ...source, settings: { ...source.settings, futureLearningPreference: true } }, '0.11.0')).toThrow();
});

test('initialized empty target is fresh; meaningful or unknown target state conflicts', () => {
  const base = { settings: { enabled: true, newSitesEnabled: null, language: 'es' }, keyEpoch: 'existing',
    recallReview: { version: 1, cards: {}, current: null, inline: null,
      learning: { day: '', count: 0, pending: [] } }, personalVocabularyV1: {
      version: 1, revision: 0, entries: [], history: {} } };
  expect(targetFresh(base)).toBe(true);
  for (const patch of [{ apiKey: 'existing-key' }, { unexpected: 1 },
    { settings: { ...base.settings, futureLearningPreference: true } },
    { recallReview: { ...base.recallReview, learning: { day: '2026-10-28', count: 1, pending: [] } } },
    { personalVocabularyV1: { ...base.personalVocabularyV1, entries: [{ id: 'anything' }] } },
    { 'lang:fr:aaaaaaaaaaaaaaaa:recallReview': { version: 1, cards: {}, learning: { day: '', count: 0 } } }])
    expect(() => targetFresh({ ...base, ...patch })).toThrow();
});

test('unreviewed pack feedback and script joiners survive without a card', () => {
  const { source, version } = baseline();
  const words = source.languagePacks.fr.words.map((word) => ({ ...word }));
  words[1].fr = 'می\u200cروم';
  words[2].fr = '中'.repeat(50);
  const nextVersion = hashKey(JSON.stringify(words));
  source.languagePacks.fr = { version: nextVersion, words };
  for (const suffix of ['recallReview', 'readingEvents', 'vocabularyEncounters']) {
    source[`lang:fr:${nextVersion}:${suffix}`] = source[`lang:fr:${version}:${suffix}`];
    delete source[`lang:fr:${version}:${suffix}`];
  }
  const aggregate = source[`lang:fr:${nextVersion}:vocabularyEncounters`];
  aggregate.counts = { [`fr:${nextVersion}:legacy:mot0`]: 3 };
  aggregate.touched = [`fr:${nextVersion}:legacy:mot0`];
  source[`lang:fr:${nextVersion}:readingEvents`].push({ word: 'می\u200cروم', kind: 'seen', day: '2026-10-28' });
  source[`lang:fr:${nextVersion}:vocabularyEncounters`].counts[`fr:${nextVersion}:legacy:${encodeURIComponent('می\u200cروم')}`] = 1;
  source[`lang:fr:${nextVersion}:vocabularyEncounters`].touched.push(`fr:${nextVersion}:legacy:${encodeURIComponent('می\u200cروم')}`);
  const longId = `fr:${nextVersion}:legacy:${encodeURIComponent('中'.repeat(50))}`;
  expect(longId.length).toBeGreaterThan(400);
  source[`lang:fr:${nextVersion}:vocabularyEncounters`].counts[longId] = 1;
  source[`lang:fr:${nextVersion}:vocabularyEncounters`].touched.push(longId);
  source.readingEvents.push({ word: 'pero', kind: 'seen', day: '2026-10-28' });
  const backup = parseBackup(createBackup(source, '0.11.0'));
  expect(backup.state.scopes[`lang:fr:${nextVersion}`].events[1].word).toBe('می\u200cروم');
  expect(backup.state.scopes[`lang:fr:${nextVersion}`].encounters.touched).toHaveLength(3);
  expect(backup.state.scopes.es.events[1].word).toBe('pero');
});

test('unverified form history and dependent feedback refuse the entire backup without changing source', () => {
  const cases = [
    (source) => { source.recallReview.cards['my appointment moved Monday'] = { due: 0, interval: 0, reviews: 0 }; },
    (source) => { source['lang:de:aaaaaaaaaaaaaaaa:recallReview'].cards['früher'] =
      { due: 90000, interval: 7, reviews: 1 }; },
    (source) => { source.readingEvents.push({ word: 'unknown phrase', kind: 'seen', day: '2026-10-28' }); },
    (source) => { source.vocabularyEncounters.counts['es:legacy:unknown%20phrase'] = 1; },
  ];
  for (const [index, mutate] of cases.entries()) {
    const { source } = baseline();
    mutate(source);
    const before = structuredClone(source);
    let failure = '';
    try { createBackup(source, '0.11.0'); } catch (error) { failure = error.message; }
    expect(failure).toMatch(/Learning backup:/);
    expect(failure).toMatch(index < 2 ? /1 unverified historical card ID/ : /1 unverified historical feedback ID/);
    expect(failure).not.toContain('appointment');
    expect(failure).not.toContain('früher');
    expect(failure).not.toContain('unknown phrase');
    expect(source).toEqual(before);
  }
});

test('hostile file with an unverified form refuses import before target writes', () => {
  const { source } = baseline();
  const json = createBackup(source, '0.11.0');
  const raw = JSON.parse(json);
  raw.state.scopes.es.review.cards['my appointment moved Monday'] =
    { due: 0, interval: 0, reviews: 0 };
  expect(() => parseBackup(JSON.stringify(raw))).toThrow(/1 unverified historical card ID/);
});

test('orphan personal UUID card remains portable without a raw form', () => {
  const { source } = baseline();
  const orphanId = 'personal:fr:44444444-4444-4444-8444-444444444444';
  source.personalVocabularyV1.history.fr.cards[orphanId] = { due: 4321, interval: 3, reviews: 2 };
  source['lang:personal:fr:readingEvents'] = [{ word: orphanId, kind: 'seen', day: '2026-10-28' }];
  const parsed = parseBackup(createBackup(source, '0.11.0'));
  expect(parsed.state.personal.history.fr.cards[orphanId].due).toBe(4321);
  expect(parsed.state.scopes['personal:fr'].events[0].word).toBe(orphanId);
});

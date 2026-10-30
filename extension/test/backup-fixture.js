// Shared learning-backup fixture: a source installation with every supported learning field.
import { hashKey } from '../src/hash.js';
import { wordsForLevel } from '../src/levels.js';
import { AGAIN_MS, DAY_MS } from '../src/review.js';

export const uuid = '11111111-1111-4111-8111-111111111111';
export const personalId = `personal:fr:${uuid}`;
export const baseline = () => {
  const words = Array.from({ length: 20 }, (_, i) => ({ fr: `mot${i}`, en: `word${i}`,
    hint: `moh${i}`, level: i < 10 ? 1 : 2 }));
  const version = hashKey(JSON.stringify(words));
  const spanish = wordsForLevel(2)[0].fr;
  const spanishEntry = `es:legacy:${encodeURIComponent(spanish)}`;
  const source = { settings: { enabled: false, newSitesEnabled: true,
    siteOverrides: { 'private.example': true }, model: 'gemini-3.8-flash',
    language: 'fr', levelOverride: 2, gradual: true, newWordsPerDay: 3,
    density: 'heavy', inlineRecall: true, apiKey: 'legacy-secret' },
    apiKey: 'actual-secret', keyEpoch: 'secret-epoch', epoch: 'site-epoch',
    modelCalls: { day: '2026-10-27', count: 9 }, quotaState: { secret: 'quota' },
    modelStatus: { secret: 'status' }, 'c:private-url': { s: 'https://private.example/page text' },
    languagePacks: { fr: { version, words } },
    personalVocabularyV1: { version: 1, revision: 9, entries: [{ uuid, id: personalId,
      language: 'fr', source: 'river', target: 'rivière', sense: 'river', direction: 'en-to-target',
      archived: true, provenance: 'manual', createdAt: 1234 }],
    history: { fr: { version: 1, cards: { [personalId]: { due: 1000 + AGAIN_MS, interval: 0,
      reviews: 3, introducedDay: '2026-10-28', introReceipt: { ticket: 'ephemeral' } } },
      current: { ticket: 'reveal-ticket', word: personalId, revealed: true },
      inline: { documentId: 'document-secret' }, learning: { day: '2026-11-10', count: 2,
        pending: [{ ownerKey: 'owner-secret', ticket: 'pending-secret' }] } } } },
    recallReview: { version: 1, cards: {
      [spanish]: { due: 1000 + DAY_MS, interval: 1, reviews: 2, introducedDay: '2026-10-28',
        introGateDay: '2026-10-28', easyStreak: 0, introReceipt: { ticket: 'secret-ticket' } },
      'pero': { due: 5000, interval: 7, reviews: 8, familiar: true },
    }, current: { ticket: 'reveal-secret', word: spanish, revealed: true },
    inline: { documentId: 'doc-secret' }, learning: { day: '2026-11-11', count: 3,
      pending: [{ ticket: 'pending-secret' }] } },
    readingEvents: [{ word: spanish.toLowerCase(), kind: 'seen', day: '2026-10-28' }],
    seenSent: { day: '2026-10-28', words: [spanish.toLowerCase()] },
    vocabularyEncounters: { version: 1, day: '2026-10-28', bucket: 2960,
      counts: { [spanishEntry]: 4 }, touched: [spanishEntry] },
    [`lang:fr:${version}:recallReview`]: { version: 1, cards: {
      mot0: { due: 1000, interval: 0, reviews: 1, easyStreak: 0 },
      mot19: { due: 9000, interval: 3, reviews: 4 } },
      current: null, inline: null, learning: { day: '2026-10-28', count: 2, pending: [] } },
    [`lang:fr:${version}:readingEvents`]: [{ word: 'mot0', kind: 'flip', day: '2026-10-28' }],
    [`lang:fr:${version}:vocabularyEncounters`]: { version: 1, day: '2026-10-28', bucket: 2960,
      counts: { [`fr:${version}:legacy:mot0`]: 3 }, touched: [`fr:${version}:legacy:mot0`] },
    'lang:personal:fr:vocabularyEncounters': { version: 1, day: '2026-10-28', bucket: 2960,
      counts: { [personalId]: 2 }, touched: [personalId] },
    // A previous, now uninstalled pack scope with no form IDs can retain its budget day/count.
    'lang:de:aaaaaaaaaaaaaaaa:recallReview': { version: 1, cards: {},
      current: null, inline: null, learning: { day: '2026-10-20', count: 1, pending: [] } },
  };
  return { source, version, spanish };
};

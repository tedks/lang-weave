// Guarded MV3 proof with two throwaway extension identities and profiles.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { hashKey } from '../src/hash.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-portability-'));
let browser;
async function load(name) {
  const extension = join(scratch, name, 'extension');
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  await cp(join(root, 'manifest.json'), join(extension, 'manifest.json'));
  browser = await chromium.launchPersistentContext(join(scratch, name, 'profile'), {
    channel: 'chromium', headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const id = await worker.evaluate(() => chrome.runtime.id);
  const backup = await browser.newPage();
  await backup.goto(`chrome-extension://${id}/src/backup.html`);
  return { worker, id, backup };
}

try {
  const old = await load('old');
  const words = Array.from({ length: 20 }, (_, i) => ({ fr: `mot${i}`, en: `word${i}`,
    hint: `moh${i}`, level: i < 10 ? 1 : 2 }));
  const version = hashKey(JSON.stringify(words));
  const uuid = '33333333-3333-4333-8333-333333333333';
  const personalId = `personal:es:${uuid}`;
  await old.worker.evaluate(({ words, version, uuid, personalId }) => chrome.storage.local.set({
    settings: { enabled: false, model: 'gemini-3.5-flash-lite', language: 'es', levelOverride: 2,
      gradual: true, newWordsPerDay: 2, density: 'heavy', inlineRecall: true,
      newSitesEnabled: true, siteOverrides: { 'source.example': true } },
    apiKey: 'synthetic-old-key',
    'c:https://source.example/private': { s: ['private passage'] },
    languagePacks: { fr: { version, words } },
    personalVocabularyV1: { version: 1, revision: 1,
      entries: [{ id: personalId, uuid, language: 'es', source: 'glimmer', target: 'brillo',
        sense: 'glimmer', direction: 'en-to-target', archived: true, provenance: 'manual', createdAt: 1000 }],
      history: { es: { version: 1, cards: { [personalId]: { due: 0, interval: 0, reviews: 1,
        introducedDay: '2026-10-27' } }, current: null, inline: null,
        learning: { day: '2026-10-27', count: 1, pending: [] } } } },
    recallReview: { version: 1, cards: { y: { due: 0, interval: 0, reviews: 2,
      introducedDay: '2026-10-27' }, 'histórico': { due: 9000, interval: 7, reviews: 5, familiar: true } },
      current: null, inline: null, learning: { day: '2026-10-28', count: 2, pending: [] } },
    [`lang:fr:${version}:recallReview`]: { version: 1, cards: { mot0: { due: 1000, interval: 1, reviews: 1 } },
      current: null, inline: null, learning: { day: '2026-10-20', count: 1, pending: [] } },
    'lang:de:aaaaaaaaaaaaaaaa:recallReview': { version: 1, cards: { 'früher': { due: 1000, interval: 1, reviews: 1 } },
      current: null, inline: null, learning: { day: '2026-10-18', count: 1, pending: [] } },
    readingEvents: [{ word: 'y', kind: 'seen', day: '2026-10-28' }],
    seenSent: { day: '2026-10-28', words: ['y'] },
    vocabularyEncounters: { version: 1, day: '2026-10-28', bucket: 2960, counts: { y: 2 }, touched: ['y'] },
  }), { words, version, uuid, personalId });
  const sourceBefore = await old.worker.evaluate(() => chrome.storage.local.get(null));
  const downloadPromise = old.backup.waitForEvent('download');
  await old.backup.locator('#export').click();
  const download = await downloadPromise;
  const file = join(scratch, 'learning-backup.json');
  await download.saveAs(file);
  await old.backup.locator('#notice').getByText(/downloaded/i).waitFor();
  const sourceAfter = await old.worker.evaluate(() => chrome.storage.local.get(null));
  assert.deepEqual(sourceAfter, sourceBefore, 'export must not change source storage');
  const json = await readFile(file, 'utf8');
  for (const forbidden of ['synthetic-old-key', 'source.example', 'private passage', 'c:https'])
    assert.ok(!json.includes(forbidden), `backup exposed ${forbidden}`);
  await browser.close(); browser = null;

  const fresh = await load('new');
  assert.notEqual(fresh.id, old.id, 'identities must differ');
  const freshBefore = await fresh.worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(freshBefore.recallReview, undefined);
  assert.equal(freshBefore.apiKey, undefined);
  await fresh.backup.locator('#file').setInputFiles(file);
  await fresh.backup.locator('#preview').click();
  await fresh.backup.locator('#summary').waitFor({ state: 'visible' });
  assert.match(await fresh.backup.locator('#counts').textContent(), /Review cards: 5/);
  assert.match(await fresh.backup.locator('#preferences').textContent(), /density heavy/);
  assert.equal(await fresh.backup.locator('#import').isDisabled(), true);
  await fresh.backup.locator('#confirm').check();
  await fresh.backup.locator('#import').click();
  await fresh.backup.locator('#notice').getByText(/Learning progress imported/).waitFor();
  const restored = await fresh.worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(restored.recallReview.cards.y.reviews, 2);
  assert.equal(restored.recallReview.cards['histórico'].familiar, true);
  assert.equal(restored.personalVocabularyV1.entries[0].archived, true);
  assert.equal(restored[`lang:fr:${version}:recallReview`].cards.mot0.reviews, 1);
  assert.equal(restored['lang:de:aaaaaaaaaaaaaaaa:recallReview'].cards['früher'].reviews, 1);
  assert.equal(restored.settings.newSitesEnabled, freshBefore.settings.newSitesEnabled);
  assert.deepEqual(restored.settings.siteOverrides, freshBefore.settings.siteOverrides);
  assert.equal(restored.apiKey, undefined);
  assert.equal(restored.learningImportJournalV1, undefined);
  const review = await browser.newPage();
  await review.goto(`chrome-extension://${fresh.id}/src/review.html`);
  await review.locator('#prompt').getByText('and').waitFor(); // bundled `y` is due, without a key
  await review.locator('#reveal').click();
  await review.locator('#answer').getByText('y').waitFor();
  await review.locator('[data-rating="hard"]').click();
  await review.locator('#empty').waitFor({ state: 'visible' });
  const rated = await fresh.worker.evaluate(() => chrome.storage.local.get('recallReview'));
  assert.equal(rated.recallReview.cards.y.interval, 1);
  assert.equal(rated.recallReview.cards.y.reviews, 3);
  assert.equal(await fresh.worker.evaluate(() => chrome.storage.local.get('apiKey').then((v) => !!v.apiKey)), false);
  console.log(`portability MV3 PASS: isolated IDs ${old.id} -> ${fresh.id}; file preview/import and keyless review`);
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true }); // own scratch created above
}

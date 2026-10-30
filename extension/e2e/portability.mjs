// Guarded MV3 proof with two throwaway extension identities and profiles.
// It rehearses the 0.12.0 migration: the source is a keyless install whose ID comes from its path (by default this
// runtime with the manifest key removed; PORTABILITY_OLD_EXTENSION may point at a real pre-0.12 extension directory),
// and the target is the shipped, keyed build with its stable ID.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { hashKey } from '../src/hash.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-portability-'));
let browser;
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const stableId = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
async function load(name, { keyless = false, source = root } = {}) {
  const extension = join(scratch, name, 'extension');
  await cp(join(source, 'src'), join(extension, 'src'), { recursive: true });
  // Chrome refuses to load without the icons a manifest names; a pre-0.12.6 source names none. Copy exactly
  // when declared, so a tree that declares icons but lacks them fails here with ENOENT, not as a worker timeout.
  const declared = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  if (declared.icons || declared.action?.default_icon) await cp(join(source, 'icons'), join(extension, 'icons'), { recursive: true });
  const shipped = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  if (keyless) delete shipped.key;
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(shipped, null, 2));
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
  const old = await load('old', { keyless: true, source: process.env.PORTABILITY_OLD_EXTENSION || root });
  assert.notEqual(old.id, stableId, 'the keyless source must have a path-derived ID');
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
      introducedDay: '2026-10-27' }, 'pero': { due: 9000, interval: 7, reviews: 5, familiar: true } },
      current: null, inline: null, learning: { day: '2026-10-28', count: 2, pending: [] } },
    [`lang:fr:${version}:recallReview`]: { version: 1, cards: { mot0: { due: 1000, interval: 1, reviews: 1 } },
      current: null, inline: null, learning: { day: '2026-10-20', count: 1, pending: [] } },
    'lang:de:aaaaaaaaaaaaaaaa:recallReview': { version: 1, cards: {},
      current: null, inline: null, learning: { day: '2026-10-18', count: 1, pending: [] } },
    readingEvents: [{ word: 'y', kind: 'seen', day: '2026-10-28' }],
    seenSent: { day: '2026-10-28', words: ['y'] },
    vocabularyEncounters: { version: 1, day: '2026-10-28', bucket: 2960,
      counts: { 'es:legacy:y': 2 }, touched: ['es:legacy:y'] },
  }), { words, version, uuid, personalId });
  const sourceBefore = await old.worker.evaluate(() => chrome.storage.local.get(null));
  await old.backup.waitForTimeout(35000); // source page can remain open before choosing Export
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
  assert.equal(fresh.id, stableId, 'the shipped build must load with its stable ID');
  const freshBefore = await fresh.worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(freshBefore.recallReview, undefined);
  assert.equal(freshBefore.apiKey, undefined);
  await fresh.backup.locator('#file').setInputFiles(file);
  await fresh.backup.locator('#preview').click();
  await fresh.backup.locator('#summary').waitFor({ state: 'visible' });
  assert.match(await fresh.backup.locator('#counts').textContent(), /Review cards: 4/);
  assert.match(await fresh.backup.locator('#preferences').textContent(), /density heavy/);
  await fresh.backup.waitForTimeout(35000); // cross the usual MV3 idle window while the preview is open
  assert.equal(await fresh.backup.locator('#summary').isVisible(), true);
  assert.equal(await fresh.backup.locator('#import').isDisabled(), true);
  await fresh.backup.locator('#confirm').check();
  await fresh.backup.locator('#import').click();
  await fresh.backup.locator('#notice').getByText(/Learning progress imported/).waitFor();
  const restored = await fresh.worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(restored.recallReview.cards.y.reviews, 2);
  assert.equal(restored.recallReview.cards.pero.familiar, true);
  assert.equal(restored.personalVocabularyV1.entries[0].archived, true);
  assert.equal(restored[`lang:fr:${version}:recallReview`].cards.mot0.reviews, 1);
  assert.equal(restored['lang:de:aaaaaaaaaaaaaaaa:recallReview'].learning.count, 1);
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
  // review-flow (#20) shows #finish after a rating in a session, #empty otherwise. Wait for
  // whichever appears, then require the finish card, which is what this scenario must reach.
  await review.locator('#finish:visible, #empty:visible').first().waitFor();
  assert.equal(await review.locator('#finish').isVisible(), true);
  const rated = await fresh.worker.evaluate(() => chrome.storage.local.get('recallReview'));
  // FSRS (0.12.6): the restored card migrates at this rating, writes its memory state, and the
  // rating is logged as one standalone retrieval with word ID and fixed fields only.
  assert.ok(rated.recallReview.cards.y.interval >= 1);
  assert.equal(rated.recallReview.cards.y.reviews, 3);
  assert.equal(typeof rated.recallReview.cards.y.fsrs?.stability, 'number');
  const logged = await fresh.worker.evaluate(() => chrome.storage.local.get('learningRetrievals'));
  const last = logged.learningRetrievals.retrievals.at(-1);
  assert.deepEqual([last[0], last[2], last[3], last[4], last[5]], ['y', 'standalone', 'productive', 'hard', 2]);
  assert.ok(!JSON.stringify(logged).includes('http'));
  assert.equal(await fresh.worker.evaluate(() => chrome.storage.local.get('apiKey').then((v) => !!v.apiKey)), false);
  console.log(`portability MV3 PASS: keyless ${old.id} -> stable ${fresh.id}; file preview/import and keyless review`);
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true }); // own scratch created above
}

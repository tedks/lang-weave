// Confirms the packaged writer and restore UI using synthetic data in disposable profiles.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, chromiumBinary, extensionRoot, waitForExtensionWorker } from './browser.mjs';

const { hashKey } = await import(pathToFileURL(join(extensionRoot, 'src', 'hash.js')).href);
const { version: writerVersion } = JSON.parse(await readFile(join(extensionRoot, 'manifest.json'), 'utf8'));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-measurements-'));
const stableId = 'lkbkmlgogcpcacjmdmoecgacdbfddbnh';
const forms = ['il/elle', 'z.B.', 'EU:n'];
const words = Array.from({ length: 20 }, (_, i) => ({ fr: forms[i] ?? `mot${i}`, en: `word${i}`,
  hint: `moh${i}`, level: i < 10 ? 1 : 2 }));
const version = hashKey(JSON.stringify(words));
const scope = `lang:fr:${version}`;
const historicalScope = 'lang:fr:bbbbbbbbbbbbbbbb';
const packRetrievals = `${scope}:learningRetrievals`;
const packExposures = `${scope}:learningExposures`;
const packDates = `${scope}:readingDaysV1`;
const dates = ['2026-10-29', '2026-10-31'];
const exposures = { version: 1, words: Object.fromEntries(forms.map((word, i) =>
  [word, [i + 1, 0, 1, dates[0], dates[0]]])) };
const review = (word, at) => [word, at, 'standalone', 'productive', 'medium', 1, 3000, 2, 3, 0.91];
const guess = (word, at) => [word, at, 'guess', 'receptive', 'correct', 0, 1500, null, null, null];
const spanishGuess = guess('y', 20000);
const generated = [guess(forms[0], 20001), review(forms[1], 20002), review(forms[2], 20003)];

async function withBackupPage(name, extension, visit) {
  const browser = await chromium.launchPersistentContext(join(scratch, name), {
    ...chromiumBinary, headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
  });
  try {
    const worker = await waitForExtensionWorker(browser);
    assert.equal(new URL(worker.url()).host, stableId);
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${stableId}/src/backup.html`);
    await page.waitForFunction(async () => !!(await chrome.storage.local.get('settings')).settings);
    await visit(page, worker);
  } finally {
    await browser.close();
  }
}

async function exportFile(page, worker, schema) {
  const before = await worker.evaluate(() => chrome.storage.local.get(null));
  const downloading = page.waitForEvent('download');
  await page.locator('#export').click();
  const file = join(scratch, `measurements-${schema}.json`);
  await (await downloading).saveAs(file);
  await page.locator('#notice').getByText(/downloaded/i).waitFor();
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(null)), before);
  const json = await readFile(file, 'utf8');
  assert.ok(Buffer.byteLength(json) <= 1024 * 1024);
  for (const forbidden of ['synthetic-backup-marker', 'source.example', 'private passage', 'c:https'])
    assert.ok(!json.includes(forbidden), `backup exposed ${forbidden}`);
  const backup = JSON.parse(json);
  assert.equal(backup.schemaVersion, schema);
  assert.equal(backup.exportedByVersion, writerVersion);
  const scopes = backup.state.scopes;
  const es = scopes.es.retrievals.retrievals;
  const pack = scopes[scope].retrievals.retrievals;
  assert.deepEqual(es.at(-1), spanishGuess);
  assert.deepEqual(pack.slice(-3), generated);
  assert.deepEqual(scopes[scope].exposures, exposures);
  assert.deepEqual(scopes[scope].readingDays, schema === 3 ? dates : undefined);
  assert.equal(scopes[historicalScope], undefined);
  const omitted = backup.state.logOmitted;
  const kept = es.length + pack.length;
  assert.equal(kept + omitted.retrievals, 10000);
  assert.ok(omitted.retrievals > 1, 'the byte budget omits retrievals in addition to one unverified word');
  assert.equal(omitted.exposureWords, forms.length, 'all exposure omissions are from the stale scope');
  return { file, schema, scopes, kept, omitted };
}

async function restore(page, worker, exported, expectedVersion, { current = false } = {}) {
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), expectedVersion);
  const before = await worker.evaluate(async () => ({
    storage: await chrome.storage.local.get(null), grants: await chrome.permissions.getAll(),
  }));
  assert.equal(before.storage.languagePacks, undefined);
  assert.equal(before.storage.apiKey, undefined);
  await page.locator('#file').setInputFiles(exported.file);
  await page.locator('#preview').click();
  await page.locator('#notice').getByText(/Preview validated/).waitFor();
  if (current) {
    const preview = await page.locator('#measurements').textContent();
    assert.match(preview, new RegExp(`${exported.kept} logged reviews and guesses, exposure counts for 4 words`));
    assert.match(preview, new RegExp(`Left out: ${exported.omitted.retrievals} reviews or guesses and exposure counts for 3 words`));
    assert.equal(preview.includes('includes reading-day dates'), exported.schema === 3);
  }
  assert.equal(await page.locator('#import').isDisabled(), true);
  await page.locator('#confirm').check();
  await page.locator('#import').click();
  await page.locator('#notice').getByText(/Learning progress imported/).waitFor();
  const after = await worker.evaluate(async () => ({
    storage: await chrome.storage.local.get(null), grants: await chrome.permissions.getAll(),
  }));
  const restored = after.storage;
  assert.deepEqual(restored.languagePacks.fr.words.map((word) => word.fr), words.map((word) => word.fr));
  assert.deepEqual(restored.learningRetrievals, exported.scopes.es.retrievals);
  assert.deepEqual(restored.learningExposures, exported.scopes.es.exposures);
  assert.deepEqual(restored[packRetrievals], exported.scopes[scope].retrievals);
  assert.deepEqual(restored[packExposures], exposures);
  assert.deepEqual(restored[packDates], exported.schema === 3 ? dates : undefined);
  assert.equal(restored[`${historicalScope}:learningExposures`], undefined);
  assert.equal(restored.apiKey, undefined);
  assert.equal(restored['c:https://source.example/private'], undefined);
  assert.equal(restored.settings.newSitesEnabled, before.storage.settings.newSitesEnabled);
  assert.deepEqual(restored.settings.siteOverrides, before.storage.settings.siteOverrides);
  assert.deepEqual(after.grants, before.grants);
  console.log(`format ${exported.schema} restored by ${expectedVersion}: ${exported.kept} retrievals, 4 exposure words; ${exported.omitted.retrievals} retrievals and 3 exposure words omitted`);
}

try {
  const exports = [];
  await withBackupPage('source', extensionRoot, async (page, worker) => {
    const help = await page.locator('[data-i18n="backup_export_compatibility"]').textContent();
    assert.match(help, /Guess first.*0\.12\.21.*0\.12\.22.*0\.13\.3.*bundled language selection.*newer version/);
    const oldReviews = (word, start, count) => Array.from({ length: count }, (_, i) => review(word, start + i));
    await worker.evaluate(async (data) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ ...data,
        settings: { ...settings, siteOverrides: { 'source.example': true } } });
    }, {
      apiKey: 'synthetic-backup-marker',
      'c:https://source.example/private': { s: ['private passage'] },
      languagePacks: { fr: { version, words } },
      learningRetrievals: { version: 1, retrievals: [
        ...oldReviews('y', 1, 4998), spanishGuess, guess(forms[0], 20004),
      ] },
      learningExposures: { version: 1, words: { y: [1, 0, 1, dates[0], dates[0]] } },
      [packRetrievals]: { version: 1, retrievals: [...oldReviews('mot3', 10000, 4997), ...generated] },
      [packExposures]: exposures,
      [`${historicalScope}:learningExposures`]: exposures,
    });
    exports.push(await exportFile(page, worker, 2));
    await worker.evaluate(({ key, days }) => chrome.storage.local.set({ [key]: days }), { key: packDates, days: dates });
    exports.push(await exportFile(page, worker, 3));
  });
  for (const exported of exports) {
    await withBackupPage(`current-${exported.schema}`, extensionRoot,
      (page, worker) => restore(page, worker, exported, writerVersion, { current: true }));
    const historical = exported.schema === 2
      ? { extension: process.env.LANG_WEAVE_FORMAT_2_READER, version: '0.12.22' }
      : { extension: process.env.LANG_WEAVE_FORMAT_3_READER, version: '0.13.3' };
    if (historical.extension) await withBackupPage(`historical-${exported.schema}`, historical.extension,
      (page, worker) => restore(page, worker, exported, historical.version));
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

// Guarded throwaway Chromium MV3 flow. The native OS menu is not automated:
// an isolated copy exposes the exact registered production listener for one synthetic click.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-personal-'));
const extension = join(scratch, 'extension');
let browser;
try {
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  await cp(join(root, 'icons'), join(extension, 'icons'), { recursive: true }); // the manifest names them; Chrome refuses to load without
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(...manifest.optional_host_permissions); // only the isolated profile gets grants
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const workerPath = join(extension, 'src', 'background.js');
  const workerSource = await readFile(workerPath, 'utf8');
  assert.match(workerSource, /chrome\.contextMenus\?\.onClicked\?\.addListener\(captureMenuListener\)/);
  await writeFile(workerPath, `${workerSource}\n// Isolated harness only; never shipped.\nglobalThis.syntheticCaptureClick = captureMenuListener;\n`);
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, enabled: true, newSitesEnabled: true,
      gradual: true, newWordsPerDay: 1, inlineRecall: true } });
    globalThis.personalModelCalls = 0;
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, init);
      globalThis.personalModelCalls++;
      if (init.headers['x-goog-api-key'] !== 'synthetic-personal-key') throw new Error('Synthetic key mismatch');
      const body = JSON.parse(init.body);
      const passages = JSON.parse(body.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        passages: passages.map(({ id, text }) => ({ id, swaps: text.includes('shimmer')
          ? [{ o: 'shimmer', f: 'brillar', ctx: '' }] : [] })) }) }] } }] }),
      { headers: { 'Content-Type': 'application/json' } });
    };
  });
  await browser.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html',
    body: `<!doctype html><html lang="en"><head><title>Reading</title></head><body><main>
      <p id="reading">We saw shimmer around the quiet garden today.</p>
      <p id="collision">We saw sparkle around the quiet garden today.</p>
      </main></body></html>`,
  }));
  const reading = await browser.newPage();
  await reading.goto('https://reading.example/story');
  await reading.waitForTimeout(1500);
  const beforeCaptureCalls = await worker.evaluate(() => globalThis.personalModelCalls);
  const extensionId = await worker.evaluate(() => chrome.runtime.id);
  const capture = async (selector, text) => {
    await reading.bringToFront();
    await reading.locator(selector).evaluate((el, expected) => {
      const node = el.firstChild;
      const offset = node.textContent.indexOf(expected);
      if (offset < 0) throw new Error('Selection text missing');
      const range = document.createRange();
      range.setStart(node, offset); range.setEnd(node, offset + expected.length);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, text);
    await reading.locator(selector).dispatchEvent('contextmenu'); // content script re-announces the document
    await reading.waitForTimeout(100);
    const tab = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0], reading.url());
    assert.ok(tab?.id);
    const opened = browser.waitForEvent('page');
    await worker.evaluate(({ id, pageUrl, selectionText }) => globalThis.syntheticCaptureClick({
      menuItemId: 'lang-weave-add-selection', selectionText, frameId: 0, editable: false, pageUrl,
    }, { id, title: 'Reading' }), { id: tab.id, pageUrl: reading.url(), selectionText: text });
    const page = await opened;
    await page.waitForLoadState();
    await page.waitForTimeout(250);
    if (!(await page.locator('#selected').textContent()).includes(text))
      throw new Error(`Capture explanation: ${await page.locator('#notice').textContent()}`);
    await page.locator('#selected').getByText(text).waitFor();
    return page;
  };
  const first = await capture('#reading', 'shimmer');
  assert.equal(await worker.evaluate(() => globalThis.personalModelCalls), beforeCaptureCalls); // menu/draft never fetched
  await first.locator('input[value="en-to-target"]').check();
  await first.locator('#target').fill('brillar');
  await first.locator('#save').click();
  await first.locator('#notice').getByText(/Saved as a personal entry/).waitFor();
  const personal = () => worker.evaluate(() => chrome.storage.local.get('personalVocabularyV1'));
  let saved = (await personal()).personalVocabularyV1;
  assert.equal(saved.entries.length, 1);
  const id = saved.entries[0].id;
  assert.equal(saved.history.es?.cards?.[id], undefined); // Save alone did not introduce
  assert.equal(await worker.evaluate(() => chrome.storage.local.get('apiKey').then((data) => !!data.apiKey)), false);
  await worker.evaluate(() => chrome.storage.local.set({ apiKey: 'synthetic-personal-key' }));
  await reading.reload(); // the content script now receives a key-enabled reading config
  await reading.bringToFront();
  await reading.locator('#reading').scrollIntoViewIfNeeded();
  await reading.locator('#reading .fw-word').waitFor({ timeout: 10000 });
  for (let i = 0; i < 50; i++) {
    saved = (await personal()).personalVocabularyV1;
    if (saved.history.es?.cards?.[id]) break;
    await reading.waitForTimeout(100);
  }
  assert.ok(saved.history.es.cards[id]); // visible content-script acknowledgement
  assert.equal(saved.history.es.learning.count, 1);
  assert.equal(saved.history.es.cards[id].reviews, 0);
  const review = await browser.newPage();
  await review.goto(`chrome-extension://${extensionId}/src/review.html`);
  await review.locator('#prompt').getByText('shimmer').waitFor();
  await review.locator('#reveal').click();
  await review.locator('#answer').getByText('brillar').waitFor();
  await review.locator('[data-rating="again"]').click();
  for (let i = 0; i < 50; i++) {
    saved = (await personal()).personalVocabularyV1;
    if (saved.history.es.cards[id].reviews === 1) break;
    await review.waitForTimeout(100);
  }
  assert.equal(saved.history.es.cards[id].reviews, 1);
  assert.equal(saved.history.es.cards[id].interval, 0);

  const second = await capture('#collision', 'sparkle');
  await second.locator('input[value="en-to-target"]').check();
  await second.locator('#target').fill('brillar');
  await second.locator('#distinct').check();
  await second.locator('#save').click();
  await second.locator('#notice').getByText(/review-only/).waitFor();
  saved = (await personal()).personalVocabularyV1;
  assert.equal(saved.entries.length, 2);
  assert.equal(saved.history.es.cards[id].reviews, 1);
  await second.locator('#entries li').filter({ hasText: 'sparkle' }).getByText('Archive', { exact: true }).click();
  await second.locator('#entries li').filter({ hasText: 'sparkle' }).getByText('Unarchive', { exact: true }).waitFor();
  saved = (await personal()).personalVocabularyV1;
  assert.equal(saved.entries.find((entry) => entry.source === 'sparkle').archived, true);
  const downloadReady = second.waitForEvent('download');
  await second.locator('#export').click();
  const download = await downloadReady;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.entries.length, 2);
  assert.equal(exported.history.es.cards[id].reviews, 1);
  assert.ok(!JSON.stringify(exported).includes('reading.example'));
  assert.ok(!JSON.stringify(exported).includes('synthetic-personal-key'));
  console.log('PASS: guarded MV3 production listener with synthetic menu event, exact-document challenge, keyless local capture/Save, visible budgeted introduction, review/Again, collision review-only, archive/export. Native OS menu click and live Gemini were not exercised.');
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true }); // this script owns its unique scratch directory
}

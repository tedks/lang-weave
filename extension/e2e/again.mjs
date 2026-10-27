// Isolated MV3 flow: failed inline recall becomes a short due manual review.
// The model is synthetic and Chromium has explicit DNS/proxy denial.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-again-'));
const extension = join(scratch, 'extension');
let browser;
try {
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(...manifest.optional_host_permissions); // isolated test grant
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    globalThis.virtualNow = Date.now();
    Date.now = () => globalThis.virtualNow;
    globalThis.modelCalls = 0;
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, init);
      globalThis.modelCalls++;
      assertSynthetic(init);
      const passages = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages:
        passages.map(({ id, text }) => ({ id, swaps: text.includes('the idea')
          ? [{ o: 'the idea', f: 'la idea', g: 'the idea', h: '', ctx: '' }] : [] })) }) }] } }] }),
      { headers: { 'Content-Type': 'application/json' } });
    };
    function assertSynthetic(init) {
      if (init.headers['x-goog-api-key'] !== 'synthetic-again-key') throw new Error('Unexpected key');
    }
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      settings: { ...settings, enabled: true, newSitesEnabled: true, gradual: true,
        inlineRecall: true, newWordsPerDay: 1 },
      apiKey: 'synthetic-again-key',
      recallReview: { version: 1, cards: { 'la idea': { due: globalThis.virtualNow - 1000,
        interval: 21, reviews: 7, easyStreak: 2, introducedDay: '2000-01-01' } },
        current: null, inline: null, learning: { day: '2000-01-01', count: 1, pending: [] } },
    });
  });
  await browser.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html',
    body: '<main><p id="reading">We discussed the idea with friends every week.</p></main>' }));
  const page = await browser.newPage();
  await page.goto('https://reading.example/article');
  const cue = page.locator('#reading .fw-word');
  await cue.waitFor();
  await page.waitForFunction(() => document.querySelector('#reading .fw-word')?.getAttribute('title') === 'Open inline recall');
  const before = await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview));
  assert.equal(before.cards['la idea'].reviews, 7);
  assert.equal(before.learning.count, 1);
  await cue.click();
  await page.locator('.fw-recall button', { hasText: 'Reveal answer' }).waitFor();
  assert.equal(await page.locator('.fw-recall button', { hasText: 'Again' }).count(), 0);
  await page.locator('.fw-recall button', { hasText: 'Reveal answer' }).click();
  assert.equal(await page.locator('.fw-recall button', { hasText: 'Hard' }).evaluate((el) => document.activeElement === el), true);
  const callsBeforeRating = await worker.evaluate(() => globalThis.modelCalls);
  assert.ok(callsBeforeRating >= 1);
  await page.locator('.fw-recall button', { hasText: 'Again' }).click();
  await page.locator('.fw-recall').waitFor({ state: 'detached' });
  const rated = await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview));
  assert.equal(rated.cards['la idea'].due, before.cards['la idea'].due + 1000 + 10 * 60 * 1000);
  assert.equal(rated.cards['la idea'].interval, 0);
  assert.equal(rated.cards['la idea'].reviews, 8);
  assert.equal(rated.cards['la idea'].easyStreak, 0);
  assert.equal(rated.cards['la idea'].introducedDay, '2000-01-01');
  assert.equal(rated.learning.count, 1);
  assert.equal(await cue.getAttribute('title'), null);
  assert.equal(await cue.textContent(), 'la idea');
  assert.equal(await worker.evaluate(() => globalThis.modelCalls), callsBeforeRating);
  const review = await browser.newPage();
  await review.goto(`chrome-extension://${id}/src/review.html`);
  await review.locator('#counts').getByText(/^0 due/).waitFor();
  assert.equal(await review.locator('#question').isHidden(), true);
  await worker.evaluate(() => {
    if (!Number.isSafeInteger(globalThis.virtualNow)) throw new Error('Synthetic worker clock was lost');
    globalThis.virtualNow += 10 * 60 * 1000 - 1;
  });
  await review.locator('#refresh').click();
  await review.locator('#counts').getByText(/^0 due/).waitFor();
  await worker.evaluate(() => {
    if (!Number.isSafeInteger(globalThis.virtualNow)) throw new Error('Synthetic worker clock was lost');
    globalThis.virtualNow++;
  });
  await review.locator('#refresh').click();
  await review.locator('#prompt').getByText('the idea').waitFor();
  assert.equal(await review.locator('#solution').isHidden(), true);
  await review.locator('#reveal').click();
  await review.locator('#solution').waitFor({ state: 'visible' });
  assert.equal(await review.locator('[data-rating="again"]').isVisible(), true);
  assert.equal(await worker.evaluate(() => globalThis.modelCalls), callsBeforeRating);
  console.log('PASS: guarded MV3 synthetic inline Again retains history/budget, waits exact virtual ten minutes, then permits standalone review without another model call or immediate cue.');
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true });
}

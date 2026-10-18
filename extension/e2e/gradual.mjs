// Isolated real MV3 Chromium with a synthetic Gemini reply and throwaway profile.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { cleanPack } from '../src/languages.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-gradual-'));
const extension = join(scratch, 'extension');
let browser;
try {
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(...manifest.optional_host_permissions); // test grant only
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, gradual: true, inlineRecall: true,
      newWordsPerDay: 1, newSitesEnabled: true }, apiKey: 'synthetic-gradual-key' });
    globalThis.calls = [];
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, init);
      if (init.headers['x-goog-api-key'] !== 'synthetic-gradual-key') throw new Error('Key mismatch');
      const body = JSON.parse(init.body);
      const passages = JSON.parse(body.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      globalThis.calls.push(...passages.map((p) => p.text));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages:
        passages.map(({ id, text }) => ({ id, swaps: text.includes('the idea')
          ? [{ o: 'the idea', f: 'la idea', g: 'the idea', h: '', ctx: '' }] : [] })) }) }] } }] }),
      { headers: { 'Content-Type': 'application/json' } });
    };
  });
  const html = `<!doctype html><html lang="en"><body><main>
    <p id="reading">We discussed the idea with friends every week.</p>
    <p id="health">The doctor explained the idea behind my medication.</p>
    <form><p>Private form text and the idea stay here.</p><input value="private"></form>
    <p contenteditable="true">Editable the idea stays here.</p>
  </main></body></html>`;
  await browser.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  const page = await browser.newPage();
  await page.goto('https://reading.example/one');
  const word = page.locator('#reading .fw-word');
  await word.waitFor();
  assert.equal(await word.getAttribute('data-fr'), 'la idea');
  assert.equal(await word.getAttribute('title'), null); // first encounter is reading, not an immediate quiz
  assert.equal(await page.locator('#health .fw-word, form .fw-word, [contenteditable] .fw-word').count(), 0);
  const first = await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview));
  assert.equal(first.learning.count, 1);
  assert.ok(first.cards['la idea']);
  assert.ok((await worker.evaluate(() => globalThis.calls)).every((s) => !/doctor|Private form|Editable/.test(s)));

  await page.goto('https://reading.example/two');
  const due = page.locator('#reading .fw-word');
  await due.waitFor();
  assert.equal(await due.getAttribute('title'), 'Open inline recall');
  assert.equal(await due.textContent(), 'the idea → [?]');
  assert.equal(await page.locator('#reading').textContent(), 'We discussed the idea → [?] with friends every week.');
  await due.click();
  await page.locator('.fw-recall').waitFor();
  assert.match(await page.locator('.fw-recall').textContent(), /the idea → \[\?\]/);
  await page.locator('.fw-recall button', { hasText: 'Dismiss' }).click();
  assert.equal(await page.locator('.fw-recall').count(), 0);
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].reviews, 0);
  await due.click();
  await page.locator('.fw-recall button', { hasText: 'Reveal answer' }).click();
  await page.locator('.fw-recall button', { hasText: 'Easy' }).click();
  await page.locator('.fw-recall').waitFor({ state: 'detached' });
  const rated = await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview));
  assert.equal(rated.cards['la idea'].reviews, 1);
  assert.equal(rated.cards['la idea'].interval, 7);
  const review = await browser.newPage();
  await review.goto(`chrome-extension://${id}/src/review.html`);
  await review.locator('#counts').getByText(/0 due/).waitFor();
  assert.equal(await review.locator('#question').isHidden(), true);

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  await popup.locator('#gradual').uncheck();
  await page.waitForFunction(() => document.querySelector('#reading .fw-word')?.getAttribute('title') !== 'Open inline recall');
  await popup.locator('#enabled').uncheck();
  await page.waitForFunction(() => document.querySelectorAll('.fw-word').length === 0);
  assert.equal(await page.locator('#reading').textContent(), 'We discussed the idea with friends every week.');
  await popup.locator('#enabled').check();
  await page.locator('#reading .fw-word').waitFor();
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'save', siteOverride: { host: 'reading.example', enabled: false } }));
  await page.waitForFunction(() => document.querySelectorAll('.fw-word').length === 0);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'save', siteOverride: { host: 'reading.example', enabled: true } }));
  await page.locator('#reading .fw-word').waitFor();

  const pack = cleanPack({ words: Array.from({ length: 20 }, (_, i) => ({
      fr: `mot${i}`, en: `word${i}`, hint: `hint${i}`, level: i < 10 ? 1 : 2,
    })) }, 'fr');
  await worker.evaluate(async (pack) => {
    await chrome.storage.local.set({ languagePacks: { fr: pack } });
  }, pack);
  await popup.reload();
  await popup.locator('#language').selectOption('fr');
  await popup.locator('#wordInfo').getByText(/French words/).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.fw-word').length === 0);
  assert.equal(await page.locator('#reading').textContent(), 'We discussed the idea with friends every week.');
  assert.equal(await worker.evaluate(() => chrome.storage.local.get('settings').then((x) => x.settings.language)), 'fr');
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].reviews, 1);
  console.log('PASS: Chromium MV3 gradual introduction, persisted budget, due inline reveal/rate, review interoperability, exclusions, off/site restoration and language isolation; Gemini synthetic.');
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true });
}

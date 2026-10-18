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
    // A restarted MV3 worker loses the synthetic fetch; DNS must then fail
    // closed instead of sending the throwaway prompt to the real endpoint.
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
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
          ? [{ o: 'the idea', f: 'la idea', g: 'the idea', h: '', ctx: '' }]
          : text.includes('the question') ? [{ o: 'the question', f: 'la pregunta', g: 'the question', h: '', ctx: '' }] : [] })) }) }] } }] }),
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
  assert.equal(await due.getAttribute('data-fr'), null);
  assert.equal(await due.getAttribute('data-tip'), null);
  assert.equal(await page.locator('#reading').textContent(), 'We discussed the idea → [?] with friends every week.');
  await due.evaluate((span) => {
    span.click();
    span.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  assert.equal(await page.locator('.fw-recall').count(), 0); // page script cannot open a ticket
  await due.evaluate((span) => span.setAttribute('data-en', 'forged cue'));
  await due.click();
  await page.locator('.fw-recall').waitFor();
  assert.match(await page.locator('.fw-recall').textContent(), /the idea → \[\?\]/);
  await due.evaluate((span) => span.setAttribute('data-en', 'the idea'));
  await page.locator('.fw-recall button', { hasText: 'Reveal answer' }).waitFor();
  await page.evaluate(() => [...document.querySelectorAll('.fw-recall button')]
    .find((button) => button.textContent === 'Reveal answer').click());
  assert.equal(await page.locator('.fw-recall button', { hasText: 'Easy' }).count(), 0);
  await page.locator('.fw-recall button', { hasText: 'Reveal answer' }).click();
  await page.locator('.fw-recall button', { hasText: 'Already know' }).waitFor();
  await page.evaluate(() => [...document.querySelectorAll('.fw-recall button')]
    .find((button) => button.textContent === 'Already know').click());
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].familiar, undefined);
  await page.locator('.fw-recall button', { hasText: 'Dismiss' }).click();
  assert.equal(await page.locator('.fw-recall').count(), 0);
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].reviews, 0);
  await due.click();
  await page.locator('.fw-recall').waitFor();
  await due.evaluate((span) => span.remove());
  await page.locator('.fw-recall button', { hasText: 'Reveal answer' }).click();
  await page.locator('.fw-recall').waitFor({ state: 'detached', timeout: 2000 });
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].reviews, 0);
  await page.reload();
  await due.waitFor();
  await due.click();
  await page.locator('.fw-recall button', { hasText: 'Reveal answer' }).click();
  await due.evaluate((span) => span.remove());
  await page.locator('.fw-recall button', { hasText: 'Easy' }).click();
  await page.locator('.fw-recall').waitFor({ state: 'detached', timeout: 2000 });
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].reviews, 0);
  await page.reload();
  await due.waitFor();
  await due.click();
  await page.locator('.fw-recall button', { hasText: 'Reveal answer' }).click();
  const canFailWrite = await worker.evaluate(() => {
    const original = chrome.storage.local.set;
    const failOnce = (...args) => {
      if (Object.hasOwn(args[0], 'recallReview')) {
        chrome.storage.local.set = original;
        return Promise.reject(new Error('Synthetic rating storage failure'));
      }
      return original.call(chrome.storage.local, ...args);
    };
    chrome.storage.local.set = failOnce;
    return chrome.storage.local.set === failOnce;
  });
  assert.equal(canFailWrite, true);
  await page.locator('.fw-recall button', { hasText: 'Easy' }).click();
  await page.locator('.fw-recall-status').getByText(/Rating was not saved/).waitFor();
  assert.equal(await page.locator('.fw-recall button:disabled').count(), 0);
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview))).cards['la idea'].reviews, 0);
  await page.locator('.fw-recall button', { hasText: 'Easy' }).click();
  await page.locator('.fw-recall').waitFor({ state: 'detached' });
  const rated = await worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview));
  assert.equal(rated.cards['la idea'].reviews, 1);
  assert.equal(rated.cards['la idea'].interval, 7);
  await page.waitForFunction(() => {
    const span = document.querySelector('#reading .fw-word');
    return span && span.textContent === 'la idea' && span.getAttribute('title') !== 'Open inline recall';
  }); // a rated cue is repainted under the now-active policy
  const review = await browser.newPage();
  await review.goto(`chrome-extension://${id}/src/review.html`);
  await review.locator('#counts').getByText(/0 due/).waitFor();
  assert.equal(await review.locator('#question').isHidden(), true);

  // The current page has exhausted its one-word allowance. A cached empty
  // decision for the same text must be reconsidered after local-day rollover.
  await page.evaluate(() => {
    const p = document.createElement('p'); p.id = 'question';
    p.textContent = 'We discussed the question with friends every week.';
    document.querySelector('main').append(p);
  });
  const questionRequested = await worker.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      if (globalThis.calls.some((text) => text.includes('the question'))) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  });
  assert.equal(questionRequested, true);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#question .fw-word').count(), 0);
  await worker.evaluate(async () => {
    const { recallReview } = await chrome.storage.local.get('recallReview');
    recallReview.learning.day = '2000-01-01';
    await chrome.storage.local.set({ recallReview });
  });
  await page.locator('#question').evaluate((p) => { p.textContent += ' '; }); // same normalized passage
  await page.locator('#question .fw-word').waitFor();
  assert.equal(await page.locator('#question .fw-word').textContent(), 'la pregunta');

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
  console.log('PASS: Chromium MV3 gradual introduction, persisted budget, due inline reveal/rate, detached-cue rejection, review interoperability, exclusions, off/site restoration and language isolation; Gemini synthetic.');
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true });
}

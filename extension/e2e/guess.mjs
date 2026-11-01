// Guess first in isolated real MV3 Chromium: synthetic Gemini replies, a throwaway profile and
// browser-level network denial. Production source and CSS; learning cards seeded in storage.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-guess-'));
const extension = join(scratch, 'extension');
const artifacts = process.argv.includes('--save-screenshots')
  ? join(root, '..', 'docs', 'artifacts') : join(scratch, 'screenshots');
let browser;
try {
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  await cp(join(root, 'icons'), join(extension, 'icons'), { recursive: true }); // the manifest names them; Chrome refuses to load without
  await cp(join(root, '_locales'), join(extension, '_locales'), { recursive: true }); // default_locale needs it
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(...manifest.optional_host_permissions); // test grant only
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width: 760, height: 520 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    for (let i = 0; i < 100 && !(await chrome.storage.local.get('settings')).settings; i++)
      await new Promise((done) => setTimeout(done, 10));
    const { settings } = await chrome.storage.local.get('settings');
    const now = Date.now();
    const d = new Date(now);
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const card = (reviews) => ({ due: now + 5 * 86400000, interval: 5, reviews, introducedDay: today });
    await chrome.storage.local.set({
      settings: { ...settings, gradual: true, inlineRecall: false, newWordsPerDay: 1, newSitesEnabled: true, guessFirst: true },
      apiKey: 'synthetic-guess-key', consentShown: true,
      recallReview: { version: 1, cards: { y: card(1), pero: card(0), o: card(2) }, learning: { day: today, count: 0, pending: [] } },
    });
    globalThis.calls = [];
    const original = fetch;
    const pairs = [['and', 'y'], ['but', 'pero'], ['or', 'o']];
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, init);
      if (init.headers['x-goog-api-key'] !== 'synthetic-guess-key') throw new Error('Key mismatch');
      const body = JSON.parse(init.body);
      const passages = JSON.parse(body.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      globalThis.calls.push(...passages.map((p) => p.text));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages:
        passages.map(({ id, text }) => ({ id, swaps: pairs.filter(([en]) => text.includes(` ${en} `))
          .map(([en, fr]) => ({ o: en, f: fr, g: en, h: '', ctx: '' })) })) }) }] } }] }),
      { headers: { 'Content-Type': 'application/json' } });
    };
  });
  // Long enough that the request-wide unknown-word cap (2% of running words) admits all three swaps.
  const filler = ' The neighbors shared simple stories at the table.'.repeat(6);
  const html = `<!doctype html><html lang="en"><head><title>Guess fixture</title>
    <style>body { font: 20px/1.6 Georgia, serif; margin: 0; } main { padding: 140px 30px 30px; }</style></head><body><main>
    <p id="one">We read and write together every single evening.${filler}</p>
    <p id="two">We cook but rarely eat together every single evening.${filler}</p>
    <p id="three">We walk or run together every single evening outside.${filler}</p>
    <form><p>Private form text and notes stay here every evening.</p></form>
    <p contenteditable="true">Editable text and notes stay here every evening.</p>
  </main></body></html>`;
  await browser.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  const page = await browser.newPage();
  await page.goto('https://reading.example/guess');
  const y = page.locator('#one .fw-word');
  const pero = page.locator('#two .fw-word');
  const o = page.locator('#three .fw-word');
  await y.waitFor();
  await pero.waitFor();
  await o.waitFor();
  assert.equal(await y.getAttribute('data-fr'), 'y');
  assert.equal(await page.locator('form .fw-word, [contenteditable] .fw-word').count(), 0);
  const log = () => worker.evaluate(() => chrome.storage.local.get('learningRetrievals')
    .then((x) => x.learningRetrievals?.retrievals || []));
  const cards = () => worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview.cards));

  // Hover: after the 700 ms beat, choices instead of the gloss.
  await y.hover();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.fw-guess').count(), 0);
  const panel = page.locator('.fw-guess');
  await panel.waitFor();
  assert.equal(await page.locator('.fw-gloss').count(), 0);
  assert.equal(await panel.getAttribute('role'), 'group');
  assert.equal(await panel.getAttribute('aria-label'), 'Guess the meaning');
  const labels = await panel.locator('.fw-guess-choices button span:last-child').allTextContents();
  assert.ok(labels.length >= 3 && labels.length <= 4, labels.join('|'));
  assert.ok(labels.includes('and'));
  // Placement by measured space: fully in the viewport, beside the word, not covering it.
  const [box, word] = await Promise.all([panel.boundingBox(), y.boundingBox()]);
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 760 && box.y + box.height <= 520);
  assert.ok(box.y + box.height <= word.y || box.y >= word.y + word.height);
  // Light theme uses the ui.css document tokens.
  const light = await panel.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
  assert.deepEqual(light, { bg: 'rgb(255, 255, 255)', fg: 'rgb(24, 32, 39)' });
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, 'guess-light.png') });

  // A page script cannot answer, and Escape dismisses without recording.
  await page.evaluate(() => document.querySelector('.fw-guess-choices button').click());
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  assert.equal((await log()).length, 0);

  // Dark theme and forced colours on the reopened panel.
  await page.mouse.move(5, 5);
  await page.emulateMedia({ colorScheme: 'dark' });
  await y.hover();
  await panel.waitFor();
  const dark = await panel.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
  assert.deepEqual(dark, { bg: 'rgb(34, 40, 45)', fg: 'rgb(243, 243, 243)' });
  await page.screenshot({ path: join(artifacts, 'guess-dark.png') });
  await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active' });
  assert.equal(await panel.evaluate((el) => getComputedStyle(el).boxShadow), 'none');
  await page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });

  // A click away dismisses without recording; then a wrong choice by mouse.
  await page.mouse.click(5, 5);
  await panel.waitFor({ state: 'detached' });
  await y.hover();
  await panel.waitFor();
  const before = (await cards()).y;
  const wrong = page.locator('.fw-guess-choices button', { hasNotText: /^\d?and$/ }).first();
  await wrong.click();
  await page.locator('.fw-guess-status', { hasText: 'Not quite: y · and' }).waitFor();
  assert.equal(await page.locator('.fw-guess-right').textContent(), `${labels.indexOf('and') + 1}and`);
  assert.equal(await page.locator('.fw-guess-wrong').count(), 1);
  let entries = await log();
  assert.equal(entries.length, 1);
  const [wordId, at, source, direction, outcome, prior, latency, elapsed, interval, predicted] = entries[0];
  assert.deepEqual([wordId, source, direction, outcome, prior, elapsed, interval, predicted],
    ['y', 'guess', 'receptive', 'incorrect', 1, null, null, null]);
  assert.ok(Number.isSafeInteger(at) && latency > 0 && latency < 60000, `latency ${latency}`);
  const after = (await cards()).y;
  assert.equal(after.peekCount, 1); // a wrong guess is a peek
  assert.equal(after.due, before.due); // FSRS is untouched

  // One guess a word a day: the next dwell is the plain gloss.
  await page.mouse.click(5, 5);
  await panel.waitFor({ state: 'detached' });
  await page.mouse.move(5, 5);
  await y.hover();
  await page.locator('.fw-gloss-on').waitFor();
  assert.equal(await page.locator('.fw-guess').count(), 0);

  // Keyboard on another word: focus opens without moving focus; arrows and 2 pick, Enter confirms.
  await page.mouse.move(5, 5);
  await pero.focus();
  await panel.waitFor();
  assert.equal(await pero.evaluate((el) => document.activeElement === el), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('.fw-guess') !== null), true);
  await page.keyboard.press('2');
  const chosen = await page.evaluate(() => document.activeElement.lastChild.textContent);
  await page.keyboard.press('Enter');
  await page.locator('.fw-guess-status').filter({ hasText: 'pero · but' }).waitFor();
  assert.equal(await pero.evaluate((el) => document.activeElement === el), true); // focus returned
  entries = await log();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[1].slice(0, 5).filter((_, i) => i !== 1),
    ['pero', 'guess', 'receptive', chosen === 'but' ? 'correct' : 'incorrect']);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });

  // Click-to-flip is unchanged and records no guess.
  await o.click();
  assert.equal(await o.textContent(), 'or');
  await o.click();
  assert.equal(await o.textContent(), 'o');
  assert.equal((await log()).length, 2);

  // My words: the measurement with its not-enough-data state.
  const words = await browser.newPage();
  await words.goto(`chrome-extension://${id}/src/words.html`);
  await words.locator('#measures li', { hasText: 'First-guess accuracy' }).waitFor();
  assert.match(await words.locator('#measures li', { hasText: 'First-guess accuracy' }).textContent(),
    /Not enough data yet: 2 words guessed; 10 are needed\./);
  assert.match(await words.locator('#measures li', { hasText: 'Next-day recall after guessing' }).textContent(),
    /Not enough data yet/);

  // Settings off: no new model call or repaint, and a hover is the plain gloss again.
  const callsBefore = (await worker.evaluate(() => globalThis.calls)).length;
  const options = await browser.newPage();
  await options.goto(`chrome-extension://${id}/src/options.html`);
  await options.locator('#guessFirst').waitFor();
  assert.equal(await options.locator('#guessFirst').isChecked(), true);
  await options.locator('#guessFirst').uncheck();
  await options.waitForFunction(() => document.querySelector('#guessFirst').checked === false);
  for (let i = 0; i < 50 && (await worker.evaluate(() => chrome.storage.local.get('settings')
    .then((x) => x.settings.guessFirst))) !== undefined; i++) await options.waitForTimeout(20);
  assert.equal(await worker.evaluate(() => chrome.storage.local.get('settings').then((x) => 'guessFirst' in x.settings)), false);
  await page.bringToFront();
  await page.mouse.move(5, 5);
  await o.hover();
  await page.locator('.fw-gloss-on').waitFor();
  assert.equal(await page.locator('.fw-guess').count(), 0);
  assert.equal(await y.getAttribute('data-fr'), 'y'); // the swaps were not repainted
  assert.equal((await worker.evaluate(() => globalThis.calls)).length, callsBefore);
  assert.ok((await worker.evaluate(() => globalThis.calls)).every((text) => !/Private form|Editable/.test(text)));
  console.log('PASS: Chromium MV3 guess first: hover and keyboard panels after the beat, light/dark/forced colours, placement, ' +
    'Escape/click-away/untrusted no-record, wrong guess as peek with worker latency, one a day, flip unchanged, ' +
    'My words not-enough-data, Settings off without repaint; Gemini synthetic.');
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true });
}

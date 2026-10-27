// Throwaway Chromium MV3 flow. Gemini is synthetic and DNS is blocked.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-adaptive-'));
const extension = join(scratch, 'extension');
let browser;
try {
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(...manifest.optional_host_permissions); // only the test profile gets this grant
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, enabled: true, newSitesEnabled: true,
      gradual: true, newWordsPerDay: 1 }, apiKey: 'synthetic-adaptive-key' });
    globalThis.adaptiveCalls = [];
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, init);
      if (init.headers['x-goog-api-key'] !== 'synthetic-adaptive-key') throw new Error('Synthetic key mismatch');
      const body = JSON.parse(init.body);
      const passages = JSON.parse(body.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      globalThis.adaptiveCalls.push({ system: body.systemInstruction.parts[0].text,
        texts: passages.map((p) => p.text) });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        passages: passages.map(({ id, text }) => ({ id, swaps: text.includes('the idea')
          ? [{ o: 'the idea', f: 'la idea', g: 'the idea', h: '', ctx: '' }]
          : text.includes('the question') ? [{ o: 'the question', f: 'la pregunta',
            g: 'the question', h: '', ctx: '' }] : [] })) }) }] } }] }),
      { headers: { 'Content-Type': 'application/json' } });
    };
  });
  await browser.route('https://reading.example/**', (route) => {
    const question = route.request().url().includes('question');
    const body = question ? '<p id="reading">We discussed the question with friends today.</p>'
      : '<div style="height:1100px"></div><p id="reading">We discussed the idea with friends today.</p>';
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Reading</title></head><body><main>${body}</main></body></html>` });
  });
  const page = await browser.newPage();
  await page.goto('https://reading.example/idea');
  const saved = () => worker.evaluate(() => chrome.storage.local.get(['recallReview', 'vocabularyEncounters']));
  const calls = () => worker.evaluate(() => globalThis.adaptiveCalls);
  const waitForCard = async (word) => {
    for (let i = 0; i < 40; i++) {
      if ((await saved()).recallReview?.cards?.[word]) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for visible introduction of ${word}`);
  };
  await page.waitForTimeout(1500);
  const beforeVisible = await saved();
  assert.equal(beforeVisible.recallReview?.learning?.count || 0, 0);
  assert.equal(beforeVisible.recallReview?.cards?.['la idea'], undefined);
  await page.locator('#reading').scrollIntoViewIfNeeded();
  await page.locator('#reading .fw-word').waitFor();
  await waitForCard('la idea');
  const first = await saved();
  assert.equal(first.recallReview.cards['la idea'].reviews, 0);
  assert.equal(first.vocabularyEncounters.counts['es:legacy:la%20idea'], 1);
  assert.ok((await calls()).some((call) => call.system.includes('la idea = the idea') &&
    !call.system.includes('la pregunta = the question')));

  await worker.evaluate(async () => {
    const { recallReview } = await chrome.storage.local.get('recallReview');
    for (const word of ['y', 'pero', 'o', 'entonces']) recallReview.cards[word] =
      { due: Date.now() - 1000, interval: 1, reviews: 2 };
    recallReview.learning = { day: '2000-01-01', count: 0, pending: [] };
    await chrome.storage.local.set({ recallReview });
  });
  const beforeThrottle = (await calls()).length;
  await page.goto('https://reading.example/question');
  // Give the worker a bounded interval to expose a delayed, unwanted request.
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#reading .fw-word').count(), 0);
  assert.equal((await calls()).length, beforeThrottle);
  assert.equal((await saved()).recallReview.cards['la pregunta'], undefined);
  assert.equal((await saved()).vocabularyEncounters.counts['es:legacy:la%20pregunta'], 1);

  await worker.evaluate(async () => {
    const data = await chrome.storage.local.get(['recallReview', 'vocabularyEncounters']);
    data.recallReview.cards.y.due = Date.now() + 2 * 86400000;
    data.recallReview.cards.y.interval = 2; // backlog falls from five to four
    const yesterday = new Date(Date.now() - 86400000);
    data.vocabularyEncounters.day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    await chrome.storage.local.set(data);
  });
  await page.goto('https://reading.example/question-again');
  await page.locator('#reading .fw-word').waitFor();
  await waitForCard('la pregunta');
  const later = await saved();
  assert.equal(later.recallReview.learning.count, 1);
  assert.equal(later.recallReview.cards['la pregunta'].reviews, 0);
  assert.equal(later.vocabularyEncounters.counts['es:legacy:la%20pregunta'], 2);
  assert.ok((await calls()).some((call) => call.system.includes('la pregunta = the question')));
  assert.ok(!JSON.stringify(later.vocabularyEncounters).includes('reading.example'));
  console.log('PASS: guarded MV3 adaptive eligible encounters, deterministic current-passage prompt, visible introduction acknowledgement, backlog throttle/resume and unchanged review ratings; Gemini synthetic.');
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true }); // this script owns its unique scratch directory
}

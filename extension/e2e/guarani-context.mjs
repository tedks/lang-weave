// Exact beta ZIP, disposable Chromium profiles, and local synthetic replies.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, chromiumBinary, extensionRoot, grantReadingSite } from './browser.mjs';

const language = 'gn-PY-x-weave';
const host = 'guarani-reading.example';
const origin = `https://${host}`;
const examples = [
  { o: 'book', f: 'aranduka', gloss: 'book (printed volume)',
    positive: 'The visitor read a book beside the station window.',
    negative: 'The visitor should book a room before sunrise.' },
  { o: 'chair', f: 'apyka', gloss: 'chair (seat)',
    positive: 'The volunteer carried a chair into the hall.',
    negative: 'The volunteer will chair the meeting after lunch.' },
  { o: 'water', f: 'y', gloss: 'water',
    positive: 'The café has access to water from a deep well.',
    negative: 'The caretaker has to water the garden today.' },
  { o: 'wind', f: 'yvytu', gloss: 'wind',
    positive: 'We could hear the wind blowing through the shutters.',
    negative: 'We need to wind the clock before we leave.' },
  { o: 'fire', f: 'tata', gloss: 'fire (something burning)',
    positive: 'We watched the fire from a bench on the porch.',
    negative: 'They hope to fire the manager next week.' },
];
const routes = new Map(examples.map((example, index) => [`${origin}/reading/${index}`, example]));

async function checkParagraph(context, worker, extensionUrl, level) {
  const page = await context.newPage();
  await page.goto(`${extensionUrl}paragraph.html#${language}`);
  await page.getByText(`Vocabulary tier: ${level === 1 ? 'Beginner' : 'Expanded'}`).waitFor();
  const source = page.getByRole('textbox', { name: 'Short English paragraph' });
  const find = page.getByRole('button', { name: 'Find words' });
  const occurrence = page.getByRole('combobox', { name: 'Occurrence in your paragraph' });
  const practice = page.getByRole('button', { name: 'Practice this word' });
  const preview = page.locator('#preview');
  const paragraph = 'I read the book that told me how to book a room. She said, “Water tastes better here.”';
  await source.fill(paragraph);
  await find.click();
  const labels = await occurrence.locator('option').allTextContents();
  const chosen = labels.map((label) => label.match(/\[(.*?)\]/)?.[1]);
  assert.deepEqual(chosen, ['book', 'room', 'Water']);
  await occurrence.selectOption(String(chosen.indexOf('Water')));
  await practice.press('Enter');
  assert.equal(await preview.textContent(), paragraph.replace('“Water', '“Y'));
  await occurrence.selectOption(String(chosen.indexOf('book')));
  await practice.press('Enter');
  assert.equal(await preview.textContent(), paragraph.replace('the book', 'the aranduka'));
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('apiKey'))).apiKey, undefined);
  await page.close();
}

for (const [gradual, level] of [[false, 1], [true, 1], [false, 2], [true, 2]]) {
  const profile = await mkdtemp(join(tmpdir(), 'lang-weave-guarani-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      ...chromiumBinary, headless: true, locale: 'en-US',
      args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`,
        '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'],
    });
    await context.route(/^https?:/, (route) => {
      const example = routes.get(route.request().url());
      if (!example) return route.abort();
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="en">
        <head><title>Starter reading sample</title></head><body><main>
        <p id="positive">${example.positive}</p><p id="negative">${example.negative}</p></main></body></html>` });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert.equal(new URL(worker.url()).host, 'lkbkmlgogcpcacjmdmoecgacdbfddbnh');
    const extensionUrl = new URL('/src/', worker.url()).href;
    const welcomeUrl = `${extensionUrl}welcome.html`;
    const welcome = context.pages().find((page) => page.url() === welcomeUrl) ||
      await context.waitForEvent('page', { predicate: (page) => page.url() === welcomeUrl });
    await welcome.locator('#demoLanguage:enabled').waitFor();
    await worker.evaluate(async ({ language, gradual, level, host }) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, language, levelOverride: level,
        gradual, newWordsPerDay: 10, newSitesEnabled: false, siteOverrides: { [host]: true } } });
    }, { language, gradual, level, host });
    if (!gradual) await checkParagraph(context, worker, extensionUrl, level);

    await worker.evaluate(async (examples) => {
      const replies = new Map(examples.flatMap(({ o, f, gloss, positive, negative }) =>
        [positive, negative].map((text) => [text, { o, f, gloss }])));
      globalThis.guaraniRequests = [];
      const delegate = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return delegate(url, init);
        if (init.headers['x-goog-api-key'] !== 'synthetic-guarani-key') throw new Error('Unexpected fixture key');
        const request = JSON.parse(init.body);
        const prompt = request.systemInstruction.parts[0].text;
        const input = JSON.parse(request.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
        const passages = input.map(({ id, text }) => {
          const { o, f, gloss } = replies.get(text) || {};
          const offered = !!f && prompt.includes(JSON.stringify({ target: f, english: gloss }));
          globalThis.guaraniRequests.push({ id, text, offered });
          return { id, swaps: offered ? [{ o, f }] : [] };
        });
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] });
      };
      await chrome.storage.local.set({ apiKey: 'synthetic-guarani-key', consentShown: true });
    }, examples);
    await grantReadingSite(context, worker, `${origin}/*`);
    await welcome.close();

    const page = await context.newPage();
    for (const [url, { o, f, positive, negative }] of routes) {
      await page.goto(url);
      const word = page.locator('#positive .fw-word');
      await word.waitFor({ timeout: 10000 });
      assert.equal(await word.getAttribute('data-en'), o);
      assert.equal(await word.textContent(), f);
      assert.equal(await page.locator('#positive').textContent(), positive.replace(o, f));
      await word.press('Enter');
      assert.equal(await page.locator('#positive').textContent(), positive);
      const { positiveOffered, negativeOffered, cached } = await worker.evaluate(async ({ positive, negative }) => {
        const deadline = Date.now() + 5000;
        let positiveOffered = false, negativeOffered = false, cached = [];
        while (Date.now() < deadline) {
          const requests = globalThis.guaraniRequests;
          positiveOffered = requests.some(({ text, offered }) => text === positive && offered);
          const proposal = requests.find(({ text, offered }) => text === negative && offered);
          if (proposal) {
            negativeOffered = true;
            const key = `c:${proposal.id}`;
            cached = Object.entries(await chrome.storage.local.get(null))
              .filter(([name]) => name === key || name.startsWith(`${key}:gradual:`)).map(([, entry]) => entry.s);
            if (cached.length && positiveOffered) break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return { positiveOffered, negativeOffered, cached };
      }, { positive, negative });
      assert.ok(positiveOffered, `offered ${f} for the noun`);
      assert.ok(negativeOffered, `offered ${f} for the verb fixture before validation`);
      assert.deepEqual(cached, [[]], `worker rejected ${f} before caching or delivering it for the verb fixture`);
      assert.equal(await page.locator('#negative').textContent(), negative);
      assert.equal(await page.locator('#negative .fw-word').count(), 0);
    }
    console.log(`PASS: Guaraní ${gradual ? 'gradual' : 'ordinary'} tier ${level}: five noun positives and five rejected verb proposals${gradual ? '' : ', plus typed keyless practice'}`);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
}

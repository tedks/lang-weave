// Woven reading in the extracted beta ZIP, with isolated profiles and local synthetic replies.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.LANG_WEAVE_PLAYWRIGHT).href);
const extension = process.env.LANG_WEAVE_WELCOME_EXTENSION;
const cases = [
  { form: 'la puerta', gloss: 'the door', rendered: 'La puerta', positive: [
    'The door stuck against the uneven slate threshold.', 'The door',
  ], negative: ['The door handle slipped from a loose metal bracket.', 'The door'] },
  { form: 'el jardín', gloss: 'the garden', rendered: 'jardín', positive: [
    'An open gate led to a garden behind the empty station.', 'garden',
  ], negative: ['The garden path twisted past several stone markers.', 'The garden'] },
  { form: 'el cielo', gloss: 'the sky', rendered: 'El cielo', positive: [
    'The sky glowed orange above the deserted pier.', 'The sky',
  ], negative: ['Mara bumped into Sky outside the crowded station.', 'Sky'] },
  { form: 'la luna', gloss: 'the moon', rendered: 'la luna', positive: [
    'Leah watched the moon sink beyond the rooftops.', 'the moon',
  ], negative: ['Leah wrote “the moon” at the top of a blank page.', 'the moon'] },
];
const origin = 'https://x.com'; // Use the unpacked build's existing static content script, with entirely synthetic pages.
const prefix = '/lang-weave-offline-prose/';
const routes = new Map(cases.map((example, index) => [origin + prefix + index, example]));

for (const gradual of [false, true]) {
  const profile = await mkdtemp(join(tmpdir(), 'lang-weave-prose-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.LANG_WEAVE_CHROMIUM, headless: true, locale: 'en-US',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'],
    });
    await context.route(/^https?:/, (route) => {
      const example = routes.get(route.request().url());
      if (!example) return route.abort();
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><body>
        <article><p id="positive" data-testid="tweetText">${example.positive[0]}</p></article>
        <article><p id="negative" data-testid="tweetText">${example.negative[0]}</p></article>
      </body></html>` });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    assert.equal(id, 'lkbkmlgogcpcacjmdmoecgacdbfddbnh');
    const welcomeUrl = `chrome-extension://${id}/src/welcome.html`;
    const welcome = context.pages().find((page) => page.url() === welcomeUrl) ||
      await context.waitForEvent('page', { predicate: (page) => page.url() === welcomeUrl });
    await welcome.locator('#demoLanguage:enabled').waitFor();
    const initial = await worker.evaluate(() => chrome.storage.local.get(['settings', 'spanishPlacement', 'apiKey', 'recallReview']));
    assert.equal(initial.settings.language, 'es');
    assert.equal(initial.settings.levelOverride, 0);
    assert.equal(initial.settings.gradual, true);
    assert.equal(initial.settings.newWordsPerDay, 5);
    assert.equal(initial.spanishPlacement, undefined);
    assert.equal(initial.apiKey, undefined);
    assert.equal(initial.recallReview, undefined);
    await worker.evaluate(async ({ cases, gradual }) => {
      const provider = new Map(cases.flatMap(({ form, gloss, positive, negative }) =>
        [positive, negative].map(([text, o]) => [text, { o, form, gloss }])));
      globalThis.proseRequests = [];
      const delegate = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return delegate(url, init);
        if (init.headers['x-goog-api-key'] !== 'synthetic-prose-key') throw new Error('Unexpected test key');
        const request = JSON.parse(init.body);
        const prompt = request.systemInstruction.parts[0].text;
        const input = JSON.parse(request.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
        const passages = input.map(({ id, text }) => {
          const { o, form, gloss } = provider.get(text) || {};
          const offered = !!form && prompt.includes(`${form} = ${gloss}`);
          globalThis.proseRequests.push({ text, offered });
          return { id, swaps: offered ? [{ o, f: form }] : [] };
        });
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] });
      };
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, gradual, newSitesEnabled: true },
        apiKey: 'synthetic-prose-key', consentShown: true });
    }, { cases, gradual });
    await welcome.close();

    const page = await context.newPage();
    for (const [url, { positive, negative, rendered }] of routes) {
      await page.goto(url);
      const word = page.locator('#positive .fw-word[lang="es"]').filter({ hasText: rendered });
      await word.waitFor();
      assert.equal(await word.textContent(), rendered);
      assert.equal(await word.getAttribute('data-en'), positive[1]);
      assert.equal(await page.locator('#positive').textContent(), positive[0].replace(positive[1], rendered));
      await word.press('Enter');
      assert.equal(await page.locator('#positive').textContent(), positive[0]);
      // The validator sees the negative proposal in this same reading flow.
      assert.ok((await worker.evaluate(() => globalThis.proseRequests))
        .some(({ text, offered }) => text === negative[0] && offered), 'negative anchor was offered to the worker');
      assert.equal(await page.locator('#negative').textContent(), negative[0]);
      assert.equal(await page.locator('#negative .fw-word').count(), 0);
    }
    console.log(`PASS: ${gradual ? 'gradual' : 'ordinary'} Beginner ZIP reading rendered four Spanish forms and left guarded contexts intact`);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
}

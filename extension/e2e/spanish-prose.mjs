// Woven reading in the extracted beta ZIP, with isolated profiles and local synthetic replies.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.LANG_WEAVE_PLAYWRIGHT).href);
const extension = process.env.LANG_WEAVE_WELCOME_EXTENSION;
const beginnerCases = [
  { form: 'la puerta', gloss: 'the door', rendered: 'La puerta', positive: [
    'The door stuck against the uneven slate threshold.', 'The door',
  ], negative: ['The door frame split beside a loose metal bracket.', 'The door'] },
  { form: 'el jardín', gloss: 'the garden', rendered: 'jardín', positive: [
    'An open gate led to a garden behind the empty station.', 'garden',
  ], negative: ['The garden gate swung past several stone markers.', 'The garden'] },
  { form: 'el cielo', gloss: 'the sky', rendered: 'El cielo', positive: [
    'The sky glowed orange above the deserted pier.', 'The sky',
  ], negative: ['A sky\u2011blue flag fluttered above the crowded station.', 'sky'] },
  { form: 'la luna', gloss: 'the moon', rendered: 'la luna', positive: [
    'Leah watched the moon sink beyond the rooftops.', 'the moon',
  ], negative: ['Leah wrote “the moon” at the top of a blank page.', 'the moon'] },
];
const windowPanes = { form: 'la ventana', gloss: 'the window', rendered: 'La ventana', positive: [
  'The window creaked under a sudden gust.', 'The window',
], negative: ['The window panes rattled under a sudden gust.', 'The window'] };
const expandedCases = [
  { form: 'el río', gloss: 'the river', rendered: 'El río', positive: [
    'The river curved beneath an old stone arch.', 'The river',
  ], negative: ['The river valley curved beneath distant hills.', 'The river'] },
  { form: 'la noche', gloss: 'the night', rendered: 'La noche', positive: [
    'The night smelled of lilacs and cedar.', 'The night',
  ], negative: ['The night sky glowed above the northern ridge.', 'The night'] },
];
const host = 'prose.example';
const origin = `https://${host}`;

for (const [gradual, level] of [[false, 1], [true, 1], [false, 2], [true, 2]]) {
  // Five due cards pause fresh introductions. Each tier uses its own fresh profile.
  const cases = [windowPanes, ...(level === 1 ? beginnerCases : expandedCases)];
  const routes = new Map(cases.map((example, index) => [`${origin}/reading/${index}`, example]));
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
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="en">
        <head><title>Prose reading exercise</title></head><body>
        <main><p id="positive">${example.positive[0]}</p><p id="negative">${example.negative[0]}</p></main>
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
    await worker.evaluate(async ({ cases, gradual, host, level }) => {
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
          globalThis.proseRequests.push({ id, text, offered });
          return { id, swaps: offered ? [{ o, f: form }] : [] };
        });
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] });
      };
      const { settings } = await chrome.storage.local.get('settings');
      // Leave room for gradual to rank several fresh candidates on the final fixture page.
      await chrome.storage.local.set({ settings: { ...settings, gradual, newWordsPerDay: 10, newSitesEnabled: false,
        siteOverrides: { [host]: true } },
        ...(level === 2 ? { spanishPlacement: 2 } : {}),
        apiKey: 'synthetic-prose-key', consentShown: true });
    }, { cases, gradual, host, level });
    // Chromium's extensions manager records the grant. The extension activates the
    // same optional origin through its permission API in the disposable profile.
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const pattern = `${origin}/*`;
    await manager.evaluate(({ id, pattern }) => chrome.developerPrivate.addHostPermission(id, pattern), { id, pattern });
    await welcome.bringToFront();
    assert.equal(await welcome.evaluate((pattern) => chrome.permissions.request({ origins: [pattern] }), pattern), true);
    assert.equal(await worker.evaluate((pattern) => chrome.permissions.contains({ origins: [pattern] }), pattern), true);
    assert.equal(await worker.evaluate(async (pattern) => {
      for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
        const [script] = await chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] });
        if (script?.matches.includes(pattern)) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    }, pattern), true, 'the content script registered on the synthetic origin');
    await manager.close();
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
      const requests = await worker.evaluate(() => globalThis.proseRequests);
      const proposed = requests.find(({ text, offered }) => text === negative[0] && offered);
      assert.ok(proposed, `negative anchor on ${url} was proposed to the worker`);
      const validated = await worker.evaluate(async (key) => {
        // The cache holds validated swaps before gradual density or introduction limits.
        return Object.entries(await chrome.storage.local.get(null))
          .filter(([name]) => name === key || name.startsWith(`${key}:gradual:`))
          .map(([, entry]) => entry.s);
      }, `c:${proposed.id}`);
      assert.deepEqual(validated, [[]], 'the validator discarded the negative proposal before delivery');
      assert.equal(await page.locator('#negative').textContent(), negative[0]);
      assert.equal(await page.locator('#negative .fw-word').count(), 0);
    }
    console.log(`PASS: ${gradual ? 'gradual' : 'ordinary'} ${level === 1 ? 'Beginner' : 'Expanded'} ZIP reading rendered ${cases.length} Spanish forms and rejected the synthetic partial proposals`);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
}

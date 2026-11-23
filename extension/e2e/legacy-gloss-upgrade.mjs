// A cold upgrade of the same unpacked extension folder and disposable Chrome profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, chromiumBinary, extensionRoot, grantReadingSite } from './browser.mjs';

const priorZip = process.env.LANG_WEAVE_PRIOR_ZIP || '';
assert.ok(isAbsolute(priorZip), 'Pass an absolute public 0.15.7 ZIP path as LANG_WEAVE_PRIOR_ZIP');
assert.equal(createHash('sha256').update(await readFile(priorZip)).digest('hex'),
  '4afe0dd5a7b5bc01d801219657088e7ddcdbfa9e86de2063ffb745636677247c');

const id = 'lkbkmlgogcpcacjmdmoecgacdbfddbnh';
const host = 'legacy-reading.example';
const pattern = `https://${host}/*`;
const url = `https://${host}/reading`;
const prose = {
  positive: 'The visitor said hello to everyone at the station.',
  negative: 'The visitor packed his bag before sunrise.',
};
const savedReview = { version: 1, cards: { 'la pregunta': { due: 1, interval: 3, reviews: 2 } },
  learning: { day: '', count: 0 } };
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-legacy-'));
const profile = join(scratch, 'profile');
const managed = join(scratch, 'extension');

async function openInstalled() {
  const context = await chromium.launchPersistentContext(profile, {
    ...chromiumBinary, headless: true, locale: 'en-US',
    args: [`--disable-extensions-except=${managed}`, `--load-extension=${managed}`,
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9'],
  });
  await context.route(/^https?:/, (route) => route.request().url() === url
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html>
    <html lang="en"><head><title>Legacy reading practice</title></head>
    <body><main><p id="hello">${prose.positive}</p><p id="his">${prose.negative}</p></main></body></html>` })
    : route.abort());
  return context;
}

async function installProvider(worker) {
  await worker.evaluate(({ positive, negative }) => {
    const anchors = new Map([[positive, 'hello'], [negative, 'his']]);
    const originalFetch = globalThis.fetch;
    globalThis.legacyRequests = [];
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(url, init);
      if (init.headers['x-goog-api-key'] !== 'synthetic-legacy-key') throw new Error('Unexpected fixture credential');
      const request = JSON.parse(init.body);
      const offered = request.systemInstruction.parts[0].text.includes('hola = hello');
      const passages = JSON.parse(request.contents[0].parts[0].text.replace(/^Passages:\n/, '')).map(({ id, text }) => {
        const o = anchors.get(text);
        globalThis.legacyRequests.push({ id, text, offered });
        return { id, swaps: o && offered ? [{ o, f: 'hola' }] : [] };
      });
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] });
    };
  }, prose);
}

async function readPair(context, worker) {
  const page = await context.newPage();
  await page.goto(url);
  const word = page.locator('#hello .fw-word[lang="es"]');
  await word.waitFor();
  assert.equal(await word.getAttribute('data-en'), 'hello');
  assert.equal(await page.locator('#hello').textContent(), prose.positive.replace('hello', 'hola'));
  const result = await worker.evaluate(async (text) => {
    for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
      const bad = globalThis.legacyRequests.find((request) => request.text === text);
      if (bad) {
        const key = `c:${bad.id}`;
        const entry = (await chrome.storage.local.get(key))[key];
        if (entry) return { offered: bad.offered, key, entry };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }, prose.negative);
  assert.ok(result?.offered, 'the ordinary prompt offered hola and the synthetic his proposal reached the cache');
  return { page, key: result.key, entry: result.entry };
}

let context;
try {
  execFileSync('python3', ['-m', 'zipfile', '-e', priorZip, managed]);
  context = await openInstalled();
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  assert.equal(new URL(worker.url()).host, id);
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), '0.15.7');
  const welcomeUrl = `chrome-extension://${id}/src/welcome.html`;
  const welcome = context.pages().find((page) => page.url() === welcomeUrl) ||
    await context.waitForEvent('page', { predicate: (page) => page.url() === welcomeUrl });
  await welcome.locator('#demoLanguage:enabled').waitFor();
  await worker.evaluate(async ({ host, savedReview }) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ spanishPlacement: 2,
      settings: { ...settings, gradual: false, newSitesEnabled: false, siteOverrides: { [host]: true } },
      apiKey: 'synthetic-legacy-key', consentShown: true, recallReview: savedReview });
  }, { host, savedReview });
  await installProvider(worker);
  await grantReadingSite(context, worker, pattern);
  await welcome.close();

  const old = await readPair(context, worker);
  assert.deepEqual(old.entry.s.map(({ o, f }) => [o, f]), [['his', 'hola']]);
  assert.equal(await old.page.locator('#his').textContent(), prose.negative.replace('his', 'hola'));
  const before = await worker.evaluate(() => chrome.storage.local.get(['settings', 'spanishPlacement', 'recallReview']));
  assert.deepEqual(before.recallReview, savedReview);
  await context.close();
  context = null;

  // Preserve the extension path that Chrome associates with this profile.
  await rename(managed, join(scratch, 'prior-install'));
  await cp(extensionRoot, managed, { recursive: true });
  const candidate = JSON.parse(await readFile(join(managed, 'manifest.json'), 'utf8'));
  assert.notEqual(candidate.version, '0.15.7');
  context = await openInstalled();
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  assert.equal(new URL(worker.url()).host, id);
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), candidate.version);
  await installProvider(worker);
  assert.equal(await worker.evaluate((pattern) => chrome.permissions.contains({ origins: [pattern] }), pattern), true);

  const updated = await readPair(context, worker);
  assert.notEqual(updated.key.split(':')[1], old.key.split(':')[1], 'the version changed the reading revision');
  assert.deepEqual(updated.entry.s, []);
  assert.equal(await updated.page.locator('#his').textContent(), prose.negative);
  assert.equal(await updated.page.locator('#his .fw-word').count(), 0);
  const retained = await worker.evaluate(async (key) => chrome.storage.local.get([key, 'settings', 'spanishPlacement', 'recallReview']), old.key);
  const { [old.key]: historicCache, ...after } = retained;
  assert.deepEqual(historicCache, old.entry);
  assert.deepEqual(after, before);
  console.log(`PASS: public 0.15.7 → ${candidate.version} in the same disposable Chrome profile. The cached his → hola survived storage but the new revision bypassed it. The new rejected result was cached, hello still rendered, and the historical card and site grant survived.`);
} finally {
  await context?.close();
  await rm(scratch, { recursive: true, force: true });
}

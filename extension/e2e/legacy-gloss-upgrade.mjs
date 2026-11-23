// Chrome's unpacked reload in one disposable profile and extension directory.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, chromiumBinary, extensionRoot, grantReadingSite } from './browser.mjs';

const priorZip = process.env.LANG_WEAVE_PRIOR_ZIP || '';
const xdotool = process.env.LANG_WEAVE_RELOAD_XDOTOOL || '';
assert.ok(isAbsolute(priorZip), 'Pass an absolute public 0.15.7 ZIP path as LANG_WEAVE_PRIOR_ZIP');
assert.ok(process.env.DISPLAY && isAbsolute(xdotool), 'Pass a disposable X11 display and absolute xdotool path');
assert.equal(createHash('sha256').update(await readFile(priorZip)).digest('hex'),
  '4afe0dd5a7b5bc01d801219657088e7ddcdbfa9e86de2063ffb745636677247c');

const id = 'lkbkmlgogcpcacjmdmoecgacdbfddbnh';
const host = 'legacy-reading.example';
const pattern = `https://${host}/*`;
const origin = `https://${host}`;
const prose = {
  positive: 'The visitor said hello to everyone at the station.',
  negative: 'The visitor packed his bag before sunrise.',
};
const pages = new Map([[`${origin}/hello`, prose.positive], [`${origin}/his`, prose.negative]]);
const savedReview = { version: 1, cards: { 'la pregunta': { due: 1, interval: 3, reviews: 2 } },
  learning: { day: '', count: 0 } };
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-legacy-'));
const profile = join(scratch, 'profile');
const managed = join(scratch, 'extension');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const xdo = (...args) => execFileSync(xdotool, args, { timeout: 3000, encoding: 'utf8' }).trim();

async function openInstalled() {
  const env = { ...process.env, HOME: scratch, GTK_USE_PORTAL: '0', GSETTINGS_BACKEND: 'memory',
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(scratch, 'no-session-bus')}` };
  for (const key of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR']) {
    env[key] = join(scratch, key.toLowerCase());
    await mkdir(env[key], { mode: 0o700 });
  }
  const context = await chromium.launchPersistentContext(profile, {
    ...chromiumBinary, headless: false, locale: 'en-US', noViewport: true, ignoreDefaultArgs: ['--disable-extensions'], env,
    args: ['--force-device-scale-factor=1', '--window-position=10,10', '--window-size=1280,850',
      '--no-first-run', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND',
      '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>'],
  });
  await context.route(/^https?:/, (route) => {
    const text = pages.get(route.request().url());
    if (!text) return route.abort();
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html>
      <html lang="en"><head><title>Legacy reading practice</title></head>
      <body><main><p id="passage">${text}</p></main></body></html>` });
  });
  return context;
}

async function expectInstalled(manager, version) {
  await manager.waitForFunction(async ({ id, path, version }) =>
    (await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true })).some((app) =>
      app.id === id && app.path === path && app.version === version && app.state === 'ENABLED'),
  { id, path: managed, version });
}

async function loadUnpacked(manager) {
  await manager.goto('chrome://extensions/');
  if (await manager.locator('#loadUnpacked').isHidden()) await manager.locator('#devMode').click();
  await manager.locator('#loadUnpacked').click();
  let title = '';
  for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
    title = xdo('getactivewindow', 'getwindowname');
    if (/extension directory/i.test(title)) break;
    await sleep(100);
  }
  assert.match(title, /extension directory/i);
  xdo('key', 'ctrl+l');
  await sleep(250);
  xdo('type', '--clearmodifiers', '--', managed);
  const bounds = Object.fromEntries(xdo('getactivewindow', 'getwindowgeometry', '--shell').split('\n')
    .filter((entry) => /^[A-Z]+=\d+$/.test(entry)).map((entry) => entry.split('=')).map(([key, value]) => [key, Number(value)]));
  xdo('mousemove', String(bounds.X + bounds.WIDTH - 50), String(bounds.Y + bounds.HEIGHT - 28), 'click', '1');
  await expectInstalled(manager, '0.15.7');
}

async function installProvider(worker, forceNegative = false) {
  await worker.evaluate(({ positive, negative, forceNegative }) => {
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
        const proposed = !!o && (offered || forceNegative && o === 'his');
        globalThis.legacyRequests.push({ id, text, offered, proposed });
        return { id, swaps: proposed ? [{ o, f: 'hola' }] : [] };
      });
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] });
    };
  }, { ...prose, forceNegative });
}

async function readPair(context, worker, requireNegativeOffer = false) {
  const negative = await context.newPage();
  await negative.goto(`${origin}/his`);
  const result = await worker.evaluate(async (text) => {
    for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
      const bad = globalThis.legacyRequests.find((request) => request.text === text);
      if (bad) {
        const key = `c:${bad.id}`;
        const entry = (await chrome.storage.local.get(key))[key];
        if (entry) return { offered: bad.offered, proposed: bad.proposed, key, entry };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }, prose.negative);
  assert.ok(result?.proposed, 'the his proposal reached the worker on its own page');
  if (requireNegativeOffer) assert.equal(result.offered, true, '0.15.7 offered hola with only the his passage');

  const positive = await context.newPage();
  await positive.goto(`${origin}/hello`);
  const word = positive.locator('#passage .fw-word[lang="es"]');
  await word.waitFor();
  assert.equal(await word.getAttribute('data-en'), 'hello');
  assert.equal(await positive.locator('#passage').textContent(), prose.positive.replace('hello', 'hola'));
  await positive.close();
  return { page: negative, key: result.key, entry: result.entry };
}

let context;
try {
  execFileSync('python3', ['-m', 'zipfile', '-e', priorZip, managed]);
  context = await openInstalled();
  const manager = await context.newPage();
  await loadUnpacked(manager);
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

  const old = await readPair(context, worker, true);
  assert.deepEqual(old.entry.s.map(({ o, f }) => [o, f]), [['his', 'hola']]);
  await old.page.locator('#passage .fw-word[lang="es"]').waitFor();
  assert.equal(await old.page.locator('#passage').textContent(), prose.negative.replace('his', 'hola'));
  const before = await worker.evaluate(() => chrome.storage.local.get(['settings', 'spanishPlacement', 'recallReview']));
  assert.deepEqual(before.recallReview, savedReview);
  await old.page.close();

  // Preserve the folder that Chrome associates with this extension entry.
  const staged = join(scratch, 'staged');
  await cp(extensionRoot, staged, { recursive: true });
  const candidate = JSON.parse(await readFile(join(staged, 'manifest.json'), 'utf8'));
  assert.notEqual(candidate.version, '0.15.7');
  await rename(managed, join(scratch, 'prior-install'));
  await rename(staged, managed);
  // Use the same reload operation as the button in Chrome's extensions manager.
  await manager.evaluate((id) => chrome.developerPrivate.reload(id), id);
  await expectInstalled(manager, candidate.version);
  // Reload can finish before Chrome starts the replacement worker. Settings wakes it.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/src/options.html`);
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'status' }));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await options.close();
  await manager.close();
  assert.equal(new URL(worker.url()).host, id);
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), candidate.version);
  await installProvider(worker, true);
  assert.equal(await worker.evaluate((pattern) => chrome.permissions.contains({ origins: [pattern] }), pattern), true);

  const updated = await readPair(context, worker);
  assert.notEqual(updated.key.split(':')[1], old.key.split(':')[1], 'the version changed the reading revision');
  assert.deepEqual(updated.entry.s, []);
  assert.equal(await updated.page.locator('#passage').textContent(), prose.negative);
  assert.equal(await updated.page.locator('#passage .fw-word').count(), 0);
  const retained = await worker.evaluate(async (key) => chrome.storage.local.get([key, 'settings', 'spanishPlacement', 'recallReview']), old.key);
  const { [old.key]: historicCache, ...after } = retained;
  assert.deepEqual(historicCache, old.entry);
  assert.deepEqual(after, before);
  console.log(`PASS: public 0.15.7 → ${candidate.version} in the same disposable Chrome profile. The cached his → hola survived storage but the new revision bypassed it. The new rejected result was cached, hello still rendered, and the historical card and site grant survived.`);
} finally {
  await context?.close();
  await rm(scratch, { recursive: true, force: true });
}

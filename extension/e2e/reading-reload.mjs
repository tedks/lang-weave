// Exercise Chrome's unpacked reload with public ZIP bytes in a disposable profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { LANG_WEAVE_CHROMIUM, LANG_WEAVE_PLAYWRIGHT, LANG_WEAVE_WELCOME_EXTENSION, LANG_WEAVE_PRIOR_ZIP,
  LANG_WEAVE_RELOAD_XDOTOOL, DISPLAY } = process.env;
assert.ok(DISPLAY && isAbsolute(LANG_WEAVE_RELOAD_XDOTOOL || '') && isAbsolute(LANG_WEAVE_PRIOR_ZIP || ''),
  'Pass a dedicated disposable X display, absolute xdotool path, and public outgoing ZIP to the Bazel test.');
const { chromium } = await import(pathToFileURL(LANG_WEAVE_PLAYWRIGHT).href);
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-reload-'));
const managed = join(scratch, 'managed');
const extensionId = 'lkbkmlgogcpcacjmdmoecgacdbfddbnh';
const extensionPage = (page) => `chrome-extension://${extensionId}/src/${page}.html`;
const site = 'https://reading.example';
const sentence = 'We read books and enjoy quiet evenings every week.';
const fresh = 'They paint pictures and talk about the quiet morning.';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const xdo = (...args) => execFileSync(LANG_WEAVE_RELOAD_XDOTOOL, args, { timeout: 3000, encoding: 'utf8' }).trim();
const activeTitle = () => xdo('getactivewindow', 'getwindowname');
const activeBounds = () => Object.fromEntries(xdo('getactivewindow', 'getwindowgeometry', '--shell').split('\n')
  .filter((entry) => /^[A-Z]+=\d+$/.test(entry)).map((entry) => entry.split('=')).map(([key, value]) => [key, Number(value)]));
const clickNative = (x, y) => xdo('mousemove', String(Math.round(x)), String(Math.round(y)), 'click', '1');
async function until(read, matches, description, timeout = 10000) {
  let last;
  for (const end = Date.now() + timeout; Date.now() < end;) {
    last = await read();
    if (matches(last)) return last;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(last)}`);
}
const manifestPath = (dir) => join(dir, 'manifest.json');
const manifest = async (dir) => JSON.parse(await readFile(manifestPath(dir), 'utf8'));
let browser;
try {
  assert.equal(createHash('sha256').update(await readFile(LANG_WEAVE_PRIOR_ZIP)).digest('hex'),
    '9bae4663e170f25d640840aefeb8b2b1551243092fc5f3f03a5f191a3eb268d6', 'public 0.15.2 asset bytes');
  execFileSync('python3', ['-m', 'zipfile', '-e', LANG_WEAVE_PRIOR_ZIP, managed]);
  const outgoing = await manifest(managed);
  const candidate = await manifest(LANG_WEAVE_WELCOME_EXTENSION);
  assert.equal(outgoing.version, '0.15.2', 'the historical baseline is the public 0.15.2 beta');
  const candidateParts = candidate.version.split('.').map(Number);
  const nextVersion = [...candidateParts.slice(0, -1), candidateParts.at(-1) + 1].join('.');
  const next = join(scratch, 'next');
  await cp(LANG_WEAVE_WELCOME_EXTENSION, next, { recursive: true });
  // This test-only next version has the exact candidate source and a different manifest version.
  await writeFile(manifestPath(next), JSON.stringify({ ...candidate, version: nextVersion }));

  const env = { ...process.env, HOME: scratch, GTK_USE_PORTAL: '0', GSETTINGS_BACKEND: 'memory',
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(scratch, 'no-session-bus')}` };
  for (const key of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR']) {
    env[key] = join(scratch, key.toLowerCase());
    await mkdir(env[key], { mode: 0o700 });
  }
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    executablePath: LANG_WEAVE_CHROMIUM, headless: false, locale: 'en-US', noViewport: true,
    ignoreDefaultArgs: ['--disable-extensions'], env,
    args: ['--no-first-run', '--disable-background-networking', '--force-device-scale-factor=1',
      '--window-position=10,10', '--window-size=1280,850',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>'],
  });
  const manager = await browser.newPage();
  await manager.goto('chrome://extensions/');
  if (await manager.locator('#loadUnpacked').isHidden()) await manager.locator('#devMode').click();
  await manager.locator('#loadUnpacked').click();
  await until(activeTitle, (title) => /extension directory/i.test(title), 'the native directory chooser');
  xdo('key', 'ctrl+l');
  await sleep(250);
  xdo('type', '--clearmodifiers', '--', managed);
  const chooser = activeBounds();
  clickNative(chooser.X + chooser.WIDTH - 50, chooser.Y + chooser.HEIGHT - 28);

  const installed = () => manager.evaluate(async (id) => (await chrome.developerPrivate.getExtensionsInfo({
    includeDisabled: true,
  })).filter((app) => app.id === id).map(({ version, location, state, path }) => ({ version, location, state, path })), extensionId);
  const expectInstalled = (version, timeout) => until(installed, (apps) => {
    const [app] = apps;
    return apps.length === 1 && app.version === version && app.location === 'UNPACKED' &&
      app.state === 'ENABLED' && app.path === managed;
  }, `unpacked Lang Weave ${version}`, timeout);
  await expectInstalled(outgoing.version);
  const findWorker = () => browser.serviceWorkers().find((item) =>
    item.url() === `chrome-extension://${extensionId}/src/background.js`);
  let worker = await until(findWorker, Boolean, 'Lang Weave worker');
  const mockProvider = () => worker.evaluate(() => {
    if (globalThis.readingFixture) return;
    globalThis.readingFixture = [];
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, options);
      const body = JSON.parse(options.body).contents[0].parts[0].text.replace(/^Passages:\n/, '');
      const items = JSON.parse(body);
      globalThis.readingFixture.push(...items);
      const passages = items.map(({ id }) => ({ id, swaps: [{ o: 'and', f: 'y', g: 'and', h: '', ctx: '' }] }));
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] });
    };
  });
  await mockProvider();
  const welcome = await browser.newPage();
  await welcome.goto(extensionPage('welcome'));
  await welcome.bringToFront();
  await welcome.locator('#allSites').click();
  await sleep(1600); // Chrome temporarily disables Allow to protect the native prompt.
  assert.match(activeTitle(), /Welcome to Lang Weave/);
  const prompt = activeBounds();
  clickNative(prompt.X + prompt.WIDTH / 2 + 166, prompt.Y + 271);
  await until(() => welcome.evaluate(() => chrome.permissions.contains({ origins: ['https://*/*'] })),
    Boolean, 'the real native optional permission grant');
  await until(() => welcome.evaluate(async () => (await chrome.storage.local.get('consentShown')).consentShown),
    Boolean, 'site choice to persist');
  const placement = welcome.locator('#placement');
  await placement.locator(':scope > summary').click();
  await placement.getByRole('combobox', { name: 'Spanish starting point' }).selectOption({ label: 'Expanded' });
  await placement.getByRole('button', { name: 'Save starting point' }).click();
  await placement.getByText('Spanish starting point saved on this device.', { exact: true }).waitFor();
  await worker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ apiKey: 'synthetic-recovery-fixture', settings: { ...settings, gradual: false } });
  });
  const review = await browser.newPage();
  await review.goto(extensionPage('review'));
  await review.locator('#introduce').click();
  await review.locator('#reveal').click();
  await review.locator('[data-rating="medium"]').click();
  await review.locator('#progress').getByText(/^Card 2 of /).waitFor();
  await review.close();
  const saved = () => worker.evaluate(() => chrome.storage.local.get([
    'settings', 'spanishPlacement', 'recallReview', 'learningRetrievals',
  ]));
  const beforeStorage = await saved();
  const grants = await worker.evaluate(() => chrome.permissions.getAll());
  assert.equal(beforeStorage.learningRetrievals.retrievals.length, 1);
  assert.equal(beforeStorage.spanishPlacement, 2);

  await browser.route(`${site}/**`, (route) => route.fulfill({ contentType: 'text/html', body:
    `<!doctype html><html lang="en"><title>Evening reading</title><main><p id="story">${sentence}</p></main>
    <form><label>Draft <input id="draft"></label></form>` }));
  const page = await browser.newPage();
  const pageUrl = site + '/story';
  await page.goto(pageUrl);
  const draft = page.locator('#draft');
  const story = page.locator('#story');
  const word = story.locator('.fw-word');
  const flip = async (span) => {
    await span.getByText('y', { exact: true }).waitFor();
    await span.click();
    assert.equal(await span.textContent(), 'and');
    await span.click();
    assert.equal(await span.textContent(), 'y');
  };
  async function openPopup() {
    // The shipped popup document loads in a background tab and sees the active reading tab.
    await page.bringToFront();
    await worker.evaluate((url) => chrome.tabs.create({ url, active: false }), extensionPage('popup'));
    return until(() => browser.pages().find((tab) => tab.url() === extensionPage('popup')), Boolean, 'packaged popup');
  }
  await flip(word);

  async function documentWorld(mark = false) {
    return worker.evaluate(async ({ pageUrl, mark }) => {
      const [tab] = await chrome.tabs.query({ url: pageUrl });
      const [{ result, documentId }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, args: [mark], func: (mark) => {
          const prior = Symbol.for('lang-weave.reload-test-outgoing');
          if (mark) {
            globalThis[prior] = true;
            const word = document.querySelector('#story .fw-word');
            const retirement = new MutationObserver(() => {
              if (word.isConnected) return;
              retirement.disconnect();
              document.documentElement.dataset.reloadTestRetired = String(!!chrome.runtime?.id);
            });
            retirement.observe(word.parentNode, { childList: true });
          }
          return { prior: globalThis[prior] === true, loader: !!globalThis[Symbol.for('lang-weave.content-loader')] };
        },
      });
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'personalCaptureAlive' }, { documentId })
        .catch(() => null);
      const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] });
      return { ...result, documentId, tabId: tab.id, live: response?.ok === true, registrations: scripts.length };
    }, { pageUrl, mark });
  }
  async function upgrade(source, version) {
    const outgoingWorld = await documentWorld(true);
    assert.ok(outgoingWorld.live);
    await draft.fill(`unsaved at ${version}`);
    await page.evaluate(() => {
      globalThis.outgoingWord = document.querySelector('#story .fw-word');
      globalThis.forged = document.createElement('span');
      forged.className = 'fw-word';
      forged.dataset.en = 'forged source';
      forged.textContent = 'site-owned';
      document.body.append(forged);
    });
    const staged = join(scratch, `staged-${version}`);
    await cp(source, staged, { recursive: true });
    await worker.evaluate(() => chrome.alarms.create('updates', { delayInMinutes: 0.5, periodInMinutes: 30 }));
    await rename(managed, join(scratch, `before-${version}`));
    await rename(staged, managed);
    await expectInstalled(version, 80000);
    worker = await until(findWorker, Boolean, 'replacement worker');
    await mockProvider();
    const current = await until(documentWorld, (world) => world.live && world.loader && world.registrations === 1,
      'the replacement listener and dynamic registration');
    assert.equal(current.documentId, outgoingWorld.documentId);
    assert.equal(current.prior, false);
    assert.equal(page.url(), pageUrl);
    assert.equal(await draft.inputValue(), `unsaved at ${version}`);
    assert.deepEqual(await worker.evaluate(() => chrome.permissions.getAll()), grants);
    assert.deepEqual(await saved(), beforeStorage);
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('reloadedFor')).reloadedFor), version);
    assert.equal(await page.evaluate(() => forged.isConnected && forged.textContent === 'site-owned' &&
      forged.dataset.en === 'forged source'), true);
    return current.tabId;
  }

  await upgrade(LANG_WEAVE_WELCOME_EXTENSION, candidate.version);
  assert.equal(await page.evaluate(() => outgoingWord === document.querySelector('#story .fw-word')), true);
  await page.evaluate((text) => {
    const p = document.createElement('p');
    p.id = 'fresh';
    p.textContent = text;
    document.querySelector('main').append(p);
  }, fresh);
  await flip(page.locator('#fresh .fw-word'));
  assert.equal(await word.count(), 1);
  const sent = await worker.evaluate(() => JSON.stringify(globalThis.readingFixture));
  assert.match(sent, /They paint pictures and talk/);
  assert.doesNotMatch(sent, /forged source|We read books/);
  // The old word alone must trigger the hint, including without the auto-update marker.
  await page.evaluate(() => forged.remove());
  await worker.evaluate(() => chrome.storage.local.remove('reloadedFor'));
  const popup = await openPopup();
  await popup.locator('#readingReload').getByText(/refresh this page when you’re ready/).waitFor();
  await popup.close();
  await word.click();
  const historicalFace = await word.textContent();
  await word.click();
  assert.equal(await word.textContent(), historicalFace, 'the new world does not take over an old wrapper');
  console.log(`PASS: public ${outgoing.version} → ${candidate.version}. The document, form, learning state and grants survived. Fresh text weaves once and the popup offers recovery for historical words.`);

  // Explicit learner recovery, in the disposable fixture only.
  await page.reload();
  await flip(word);
  await upgrade(next, nextVersion);
  assert.equal(await page.evaluate(() => outgoingWord.isConnected), false);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.reloadTestRetired), 'true',
    'the outgoing world restored the word while its runtime was still valid');
  await flip(word);
  assert.equal(await word.count(), 1);
  const recovered = await openPopup();
  await recovered.getByText('On for reading.example', { exact: true }).waitFor();
  assert.equal(await recovered.locator('#readingReload').isVisible(), false);
  await recovered.close();
  console.log(`PASS: ${candidate.version} → ${nextVersion} (same source, fixture manifest version). The old owned wrapper is gone, the same page weaves again, and existing edits and approvals survived.`);

  const controls = await openPopup();
  await controls.locator('#enabled').uncheck();
  await word.waitFor({ state: 'detached' });
  assert.equal(await story.textContent(), sentence);
  await controls.locator('#enabled').check();
  await flip(word);
  assert.equal(await controls.evaluate(() => chrome.permissions.remove({ origins: ['http://*/*', 'https://*/*'] })), true);
  await word.waitFor({ state: 'detached' });
  assert.equal(await story.textContent(), sentence);
  assert.equal(await draft.inputValue(), `unsaved at ${nextVersion}`);
  assert.equal(await page.evaluate(() => forged.isConnected && forged.textContent === 'site-owned'), true);
  assert.equal((await saved()).learningRetrievals.retrievals.length, 1);
  console.log('PASS: the actual pause switch and Chrome permission revocation restore English without navigating or rating.');
} finally {
  try { await browser?.close(); } finally { await rm(scratch, { recursive: true, force: true }); }
}

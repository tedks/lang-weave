// Real MV3 Chromium: the Store build's manifest delta and the self-update gate, against the dev build.
// Synthetic pages and Gemini only; DNS resolves nothing, so no request leaves the machine. No Store upload,
// no real profile: an update_url added to an unpacked copy stands in for the one the Store writes at install.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, readdir, writeFile, rm, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { globToRegExp, packageExtension } from '../scripts/package.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-store-'));
const run = promisify(execFile);
const dev = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const tweet = `<!doctype html><html lang="en"><head><title>Post on X</title></head><body><main><article>
  <div dir="auto">We read books and enjoy quiet evenings every week together.</div></article></main></body></html>`;
const prose = `<!doctype html><html lang="en"><head><title>Reading</title></head><body><main>
  <p id="reading">We read books and enjoy quiet evenings every week.</p></main></body></html>`;

async function launch(label, manifest, source = root) {
  const extension = join(scratch, label, 'extension');
  if (label === 'store') await cp(source, extension, { recursive: true });
  else {
    await cp(join(source, 'src'), join(extension, 'src'), { recursive: true });
    await cp(join(source, 'icons'), join(extension, 'icons'), { recursive: true });
  }
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(join(scratch, label, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
  await context.route('https://x.com/**', (route) => route.fulfill({ contentType: 'text/html', body: tweet }));
  await context.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html', body: prose }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    for (let i = 0; i < 100 && !(await chrome.storage.local.get('settings')).settings; i++)
      await new Promise((done) => setTimeout(done, 10));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(url, init);
      const items = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      const passages = items.map(({ id, text }) => ({ id, swaps: text.includes(' and ') ? [{ o: 'and', f: 'y', g: 'and', h: '', ctx: '' }] : [] }));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] }),
        { headers: { 'Content-Type': 'application/json' } });
    };
    await chrome.storage.local.set({ apiKey: 'synthetic-store-key', consentShown: true });
  });
  return { context, worker, id: new URL(worker.url()).host };
}

// Which src/*.js a web page can fetch must be exactly what web_accessible_resources lists.
async function checkWebAccessible(context, id, manifest, source = root) {
  const files = (await readdir(join(source, 'src'))).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`);
  const listed = (manifest.web_accessible_resources ?? []).flatMap((e) => e.resources ?? []).map(globToRegExp);
  const page = await context.newPage();
  await page.goto('https://reading.example/probe');
  const reachable = await page.evaluate(async ({ id, files }) => {
    const out = [];
    for (const f of files) { try { if ((await fetch(`chrome-extension://${id}/${f}`)).ok) out.push(f); } catch { /* denied */ } }
    return out;
  }, { id, files });
  await page.close();
  assert.deepEqual(reachable, files.filter((f) => listed.some((re) => re.test(f))));
  return { reachable, files };
}

const alarms = (worker) => worker.evaluate(() => chrome.alarms?.getAll().then((all) => all.map((a) => a.name)) ?? null);
const settle = async (worker) => { await new Promise((done) => setTimeout(done, 1500)); return worker; };

async function restartWorker(context, page, id, worker) {
  await worker.evaluate(() => { globalThis.beforeRestart = true; });
  const cdp = await context.newCDPSession(page);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${id}/src/background.js`);
  await cdp.send('Target.closeTarget', { targetId: target.targetId }); // keep the extension and dynamic registration loaded
  const wake = await context.newPage();
  await wake.goto(`chrome-extension://${id}/src/popup.html`);
  const within = (p, ms) => Promise.race([p, new Promise((done) => setTimeout(() => done('timeout'), ms))]);
  let fresh;
  for (let i = 0; i < 50 && !fresh; i++) {
    for (const w of context.serviceWorkers()) {
      if (await within(w.evaluate(() => globalThis.beforeRestart ?? false).catch(() => 'closed'), 1000) === false) fresh = w;
    }
    if (!fresh) await new Promise((done) => setTimeout(done, 200));
  }
  assert.ok(fresh, 'a fresh worker started and ran registerSites');
  await wake.close();
  return settle(fresh);
}

let open;
try {
  // Store build: no X content script, update_url as the Store writes it, sites granted by the user.
  const built = packageExtension({ store: true, outDir: join(scratch, 'dist') });
  const unpacked = join(scratch, 'unzipped-store');
  await mkdir(unpacked);
  await run('unzip', ['-q', built.path, '-d', unpacked]);
  const store = JSON.parse(await readFile(join(unpacked, 'manifest.json'), 'utf8'));
  assert.equal(store.content_scripts, undefined);
  assert.equal(store.web_accessible_resources, undefined);
  assert.equal(store.permissions.includes('alarms'), false);
  assert.match(await readFile(join(unpacked, 'src/sites.js'), 'utf8'), /js: \['src\/content-bundle\.js'\]/);
  assert.match(await readFile(join(unpacked, 'src/popup.js'), 'utf8'), /files: \['src\/content-bundle\.js'\]/);
  store.update_url = 'https://update.invalid/service/update2/crx';
  store.host_permissions.push(...store.optional_host_permissions); // test-only stand-in for the user's grant
  open = await launch('store', store, unpacked);
  let { context, worker, id } = open;
  await settle(worker);
  assert.equal(await alarms(worker), null, 'the Store build has no alarms API or self-update alarm');
  assert.equal(await worker.evaluate(() => Object.hasOwn(chrome.runtime.getManifest(), 'update_url')), true);
  const [registered] = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] }));
  assert.ok(registered, 'the granted sites are registered dynamically');
  assert.deepEqual(registered.js, ['src/content-bundle.js']);
  assert.deepEqual(registered.excludeMatches ?? [], []);
  let page = await context.newPage();
  await page.goto('https://x.com/someone/status/1');
  await page.locator('article .fw-word').waitFor();
  assert.equal(await page.locator('article .fw-word').textContent(), 'y');
  const word = page.locator('article .fw-word').first();
  await word.hover();
  await page.locator('.fw-gloss-on').waitFor();
  assert.match(await page.locator('.fw-gloss-on').textContent(), /y · and/);
  await word.click();
  assert.equal(await word.textContent(), 'and');
  // Popup fallback injection can run again on the same document. A classic script needs the
  // module loader's old one-evaluation semantics or duplicate listeners and observers result.
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://x.com/*' }))[0]?.id);
  assert.ok(tabId);
  const sameEntry = await worker.evaluate(async (tabId) => {
    const target = { tabId };
    const [before] = await chrome.scripting.executeScript({ target, func: () => {
      globalThis.__storeFirstEntry = globalThis[Symbol.for('lang-weave.content-bundle')].disarmTip;
      return !!globalThis.__storeFirstEntry;
    } });
    await chrome.scripting.executeScript({ target, files: ['src/content-bundle.js'] });
    await chrome.scripting.executeScript({ target, files: ['src/content-bundle.js'] });
    const [after] = await chrome.scripting.executeScript({ target, func: () =>
      globalThis.__storeFirstEntry === globalThis[Symbol.for('lang-weave.content-bundle')].disarmTip });
    return before.result && after.result;
  }, tabId);
  assert.equal(sameEntry, true, 'repeated popup fallback injection reuses the same document entry');
  const { reachable: storeReachable, files: storeFiles } = await checkWebAccessible(context, id, store, unpacked);
  assert.deepEqual(storeReachable, []);
  assert.ok(storeFiles.includes('src/content.js'));
  for (const closureFile of dev.web_accessible_resources[0].resources) assert.ok(storeFiles.includes(closureFile));
  // An upgrade can leave an old loader even when exclusions are already correct. Isolate that
  // case so the exclusion repair cannot mask a failure to replace the js field.
  await worker.evaluate(() => chrome.scripting.updateContentScripts([{ id: 'weave-sites',
    js: ['src/content-loader.js'] }]));
  const [stale] = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] }));
  assert.deepEqual(stale.js, ['src/content-loader.js'], 'the stale loader is in place');
  assert.deepEqual(stale.excludeMatches ?? [], [], 'exclusions are already correct');
  worker = await restartWorker(context, page, id, worker);
  const [updated] = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] }));
  assert.deepEqual(updated.js, ['src/content-bundle.js'], 'a restarted worker replaces a stale loader');
  // Separately pin the existing empty-exclusion update path. Omitting this field would keep X stale.
  await worker.evaluate(() => chrome.scripting.updateContentScripts([{ id: 'weave-sites',
    excludeMatches: ['https://x.com/*', 'https://twitter.com/*'] }]));
  const [excluded] = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] }));
  assert.deepEqual([...excluded.excludeMatches].sort(), ['https://twitter.com/*', 'https://x.com/*']);
  assert.deepEqual(excluded.js, ['src/content-bundle.js']);
  worker = await restartWorker(context, page, id, worker);
  const [cleared] = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] }));
  assert.deepEqual(cleared.excludeMatches ?? [], [], 'a restarted worker clears a stale exclusion');
  await context.close();

  // Dev (unpacked) build: X through the manifest content script; the self-update stays armed. The X grant is
  // still needed: without it Chrome hides the tab title and the worker's title guard fails closed (ditz
  // x-content-script-needs-grant), so the manifest entry injects but never weaves.
  const devGranted = structuredClone(dev);
  devGranted.host_permissions.push('https://x.com/*'); // test-only stand-in for the user's X grant
  open = await launch('dev', devGranted);
  ({ context, worker, id } = open);
  await settle(worker);
  assert.deepEqual(await alarms(worker), ['updates'], 'an unpacked install keeps the self-update alarm');
  // Chrome reports the manifest's X hosts as granted origins, so a registration exists, but it excludes
  // every host it matches: X gets the loader once, from the manifest.
  const [devRegistered] = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] }));
  assert.deepEqual([...devRegistered.excludeMatches].sort(), ['https://twitter.com/*', 'https://x.com/*']);
  assert.ok(devRegistered.matches.every((m) => devRegistered.excludeMatches.includes(m)));
  page = await context.newPage();
  await page.goto('https://x.com/someone/status/1');
  await page.locator('article .fw-word').waitFor();
  assert.equal(await page.locator('article .fw-word').textContent(), 'y');
  await checkWebAccessible(context, id, devGranted);
  await context.close();
  open = undefined;
  console.log(`PASS: real Chromium MV3, unzipped Store package has no static content script, web-accessible resources or alarms permission; granted X swaps, glosses and flips through the bundled dynamic script; no Store source JS fetch succeeds; a stale loader and stale exclusion each clear on isolated worker restarts. Dev build keeps modular loader and update alarm. Gemini mocked; no Store upload.`);
} finally {
  try { if (open) await open.context.close(); } finally {
    // Only the exact mkdtemp directory created above, after closing its browser.
    await rm(scratch, { recursive: true, force: true });
  }
}

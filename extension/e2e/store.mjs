// Real MV3 Chromium: the Store build's manifest delta and the self-update gate, against the dev build.
// Synthetic pages and Gemini only; DNS resolves nothing, so no request leaves the machine. No Store upload,
// no real profile: an update_url added to an unpacked copy stands in for the one the Store writes at install.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { globToRegExp, storeManifest } from '../scripts/package.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-store-'));
const dev = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const tweet = `<!doctype html><html lang="en"><head><title>Post on X</title></head><body><main><article>
  <div dir="auto">We read books and enjoy quiet evenings every week together.</div></article></main></body></html>`;
const prose = `<!doctype html><html lang="en"><head><title>Reading</title></head><body><main>
  <p id="reading">We read books and enjoy quiet evenings every week.</p></main></body></html>`;

async function launch(label, manifest) {
  const extension = join(scratch, label, 'extension');
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  for (const dir of ['icons', '_locales']) await cp(join(root, dir), join(extension, dir), { recursive: true }).catch(() => {});
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(join(scratch, label, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
  await context.route('https://x.com/**', (route) => route.fulfill({ contentType: 'text/html', body: tweet }));
  await context.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html', body: prose }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(url, init);
      const items = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      const passages = items.map(({ id, text }) => ({ id, swaps: text.includes(' and ') ? [{ o: 'and', f: 'y', g: 'and', h: '', ctx: '' }] : [] }));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] }),
        { headers: { 'Content-Type': 'application/json' } });
    };
    await chrome.storage.local.set({ apiKey: 'synthetic-store-key' });
  });
  return { context, worker, id: new URL(worker.url()).host };
}

// Which src/*.js a web page can fetch must be exactly what web_accessible_resources lists.
async function checkWebAccessible(context, id, manifest) {
  const files = (await readdir(join(root, 'src'))).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`);
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
  return reachable.length;
}

const alarms = (worker) => worker.evaluate(() => chrome.alarms.getAll().then((all) => all.map((a) => a.name)));
const settle = async (worker) => { await new Promise((done) => setTimeout(done, 1500)); return worker; };

let open;
try {
  // Store build: no X content script, update_url as the Store writes it, sites granted by the user.
  const store = storeManifest(dev);
  assert.equal(store.content_scripts, undefined);
  store.update_url = 'https://update.invalid/service/update2/crx';
  store.host_permissions.push(...store.optional_host_permissions); // test-only stand-in for the user's grant
  open = await launch('store', store);
  let { context, worker, id } = open;
  await settle(worker);
  assert.deepEqual(await alarms(worker), [], 'a packaged install must not arm the self-update alarm');
  assert.equal(await worker.evaluate(() => Object.hasOwn(chrome.runtime.getManifest(), 'update_url')), true);
  const [registered] = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] }));
  assert.ok(registered, 'the granted sites are registered dynamically');
  assert.deepEqual(registered.excludeMatches ?? [], []);
  let page = await context.newPage();
  await page.goto('https://x.com/someone/status/1');
  await page.locator('article .fw-word').waitFor();
  assert.equal(await page.locator('article .fw-word').textContent(), 'y');
  const storeReachable = await checkWebAccessible(context, id, store);
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
  console.log(`PASS: real Chromium MV3, Store manifest delta (no X content script, granted X woven through the dynamic registration with an empty exclusion), no self-update alarm with update_url; dev build weaves granted X from the manifest entry (the dynamic registration excludes X) and keeps the alarm; ${storeReachable} web-accessible src/*.js exactly as listed. Gemini mocked; no Store upload.`);
} finally {
  try { if (open) await open.context.close(); } finally {
    // Only the exact mkdtemp directory created above, after closing its browser.
    await rm(scratch, { recursive: true, force: true });
  }
}

// A granted page is already open when a fresh MV3 worker restores registration.
// The fixture removes the dynamic registration before navigation to reproduce Chromium's raw-wake gap.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-startup-recovery-'));
const extension = join(scratch, 'extension');
let browser;
try {
  for (const path of ['src', 'icons', '_locales'])
    await cp(join(root, path), join(extension, path), { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://reading.example/*'); // isolated grant only
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND', '--proxy-server=127.0.0.1:9'],
  });
  await browser.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><title>Ordinary reading</title><main><p id="reading">We read books and enjoy quiet evenings every week.</p></main>' }));
  let worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    for (let i = 0; i < 100 && !(await chrome.storage.local.get('settings')).settings; i++)
      await new Promise((done) => setTimeout(done, 10));
    await chrome.storage.local.set({ apiKey: 'synthetic-startup-key', consentShown: true });
    globalThis.modelCalls = 0;
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, init);
      globalThis.modelCalls++;
      const passages = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages:
        passages.map(({ id }) => ({ id, swaps: [{ o: 'and', f: 'y', g: 'and', h: '', ctx: '' }] })) }) }] } }] }),
      { headers: { 'Content-Type': 'application/json' } });
    };
  });
  const first = await browser.newPage();
  await first.goto('https://reading.example/prime');
  await first.locator('#reading .fw-word').waitFor(); // positive control: this grant and cache work
  assert.equal(await worker.evaluate(() => globalThis.modelCalls), 1);
  await worker.evaluate(() => chrome.scripting.unregisterContentScripts({ ids: ['weave-sites'] }));
  const waiting = await browser.newPage();
  await waiting.goto('https://reading.example/waiting');
  assert.equal(await waiting.locator('#reading .fw-word').count(), 0);
  const cdp = await browser.newCDPSession(waiting);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find((item) => item.type === 'service_worker' &&
    item.url === `chrome-extension://${id}/src/background.js`);
  assert.ok(target, 'the first worker is running');
  await cdp.send('Target.closeTarget', { targetId: target.targetId });
  // CDP starts the worker directly. Neither page navigation nor a user gesture wakes it.
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.startWorker', { scopeURL: `chrome-extension://${id}/` });
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = browser.serviceWorkers().find((item) => item !== worker);
    if (candidate) { worker = candidate; break; }
    await new Promise((done) => setTimeout(done, 100));
  }
  await waiting.locator('#reading .fw-word').waitFor({ timeout: 10000 });
  assert.equal(await waiting.locator('#reading .fw-word').count(), 1);
  assert.equal(await waiting.locator('#reading .fw-word').textContent(), 'y');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://reading.example/waiting' }))[0]?.id);
  assert.ok(tabId);
  const marker = await worker.evaluate(async (tabId) => {
    const target = { tabId };
    const [before] = await chrome.scripting.executeScript({ target, func: () =>
      globalThis[Symbol.for('lang-weave.content-loader')] === true });
    await chrome.scripting.executeScript({ target, files: ['src/content-loader.js'] });
    await chrome.scripting.executeScript({ target, files: ['src/content-loader.js'] });
    const [after] = await chrome.scripting.executeScript({ target, func: () =>
      globalThis[Symbol.for('lang-weave.content-loader')] === true });
    return before.result && after.result;
  }, tabId);
  assert.equal(marker, true);
  assert.equal(await waiting.locator('#reading .fw-word').count(), 1);
  console.log('startup-recovery: already-open granted page woven once without navigation or user gesture');
} finally {
  await browser?.close();
  await rm(scratch, { recursive: true, force: true });
}

// Isolated Chromium: a rejected key stops later reading and Test key calls until replacement.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-key-rejection-'));
const extension = join(scratch, 'extension');
let browser;
try {
  for (const path of ['src', 'icons', '_locales'])
    await cp(join(root, path), join(extension, path), { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(...manifest.optional_host_permissions); // throwaway grant only
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND', '--proxy-server=127.0.0.1:9'],
  });
  await browser.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><title>Ordinary reading</title><main><p id="reading">We read books and enjoy quiet evenings every week.</p></main>' }));
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const waitStatus = async (predicate) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      const status = await worker.evaluate(() => chrome.storage.local.get('modelStatus').then((x) => x.modelStatus));
      if (predicate(status)) return status;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error('Reading status did not advance');
  };
  await worker.evaluate(async () => {
    for (let i = 0; i < 100 && !(await chrome.storage.local.get('settings')).settings; i++)
      await new Promise((done) => setTimeout(done, 10));
    await chrome.storage.local.set({ apiKey: 'rejected-synthetic-key', consentShown: true });
    globalThis.syntheticCalls = 0;
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, init);
      globalThis.syntheticCalls++;
      if (init.headers['x-goog-api-key'] === 'rejected-synthetic-key')
        return new Response(JSON.stringify({ error: { status: 'API_KEY_INVALID', message: 'private provider text' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } });
      const passages = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages:
        passages.map(({ id }) => ({ id, swaps: [{ o: 'and', f: 'y', g: 'and', h: '', ctx: '' }] })) }) }] } }] }),
      { headers: { 'Content-Type': 'application/json' } });
    };
  });
  const first = await browser.newPage();
  await first.goto('https://reading.example/first');
  await waitStatus((status) => status?.category === 'key_rejected');
  const stored = await worker.evaluate(() => chrome.storage.local.get(['modelStatus', 'keyEpoch']));
  assert.equal(stored.modelStatus.keyEpoch, stored.keyEpoch);
  assert.equal(await worker.evaluate(() => globalThis.syntheticCalls), 1);
  assert.doesNotMatch(JSON.stringify(stored.modelStatus), /private provider text|synthetic-key/);
  await new Promise((done) => setTimeout(done, 30));
  const second = await browser.newPage();
  await second.goto('https://reading.example/second');
  await waitStatus((status) => status?.at > stored.modelStatus.at);
  assert.equal(await worker.evaluate(() => globalThis.syntheticCalls), 1);
  const options = await browser.newPage();
  await options.goto(`chrome-extension://${id}/src/options.html`);
  assert.deepEqual(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'testKey' })),
    { ok: false, category: 'key_rejected' });
  assert.equal(await worker.evaluate(() => globalThis.syntheticCalls), 1);
  assert.equal((await options.evaluate(() => chrome.runtime.sendMessage({ type: 'status' }))).modelStatus.category,
    'key_rejected');
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'save', apiKey: 'replacement-synthetic-key' }));
  const third = await browser.newPage();
  await third.goto('https://reading.example/third');
  await third.locator('#reading .fw-word').waitFor();
  assert.ok(await worker.evaluate(() => globalThis.syntheticCalls) > 1);
  console.log('key-rejection: one request for rejected epoch; replacement resumes reading');
} finally {
  await browser?.close();
  await rm(scratch, { recursive: true, force: true });
}

// Fresh MV3 install: first-run page has a local demo and an explicit site choice.
// DNS blocks Gemini; no real key or request is used.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-welcome-'));
const extension = join(scratch, 'extension');
let context;
try {
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  await cp(join(root, 'icons'), join(extension, 'icons'), { recursive: true });
  await writeFile(join(extension, 'manifest.json'), await readFile(join(root, 'manifest.json')));
  const geminiRequests = [];
  context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND'],
  });
  context.on('request', (request) => {
    if (request.url().startsWith('https://generativelanguage.googleapis.com/')) geminiRequests.push(request.url());
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const welcomeUrl = `chrome-extension://${id}/src/welcome.html`;
  const page = context.pages().find((p) => p.url() === welcomeUrl) ||
    await context.waitForEvent('page', { predicate: (p) => p.url() === welcomeUrl });
  await page.locator('#demo .fw-word').first().waitFor();
  assert.equal(await page.locator('#demo .fw-word').count(), 9);
  const word = page.locator('#demo .fw-word').first();
  assert.equal(await word.textContent(), 'hoy');
  await word.hover();
  await page.locator('.fw-gloss.fw-gloss-on').waitFor();
  assert.match(await page.locator('.fw-gloss').textContent(), /hoy · today/);
  await word.click();
  assert.equal(await word.textContent(), 'Today');
  await word.click();
  assert.equal(await word.textContent(), 'hoy');
  const before = await worker.evaluate(() => chrome.storage.local.get(['settings', 'consentShown', 'apiKey']));
  assert.equal(before.consentShown, false);
  assert.equal(before.apiKey, undefined);
  await page.getByRole('button', { name: /Only sites I turn on/ }).click();
  await page.getByRole('status').getByText(/Only sites you turn on selected/).waitFor();
  const after = await worker.evaluate(() => chrome.storage.local.get(['settings', 'consentShown']));
  assert.equal(after.consentShown, true);
  assert.equal(after.settings.newSitesEnabled, false);
  assert.deepEqual(await worker.evaluate(() => chrome.permissions.getAll().then(({ origins }) => origins
    .filter((origin) => origin === '<all_urls>' || origin === 'http://*/*' || origin === 'https://*/*'))), []);
  assert.deepEqual(geminiRequests, []);
  console.log('PASS: fresh install opened welcome; bundled demo gloss and flip worked; only-sites consent saved without an all-site grant or Gemini request.');
} finally {
  try { await context?.close(); } finally { await rm(scratch, { recursive: true, force: true }); }
}

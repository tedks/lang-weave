// Real MV3 Chromium, synthetic pages and Gemini only. No API key, account or paid calls.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'spanish-weave-smoke-'));
const extension = join(scratch, 'extension');
let context;
try {
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  // Test-only grants stand in for accepting Chrome's optional-permissions prompt.
  manifest.host_permissions.push(...manifest.optional_host_permissions);
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    globalThis.smokeCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(url, init);
      if (init.headers['x-goog-api-key'] !== 'synthetic-smoke-key') throw new Error('Unexpected test key');
      const body = JSON.parse(init.body);
      if (!body.systemInstruction.parts[0].text.includes('Spanish Weave')) throw new Error('Non-Spanish prompt');
      const items = JSON.parse(body.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      globalThis.smokeCalls.push(...items.map((item) => item.text));
      const passages = items.map(({ id, text }) => ({ id, swaps: text.includes(' and ')
        ? [{ o: 'and', f: 'y', g: 'and', h: 'ee', ctx: '' }] : [] }));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] }),
        { headers: { 'Content-Type': 'application/json' } });
    };
    await chrome.storage.local.set({ apiKey: 'synthetic-smoke-key' });
  });
  const html = `<!doctype html><html lang="en"><head><title>Spanish smoke fixture</title></head><body><main>
    <p id="reading">We read books and enjoy quiet evenings every week.</p>
    <p id="health">My doctor changed my medication and asked me to rest.</p>
    <p id="links">We read <a href="/friend">friends and family</a> and enjoy more stories together.</p>
    <form><p>Private form text and personal details stay here.</p><input value="private"></form>
    <p contenteditable="true">Editable secrets and private drafts stay here.</p>
    <pre>private code and secrets stay here</pre>
    <p lang="es">Leemos libros y disfrutamos de las tardes tranquilas.</p>
  </main></body></html>`;
  await context.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await context.route('https://mail.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  const page = await context.newPage();
  await page.goto('https://reading.example/article');
  const word = page.locator('#reading .fw-word');
  await word.waitFor();
  assert.equal(await word.textContent(), 'y');
  await word.hover();
  await page.waitForFunction(() => document.querySelector('#reading .fw-word')?.classList.contains('fw-tip'));
  assert.match(await word.getAttribute('data-tip'), /and/);
  await word.click();
  assert.equal(await word.textContent(), 'and');
  assert.match(await word.getAttribute('aria-label'), /Show Spanish/);
  await word.press('Enter');
  assert.equal(await word.textContent(), 'y');
  assert.equal(await page.locator('#health .fw-word, form .fw-word, [contenteditable] .fw-word, pre .fw-word, [lang=es] .fw-word').count(), 0);
  assert.equal(await page.locator('a').textContent(), 'friends and family');
  const calls = await worker.evaluate(() => globalThis.smokeCalls);
  assert.ok(calls.some((text) => text.includes('We read books')));
  assert.ok(calls.every((text) => !/doctor|Private form|Editable secrets|private code/.test(text)));
  const events = await worker.evaluate(() => chrome.storage.local.get('readingEvents').then((s) => s.readingEvents || []));
  assert.ok(events.some((e) => e.word === 'y' && e.kind === 'flip'));
  const mail = await context.newPage();
  await mail.goto('https://mail.google.com/mail/u/0/');
  // The popup's resolved configuration confirms the real site gate, then allow discovery/debounce to settle.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  await popup.waitForFunction(() => document.querySelector('#wordInfo')?.textContent.includes('Spanish words'));
  assert.equal(await popup.locator('h1').textContent(), 'Spanish Weave');
  assert.equal(await popup.locator('#apiKey').getAttribute('placeholder'), 'saved (paste to replace)');
  await mail.waitForTimeout(800);
  assert.equal(await mail.locator('.fw-word').count(), 0);
  assert.equal(await worker.evaluate(() => globalThis.smokeCalls.length), calls.length);
  await popup.locator('#levelOverride').selectOption('2');
  await popup.waitForFunction(() => document.querySelector('#wordInfo').textContent === '147 Spanish words');
  await popup.locator('#enabled').uncheck();
  await page.waitForFunction(() => document.querySelectorAll('.fw-word').length === 0);
  assert.equal(await page.locator('#reading').textContent(), 'We read books and enjoy quiet evenings every week.');
  await popup.locator('#enabled').check();
  await page.locator('#reading .fw-word').waitFor();
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'save', siteOverride: { host: 'reading.example', enabled: false } }));
  await page.waitForFunction(() => document.querySelectorAll('.fw-word').length === 0);
  console.log('PASS: real Chromium MV3 load; Spanish swaps, hover, click/keyboard, popup, level switch, local events, privacy exclusions, pause/resume and site-off restoration. Gemini mocked; no live model validation.');
} finally {
  if (context) await context.close();
  // Only the exact mkdtemp directory created above, after closing its browser.
  await rm(scratch, { recursive: true, force: true });
}

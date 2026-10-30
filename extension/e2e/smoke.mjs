// Real MV3 Chromium, synthetic pages and Gemini only. No API key, account or paid calls.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = process.env.SPANISH_WEAVE_TEST_EXTENSION || root;
if (!isAbsolute(source)) throw new Error('SPANISH_WEAVE_TEST_EXTENSION must be an absolute extension directory');
const scratch = await mkdtemp(join(tmpdir(), 'spanish-weave-smoke-'));
const extension = join(scratch, 'extension');
let context;
const originHits = [];
const proxyHits = [];
const origin = createServer((request, response) => {
  originHits.push(request.url);
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('owned probe works');
});
// The proxy is an owned sink: even a failed network assertion cannot forward
// a request or contact Gemini. The resolver rule below backs it up.
const proxy = createServer((request, response) => {
  proxyHits.push(request.url);
  response.destroy();
});
proxy.on('connect', (request, socket) => {
  proxyHits.push(request.url);
  socket.destroy();
});
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
try {
  const originPort = await listen(origin);
  const proxyPort = await listen(proxy);
  await cp(join(source, 'src'), join(extension, 'src'), { recursive: true });
  // Chrome refuses to load without the icons a manifest names; a pre-0.12.7 source names none. Copy exactly
  // when declared, so a tree that declares icons but lacks them fails here with ENOENT, not as a worker timeout.
  const declared = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  if (declared.icons || declared.action?.default_icon) await cp(join(source, 'icons'), join(extension, 'icons'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  // Test-only grants stand in for accepting Chrome's optional-permissions prompt.
  manifest.host_permissions.push(...manifest.optional_host_permissions);
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const launchArgs = [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
    '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND, MAP probe.weave.test 127.0.0.1',
    `--proxy-server=127.0.0.1:${proxyPort}`];
  context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true,
    // An MV3 worker restart loses the synthetic fetch. Block real Gemini
    // dispatch at the browser level even if that happens during this flow.
    args: launchArgs,
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
      if (!body.contents[0].parts[0].text.startsWith('Passages:')) {
        const code = JSON.parse(body.contents[0].parts[0].text).targetLanguage;
        const first = code === 'fr' ? 'et' : 'そして';
        const words = Array.from({ length: 24 }, (_, i) => ({ fr: i ? `${code}${i}` : first,
          en: i ? `gloss ${i}` : 'and', hint: `hint ${i}`, level: i < 12 ? 1 : 2 }));
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ words }) }] } }] }),
          { headers: { 'Content-Type': 'application/json' } });
      }
      const items = JSON.parse(body.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      const prompt = body.systemInstruction.parts[0].text;
      const target = prompt.includes('French (fr)') ? 'et' : prompt.includes('Japanese (ja)') ? 'そして' : 'y';
      globalThis.smokeCalls.push(...items.map((item) => item.text));
      const passages = items.map(({ id, text }) => ({ id,
        swaps: target === 'y' && prompt.includes('la ventana = the window') &&
          text.includes('The window stands beside the cat')
          ? [{ o: 'The window', f: 'la ventana', g: 'the window', h: '', ctx: 'The window stands' },
            { o: 'the cat', f: 'el gato', g: 'the cat', h: '', ctx: 'beside the cat and' }]
          : text.includes(' and ') ? [{ o: 'and', f: target, g: 'and', h: '', ctx: '' }] : [] }));
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
  const callsBeforeTitle = await worker.evaluate(() => globalThis.smokeCalls.length);
  await page.evaluate(() => { document.title = 'Bank robbery investigation';
    const p = document.createElement('p'); p.id = 'title-neutral';
    p.textContent = 'We read books and enjoy quiet evenings every week.';
    document.querySelector('main').append(p); });
  await page.waitForFunction(() => document.querySelectorAll('.fw-word').length === 0);
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#title-neutral .fw-word').count(), 0);
  assert.equal(await worker.evaluate(() => globalThis.smokeCalls.length), callsBeforeTitle);
  await page.evaluate(() => { document.title = 'Spanish smoke fixture'; });
  await page.locator('#reading .fw-word').waitFor();
  await page.locator('#title-neutral .fw-word').waitFor();
  const mail = await context.newPage();
  await mail.goto('https://mail.google.com/mail/u/0/');
  // The popup's resolved configuration confirms the real site gate, then allow discovery/debounce to settle.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  await popup.waitForFunction(() => document.querySelector('#today')?.textContent.includes('available to add'));
  const popupSize = await popup.evaluate(() => ({ width: document.body.getBoundingClientRect().width,
    height: document.body.getBoundingClientRect().height }));
  assert.equal(popupSize.width, 300);
  assert.ok(popupSize.height <= 600, `popup exceeds Chrome's 600px cap: ${popupSize.height}px`);
  const [options] = await Promise.all([context.waitForEvent('page'), popup.locator('#openSettings').click()]);
  await options.waitForLoadState();
  await options.waitForFunction((version) => document.querySelector('#version')?.textContent === version, manifest.version);
  assert.equal(await options.locator('#apiKey').getAttribute('placeholder'), 'saved (paste to replace)');
  const [words] = await Promise.all([context.waitForEvent('page'), popup.locator('#openWords').click()]);
  await words.waitForLoadState();
  assert.equal(new URL(words.url()).search, '');
  await words.locator('#entries').getByText('No personal entries yet.').waitFor();
  assert.equal(await popup.locator('h1').textContent(), 'Lang Weave');
  assert.match(await popup.locator('#operation').textContent(), /^(On|Off on this site)$/);
  assert.equal(await popup.locator('#primary').textContent(), 'Add words');
  const [review] = await Promise.all([context.waitForEvent('page'), popup.locator('#primary').click()]);
  await review.waitForLoadState();
  await review.locator('#counts').getByText('0 due · 30 available to add').waitFor();
  assert.equal(await review.locator('#question').isHidden(), true);
  await review.locator('#introduce').click();
  await review.locator('#prompt').getByText('and').waitFor();
  assert.equal(await review.locator('#prompt').textContent(), 'and');
  assert.equal(await review.locator('#solution').isHidden(), true);
  await review.locator('#reveal').click();
  await review.locator('#answer').getByText('y').waitFor();
  assert.equal(await review.locator('#answer').textContent(), 'y');
  await review.reload(); // a revealed card survives closing/reopening the extension page
  await review.locator('#answer').getByText('y').waitFor();
  await review.locator('[data-rating="hard"]').click();
  await review.locator('#prompt').getByText('but').waitFor();
  await review.waitForFunction(() => document.activeElement?.id === 'reveal');
  assert.equal(await review.locator('#progress').textContent(), 'Card 2 of 5');
  await review.keyboard.press('Enter');
  await review.locator('#answer').getByText('pero').waitFor();
  await review.waitForFunction(() => document.activeElement?.dataset.rating === 'medium');
  await review.keyboard.press('2');
  await review.locator('#prompt').getByText('or').waitFor();
  await review.waitForFunction(() => document.activeElement?.id === 'reveal');
  assert.equal(await review.locator('#counts').textContent(), '3 due · 25 available to add');
  const savedReview = await worker.evaluate(() => chrome.storage.local.get('recallReview').then((s) => s.recallReview));
  assert.equal(savedReview.cards.y.interval, 1);
  assert.equal(savedReview.cards.y.reviews, 1);
  assert.equal(savedReview.cards.pero.interval, 1); // rated Hard with the 2 key
  assert.equal(await worker.evaluate(() => globalThis.smokeCalls.length), calls.length); // review never calls Gemini
  await options.getByText('Add a language').click();
  await options.locator('#newLanguage').fill('fr');
  await options.locator('#addLanguage').click();
  await options.waitForFunction(() => document.querySelector('#language')?.value === 'fr');
  await review.locator('#language').getByText('Reviewing French').waitFor();
  await review.locator('#counts').getByText('0 due · 12 available to add').waitFor();
  await page.locator('#reading .fw-word').getByText('et').waitFor();
  await review.locator('#introduce').click();
  await review.locator('#prompt').getByText('and').waitFor();
  const frenchState = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(frenchState.recallReview.cards.y.reviews, 1);
  assert.ok(Object.keys(frenchState).some((key) => key.startsWith('lang:fr:') && key.endsWith(':recallReview')));
  await options.locator('#newLanguage').fill('ja');
  await options.locator('#addLanguage').click();
  await options.waitForFunction(() => document.querySelector('#language')?.value === 'ja');
  await page.locator('#reading .fw-word').getByText('そして').waitFor();
  await options.locator('#removeLanguage').click();
  await options.waitForFunction(() => document.querySelector('#language')?.value === 'es');
  assert.equal(await options.locator('#language option[value=ja]').count(), 0);
  await page.locator('#reading .fw-word').getByText('y').waitFor();
  await review.locator('#language').getByText('Reviewing Spanish').waitFor();
  await review.locator('#counts').getByText('3 due · 25 available to add').waitFor();
  const afterLanguages = await worker.evaluate(() => globalThis.smokeCalls.length);
  await mail.waitForTimeout(800);
  assert.equal(await mail.locator('.fw-word').count(), 0);
  assert.equal(await worker.evaluate(() => globalThis.smokeCalls.length), afterLanguages);
  await options.locator('#levelOverride').selectOption('2');
  await options.waitForFunction(() => document.querySelector('#levelInfo').textContent === 'L2');
  await page.evaluate(() => { const p = document.createElement('p'); p.id = 'curriculum';
    p.textContent = 'The window stands beside the cat and the book.';
    document.querySelector('main').append(p); });
  await page.waitForFunction(() => [...document.querySelectorAll('#curriculum .fw-word')]
    .map((node) => node.textContent).join('|') === 'La ventana|el gato');
  const retained = await worker.evaluate(() => chrome.storage.local.get('recallReview'));
  assert.equal(retained.recallReview.cards.y.reviews, 1);
  assert.equal(retained.recallReview.cards.y.interval, 1);
  await popup.locator('#enabled').uncheck();
  await page.waitForFunction(() => document.querySelectorAll('.fw-word').length === 0);
  assert.equal(await page.locator('#reading').textContent(), 'We read books and enjoy quiet evenings every week.');
  await popup.locator('#enabled').check();
  await page.locator('#reading .fw-word').waitFor();
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'save', siteOverride: { host: 'reading.example', enabled: false } }));
  await page.waitForFunction(() => document.querySelectorAll('.fw-word').length === 0);
  // A fresh browser/profile starts an MV3 worker without the synthetic fetch.
  // Probe its browser-level network denial, which also survives worker restarts.
  await context.close();
  context = await chromium.launchPersistentContext(join(scratch, 'fresh-profile'), {
    channel: 'chromium', headless: true, args: launchArgs,
  });
  const freshWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  assert.equal(await freshWorker.evaluate(() => 'smokeCalls' in globalThis), false);
  // The owned origin is a positive control; a non-loopback hostname must
  // fail through the local rejecting proxy, with no request reaching origin.
  const probe = await freshWorker.evaluate(async (port) => {
    const working = await fetch(`http://127.0.0.1:${port}/working`);
    const positive = await working.text();
    let denied = false;
    try { await fetch(`http://probe.weave.test:${port}/blocked`); } catch { denied = true; }
    let httpsDenied = false;
    try { await fetch(`https://probe.weave.test:${port}/blocked`); } catch { httpsDenied = true; }
    return { positive, denied, httpsDenied };
  }, originPort);
  assert.equal(probe.positive, 'owned probe works');
  assert.equal(probe.denied, true);
  assert.equal(probe.httpsDenied, true);
  assert.ok(originHits.includes('/working'));
  assert.equal(originHits.some((url) => url.includes('/blocked')), false);
  assert.ok(proxyHits.some((url) => url.includes('probe.weave.test')));
  assert.ok(proxyHits.includes(`probe.weave.test:${originPort}`)); // HTTPS CONNECT reached only the owned sink
  console.log('PASS: real Chromium MV3 load; Spanish migration, new la ventana and pre-existing el gato at Expanded with review history, generated French/Japanese packs, language switching and isolated recall, hover, popup, local events, privacy exclusions, pause/resume and site-off restoration; unmocked worker HTTP/HTTPS proxy denial with owned positive control. Gemini mocked; no live model validation.');
} finally {
  try {
    if (context) await context.close();
  } finally {
    const servers = [origin, proxy].filter((server) => server.listening);
    for (const server of servers) server.closeAllConnections();
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    // Only the exact mkdtemp directory created above, after closing its browser.
    await rm(scratch, { recursive: true, force: true });
  }
}

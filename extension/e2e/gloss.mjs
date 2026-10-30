// Real MV3 Chromium with production source/CSS, synthetic model replies and browser-level network denial.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-gloss-'));
const extension = join(scratch, 'extension');
const artifacts = process.argv.includes('--save-screenshots')
  ? join(root, '..', 'docs', 'artifacts') : join(scratch, 'screenshots');
const proxyHits = [];
const originHits = [];
const origin = createServer((req, res) => { originHits.push(req.url); res.end('owned positive control'); });
const proxy = createServer((req, res) => { proxyHits.push(req.url); res.destroy(); });
proxy.on('connect', (req, socket) => { proxyHits.push(req.url); socket.destroy(); });
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
let browser;
try {
  const originPort = await listen(origin);
  const proxyPort = await listen(proxy);
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  await cp(join(root, 'icons'), join(extension, 'icons'), { recursive: true }); // the manifest names them; Chrome refuses to load without
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(...manifest.optional_host_permissions);
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width: 620, height: 420 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND, MAP probe.weave.test 127.0.0.1',
      `--proxy-server=127.0.0.1:${proxyPort}`],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    globalThis.glossCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(url, init);
      if (init.headers['x-goog-api-key'] !== 'synthetic-gloss-key') throw new Error('Unexpected key');
      const data = JSON.parse(init.body);
      const passages = JSON.parse(data.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      globalThis.glossCalls.push(...passages.map(({ text }) => text));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages:
        passages.map(({ id, text }) => ({ id, swaps: text.includes(' and ')
          ? [{ o: 'and', f: 'y', g: 'and', h: 'ee', ctx: '' }] : [] })) }) }] } }] }),
      { headers: { 'Content-Type': 'application/json' } });
    };
    await chrome.storage.local.set({ apiKey: 'synthetic-gloss-key' });
  });
  const fixture = (dark = false) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <title>Gloss fixture</title><style>
    body { margin: 0; background: ${dark ? '#15202b' : '#fff'}; color: ${dark ? '#e7e9ea' : '#202124'};
      font: 20px/1.5 Georgia, serif; }
    main { padding: 20px; } .clip { overflow: hidden; height: 26px; width: 280px;
      transform: translateZ(0); position: relative; z-index: 1; }
    #clipped { margin: 0; }
    #edge { position: absolute; top: 65px; right: 1px; width: 145px; }
    #far { margin-top: 1100px; }
    /* Reddit-like broad rule plus inherited values must not hide or recolor the gloss. */
    :not(:defined) { visibility: hidden; opacity: 0; }
    </style></head><body><main>
    <div class="clip"><p id="clipped">We read and write every evening.</p></div>
    <p id="edge">We read and write every evening.</p>
    <p id="far">We read and write every evening.</p>
    </main></body></html>`;
  await browser.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html',
    body: fixture(route.request().url().endsWith('/dark')) }));
  await mkdir(artifacts, { recursive: true });
  const results = [];
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage();
    await page.goto(`https://reading.example/${theme}`);
    const word = page.locator('#clipped .fw-word');
    await word.waitFor(); // positive control: the target was actually painted by the production content script
    assert.equal(await word.textContent(), 'y');
    assert.equal(await page.locator('.fw-gloss-on').count(), 0);
    const before = await worker.evaluate(() => chrome.storage.local.get('readingEvents').then((x) => x.readingEvents || []));
    // Record the trusted mouseover and the production box transition on the same page clock.
    await page.evaluate(() => {
      window.glossTiming = { started: 0, shown: 0 };
      document.querySelector('#clipped .fw-word').addEventListener('mouseover', () => {
        window.glossTiming.started = performance.now();
      }, { once: true });
      const observer = new MutationObserver(() => {
        if (document.querySelector('.fw-gloss-on')) {
          window.glossTiming.shown = performance.now(); observer.disconnect();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
    await word.hover();
    await page.waitForTimeout(250); // safely inside the measured 700 ms dwell window
    assert.equal(await page.locator('.fw-gloss-on').count(), 0);
    const early = await worker.evaluate(() => chrome.storage.local.get('readingEvents').then((x) => x.readingEvents || []));
    assert.equal(early.filter((e) => e.kind === 'peek').length, before.filter((e) => e.kind === 'peek').length);
    const box = page.locator('.fw-gloss-on');
    await box.waitFor();
    const timing = await page.evaluate(() => window.glossTiming);
    assert.ok(timing.started > 0 && timing.shown - timing.started >= 650 && timing.shown - timing.started < 1400,
      `hover reveal elapsed ${timing.shown - timing.started} ms`);
    const geometry = await page.evaluate(() => {
      const target = document.querySelector('#clipped .fw-word');
      const tip = document.querySelector('.fw-gloss-on');
      const a = target.getBoundingClientRect(), b = tip.getBoundingClientRect();
      const clip = document.querySelector('.clip').getBoundingClientRect();
      const style = getComputedStyle(tip);
      return { target: a.toJSON(), box: b.toJSON(), clip: clip.toJSON(),
        viewport: { width: innerWidth, height: innerHeight },
        style: { display: style.display, visibility: style.visibility, opacity: style.opacity,
          position: style.position, color: style.color, background: style.backgroundColor,
          zIndex: style.zIndex, pointerEvents: style.pointerEvents }, text: tip.textContent,
        label: target.getAttribute('aria-label') };
    });
    assert.match(geometry.text, /y.*and.*ee/);
    assert.match(geometry.label, /y.*and/);
    assert.equal(geometry.style.position, 'fixed');
    assert.equal(geometry.style.visibility, 'visible');
    assert.equal(geometry.style.opacity, '1');
    assert.equal(geometry.style.pointerEvents, 'none');
    assert.ok(geometry.box.width > 0 && geometry.box.height > 0);
    assert.ok(geometry.box.left >= 0 && geometry.box.right <= geometry.viewport.width + 1);
    assert.ok(geometry.box.top >= 0 && geometry.box.bottom <= geometry.viewport.height + 1);
    assert.ok(geometry.box.top >= geometry.clip.bottom || geometry.box.bottom <= geometry.clip.top,
      'box must visibly extend beyond the clipped ancestor');
    await page.screenshot({ path: join(artifacts, `gloss-${theme}.png`) });
    let after = [];
    for (let attempt = 0; attempt < 40; attempt++) {
      after = await worker.evaluate(() => chrome.storage.local.get('readingEvents').then((x) => x.readingEvents || []));
      if (theme !== 'light' || after.filter((e) => e.kind === 'peek').length >
          before.filter((e) => e.kind === 'peek').length) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (theme === 'light') assert.equal(after.filter((e) => e.kind === 'peek').length - before.filter((e) => e.kind === 'peek').length, 1);
    await page.evaluate(() => window.scrollTo(0, 80));
    await page.waitForFunction(() => !document.querySelector('.fw-gloss-on'));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(400, 350);
    await page.waitForFunction(() => !document.querySelector('.fw-gloss-on'));
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => document.activeElement?.classList.contains('fw-word'));
    assert.equal(focus, true);
    await page.waitForFunction(() => !!document.querySelector('.fw-gloss-on'));
    const focusEvents = await worker.evaluate(() => chrome.storage.local.get('readingEvents').then((x) => x.readingEvents || []));
    assert.equal(focusEvents.filter((e) => e.kind === 'peek').length, after.filter((e) => e.kind === 'peek').length);
    await word.evaluate((el) => el.blur());
    const edge = page.locator('#edge .fw-word');
    await edge.hover();
    await page.waitForFunction(() => document.querySelector('.fw-gloss-on')?.getBoundingClientRect().left > 300);
    assert.equal(await page.locator('.fw-gloss-on').count(), 1);
    await word.focus(); // a resting pointer on another word must not block keyboard focus
    await page.waitForFunction(() => document.querySelector('.fw-gloss-on')?.getBoundingClientRect().left < 200);
    assert.equal(await page.locator('.fw-gloss-on').count(), 1);
    await page.mouse.move(400, 350);
    // The focus-priority box persists after the pointer leaves the old target.
    await page.waitForFunction(() => document.querySelector('.fw-gloss-on')?.getBoundingClientRect().left < 200);
    assert.equal(await page.locator('.fw-gloss-on').count(), 1);
    await page.keyboard.press('Enter');
    assert.equal(await word.textContent(), 'and');
    await page.waitForFunction(() => !document.querySelector('.fw-gloss-on'));
    await page.keyboard.press('Space');
    assert.equal(await word.textContent(), 'y');
    await page.mouse.move(400, 350);
    await edge.hover();
    await box.waitFor();
    const edgeRect = await box.evaluate((el) => el.getBoundingClientRect().toJSON());
    assert.ok(edgeRect.left >= 0 && edgeRect.right <= 621 && edgeRect.top >= 0 && edgeRect.bottom <= 421);
    await page.setViewportSize({ width: 320, height: 220 });
    await page.waitForFunction(() => !document.querySelector('.fw-gloss-on'));
    await page.evaluate(() => document.body.style.zoom = '150%');
    await page.locator('#edge .fw-word').evaluate((el) => {
      el.setAttribute('data-tip', `${'a long but synthetic layout hint '.repeat(30)}<img src=x onerror=alert(1)>`);
    });
    await page.mouse.move(5, 5);
    await edge.hover();
    await box.waitFor();
    const long = await box.evaluate((el) => ({ text: el.textContent,
      html: el.innerHTML, rect: el.getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight } }));
    assert.match(long.text, /<img src=x/);
    assert.ok(!long.html.includes('<img '), 'untrusted tip text must not become markup');
    assert.ok(long.rect.left >= 0 && long.rect.right <= long.viewport.width + 1);
    assert.ok(long.rect.top >= 0 && long.rect.bottom <= long.viewport.height + 1);
    await page.waitForTimeout(500); // exceeds the 250 ms passage flush if the appended box were scanned
    const scanned = await worker.evaluate(() => globalThis.glossCalls);
    assert.ok(scanned.every((s) => !s.includes('y · and · "ee"') &&
      !s.includes('a long but synthetic layout hint')),
    'visible gloss text must never enter a model passage');
    await page.mouse.move(5, 5);
    await page.setViewportSize({ width: 620, height: 420 });
    await page.evaluate(() => { document.body.style.zoom = ''; });
    await word.hover();
    await box.waitFor();
    await page.evaluate(() => { document.querySelector('#clipped').firstChild.textContent = 'Host-owned text remains and changes.'; });
    await page.waitForFunction(() => !document.querySelector('.fw-gloss-on'));
    assert.match(await page.locator('#clipped').textContent(), /Host-owned text remains and changes/);
    await page.emulateMedia({ forcedColors: 'active' });
    const forced = await page.locator('#edge .fw-word').evaluate((el) => {
      const css = getComputedStyle(el); return { thickness: css.textDecorationThickness,
        decorationColor: css.textDecorationColor, color: css.color };
    });
    assert.equal(forced.thickness, '2px');
    assert.equal(forced.decorationColor, forced.color);
    await page.locator('#edge .fw-word').hover();
    await box.waitFor();
    await page.screenshot({ path: join(artifacts, `gloss-${theme}-forced.png`) });
    const far = page.locator('#far .fw-word');
    await page.evaluate(() => window.scrollTo(0, 1000)); // enter the content script's near viewport band
    await far.waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(5, 5);
    await far.focus(); // browser scrolls an offscreen keyboard target into view
    assert.equal(await far.evaluate((el) => el === document.activeElement), true);
    await page.waitForFunction(() => document.querySelector('#far .fw-word.fw-tip') &&
      document.querySelector('.fw-gloss-on'), undefined, { timeout: 5000 });
    const farRect = await box.evaluate((el) => el.getBoundingClientRect().toJSON());
    const farWordRect = await far.evaluate((el) => el.getBoundingClientRect().toJSON());
    assert.ok(farRect.top >= 0 && farRect.bottom <= 421);
    assert.ok(Math.abs(farRect.left - farWordRect.left) < 120);
    await far.evaluate((el) => el.blur());
    await page.waitForFunction(() => !document.querySelector('.fw-gloss-on'));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100); // let the scroll cleanup run before the next hover
    await page.mouse.move(5, 5);
    await edge.hover();
    await box.waitFor({ timeout: 5000 });
    if (theme === 'light') {
      await page.evaluate(() => { document.title = 'Bank robbery investigation'; });
      await page.waitForFunction(() => !document.querySelector('.fw-gloss, .fw-word'));
      assert.match(await page.locator('#clipped').textContent(), /Host-owned text remains and changes/);
    } else {
      const popup = await browser.newPage();
      await popup.goto(`chrome-extension://${id}/src/popup.html`);
      await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'save',
        siteOverride: { host: 'reading.example', enabled: false } }));
      await page.waitForFunction(() => !document.querySelector('.fw-gloss, .fw-word'));
      assert.match(await page.locator('#clipped').textContent(), /Host-owned text remains and changes/);
      await popup.close();
    }
    results.push({ theme, timing: Math.round(timing.shown - timing.started), geometry });
    await page.close();
  }
  const guard = await worker.evaluate(async (port) => {
    const ok = await fetch(`http://127.0.0.1:${port}/positive`).then((r) => r.text());
    let denied = false;
    try { await fetch(`https://probe.weave.test:${port}/negative`); } catch { denied = true; }
    return { ok, denied };
  }, originPort);
  assert.equal(guard.ok, 'owned positive control');
  assert.equal(guard.denied, true);
  assert.ok(originHits.includes('/positive'));
  assert.ok(proxyHits.includes(`probe.weave.test:${originPort}`));
  console.log(JSON.stringify({ result: 'PASS', results: results.map(({ theme, timing, geometry }) => ({ theme,
    delayMs: timing, target: geometry.target, box: geometry.box, clip: geometry.clip, style: geometry.style })) }));
} finally {
  if (browser) await browser.close();
  for (const server of [origin, proxy]) if (server.listening) server.closeAllConnections();
  await Promise.all([origin, proxy].map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(scratch, { recursive: true, force: true });
}

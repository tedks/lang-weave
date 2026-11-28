// Real MV3 Chromium with production source/CSS, synthetic model replies and browser-level network denial.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, chromiumBinary, extensionRoot, grantReadingSite, waitForExtensionWorker } from './browser.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const longEntry = {
  fr: 'ensemble',
  en: 'together, in company with the other people in a group',
  hint: 'ahn-sahmbl &lt;em&gt; (keep the final sound soft)',
  level: 1,
};
const longPassage = 'We worked together during the quiet afternoon.';
const maxRevealDelayMs = 1400;
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-gloss-'));
const extension = extensionRoot;
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
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    ...chromiumBinary, headless: true, viewport: { width: 620, height: 420 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND, MAP probe.weave.test 127.0.0.1',
      `--proxy-server=127.0.0.1:${proxyPort}`],
  });
  const worker = await waitForExtensionWorker(browser);
  const id = new URL(worker.url()).host;
  await worker.evaluate(async (longEntry) => {
    globalThis.glossCalls = [];
    globalThis.longWordInteractions = [];
    chrome.runtime.onMessage.addListener(({ type, word, event }) => {
      if (type === 'event' && word === longEntry.fr && event !== 'seen') globalThis.longWordInteractions.push(event);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(url, init);
      if (init.headers['x-goog-api-key'] !== 'synthetic-gloss-key') throw new Error('Unexpected key');
      const data = JSON.parse(init.body);
      const request = data.contents[0].parts[0].text;
      if (!request.startsWith('Passages:\n')) {
        const words = [{ fr: 'et', en: 'and', hint: 'eh', level: 1 }, longEntry,
          ...Array.from({ length: 18 }, (_, i) => ({
            fr: `mot${i}`, en: `word ${i}`, hint: `hint ${i}`, level: i < 8 ? 1 : 2,
          }))];
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ words }) }] } }] });
      }
      const passages = JSON.parse(request.slice('Passages:\n'.length));
      globalThis.glossCalls.push(...passages.map(({ text }) => text));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages:
        passages.map(({ id, text }) => ({ id, swaps: text.includes(' and ')
          ? [{ o: 'and', f: 'et', g: 'and', h: 'eh', ctx: '' }]
          : text.includes(' together ') ? [{ o: 'together', f: longEntry.fr, g: 'together', h: 'ahn-sahmbl', ctx: '' }]
            : [] })) }) }] } }] }),
      { headers: { 'Content-Type': 'application/json' } });
    };
    for (let i = 0; i < 100 && !(await chrome.storage.local.get('settings')).settings; i++)
      await new Promise((done) => setTimeout(done, 10));
    // Plain reading path: a new profile starts with gradual on (FRESH_INSTALL_SETTINGS); gradual.mjs covers that.
    const { settings } = await chrome.storage.local.get('settings');
    if (!settings) throw new Error('worker never wrote its startup settings');
    await chrome.storage.local.set({ settings: { ...settings, gradual: false }, apiKey: 'synthetic-gloss-key', consentShown: true });
  }, longEntry);
  const options = await browser.newPage();
  await options.goto(`chrome-extension://${id}/src/options.html`);
  await options.getByText('Add a language').click();
  await options.locator('#newLanguage').fill('fr');
  await options.locator('#addLanguage').click();
  await options.waitForFunction(() => document.querySelector('#language')?.value === 'fr');
  await options.close();
  const readingEffects = () => worker.evaluate(async () => {
    const { languagePacks } = await chrome.storage.local.get('languagePacks');
    const key = `lang:fr:${languagePacks.fr.version}:readingEvents`;
    return {
      events: (await chrome.storage.local.get(key))[key] || [],
      interactions: globalThis.longWordInteractions,
      calls: globalThis.glossCalls.length,
    };
  });
  const fixture = (dark = false) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <title>Gloss fixture</title><style>
    body { margin: 0; background: ${dark ? '#15202b' : '#fff'}; color: ${dark ? '#e7e9ea' : '#202124'};
      font: 20px/1.5 Georgia, serif; }
    main { padding: 20px; } .clip { overflow: hidden; height: 26px; width: 280px;
      transform: translateZ(0); position: relative; z-index: 1; }
    #clipped { margin: 0; }
    #edge { position: absolute; top: 65px; right: 1px; width: 145px; }
    #long { position: absolute; top: 90px; right: 1px; width: 142px; margin: 0; }
    #far { margin-top: 1100px; }
    /* Reddit-like broad rule plus inherited values must not hide or recolor the gloss. */
    :not(:defined) { visibility: hidden; opacity: 0; }
    </style></head><body><main>
    <div class="clip"><p id="clipped">We read and write every evening.</p></div>
    <p id="edge">We read and write every evening.</p>
    <p id="far">We read and write every evening.</p>
    </main></body></html>`;
  await grantReadingSite(browser, worker);
  await browser.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html',
    body: fixture(route.request().url().endsWith('/dark')) }));
  await mkdir(artifacts, { recursive: true });
  const results = [];
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage();
    await page.goto(`https://reading.example/${theme}`);
    const word = page.locator('#clipped .fw-word');
    await word.waitFor(); // positive control: the target was actually painted by the production content script
    assert.equal(await word.textContent(), 'et');
    assert.equal(await page.locator('.fw-gloss-on').count(), 0);
    const { events: before } = await readingEffects();
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
    const { events: early } = await readingEffects();
    assert.equal(early.filter((e) => e.kind === 'peek').length, before.filter((e) => e.kind === 'peek').length);
    const box = page.locator('.fw-gloss-on');
    const waitForGloss = async (stage) => {
      try {
        await box.waitFor({ timeout: 5000 });
      } catch (cause) {
        throw new Error(`${theme} gloss was missing after ${stage}`, { cause });
      }
    };
    await waitForGloss('hovering the clipped word');
    const timing = await page.evaluate(() => window.glossTiming);
    assert.ok(timing.started > 0 && timing.shown - timing.started >= 650 &&
      timing.shown - timing.started < maxRevealDelayMs,
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
        label: target.getAttribute('aria-label'), lang: target.getAttribute('lang'),
        description: document.getElementById(target.getAttribute('aria-describedby'))?.textContent,
        descriptionInside: !!target.closest('p,li,blockquote,h1,h2,h3,h4,article,main')
          ?.contains(document.getElementById(target.getAttribute('aria-describedby'))) };
    });
    assert.equal(geometry.text, 'et · and · "eh"');
    // The swapped word is tagged with the target language, its name is the word alone and the gloss is a
    // description outside every passage. Chrome's own accessibility tree must compute exactly that.
    assert.equal(geometry.label, null);
    assert.equal(geometry.lang, 'fr');
    assert.equal(geometry.description, 'and · "eh". Show English');
    assert.equal(geometry.descriptionInside, false);
    const cdp = await page.context().newCDPSession(page);
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#clipped .fw-word' });
    const [ax] = (await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })).nodes;
    assert.equal(ax.role?.value, 'button');
    assert.equal(ax.name?.value, 'et');
    assert.equal(ax.description?.value, geometry.description);
    await cdp.detach();
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
      ({ events: after } = await readingEffects());
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
    const { events: focusEvents } = await readingEffects();
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
    assert.equal(await word.textContent(), 'et');
    await page.mouse.move(400, 350);
    await edge.hover();
    await waitForGloss('hovering the right edge after the keyboard flip');
    const edgeRect = await box.evaluate((el) => el.getBoundingClientRect().toJSON());
    assert.ok(edgeRect.left >= 0 && edgeRect.right <= 621 && edgeRect.top >= 0 && edgeRect.bottom <= 421);
    await page.setViewportSize({ width: 320, height: 220 });
    await page.waitForFunction(() => !document.querySelector('.fw-gloss-on'));
    await page.evaluate(() => document.body.style.zoom = '150%');
    await page.mouse.move(5, 5);
    await page.evaluate((text) => {
      const passage = document.createElement('p');
      passage.id = 'long';
      passage.textContent = text;
      document.querySelector('main').append(passage);
    }, longPassage);
    const longWord = page.locator('#long .fw-word');
    await longWord.waitFor();
    const longTip = `${longEntry.en} · "${longEntry.hint}"`;
    assert.equal(await longWord.getAttribute('data-tip'), longTip, 'renderer uses the validated pack text');
    const { interactions: beforeLongHover } = await readingEffects();
    await longWord.hover();
    await waitForGloss('hovering the intact long word at narrow zoom');
    const long = await box.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return { text: el.textContent, elements: el.childElementCount, lines: range.getClientRects().length,
        clipped: el.scrollHeight > el.clientHeight, rect: el.getBoundingClientRect().toJSON(),
        viewport: { width: innerWidth, height: innerHeight } };
    });
    assert.equal(long.text, `ensemble · ${longTip}`);
    assert.equal(long.elements, 0, 'catalog text stays literal, including the entity-like hint');
    assert.ok(long.lines > 1 && !long.clipped, 'the legitimate long gloss wraps without clipping');
    assert.ok(long.rect.left >= 0 && long.rect.right <= long.viewport.width + 1);
    assert.ok(long.rect.top >= 0 && long.rect.bottom <= long.viewport.height + 1);
    await page.waitForTimeout(500); // exceeds the 250 ms passage flush if the appended box were scanned
    const scanned = await worker.evaluate(() => globalThis.glossCalls);
    assert.ok(scanned.includes(longPassage), 'the synthetic provider received the real passage');
    assert.ok(scanned.every((s) => !s.includes('et · and · "eh"') && !s.includes(longEntry.hint)),
      'visible gloss text must never enter a model passage');
    await page.mouse.move(5, 5);
    await box.waitFor({ state: 'detached' });
    const forgedTip = '<b>Host edit</b>';
    const beforeDirty = await readingEffects();
    assert.deepEqual(beforeDirty.interactions, [...beforeLongHover, 'peek'], 'this theme’s intact long gloss sent a peek');
    await longWord.evaluate((span, text) => {
      span.setAttribute('data-tip', text);
      window.glossInput = [];
      for (const type of ['mouseover', 'click']) {
        span.addEventListener(type, (event) => window.glossInput.push([event.type, event.isTrusted]), { once: true });
      }
    }, forgedTip);
    await longWord.hover();
    await assert.rejects(box.waitFor({ timeout: maxRevealDelayMs }), { name: 'TimeoutError' },
      'an edited tip must stay hidden throughout the allowed reveal window');
    await longWord.click();
    await page.waitForTimeout(300); // allow a wrongly dispatched event or passage flush to reach the worker
    assert.deepEqual(await page.evaluate(() => window.glossInput), [['mouseover', true], ['click', true]]);
    assert.equal(await longWord.getAttribute('data-tip'), forgedTip, 'the host edit stays in place');
    assert.equal(await longWord.textContent(), 'ensemble', 'the edited span must not flip');
    assert.deepEqual(await readingEffects(), beforeDirty, 'editing the tip must record no reading event or model call');
    console.log(`Gloss ownership (${theme}): the validated gloss wrapped to ${long.lines} lines; trusted hover and click on the edited span had no effects.`);
    await page.locator('#long').evaluate((passage) => passage.remove());
    await page.mouse.move(5, 5);
    await page.setViewportSize({ width: 620, height: 420 });
    await page.evaluate(() => { document.body.style.zoom = ''; });
    await word.hover();
    await waitForGloss('returning to the clipped word after zoom');
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
    await waitForGloss('hovering the right edge in forced colors');
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
    await waitForGloss('returning to the right edge after scrolling');
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
    assert.deepEqual((await readingEffects()).interactions, beforeDirty.interactions,
      'no late peek or flip arrived from the edited span');
    results.push({ theme, timing: Math.round(timing.shown - timing.started), geometry });
    await page.close();
  }
  await grantReadingSite(browser, worker, 'http://127.0.0.1/*');
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

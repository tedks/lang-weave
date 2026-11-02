// Guess first in isolated real MV3 Chromium: synthetic Gemini replies, a throwaway profile and
// browser-level network denial. Production source and CSS; learning cards seeded in storage.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-guess-'));
const extension = join(scratch, 'extension');
const artifacts = process.argv.includes('--save-screenshots')
  ? join(root, '..', 'docs', 'artifacts') : join(scratch, 'screenshots');
let browser;
try {
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  await cp(join(root, 'icons'), join(extension, 'icons'), { recursive: true }); // the manifest names them; Chrome refuses to load without
  await cp(join(root, '_locales'), join(extension, '_locales'), { recursive: true }); // default_locale needs it
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(...manifest.optional_host_permissions); // test grant only
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width: 760, height: 520 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    for (let i = 0; i < 100 && !(await chrome.storage.local.get('settings')).settings; i++)
      await new Promise((done) => setTimeout(done, 10));
    const { settings } = await chrome.storage.local.get('settings');
    const now = Date.now();
    const d = new Date(now);
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const card = (reviews) => ({ due: now + 5 * 86400000, interval: 5, reviews, introducedDay: today });
    await chrome.storage.local.set({
      settings: { ...settings, gradual: true, inlineRecall: false, newWordsPerDay: 1, newSitesEnabled: true, guessFirst: true },
      apiKey: 'synthetic-guess-key', consentShown: true,
      recallReview: { version: 1, cards: { y: card(1), pero: card(0), o: card(2) }, learning: { day: today, count: 0, pending: [] } },
    });
    globalThis.calls = [];
    const original = fetch;
    const pairs = [['and', 'y'], ['but', 'pero'], ['or', 'o']];
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return original(url, init);
      if (init.headers['x-goog-api-key'] !== 'synthetic-guess-key') throw new Error('Key mismatch');
      const body = JSON.parse(init.body);
      const passages = JSON.parse(body.contents[0].parts[0].text.replace(/^Passages:\n/, ''));
      globalThis.calls.push(...passages.map((p) => p.text));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages:
        passages.map(({ id, text }) => ({ id, swaps: pairs.filter(([en]) => text.includes(` ${en} `))
          .map(([en, fr]) => ({ o: en, f: fr, g: en, h: '', ctx: '' })) })) }) }] } }] }),
      { headers: { 'Content-Type': 'application/json' } });
    };
  });
  // Long enough that the request-wide unknown-word cap (2% of running words) admits all three swaps.
  const filler = ' The neighbors shared simple stories at the table.'.repeat(6);
  const html = `<!doctype html><html lang="en"><head><title>Guess fixture</title>
    <style>body { font: 20px/1.6 Georgia, serif; margin: 0; } main { padding: 140px 30px 30px; }</style></head><body><main>
    <p id="one">We read and write together every single evening.${filler}</p>
    <p id="two">We cook but rarely eat together every single evening.${filler}</p>
    <p id="three">We walk or run together every single evening outside.${filler}</p>
    <form><p>Private form text and notes stay here every evening.</p></form>
    <p contenteditable="true">Editable text and notes stay here every evening.</p>
  </main></body></html>`;
  await browser.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('PAGE CONSOLE', msg.text()); });
  page.on('pageerror', (error) => console.error('PAGE ERROR', error));
  worker.on('console', (msg) => { if (msg.type() === 'error') console.error('WORKER CONSOLE', msg.text()); });
  await page.goto('https://reading.example/guess');
  const y = page.locator('#one .fw-word');
  const pero = page.locator('#two .fw-word');
  const o = page.locator('#three .fw-word');
  await y.waitFor();
  await pero.waitFor();
  await o.waitFor();
  assert.equal(await y.getAttribute('data-fr'), 'y');
  assert.equal(await page.locator('form .fw-word, [contenteditable] .fw-word').count(), 0);
  const log = () => worker.evaluate(() => chrome.storage.local.get('learningRetrievals')
    .then((x) => x.learningRetrievals?.retrievals || []));
  const cards = () => worker.evaluate(() => chrome.storage.local.get('recallReview').then((x) => x.recallReview.cards));

  const cdp = await browser.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  const descendants = (node) => [node, ...(node.children || []).flatMap(descendants),
    ...(node.shadowRoots || []).flatMap(descendants)];
  const named = (node, cls) => descendants(node).find((n) => {
    const at = n.attributes || [];
    return at.some((v, i) => i % 2 === 0 && v === 'class' && at[i + 1].split(' ').includes(cls));
  });
  const internal = async () => {
    const { root: dom } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const inner = named(dom, 'fw-guess');
    assert.ok(inner, 'closed shadow panel exists in CDP DOM');
    return inner;
  };
  const resolve = async (node) => (await cdp.send('DOM.resolveNode', { nodeId: node.nodeId })).object.objectId;
  const value = async (node, fn) => (await cdp.send('Runtime.callFunctionOn', {
    objectId: await resolve(node), functionDeclaration: fn, returnByValue: true })).result.value;
  const buttons = async () => {
    const list = named(await internal(), 'fw-guess-choices');
    return descendants(list).filter((n) => n.nodeName === 'BUTTON');
  };
  const statusText = async () => value(named(await internal(), 'fw-guess-status'), 'function() { return this.textContent; }');
  const clickNode = async (node) => {
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId });
    const q = model.content;
    await page.mouse.click((q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4);
  };
  const ax = async () => (await cdp.send('Accessibility.getFullAXTree')).nodes;
  const axBy = (nodes, role, name) => nodes.find((n) => n.role?.value === role && n.name?.value === name);
  const axFocused = (node) => node.properties?.some((p) => p.name === 'focused' && p.value?.value === true);
  let tree = await ax();
  const yAx = axBy(tree, 'button', 'y');
  assert.ok(yAx, 'the woven word is in Chrome accessibility tree');
  assert.doesNotMatch(yAx.description?.value || '', /and/);
  assert.match(yAx.description?.value || '', /Guess the meaning/);

  // Hover: after the 700 ms beat, choices instead of the gloss.
  await y.hover();
  await page.waitForTimeout(400);
  const panel = page.locator('.fw-guess-host');
  assert.equal(await panel.count(), 0);
  await panel.waitFor();
  assert.equal(await panel.evaluate((el) => el.shadowRoot), null); // closed to the page
  assert.equal(await page.locator('.fw-gloss').count(), 0);
  tree = await ax();
  assert.ok(axBy(tree, 'group', 'Guess the meaning'));
  assert.ok(tree.some((n) => n.role?.value === 'status'));
  assert.ok(tree.some((n) => /Guess choices ready/.test(n.name?.value || '')));
  const choiceNodes = await buttons();
  const labels = await Promise.all(choiceNodes.map((n) => value(n, 'function() { return this.lastChild.textContent; }')));
  assert.ok(labels.length >= 3 && labels.length <= 4, labels.join('|'));
  assert.ok(labels.includes('and'));
  for (const label of labels) assert.ok(axBy(tree, 'button', label), `AX choice ${label}`);
  const [box, word] = await Promise.all([panel.boundingBox(), y.boundingBox()]);
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 760 && box.y + box.height <= 520);
  assert.ok(box.y + box.height <= word.y || box.y >= word.y + word.height);
  const light = await value(await internal(), 'function() { const s = getComputedStyle(this); return [s.backgroundColor, s.color]; }');
  assert.deepEqual(light, ['rgb(255, 255, 255)', 'rgb(24, 32, 39)']);
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, 'guess-light.png') });

  // Page-script clicks are untrusted; Escape and click-away never record a guess.
  await value((await buttons())[0], 'function() { this.click(); return true; }');
  assert.equal((await log()).length, 0);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  assert.equal((await log()).length, 0);

  await page.mouse.move(5, 5);
  await page.emulateMedia({ colorScheme: 'dark' });
  await y.hover();
  await panel.waitFor();
  const dark = await value(await internal(), 'function() { const s = getComputedStyle(this); return [s.backgroundColor, s.color]; }');
  assert.deepEqual(dark, ['rgb(34, 40, 45)', 'rgb(243, 243, 243)']);
  await page.screenshot({ path: join(artifacts, 'guess-dark.png') });
  await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active' });
  const forced = await value(await internal(), 'function() { const s = getComputedStyle(this); return [s.color, s.backgroundColor, s.boxShadow]; }');
  assert.notEqual(forced[0], forced[1]);
  assert.equal(forced[2], 'none');
  await page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });

  await page.mouse.click(5, 5);
  await panel.waitFor({ state: 'detached' });
  await y.hover();
  await panel.waitFor();
  const before = (await cards()).y;
  const wrongIndex = labels.findIndex((label) => label !== 'and');
  await clickNode((await buttons())[wrongIndex]);
  for (let i = 0; i < 50 && !/Not quite/.test(await statusText()); i++) await page.waitForTimeout(20);
  assert.match(await statusText(), /Not quite: y · and/);
  tree = await ax();
  assert.ok(tree.some((n) => n.role?.value === 'status'));
  assert.ok(tree.some((n) => /Not quite: y · and/.test(n.name?.value || '')));
  const yRevealed = axBy(tree, 'button', 'y');
  assert.match(yRevealed.description?.value || '', /and/);
  let entries = await log();
  assert.equal(entries.length, 1);
  const [wordId, at, source, direction, outcome, prior, latency, elapsed, interval, predicted] = entries[0];
  assert.deepEqual([wordId, source, direction, outcome, prior, elapsed, interval, predicted],
    ['y', 'guess', 'receptive', 'incorrect', 1, null, null, null]);
  assert.ok(Number.isSafeInteger(at) && latency > 0 && latency < 60000, `latency ${latency}`);
  const after = (await cards()).y;
  assert.equal(after.peekCount, 1);
  assert.equal(after.due, before.due);

  await page.mouse.click(5, 5);
  await panel.waitFor({ state: 'detached' });
  await page.mouse.move(5, 5);
  await y.hover();
  await page.locator('.fw-gloss-on').waitFor();
  assert.equal(await panel.count(), 0);

  // Focus order: word -> first choice on Tab; the result is a live status and focus returns.
  await page.mouse.move(5, 5);
  await pero.focus();
  await panel.waitFor();
  assert.equal(await pero.evaluate((el) => document.activeElement === el), true);
  await page.keyboard.press('Tab');
  tree = await ax();
  const peroLabels = await Promise.all((await buttons()).map((n) => value(n, 'function() { return this.lastChild.textContent; }')));
  assert.ok(tree.some((n) => n.role?.value === 'button' && axFocused(n) && peroLabels.includes(n.name?.value)));
  await page.keyboard.press('2');
  const selected = peroLabels[1];
  assert.ok((await ax()).some((n) => n.role?.value === 'button' && axFocused(n) && n.name?.value === selected));
  await page.keyboard.press('Enter');
  for (let i = 0; i < 50 && !/pero · but/.test(await statusText()); i++) await page.waitForTimeout(20);
  assert.match(await statusText(), /pero · but/);
  assert.equal(await pero.evaluate((el) => document.activeElement === el), true);
  entries = await log();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[1].slice(0, 5).filter((_, i) => i !== 1),
    ['pero', 'guess', 'receptive', selected === 'but' ? 'correct' : 'incorrect']);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });

  // Click-to-flip is unchanged and records no guess.
  await o.click();
  assert.equal(await o.textContent(), 'or');
  await o.click();
  assert.equal(await o.textContent(), 'o');
  assert.equal((await log()).length, 2);

  // My words: the measurement with its not-enough-data state.
  const words = await browser.newPage();
  await words.goto(`chrome-extension://${id}/src/words.html`);
  await words.locator('#measures li', { hasText: 'First-guess accuracy' }).waitFor();
  assert.match(await words.locator('#measures li', { hasText: 'First-guess accuracy' }).textContent(),
    /Not enough data yet: 2 words guessed; 10 are needed\./);
  assert.match(await words.locator('#measures li', { hasText: 'Next-day recall after guessing' }).textContent(),
    /Not enough data yet/);

  // Settings off: no new model call or repaint, and a hover is the plain gloss again.
  const callsBefore = (await worker.evaluate(() => globalThis.calls)).length;
  await page.evaluate(() => {
    globalThis.guessE2E = { word: document.querySelector('#one .fw-word'), changes: 0 };
    new MutationObserver((records) => { globalThis.guessE2E.changes += records.filter((r) =>
      r.target.closest?.('main')).length; }).observe(document.querySelector('main'), { childList: true, subtree: true, characterData: true });
  });
  const options = await browser.newPage();
  await options.goto(`chrome-extension://${id}/src/options.html`);
  await options.locator('#guessFirst').waitFor();
  await options.waitForFunction(() => document.querySelector('#guessFirst').checked === true);
  assert.equal(await options.locator('#guessFirst').isChecked(), true);
  await options.locator('#guessFirst').uncheck();
  await options.waitForFunction(() => document.querySelector('#guessFirst').checked === false);
  for (let i = 0; i < 50 && (await worker.evaluate(() => chrome.storage.local.get('settings')
    .then((x) => x.settings.guessFirst))) !== undefined; i++) await options.waitForTimeout(20);
  assert.equal(await worker.evaluate(() => chrome.storage.local.get('settings').then((x) => 'guessFirst' in x.settings)), false);
  await page.bringToFront();
  await page.mouse.move(5, 5);
  await o.hover();
  await page.locator('.fw-gloss-on').waitFor();
  assert.equal(await page.locator('.fw-guess-host').count(), 0);
  // The swaps were not repainted: the same span node, and no node or text change inside the passages.
  assert.deepEqual(await page.evaluate(() => ({ same: document.querySelector('#one .fw-word') === globalThis.guessE2E.word,
    changes: globalThis.guessE2E.changes })), { same: true, changes: 0 });
  assert.equal((await worker.evaluate(() => globalThis.calls)).length, callsBefore);
  assert.ok((await worker.evaluate(() => globalThis.calls)).every((text) => !/Private form|Editable/.test(text)));
  console.log('PASS: Chromium MV3 guess first: hover and keyboard panels after the beat, light/dark/forced colours, placement, ' +
    'Escape/click-away/untrusted no-record, wrong guess as peek with worker latency, one a day, flip unchanged, ' +
    'My words not-enough-data, Settings off without repaint; Gemini synthetic.');
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true });
}

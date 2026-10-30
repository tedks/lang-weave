// Reproducible Store listing scenes in real Chromium. Only the packaged Store extension runs.
// The article and Gemini reply are synthetic; DNS and proxy rules fail closed for every host.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { packageExtension } from '../scripts/package.mjs';
import { L1_WORDS } from '../src/vocabulary.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assets = join(root, '..', 'docs', 'store-assets');
const shots = [
  ['01-welcome.png', 1280, 800],
  ['02-hover.png', 1280, 800],
  ['03-flip.png', 1280, 800],
  ['04-review.png', 1280, 800],
  ['05-progress.png', 1280, 800],
  ['small-promo.png', 440, 280],
];

async function checkDimensions() {
  for (const [name, width, height] of shots) {
    const bytes = await readFile(join(assets, name));
    assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${name}: PNG signature`);
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${name}: IHDR`);
    assert.equal(bytes.readUInt32BE(16), width, `${name}: width`);
    assert.equal(bytes.readUInt32BE(20), height, `${name}: height`);
  }
  console.log('PASS: five 1280x800 PNGs and one 440x280 PNG have the required IHDR dimensions.');
}

if (process.argv.includes('--check')) {
  await checkDimensions();
} else {
  const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-store-shots-'));
  let browser;
  try {
    const built = packageExtension({ store: true, outDir: join(scratch, 'dist') });
    const extension = join(scratch, 'extension');
    await mkdir(extension);
    await promisify(execFile)('unzip', ['-q', built.path, '-d', extension]);
    const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
    assert.equal(manifest.content_scripts, undefined, 'the screenshot source must be the Store build');
    assert.equal(manifest.web_accessible_resources, undefined);
    // Stand in for a user's per-site Chrome permission. This copy is thrown away after capture.
    manifest.host_permissions.push('https://reading.example/*');
    manifest.update_url = 'https://update.invalid/service/update2/crx';
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
      channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=127.0.0.1:9'],
    });
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    assert.equal(id, 'lkbkmlgogcpcacjmdmoecgacdbfddbnh', 'fixed extension ID');
    const url = (page) => `chrome-extension://${id}/src/${page}.html`;
    const welcome = browser.pages().find((page) => page.url() === url('welcome')) ||
      await browser.waitForEvent('page', { predicate: (page) => page.url() === url('welcome') });
    await welcome.locator('#demo .fw-word').first().waitFor();
    assert.equal(await welcome.locator('#demo .fw-word').count(), 9);
    assert.equal(await welcome.locator('#onlySites').isVisible(), true);
    await mkdir(assets, { recursive: true });
    await welcome.evaluate(() => window.scrollTo(0, 165));
    await welcome.screenshot({ path: join(assets, shots[0][0]) });

    await welcome.locator('#onlySites').click();
    await welcome.locator('#choiceStatus').getByText(/Only sites you turn on selected/).waitFor();
    const words = L1_WORDS.filter(({ en }) => ['and', 'but', 'with', 'always', 'because', 'important', 'possible'].includes(en));
    await worker.evaluate(async (candidateWords) => {
      for (let i = 0; i < 100 && !(await chrome.storage.local.get('settings')).settings; i++)
        await new Promise((done) => setTimeout(done, 10));
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, siteOverrides: { ...settings.siteOverrides,
        'reading.example': true } }, apiKey: 'synthetic-store-shots-key' });
      globalThis.storeShotCalls = 0;
      globalThis.fetch = async (request, init) => {
        if (!String(request).startsWith('https://generativelanguage.googleapis.com/'))
          throw new Error(`Unexpected network request: ${request}`);
        if (init.headers['x-goog-api-key'] !== 'synthetic-store-shots-key') throw new Error('Unexpected key');
        const prompt = JSON.parse(init.body).contents[0].parts[0].text;
        if (!prompt.startsWith('Passages:\n')) throw new Error('Unexpected model prompt');
        const items = JSON.parse(prompt.slice('Passages:\n'.length));
        globalThis.storeShotItems = items;
        globalThis.storeShotCalls += 1;
        const passages = items.map(({ id, text }) => ({ id, swaps: candidateWords.flatMap((word) => {
          const found = new RegExp(`\\b${word.en}\\b`, 'i').exec(text);
          return found ? [{ o: found[0], f: word.fr, g: word.en, h: word.hint, ctx: '' }] : [];
        }) }));
        globalThis.storeShotPassages = passages;
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ passages }) }] } }] }),
          { headers: { 'Content-Type': 'application/json' } });
      };
    }, words);
    await worker.evaluate(async () => {
      for (let i = 0; i < 100; i++) {
        const registered = await chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] });
        if (registered[0]?.js?.includes('src/content-bundle.js')) return;
        await new Promise((done) => setTimeout(done, 50));
      }
      throw new Error('Store content script did not register');
    });

    // Original sample prose. A local route supplies the entire page; there is no external article.
    const article = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A table for everyone · Sample reading</title>
      <style>body{margin:0;background:#f8f7f2;color:#22312e;font:18px/1.75 Georgia,serif}
      header{height:74px;background:#fff;border-bottom:1px solid #dce3de;display:flex;align-items:center;padding:0 9%;gap:24px}
      .mark{font:700 18px system-ui,sans-serif;color:#146b60}.nav{margin-left:auto;font:14px system-ui,sans-serif;color:#64736e}
      main{max-width:920px;margin:58px auto;display:grid;grid-template-columns:650px 210px;gap:60px}
      .eyebrow{font:700 12px system-ui,sans-serif;letter-spacing:.13em;text-transform:uppercase;color:#277468}
      h1{font:700 46px/1.15 Georgia,serif;letter-spacing:-.03em;margin:12px 0 12px}
      .deck{color:#5a6863;font-size:21px;line-height:1.45;margin:0 0 28px}
      .rule{width:42px;height:3px;background:#277468;margin:20px 0 25px}
      p{margin:0 0 22px} aside{border-left:1px solid #dce3de;padding-left:22px;color:#67736e;font:14px/1.55 system-ui,sans-serif}
      aside strong{display:block;color:#22312e;margin:0 0 12px} aside p{margin-bottom:15px}</style></head><body>
      <header><span class="mark">FIELD NOTES</span><span class="nav">Stories&nbsp;&nbsp;&nbsp; Ideas&nbsp;&nbsp;&nbsp; About</span></header>
      <main><article><div class="eyebrow">Everyday ideas · Sample reading</div><h1>A table for everyone</h1>
      <p class="deck">How a small neighborhood gathering became a place to learn from one another.</p><div class="rule"></div>
      <p id="opening">Today the library opened its back room for a shared meal. Neighbors brought bread and fruit, while every chair found a place at the long table.</p>
      <p id="second">Mira came with an important question: how could everyone help without spending much? The answer began with a simple idea. Each person could bring one thing they already knew how to make.</p>
      <p id="third">Some people were quiet at first, but the room grew warmer as stories traveled from one end of the table to the other. Learning together was possible because nobody had to know everything.</p>
      </article><aside><strong>Reading notes</strong><p>A short original story written for this Lang Weave sample.</p>
      <p>Underlined Spanish words are woven into the English text you choose to read.</p></aside></main></body></html>`;
    await browser.route('https://reading.example/**', (route) => route.fulfill({ contentType: 'text/html', body: article }));
    const reading = await browser.newPage();
    await reading.goto('https://reading.example/a-table-for-everyone');
    try { await reading.locator('#opening .fw-word').first().waitFor({ timeout: 10000 }); }
    catch (error) {
      const state = await worker.evaluate(async () => ({ stored: await chrome.storage.local.get(['settings', 'consentShown', 'modelStatus']),
        scripts: await chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] }),
        calls: globalThis.storeShotCalls, items: globalThis.storeShotItems, passages: globalThis.storeShotPassages }));
      throw new Error(`Reading did not weave: ${JSON.stringify({ url: reading.url(), title: await reading.title(), state })}`, { cause: error });
    }
    const hoverWord = reading.locator('#opening .fw-word[data-fr="y"]').first();
    await hoverWord.waitFor();
    await reading.locator('#third .fw-word[data-fr="pero"]').waitFor();
    await hoverWord.hover();
    await reading.locator('.fw-gloss.fw-gloss-on').waitFor();
    assert.match(await reading.locator('.fw-gloss.fw-gloss-on').textContent(), /y · and/);
    await reading.screenshot({ path: join(assets, shots[1][0]) });
    await hoverWord.click();
    assert.equal(await hoverWord.textContent(), 'and');
    assert.match(await hoverWord.getAttribute('aria-label'), /Show Spanish/);
    await reading.screenshot({ path: join(assets, shots[2][0]) });
    assert.ok(await worker.evaluate(() => globalThis.storeShotCalls > 0), 'synthetic responder was used');

    // Seed via the real review messages, then capture the real page halfway through a session.
    const review = await browser.newPage();
    await review.goto(url('review'));
    await review.locator('#introduce').waitFor({ state: 'visible' });
    await review.locator('#introduce').click();
    await review.locator('#prompt').getByText('and', { exact: true }).waitFor();
    await review.locator('#reveal').click();
    await review.locator('#answer').getByText('y', { exact: true }).waitFor();
    await review.locator('[data-rating="medium"]').click();
    await review.waitForFunction(() => document.querySelector('#progress')?.textContent === 'Card 2 of 5');
    await review.locator('#reveal').click();
    await review.locator('#solution').waitFor({ state: 'visible' });
    await review.screenshot({ path: join(assets, shots[3][0]) });

    const progress = await browser.newPage();
    await progress.goto(url('words'));
    await progress.locator('#words li[data-id]').first().waitFor();
    await progress.locator('#today').getByText(/introduced/).waitFor();
    assert.match(await progress.locator('#today').textContent(), /1 reviewed/);
    await progress.screenshot({ path: join(assets, shots[4][0]) });

    // The tile is composed entirely in Chromium with the shipped icon and text.
    const tile = await browser.newPage();
    await tile.setViewportSize({ width: 440, height: 280 });
    const icon = (await readFile(join(root, 'icons', 'icon-128.png'))).toString('base64');
    await tile.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;background:#f8f7f2;color:#203a35;font-family:system-ui,sans-serif}
      main{width:440px;height:280px;padding:28px 32px;background:linear-gradient(140deg,#f9faf5,#e6f1e9);position:relative;overflow:hidden}
      main:after{content:"";position:absolute;width:210px;height:210px;border:1px solid #b5d3c7;border-radius:50%;right:-70px;top:-90px}
      img{width:72px;height:72px;display:block;margin-bottom:16px}h1{font-size:32px;line-height:1;margin:0 0 9px;letter-spacing:-.04em}
      p{font-size:18px;line-height:1.25;margin:0;max-width:340px;color:#335b51}
      </style></head><body><main><img alt="" src="data:image/png;base64,${icon}"><h1>Lang Weave</h1>
      <p>Learn Spanish while you read.</p></main></body></html>`);
    await tile.screenshot({ path: join(assets, shots[5][0]) });
    await checkDimensions();
    console.log('PASS: Store package, synthetic Gemini and original article captured five listing screenshots plus promo tile.');
  } finally {
    if (browser) await browser.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

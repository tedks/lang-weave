// Real Chromium rendering of the shipped extension CSS on owned synthetic pages.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-highlights-'));
const extension = join(scratch, 'extension');
const screenshots = process.argv.includes('--save-screenshots')
  ? join(root, '..', 'docs', 'artifacts') : join(scratch, 'screenshots');
function contrast(foreground, background) {
  const luminance = (color) => {
    const values = color.match(/[\d.]+/g).map(Number);
    assert.equal(values[3] ?? 1, 1, 'underline color must be opaque');
    const channels = values.slice(0, 3).map((value) => value / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
let browser;
try {
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.content_scripts[0].matches = ['https://reading.example/*']; // synthetic site only
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width: 820, height: 460 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
  });
  await browser.route('https://reading.example/highlight-fixture/**', (route) => {
    const dark = route.request().url().endsWith('/dark');
    const background = dark ? '#15202b' : '#ffffff';
    const foreground = dark ? '#e7e9ea' : '#202124';
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <title>${dark ? 'Dark' : 'Light'} highlight fixture</title>
      <style>body { margin: 0; padding: 32px; background: ${background}; color: ${foreground};
        font: 20px/2 system-ui, sans-serif; } a { color: ${dark ? '#80bfff' : '#0759b8'}; }
        .sample { margin: 4px 0; } .label { display: inline-block; width: 150px; font: 14px system-ui; }
      </style></head><body>
      <h1 style="font-size:22px;margin:0 0 12px">${dark ? 'Dark' : 'Light'} page</h1>
      <div class="sample"><span class="label">Ordinary</span><span id="plain">ordinary</span> and <span class="fw-word" id="ordinary" tabindex="0" role="button">palabra</span></div>
      <div class="sample"><span class="label">Learning</span><span class="fw-word" id="active" data-fw-status="active" tabindex="0" role="button">aprendiendo</span></div>
      <div class="sample"><span class="label">Practice</span><span class="fw-word fw-practice" id="practice" tabindex="0" role="button">word → [?]</span></div>
      <div class="sample"><span class="label">Link context</span><a href="#destination" id="link">linked <span class="fw-word" id="linked" tabindex="0" role="button">palabra</span></a></div>
      <div class="sample"><span class="label">Hover hint</span><span class="fw-word fw-tip" id="hover" data-tip="word · pronunciation" tabindex="0" role="button">palabra</span></div>
      <div class="fw-gloss fw-gloss-on" aria-hidden="true">palabra = word · "pronunciation"</div>
      </body></html>` });
  });
  await mkdir(screenshots, { recursive: true });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage();
    await page.goto(`https://reading.example/highlight-fixture/${theme}`);
    const css = await page.evaluate(() => {
      const pick = (id) => {
        const el = document.getElementById(id);
        const style = getComputedStyle(el);
        return { color: style.color, decorationColor: style.textDecorationColor,
          line: style.textDecorationLine, decorationStyle: style.textDecorationStyle,
          thickness: style.textDecorationThickness, height: el.getBoundingClientRect().height };
      };
      return { background: getComputedStyle(document.body).backgroundColor,
        ordinary: pick('ordinary'), plain: pick('plain'),
        active: pick('active'), practice: pick('practice'), linked: pick('linked'),
        link: pick('link'), hover: pick('hover'),
        gloss: (() => { const style = getComputedStyle(document.querySelector('.fw-gloss'));
          return { display: style.display, visibility: style.visibility, position: style.position,
            color: style.color, background: style.backgroundColor, pointerEvents: style.pointerEvents }; })() };
    });
    // A default cue must be conspicuous in the actual browser, and must use
    // the host's readable text color on either background without changing it.
    assert.equal(css.ordinary.line, 'underline');
    assert.equal(css.ordinary.decorationStyle, 'solid');
    assert.equal(css.ordinary.thickness, '2px');
    assert.equal(css.ordinary.decorationColor, css.ordinary.color);
    assert.equal(css.ordinary.color, css.plain.color);
    assert.equal(css.ordinary.height, css.plain.height); // no line-box shift
    assert.ok(contrast(css.ordinary.decorationColor, css.background) >= 3);
    assert.equal(css.active.thickness, '2px');
    assert.notEqual(css.active.decorationColor, css.ordinary.decorationColor);
    assert.ok(contrast(css.active.decorationColor, css.background) >= 3);
    const otherStates = await page.locator('#ordinary').evaluate((el) => {
      const sample = (status, flipped = false) => {
        if (status) el.dataset.fwStatus = status;
        else delete el.dataset.fwStatus;
        el.classList.toggle('fw-en', flipped);
        const style = getComputedStyle(el);
        return { color: style.color, decorationColor: style.textDecorationColor,
          decorationStyle: style.textDecorationStyle, thickness: style.textDecorationThickness };
      };
      const states = ['new', 'known', 'shaky'].map((status) => sample(status));
      states.push(sample('', true)); // click-to-English uses the same cue
      sample('', false);
      return states;
    });
    for (const state of otherStates) {
      assert.equal(state.decorationStyle, 'solid');
      assert.equal(state.thickness, '2px');
    }
    assert.equal(otherStates[0].decorationColor, otherStates[0].color);
    assert.equal(otherStates[1].decorationColor, otherStates[1].color);
    assert.equal(otherStates[2].decorationColor, css.active.decorationColor);
    assert.equal(otherStates[3].decorationColor, otherStates[3].color);
    assert.equal(css.practice.decorationStyle, 'dashed');
    assert.equal(css.practice.decorationColor, css.practice.color);
    assert.equal(css.linked.color, css.link.color);
    assert.match(css.link.line, /underline/); // host link decoration stays
    assert.equal(css.gloss.display, 'block');
    assert.equal(css.gloss.visibility, 'visible');
    assert.equal(css.gloss.position, 'fixed');
    assert.equal(css.gloss.color, 'rgb(255, 255, 255)');
    assert.equal(css.gloss.background, 'rgb(29, 31, 35)');
    assert.ok(contrast(css.gloss.color, css.gloss.background) >= 7);
    assert.equal(css.gloss.pointerEvents, 'none');
    await page.waitForTimeout(100); // let the content script finish observing the synthetic state changes
    await page.locator('#hover').evaluate((el) => el.classList.add('fw-tip'));
    await page.screenshot({ path: join(screenshots, `highlights-${theme}.png`) });
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#ordinary').evaluate((el) => el === document.activeElement), true);
    assert.equal(await page.locator('#ordinary').evaluate((el) => getComputedStyle(el).outlineWidth), '2px');
    await page.emulateMedia({ forcedColors: 'active' });
    const forced = await page.locator('#active').evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.color, decorationColor: style.textDecorationColor, thickness: style.textDecorationThickness };
    });
    assert.equal(forced.decorationColor, forced.color);
    assert.equal(forced.thickness, '2px');
    const forcedGloss = await page.locator('.fw-gloss').evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.color, background: style.backgroundColor, border: style.borderTopColor };
    });
    assert.notEqual(forcedGloss.color, forcedGloss.background);
    assert.equal(forcedGloss.border, forcedGloss.color);
    await page.close();
  }
  console.log('PASS: Chromium extension CSS is visible on synthetic light/dark pages; ordinary, active, practice, link, hover, keyboard focus and forced colors checked.');
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true }); // exact directory owned by this run
}

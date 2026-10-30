// Real MV3 action state, rendered beside the shipped 16px icon in synthetic light/dark toolbar fixtures.
// Chromium's headless page screenshots cannot include browser chrome; the fixture uses action API values.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'lang-weave-badge-'));
const extension = join(scratch, 'extension');
const screenshots = process.argv.includes('--save-screenshots')
  ? join(root, '..', 'docs', 'artifacts') : join(scratch, 'screenshots');
let browser;
const colorCss = (value) => Array.isArray(value) ? `rgb(${value.slice(0, 3).join(', ')})` : value;
const colorHex = (value) => `#${value.slice(0, 3).map((x) => x.toString(16).padStart(2, '0')).join('')}`;
const contrast = (hex) => {
  const channels = hex.match(/[\da-f]{2}/gi).slice(0, 3).map((x) => parseInt(x, 16) / 255)
    .map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return 1.05 / (luminance + 0.05); // white foreground
};
try {
  await cp(join(root, 'src'), join(extension, 'src'), { recursive: true });
  await cp(join(root, 'icons'), join(extension, 'icons'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://reading.example/*'); // isolated test grant
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP generativelanguage.googleapis.com ~NOTFOUND',
      '--proxy-server=127.0.0.1:9'],
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  await browser.route(/^https:\/\/(reading|other)\.example\//, (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Badge fixture</title><main></main>',
  }));
  const page = await browser.newPage();
  let tabId;
  const action = async () => worker.evaluate(async (tabId) => {
    if (!tabId) return null;
    return { tabId, text: await chrome.action.getBadgeText({ tabId }),
      color: await chrome.action.getBadgeBackgroundColor({ tabId }),
      title: await chrome.action.getTitle({ tabId }) };
  }, tabId);
  const waitFor = async (text, title) => {
    for (let i = 0; i < 100; i++) {
      const value = await action();
      if (value?.text === text && (!title || value.title === title)) return value;
      await new Promise((done) => setTimeout(done, 50));
    }
    const observed = await worker.evaluate(async () => ({
      tabs: await chrome.tabs.query({}), active: await chrome.tabs.query({ active: true, currentWindow: true }),
    }));
    throw new Error(`badge ${JSON.stringify(text)} did not appear on ${page.url()}: ${JSON.stringify(observed)}`);
  };
  await page.goto('https://reading.example/no-key');
  tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://reading.example/*' }))[0]?.id);
  assert.ok(tabId, 'granted test page has a visible tab ID');
  const setup = await waitFor('!', 'Finish setup in the welcome page');
  assert.equal(setup.title, 'Finish setup in the welcome page');
  await worker.evaluate(() => chrome.storage.local.set({ consentShown: true })); // synthetic completion of the welcome choice
  const needsKey = await waitFor('!', 'Add your Gemini key');
  assert.equal(needsKey.title, 'Add your Gemini key');
  assert.equal(colorCss(needsKey.color), 'rgb(155, 34, 27)');
  await worker.evaluate(() => chrome.storage.local.set({ apiKey: 'synthetic-badge-key' }));
  const working = await waitFor('');
  assert.equal(working.title, 'Lang Weave is on here');
  await page.goto('https://other.example/needs-grant');
  const unknownSite = await waitFor('–');
  assert.equal(unknownSite.title, 'Open Lang Weave to check this page');
  await worker.evaluate(() => chrome.storage.local.set({ settings: { enabled: false, newSitesEnabled: true } }));
  const paused = await waitFor('–', 'Lang Weave is paused; click to turn it on');
  assert.equal(paused.title, 'Lang Weave is paused; click to turn it on');
  assert.equal(colorCss(paused.color), 'rgb(89, 99, 107)');
  assert.ok(contrast(colorHex(needsKey.color)) >= 4.5 && contrast(colorHex(paused.color)) >= 4.5);
  const icon = (await readFile(join(root, 'icons', 'icon-16.png'))).toString('base64');
  await mkdir(screenshots, { recursive: true });
  for (const theme of ['light', 'dark']) {
    const toolbar = await browser.newPage();
    const background = theme === 'light' ? '#f3f3f3' : '#292a2d';
    const foreground = theme === 'light' ? '#202124' : '#f1f3f4';
    await toolbar.setContent(`<!doctype html><style>
      body { margin:0; padding:16px; background:${background}; color:${foreground}; font:12px system-ui; }
      .row { display:flex; align-items:center; gap:18px; height:34px; }
      .slot { position:relative; width:24px; height:24px; display:flex; align-items:center; justify-content:center; }
      img { width:16px; height:16px; }
      .badge { position:absolute; right:-8px; bottom:-3px; min-width:12px; height:12px;
        padding:0 2px; border-radius:3px; color:white; font:bold 10px/12px Arial,sans-serif;
        text-align:center; box-shadow:0 0 0 1px ${background}; }
    </style><div class="row">
      <span class="slot"><img src="data:image/png;base64,${icon}"><span class="badge" style="background:${colorCss(needsKey.color)}">${needsKey.text}</span></span>
      <span>Needs key</span>
      <span class="slot"><img src="data:image/png;base64,${icon}"><span class="badge" style="background:${colorCss(unknownSite.color)}">${unknownSite.text}</span></span>
      <span>Site unknown</span>
      <span class="slot"><img src="data:image/png;base64,${icon}"><span class="badge" style="background:${colorCss(paused.color)}">${paused.text}</span></span>
      <span>Paused</span>
    </div>`);
    assert.equal(await toolbar.locator('.badge').count(), 3);
    await toolbar.screenshot({ path: join(screenshots, `badge-${theme}.png`), clip: { x: 0, y: 0, width: 360, height: 66 } });
    await toolbar.close();
  }
  console.log('PASS: MV3 per-tab action text/title/color for key, working, hidden URL and pause; 16px icon badge screenshots in light/dark fixtures; white contrast >= 4.5.');
} finally {
  if (browser) await browser.close();
  await rm(scratch, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwrightPath = process.env.LANG_WEAVE_PLAYWRIGHT;
export const { chromium } = await import(playwrightPath ? pathToFileURL(playwrightPath).href : 'playwright');
export const chromiumBinary = process.env.LANG_WEAVE_CHROMIUM
  ? { executablePath: process.env.LANG_WEAVE_CHROMIUM } : { channel: 'chromium' };
const packagedExtension = process.env.LANG_WEAVE_WELCOME_EXTENSION;
if (process.env.TEST_SRCDIR && !packagedExtension) throw new Error('Bazel must supply the extracted beta ZIP directory');
export const extensionRoot = packagedExtension || fileURLToPath(new URL('..', import.meta.url));

// Use Chromium's permission store in a disposable profile. The manager pregrants the
// test origin so the extension's normal optional-permission request has no native prompt.
export async function grantReadingSite(browser, worker, pattern = 'https://reading.example/*') {
  const id = new URL(worker.url()).host;
  const manager = await browser.newPage();
  const controls = await browser.newPage();
  try {
    await manager.goto('chrome://extensions/');
    await manager.evaluate(({ id, pattern }) => chrome.developerPrivate.addHostPermission(id, pattern), { id, pattern });
    await controls.goto(`chrome-extension://${id}/src/options.html`);
    assert.equal(await controls.evaluate((pattern) => chrome.permissions.request({ origins: [pattern] }), pattern), true);
    assert.equal(await worker.evaluate((pattern) => chrome.permissions.contains({ origins: [pattern] }), pattern), true);
    await controls.waitForFunction(async (pattern) => {
      const [script] = await chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] });
      return script?.matches.includes(pattern);
    }, pattern, { timeout: 5000 });
  } finally {
    await controls.close();
    await manager.close();
  }
}

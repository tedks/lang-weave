import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwrightPath = process.env.LANG_WEAVE_PLAYWRIGHT;
export const { chromium } = await import(playwrightPath ? pathToFileURL(playwrightPath).href : 'playwright');
export const chromiumBinary = process.env.LANG_WEAVE_CHROMIUM
  ? { executablePath: process.env.LANG_WEAVE_CHROMIUM } : { channel: 'chromium' };
const packagedExtension = process.env.LANG_WEAVE_WELCOME_EXTENSION;
if (process.env.TEST_SRCDIR && !packagedExtension) throw new Error('Bazel must supply the extracted beta ZIP directory');
export const extensionRoot = packagedExtension || fileURLToPath(new URL('..', import.meta.url));

export async function waitForExtensionWorker(browser, previous) {
  const matches = (worker) => {
    const url = new URL(worker.url());
    return url.protocol === 'chrome-extension:' && url.pathname === '/src/background.js' &&
      (!previous || worker.url() === previous.url);
  };
  // Chrome 140 can publish the worker target before its extension APIs are bound.
  // Playwright can also keep the same Worker object across an MV3 restart.
  const timeoutMs = previous ? 10000 : 30000;
  let waitingFor = 'a matching worker target';
  let timeout, done = false;
  try {
    return await Promise.race([
      (async () => {
        while (!done) {
          // If both targets are briefly listed, prefer the newly attached one.
          const worker = browser.serviceWorkers().findLast(matches);
          if (worker) {
            try {
              waitingFor = 'the worker execution context';
              const missing = await worker.evaluate(({ id, token }) => {
                const api = globalThis.chrome;
                if (api?.runtime?.id !== id) return 'the extension runtime ID';
                if (typeof api.runtime.onMessage?.addListener !== 'function') return 'runtime.onMessage';
                if (typeof api.storage?.local?.get !== 'function' ||
                    typeof api.storage.local.set !== 'function') return 'storage.local';
                if (typeof api.permissions?.contains !== 'function') return 'permissions.contains';
                if (token && globalThis.fixtureWorkerToken === token) return 'a new worker execution context';
                return null;
              }, { id: new URL(worker.url()).host, token: previous?.token });
              if (missing === null) return worker;
              waitingFor = missing;
            } catch (error) {
              // Closing a target or replacing its execution context can interrupt this read.
              if (!/Service worker restarted|Worker was closed|Target page, context or browser has been closed|Execution context was destroyed/i
                .test(error.message)) throw error;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      })(),
      // Playwright can also wait for a worker execution context before evaluating.
      new Promise((_, reject) => {
        const target = previous ? `replacement for ${previous.url}` : 'Lang Weave background worker';
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${waitingFor} in ${target}`)), timeoutMs);
      }),
    ]);
  } finally {
    done = true;
    clearTimeout(timeout);
  }
}

export async function restartExtensionWorker(browser, page, worker) {
  const url = worker.url();
  const token = await worker.evaluate(() => {
    globalThis.fixtureWorkerToken = crypto.randomUUID();
    return globalThis.fixtureWorkerToken;
  });
  const cdp = await browser.newCDPSession(page);
  try {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const target = targetInfos.find((item) => item.type === 'service_worker' && item.url === url);
    assert.ok(target, 'the first worker is running');
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
    // Start the worker directly, without navigation or a user gesture.
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.startWorker', { scopeURL: `chrome-extension://${new URL(url).host}/` });
    return await waitForExtensionWorker(browser, { url, token });
  } finally {
    await cdp.detach();
  }
}

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
    // Check the same extension permission store from the live requesting page.
    assert.equal(await controls.evaluate((pattern) => chrome.permissions.contains({ origins: [pattern] }), pattern), true);
    await controls.waitForFunction(async (pattern) => {
      const [script] = await chrome.scripting.getRegisteredContentScripts({ ids: ['weave-sites'] });
      return script?.matches.includes(pattern);
    }, pattern, { timeout: 5000 });
  } finally {
    await controls.close();
    await manager.close();
  }
}

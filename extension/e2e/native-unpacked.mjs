// Native Load unpacked tests run on a dedicated X display and disposable profile.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const xdo = (...args) => execFileSync(process.env.LANG_WEAVE_RELOAD_XDOTOOL, args, { timeout: 3000, encoding: 'utf8' }).trim();
export const activeTitle = () => xdo('getactivewindow', 'getwindowname');
export const activeBounds = () => Object.fromEntries(xdo('getactivewindow', 'getwindowgeometry', '--shell').split('\n')
  .filter((entry) => /^[A-Z]+=\d+$/.test(entry)).map((entry) => entry.split('=')).map(([key, value]) => [key, Number(value)]));
export const clickNative = (x, y) => xdo('mousemove', String(Math.round(x)), String(Math.round(y)), 'click', '1');
export async function until(read, matches, description, timeout = 10000) {
  let last;
  for (const end = Date.now() + timeout; Date.now() < end;) {
    last = await read();
    if (matches(last)) return last;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(last)}`);
}

// The private bookmark has exactly one child, uniquely named for this run.
export const managedFolder = (scratch) => join(scratch, 'pick', `managed-${randomUUID()}`);

export async function bookmarkFolder(configHome, managed) {
  const gtkConfig = join(configHome, 'gtk-3.0');
  await mkdir(gtkConfig, { recursive: true });
  await writeFile(join(gtkConfig, 'bookmarks'), pathToFileURL(dirname(managed)).href + ' Test extension folder\n');
}

export async function loadUnpacked(manager, managed) {
  await manager.goto('chrome://extensions/');
  if (await manager.locator('#loadUnpacked').isHidden()) await manager.locator('#devMode').click();
  await manager.locator('#loadUnpacked').click();
  await until(activeTitle, (title) => /extension directory/i.test(title), 'the native directory chooser');
  const chooserId = xdo('getactivewindow');
  function chooserBounds() {
    const bounds = activeBounds();
    assert.equal(String(bounds.WINDOW), chooserId, 'the generated directory chooser must still have focus');
    assert.match(activeTitle(), /extension directory/i);
    return bounds;
  }
  // Ask GTK for the selected folder's name in its location entry. The name
  // is unique to this run and the X clipboard belongs to the test display.
  chooserBounds();
  xdo('key', 'alt+1');
  await until(() => {
    const bounds = chooserBounds();
    clickNative(bounds.X + 175, bounds.Y + 78);
    xdo('key', 'Home', 'ctrl+l', 'ctrl+a', 'ctrl+c');
    const selection = spawnSync(process.env.LANG_WEAVE_RELOAD_XCLIP || 'xclip',
      ['-selection', 'clipboard', '-out'], { encoding: 'utf8', timeout: 1000 });
    if (selection.error && selection.error.code !== 'ETIMEDOUT') throw selection.error;
    chooserBounds();
    xdo('key', 'Escape'); // Leave GTK's location entry and return to the selected row.
    return selection.status === 0 ? selection.stdout.trim().replace(/\/$/, '') : '';
  }, (name) => name === basename(managed) || name === managed, 'the generated folder name in the native chooser');
  // Some GTK versions enable Open only after the location entry has closed.
  await until(() => {
    if (xdo('getactivewindow') !== chooserId) return true;
    const chooser = chooserBounds();
    clickNative(chooser.X + chooser.WIDTH - 45, chooser.Y + chooser.HEIGHT - 33);
    return false;
  }, Boolean, 'the native chooser to confirm the selected folder');
}

export async function expectInstalled(manager, extensionId, managed, version, timeout) {
  const installed = () => manager.evaluate(async (id) => (await chrome.developerPrivate.getExtensionsInfo({
    includeDisabled: true,
  })).filter((app) => app.id === id).map(({ version, location, state, path }) => ({ version, location, state, path })), extensionId);
  return until(installed, (apps) => {
    const [app] = apps;
    return apps.length === 1 && app.version === version && app.location === 'UNPACKED' &&
      app.state === 'ENABLED' && app.path === managed;
  }, `unpacked Lang Weave ${version}`, timeout);
}

export async function readyWorker(browser, extensionId, version) {
  return until(async () => {
    for (const candidate of browser.serviceWorkers()) {
      if (candidate.url() !== `chrome-extension://${extensionId}/src/background.js`) continue;
      const ready = await candidate.evaluate((expected) =>
        globalThis.chrome?.runtime?.getManifest?.().version === expected &&
        !!chrome.tabs?.query && !!chrome.scripting?.executeScript && !!chrome.storage?.local, version)
        .catch(() => false);
      if (ready) return candidate;
    }
    return null;
  }, Boolean, `Lang Weave ${version} worker bindings`);
}

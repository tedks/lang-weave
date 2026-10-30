import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { relativeImports } from '../scripts/package.mjs';

// content-loader.js (a classic content script) imports src/content.js by extension URL, and a page-origin
// module import needs every file of that graph web-accessible. Nothing else may be: the list must equal
// content.js's static import closure, so a new content import fails here until it is listed, and
// worker, popup and page code are never probeable. use_dynamic_url cannot be used: in Chromium 156 a
// module fetched by dynamic URL resolves its relative imports against the static ID, which are then
// denied (docs/STORE-ENGINEERING-MISSION.md; ditz content-bundle-no-war). The listed files remain probeable.
const EXT = resolve(import.meta.dir, '..');
const read = (path) => readFileSync(resolve(EXT, path), 'utf8');

function closure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of relativeImports(read(file))) queue.push(posix.normalize(posix.join(posix.dirname(file), spec)));
  }
  return [...seen].sort();
}

test('web_accessible_resources is exactly content.js and its import closure, for http(s) pages only', () => {
  const manifest = JSON.parse(read('manifest.json'));
  expect(read('src/content-loader.js')).toContain("import(chrome.runtime.getURL('src/content.js'))");
  expect(manifest.web_accessible_resources).toHaveLength(1);
  const [entry] = manifest.web_accessible_resources;
  expect(Object.keys(entry).sort()).toEqual(['matches', 'resources']);
  expect(entry.matches).toEqual(['http://*/*', 'https://*/*']);
  expect(entry.resources.every((r) => !/[*?]/.test(r))).toBe(true);
  expect([...entry.resources].sort()).toEqual(closure('src/content.js'));
  for (const never of ['src/background.js', 'src/popup.js', 'src/update.js', 'src/router.js', 'src/content-loader.js']) {
    expect(entry.resources).not.toContain(never);
  }
});

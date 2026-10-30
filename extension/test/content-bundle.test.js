import { test, expect } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleContent, BundleError } from '../scripts/content-bundle.mjs';

test('bundle orders dependencies once, resolves named exports and runs as a classic script', () => {
  const files = new Map([
    ['src/entry.js', "import { doubled as answer } from './middle.js';\nexport function entry() { return answer; }\n"],
    ['src/middle.js', "import { value } from './base.js';\nexport const doubled = value * 2;\n"],
    ['src/base.js', 'export const value = 21;\n'],
  ]);
  const { code, order } = bundleContent(files, 'src/entry.js');
  expect(order).toEqual(['src/base.js', 'src/middle.js', 'src/entry.js']);
  expect(code).not.toMatch(/(^|\n)\s*(import|export)\b|\bimport\.meta\b/);
  expect(runInNewContext(code).entry()).toBe(42);
  expect(bundleContent(files, 'src/entry.js').code).toBe(code);
});

test('bundle resolves named re-exports', () => {
  const files = new Map([
    ['src/entry.js', "import { result } from './bridge.js';\nexport const entry = () => result;\n"],
    ['src/bridge.js', "export { value as result } from './base.js';\n"],
    ['src/base.js', 'export const value = 7;\n'],
  ]);
  expect(runInNewContext(bundleContent(files, 'src/entry.js').code).entry()).toBe(7);
});

test('bundle leaves module words in comments and template text untouched, but rejects interpolation imports', () => {
  const source = '// export const phantom = 1;\n'
    + 'export const entry = `before\nexport const phantom = 42;\nafter`;\n'
    + 'export const pattern = /[`]/;\n';
  const entry = runInNewContext(bundleContent(new Map([['src/a.js', source]]), 'src/a.js').code);
  expect(entry.entry).toBe('before\nexport const phantom = 42;\nafter');
  expect(Object.keys(entry).sort()).toEqual(['entry', 'pattern']);
  expect(() => bundleContent(new Map([['src/a.js',
    'export const entry = `${import("./dep.js")}`;']]), 'src/a.js')).toThrow(/dynamic import/);
  expect(() => bundleContent(new Map([['src/a.js',
    "export const entry = /https?:\\/\\//.test('http://'); import('./dep.js');"]]), 'src/a.js'))
    .toThrow(/dynamic import/);
});

test('a second evaluation in the same document reuses the first content entry', () => {
  const source = 'globalThis.entryRuns = (globalThis.entryRuns || 0) + 1;\nexport function entry() {}\n';
  const { code } = bundleContent(new Map([['src/a.js', source]]), 'src/a.js');
  const context = { entryRuns: 0 };
  const first = runInNewContext(code, context);
  const second = runInNewContext(code, context);
  expect(second).toBe(first);
  expect(context.entryRuns).toBe(1);
});

test('bundle rejects cycles, missing files and module features outside the supported subset', () => {
  expect(() => bundleContent(new Map([
    ['src/a.js', "import { b } from './b.js';\nexport const a = b;"],
    ['src/b.js', "import { a } from './a.js';\nexport const b = a;"],
  ]), 'src/a.js')).toThrow(/module cycle/);
  expect(() => bundleContent(new Map([['src/a.js', "import { x } from './gone.js';"]]), 'src/a.js'))
    .toThrow(/missing module/);
  expect(() => bundleContent(new Map([
    ['src/a.js', "import { missing } from './b.js';\nexport const a = missing;"],
    ['src/b.js', 'export const present = 1;'],
  ]), 'src/a.js')).toThrow(/no named export missing/);
  for (const source of ["export const x = import('./x.js');", 'export const x = import.meta.url;',
    'await Promise.resolve();', 'export default 1;']) {
    expect(() => bundleContent(new Map([['src/a.js', source]]), 'src/a.js')).toThrow(BundleError);
  }
});

test('the shipped content closure wraps in deterministic order with an entry function', () => {
  const dir = resolve(import.meta.dir, '../src');
  const files = new Map();
  // Deliberate drift alarm: a new content dependency must be reviewed before shipping it.
  for (const name of ['content', 'catalog', 'events', 'fsrs', 'hash', 'language-name', 'learning', 'levels', 'page',
    'personal-capture', 'personal', 'review', 'semantic', 'settings', 'text', 'vocabulary']) {
    files.set(`src/${name}.js`, readFileSync(resolve(dir, `${name}.js`), 'utf8'));
  }
  const { code, order } = bundleContent(files);
  expect(order).toHaveLength(files.size);
  expect(order.at(-1)).toBe('src/content.js');
  // A minimal DOM/chrome fixture lets the real entry run, so this catches wrapper binding errors.
  const handlers = [];
  const context = {
    chrome: { runtime: { id: 'test', onMessage: { addListener: (fn) => handlers.push(fn) },
      sendMessage: async () => ({}) } },
    document: { title: 'Test', addEventListener() {}, visibilityState: 'hidden' },
    window: { addEventListener() {} }, location: { href: 'https://example.com/' },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    URL, Map, Set, WeakMap, WeakSet, Date, crypto,
  };
  const entry = runInNewContext(code, context);
  expect(typeof entry.disarmTip).toBe('function');
  expect(handlers.length).toBeGreaterThan(0);
});

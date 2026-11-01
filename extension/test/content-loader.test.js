import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const loader = readFileSync(new URL('../src/content-loader.js', import.meta.url), 'utf8');

test('the dev loader imports content once even when registration and recovery inject together', async () => {
  let imports = 0;
  let release;
  const pending = new Promise((done) => { release = done; });
  const context = { chrome: { runtime: { getURL: (path) => `chrome-extension://test/${path}` } },
    console: { error: () => { throw new Error('content import failed'); } } };
  const options = { importModuleDynamically: async (specifier) => {
    expect(specifier).toBe('chrome-extension://test/src/content.js');
    imports++;
    await pending;
    return {};
  } };
  const first = runInNewContext(loader, context, options);
  const second = runInNewContext(loader, context, options);
  expect(imports).toBe(1);
  release();
  await Promise.all([first, second]);
  expect(context[Symbol.for('lang-weave.content-loader')]).toBe(true);
  await runInNewContext(loader, context, options);
  expect(imports).toBe(1);
});

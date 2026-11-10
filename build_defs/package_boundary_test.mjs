import { test, expect } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { packageExtension } from '../extension/scripts/package.mjs';

test('the extension ZIP omits Bazel package metadata', () => {
  const root = join(import.meta.dir, 'package-fixture');
  const extensionDir = join(root, 'extension');
  const put = (path, body) => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  };
  for (const name of ['LICENSE', 'LICENSE-MIT', 'NOTICE']) put(name, `${name}\n`);
  put('extension/manifest.json', JSON.stringify({
    manifest_version: 3, name: 'Fixture', version: '1.0.0',
    background: { service_worker: 'src/background.js', type: 'module' },
  }));
  put('extension/src/background.js', 'export const ready = true;\n');
  put('extension/src/BUILD.bazel', 'filegroup(name = "background")\n');
  put('extension/src/nested/BUILD', 'exports_files([])\n');
  const result = packageExtension({ extensionDir, licenseDir: root, outDir: join(root, 'out') });
  expect(result.files).toEqual(['LICENSE', 'LICENSE-MIT', 'NOTICE', 'manifest.json', 'src/background.js']);
  expect(readFileSync(result.path).length).toBeGreaterThan(0);
});

import { test, expect, afterAll } from 'bun:test';
import { inflateRawSync } from 'node:zlib';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  packageExtension, storeManifest, STORE_DELTAS, verifyPackage, relativeImports, localHtmlRefs, globToRegExp, crc32, PackageError,
  parseArgs,
} from '../scripts/package.mjs';

const EXT = resolve(import.meta.dir, '..');
const ROOT = resolve(EXT, '..');
const tmpRoot = mkdtempSync(join(tmpdir(), 'lang-weave-package-'));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

let counter = 0;
const fresh = (label) => {
  const d = join(tmpRoot, `${label}-${counter++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

// Independent zip reader: EOCD -> central directory -> local headers.
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  expect(eocd).toBeGreaterThanOrEqual(0);
  expect(buf.readUInt16LE(eocd + 20)).toBe(0); // no comment
  const count = buf.readUInt16LE(eocd + 10);
  expect(buf.readUInt16LE(eocd + 8)).toBe(count);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let p = buf.readUInt32LE(eocd + 16);
  expect(p + cdSize).toBe(eocd);
  const entries = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12);
    const date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    expect(buf.readUInt32LE(lho)).toBe(0x04034b50);
    expect(buf.toString('utf8', lho + 30, lho + 30 + buf.readUInt16LE(lho + 26))).toBe(name);
    expect(buf.readUInt32LE(lho + 14)).toBe(crc);
    expect(buf.readUInt32LE(lho + 18)).toBe(csize);
    expect(buf.readUInt32LE(lho + 22)).toBe(usize);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    expect([0, 8]).toContain(method);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    expect(data.length).toBe(usize);
    entries.push({ name, data, crc, method, time, date, ext, csize, usize });
  }
  expect(p).toBe(eocd);
  return entries;
}

function walkRel(dir, rel = '') {
  const out = [];
  for (const d of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...walkRel(dir, r));
    else out.push(r);
  }
  return out;
}

const build = (opts = {}) => {
  const outDir = fresh('out');
  const r = packageExtension({ extensionDir: EXT, licenseDir: ROOT, outDir, ...opts });
  return { ...r, outDir, bytes: readFileSync(r.path) };
};

test('package: exact entry set, bytes, CRCs, fixed metadata', () => {
  const { bytes, path, entries: count } = build();
  expect(path.endsWith(`lang-weave-${JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8')).version}.zip`)).toBe(true);
  const entries = readZip(bytes);
  expect(entries.length).toBe(count);

  const expected = ['manifest.json', 'LICENSE', 'LICENSE-MIT', 'NOTICE', ...walkRel(EXT, 'src')];
  for (const root of ['icons', '_locales']) {
    if (existsSync(join(EXT, root))) expected.push(...walkRel(EXT, root));
  }
  const names = entries.map((e) => e.name);
  expect(names).toEqual([...expected.filter((n) => !n.split('/').some((s) => s.startsWith('.')))].sort());
  expect(names).toEqual([...names].sort());

  for (const e of entries) {
    const source = e.name.startsWith('LICENSE') || e.name === 'NOTICE' ? join(ROOT, e.name) : join(EXT, e.name);
    const src = readFileSync(source);
    expect(Buffer.compare(e.data, src)).toBe(0);
    expect(e.crc).toBe(Bun.hash.crc32(e.data));
    expect(crc32(src)).toBe(Bun.hash.crc32(src));
    expect(e.time).toBe(0);
    expect(e.date).toBe(0x0021); // 1980-01-01
    expect(e.ext >>> 16).toBe(0o100644);
    if (e.method === 8) expect(e.csize).toBeLessThan(e.usize);
  }
  for (const n of names) {
    expect(n).not.toMatch(/^(test|e2e|node_modules|scripts|dist)\//);
    expect(n).not.toMatch(/^(package\.json|bun\.lock)$/);
    expect(n.split('/').some((s) => s.startsWith('.'))).toBe(false);
  }
});

test('package: two builds are byte-identical; --store applies only the delta table, with a distinct name', () => {
  const a = build();
  const b = build();
  expect(Buffer.compare(a.bytes, b.bytes)).toBe(0);

  const s = build({ store: true });
  expect(s.path.endsWith('-store.zip')).toBe(true);
  expect(s.path).not.toBe(a.path);
  const plain = readZip(a.bytes).find((e) => e.name === 'manifest.json');
  const stored = readZip(s.bytes).find((e) => e.name === 'manifest.json');
  expect(JSON.parse(plain.data.toString()).minimum_chrome_version).toBe('140');
  expect(JSON.parse(stored.data.toString()).minimum_chrome_version).toBe('140');
  expect(JSON.parse(stored.data.toString())).toEqual(storeManifest(JSON.parse(plain.data.toString())));
  expect(readZip(s.bytes).map((e) => e.name)).toEqual([...readZip(a.bytes).map((e) => e.name), 'src/content-bundle.js'].sort());
  for (const e of readZip(s.bytes)) {
    if (!['manifest.json', 'src/content-bundle.js', 'src/sites.js', 'src/popup.js'].includes(e.name))
      expect(Buffer.compare(e.data, readZip(a.bytes).find((x) => x.name === e.name).data)).toBe(0);
  }
  const storeFiles = Object.fromEntries(readZip(s.bytes).map((e) => [e.name, e.data.toString()]));
  expect(storeFiles['src/sites.js']).toContain("js: ['src/content-bundle.js']");
  expect(storeFiles['src/popup.js']).toContain("files: ['src/content-bundle.js']");
  expect(storeFiles['src/content-bundle.js']).toContain('src/content.js');
  expect(Buffer.compare(s.bytes, build({ store: true }).bytes)).toBe(0);

  const manifest = JSON.parse(plain.data.toString());
  const copy = storeManifest(manifest);
  expect(copy).not.toBe(manifest);
  copy.permissions.push('x');
  expect(manifest.permissions).not.toContain('x');
});

test('store manifest: differs from the dev manifest in exactly the delta-table keys', () => {
  const dev = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
  const store = storeManifest(dev);
  const keys = [...new Set([...Object.keys(dev), ...Object.keys(store)])];
  const changed = keys.filter((k) => JSON.stringify(dev[k]) !== JSON.stringify(store[k])).sort();
  expect(changed).toEqual(STORE_DELTAS.map((d) => d.key).sort());
  expect(new Set(STORE_DELTAS.map((d) => d.key)).size).toBe(STORE_DELTAS.length);
  for (const d of STORE_DELTAS) expect(d.why.length).toBeGreaterThan(20);
  // The Store has no static injection, page-accessible modules or unused alarm permission.
  expect(Object.hasOwn(store, 'content_scripts')).toBe(false);
  expect(Object.hasOwn(store, 'web_accessible_resources')).toBe(false);
  expect(store.permissions).not.toContain('alarms');
  expect(dev.content_scripts.some((cs) => cs.matches.includes('https://x.com/*'))).toBe(true);
  expect(store.key).toBe(dev.key);
  expect(JSON.stringify(store)).not.toContain('x.com');
  expect(JSON.stringify(store)).not.toContain('twitter.com');
  expect(dev).toEqual(JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'))); // input untouched
});

test('store manifest: the X row keeps other content scripts and refuses a changed precondition', () => {
  const x = { matches: ['https://twitter.com/*', 'https://x.com/*'], js: ['src/content-loader.js'], css: ['src/content.css'],
    run_at: 'document_idle' };
  const other = { matches: ['https://example.com/*'], js: ['src/other.js'] };
  const full = (scripts) => ({ version: '1', content_scripts: scripts, permissions: ['storage', 'alarms'],
    web_accessible_resources: [{ matches: ['http://*/*', 'https://*/*'], resources: ['src/content.js'] }] });
  expect(storeManifest(full([x, other])).content_scripts).toEqual([other]);
  expect(Object.hasOwn(storeManifest(full([x])), 'content_scripts')).toBe(false);
  for (const content_scripts of [undefined, [], [other], [x, x],
    [{ ...x, matches: [...x.matches, 'https://mobile.x.com/*'] }], [{ ...x, matches: ['https://x.com/*'] }],
    // The rest of the entry must be exactly the loader, so nothing else rides out with it.
    [{ ...x, js: [...x.js, 'src/other.js'] }], [{ ...x, css: [] }], [{ ...x, run_at: 'document_end' }],
    [{ ...x, all_frames: true }], [(({ css, ...rest }) => rest)(x)]]) {
    expect(() => storeManifest(full(content_scripts))).toThrow(PackageError);
  }
});

test('package: stored fallback and non-ascii names round-trip', () => {
  const { root, ext } = fixture({ 'src/blob.bin': Buffer.from([1, 2, 3]), 'src/ünï.js': 'export const x = 1;\n', 'src/empty.js': '' });
  const out = fresh('out');
  const r = packageExtension({ extensionDir: ext, licenseDir: root, outDir: out });
  const entries = readZip(readFileSync(r.path));
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
  expect(byName['src/blob.bin'].method).toBe(0);
  expect(byName['src/empty.js'].method).toBe(0);
  expect(byName['src/ünï.js'].data.toString()).toBe('export const x = 1;\n');
  for (const e of entries) expect(e.crc).toBe(Bun.hash.crc32(e.data));
});

test('package: dotfiles and unlisted directories never ship', () => {
  const { root, ext } = fixture({ 'src/.secret.js': 'x', 'src/.git/config': 'x', 'src/a/.env': 'x', 'test/t.js': 'x', 'scripts/p.mjs': 'x', 'package.json': '{}', 'icons/.DS_Store': 'x', 'icons/i.png': 'png' });
  const r = packageExtension({ extensionDir: ext, licenseDir: root, outDir: fresh('out') });
  expect(readZip(readFileSync(r.path)).map((e) => e.name)).toEqual(['LICENSE', 'LICENSE-MIT', 'NOTICE', 'icons/i.png', 'manifest.json', 'src/background.js', 'src/popup.html', 'src/popup.js']);
});

// ------------------------------------------------------------------ fixtures

const BASE_MANIFEST = {
  manifest_version: 3,
  name: 'Fixture',
  version: '1.2.3',
  background: { service_worker: 'src/background.js', type: 'module' },
  action: { default_popup: 'src/popup.html' },
};

function fixture(extra = {}, manifestPatch = {}, { manifest } = {}) {
  const root = fresh('fx');
  const ext = join(root, 'extension');
  const files = {
    'manifest.json': JSON.stringify(manifest ?? { ...BASE_MANIFEST, ...manifestPatch }),
    'src/background.js': 'export const bg = 1;\n',
    'src/popup.html': '<!doctype html><script type="module" src="popup.js"></script>',
    'src/popup.js': "import { bg } from './background.js';\nexport default bg;\n",
    ...extra,
  };
  for (const n of ['LICENSE', 'LICENSE-MIT', 'NOTICE']) writeFileSync(join(root, n), `${n}\n`);
  mkdirSync(ext, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue;
    const abs = join(ext, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { root, ext };
}

function expectRefusal(extra, manifestPatch, pattern) {
  const { root, ext } = fixture(extra, manifestPatch);
  const out = join(root, 'out');
  let error;
  try { packageExtension({ extensionDir: ext, licenseDir: root, outDir: out }); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(PackageError);
  expect(error.message).toMatch(pattern);
  expect(existsSync(out)).toBe(false);
}

test('verify: fixture baseline packages', () => {
  const { root, ext } = fixture();
  const r = packageExtension({ extensionDir: ext, licenseDir: root, outDir: join(root, 'out') });
  expect(r.entries).toBe(7);
  expect(r.path.endsWith('lang-weave-1.2.3.zip')).toBe(true);
});

test('verify: manifest references a missing file', () => {
  expectRefusal({}, { content_scripts: [{ matches: ['https://a/*'], js: ['src/gone.js'], css: ['src/gone.css'] }] }, /content_scripts\[0\]\.js: src\/gone\.js[\s\S]*content_scripts\[0\]\.css: src\/gone\.css/);
  expectRefusal({}, { background: { service_worker: 'src/missing-worker.js' } }, /background\.service_worker: src\/missing-worker\.js/);
  expectRefusal({}, { action: { default_popup: 'src/popup.html', default_icon: { 16: 'icons/16.png' } } }, /default_icon\[16\]: icons\/16\.png/);
  expectRefusal({}, { icons: { 48: 'icons/48.png' } }, /icons\[48\]: icons\/48\.png/);
  expectRefusal({}, { options_ui: { page: 'src/options.html' } }, /options_ui\.page: src\/options\.html/);
  expectRefusal({}, { side_panel: { default_path: 'src/panel.html' } }, /side_panel\.default_path/);
  expectRefusal({}, { default_locale: 'en' }, /_locales\/en\/messages\.json/);
  expectRefusal({}, { options_page: 'test/x.html' }, /options_page: test\/x\.html/);
  expectRefusal({}, { devtools_page: '../outside.html' }, /devtools_page: invalid path/);
});

test('verify: a file that exists only outside the payload is still refused', () => {
  expectRefusal({ 'test/helper.js': 'x' }, { content_scripts: [{ matches: ['https://a/*'], js: ['test/helper.js'] }] }, /test\/helper\.js is not in the package/);
});

test('verify: web_accessible_resources glob matching nothing', () => {
  expectRefusal({}, { web_accessible_resources: [{ resources: ['assets/*.png'], matches: ['https://a/*'] }] }, /assets\/\*\.png matches no packaged file/);
  const { root, ext } = fixture({}, { web_accessible_resources: [{ resources: ['src/*.js'], matches: ['https://a/*'] }] });
  expect(() => packageExtension({ extensionDir: ext, licenseDir: root, outDir: join(root, 'out') })).not.toThrow();
});

test('verify: HTML page linking a missing script or stylesheet', () => {
  expectRefusal({ 'src/popup.html': '<script type="module" src="nope.js"></script>' }, {}, /src\/popup\.html: <script> nope\.js/);
  expectRefusal({ 'src/popup.html': '<link rel="stylesheet" href="nope.css"><script src="https://cdn.example/x.js"></script>' }, {}, /<link> nope\.css/);
  expectRefusal({ 'src/popup.html': '<script src=/src/nope.js></script>' }, {}, /<script> \/src\/nope\.js/);
});

test('verify: JS importing a missing module', () => {
  expectRefusal({ 'src/popup.js': "import { x } from './gone.js';\n" }, {}, /src\/popup\.js: import "\.\/gone\.js"/);
  expectRefusal({ 'src/popup.js': "export * from './gone.js';\n" }, {}, /"\.\/gone\.js"/);
  expectRefusal({ 'src/popup.js': "import {\n  a,\n  b,\n} from '../outside.js';\n" }, {}, /"\.\.\/outside\.js"/);
  expectRefusal({ 'src/popup.js': "const m = await import('./lazy.js');\n" }, {}, /"\.\/lazy\.js"/);
  expectRefusal({ 'src/popup.js': "import './side-effect.js';\n" }, {}, /"\.\/side-effect\.js"/);
});

test('verify: refusal lists every problem and writes nothing', () => {
  const { root, ext } = fixture({ 'src/popup.js': "import './a.js';\nimport './b.js';\n" }, { icons: { 16: 'icons/16.png' } });
  const out = join(root, 'out');
  let error;
  try { packageExtension({ extensionDir: ext, licenseDir: root, outDir: out }); } catch (e) { error = e; }
  expect(error.problems.length).toBe(3);
  expect(existsSync(out)).toBe(false);
});

test('verify: references that resolve are accepted; comments and strings are not scanned', () => {
  const src = [
    "// import('./commented-out.js')",
    "/* import './block.js'; */",
    "const glob = 'src/*.js'; const rx = /['\"]\\//; // import './tail.js'",
    "const note = \"import x from './in-a-string.js'\";",
    "import { bg } from './background.js';",
    "export { bg as other } from './background.js?v=1';",
    "const dyn = () => import('./background.js');",
    "import 'pkg-bare';",
  ].join('\n');
  expect(relativeImports(src).sort()).toEqual(['./background.js', './background.js?v=1'].sort());
  const { root, ext } = fixture({ 'src/popup.js': src });
  expect(() => packageExtension({ extensionDir: ext, licenseDir: root, outDir: join(root, 'out') })).not.toThrow();
});

test('verify: pure helpers', () => {
  expect(localHtmlRefs('<!-- <script src="old.js"></script> --><script src="a.js"></script><link rel="icon" href="x.png"><link rel="stylesheet" href="b.css?x=1">')).toEqual([
    { tag: 'script', url: 'a.js' },
    { tag: 'link', url: 'b.css?x=1' },
  ]);
  expect(globToRegExp('src/*.js').test('src/a/b.js')).toBe(true);
  expect(globToRegExp('src/*.js').test('src/a.jsx')).toBe(false);
  expect(globToRegExp('a.b').test('aXb')).toBe(false);
  const files = [{ name: 'src/a.js', data: Buffer.from('') }];
  expect(verifyPackage({ version: '1', background: { service_worker: 'src/a.js' } }, files)).toEqual([]);
  expect(verifyPackage({ background: { service_worker: 'src/a.js' } }, files).length).toBe(1);
});

test('package: the real extension verifies cleanly', () => {
  const packaged = build();
  expect(packaged.files).toContain('src/options.html');
  expect(packaged.files).toContain('src/options.js');
  expect(JSON.parse(readZip(packaged.bytes).find((entry) => entry.name === 'manifest.json').data.toString())
    .options_ui).toEqual({ page: 'src/options.html', open_in_tab: true });
});

test('package: --out needs a non-empty directory in both spellings', () => {
  expect(parseArgs(['--store', '--out', 'x']).store).toBe(true);
  expect(parseArgs(['--out=x']).outDir).toBe(resolve('x'));
  for (const argv of [['--out'], ['--out', ''], ['--out='], ['--bogus']])
    expect(() => parseArgs(argv)).toThrow(PackageError);
});

test('verify: literal specifiers in backticks and interpolations are seen; computed ones are not', () => {
  expect(relativeImports('const m = import(`./tick.js`);')).toEqual(['./tick.js']);
  expect(relativeImports("const t = `a${import('./inner.js')}b`;")).toEqual(['./inner.js']);
  expect(relativeImports("const t = `a${ { a: `x${1}` }.a }b${import('./deep.js')}`; import('./after.js');"))
    .toEqual(['./deep.js', './after.js']);
  expect(relativeImports('import(`./${name}.js`);')).toEqual([]);
  expect(relativeImports("const r = /import ['\"]\\.\\/x.js/; import './real.js';")).toEqual(['./real.js']);
  expect(relativeImports("const s = 'import(`./not-code.js`)'; const u = \"export * from './nor.js'\";")).toEqual([]);
  // A division the scanner cannot close as a regex must not hide the rest of the line.
  expect(relativeImports("let n = i++ / 2; import('./after-div.js');")).toEqual(['./after-div.js']);
  expect(relativeImports("function f(i) { return `${ i++ / 2 }`; }\nimport('./after.js');")).toEqual(['./after.js']);
  expect(relativeImports("const q = a / b; import('./plain-div.js');")).toEqual(['./plain-div.js']);
  expect(relativeImports("const x = count++ / import('./postfix.js');")).toEqual(['./postfix.js']);
  // A division the regex reading misparses is still covered by the division reading, and a
  // quote inside a real regex is still covered by the regex reading.
  expect(relativeImports("const x = {} / 2; import('./needed.js');")).toEqual(['./needed.js']);
  expect(relativeImports("x = `${ function(){} / 2 }`;\nimport('./z.js');")).toEqual(['./z.js']);
  expect(relativeImports("const q = /['\"`]/.test(s); import('./after-regex.js');")).toEqual(['./after-regex.js']);
  // A missing module behind a backtick specifier refuses the package.
  expectRefusal({ 'src/popup.js': 'import(`./missing-tick.js`);\n' }, {}, /missing-tick\.js/);
});

test('collect: a symlinked payload root or file is refused, never followed', () => {
  for (const target of ['src', 'icons', 'manifest.json', 'LICENSE']) {
    const { root, ext } = fixture();
    const outside = join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), 'outside the tree\n');
    const abs = target === 'LICENSE' ? join(root, 'LICENSE') : join(ext, target);
    rmSync(abs, { recursive: true, force: true });
    if (target === 'src' || target === 'icons') symlinkSync(outside, abs);
    else {
      writeFileSync(join(outside, target), target === 'manifest.json' ? JSON.stringify(BASE_MANIFEST) : 'x\n');
      symlinkSync(join(outside, target), abs);
    }
    const out = join(root, 'out');
    expect(() => packageExtension({ extensionDir: ext, licenseDir: root, outDir: out }))
      .toThrow(new RegExp(`symlink or special file\\) in payload: ${target.replace('.', '\\.')}`));
    expect(existsSync(out)).toBe(false);
  }
});

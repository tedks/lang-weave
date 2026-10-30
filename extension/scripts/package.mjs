#!/usr/bin/env node
// Build a deterministic Chrome Web Store zip of the shipped extension. Output is byte-identical
// across runs on the same runtime; deflate output can differ between zlib builds (node vs bun).
// Dependencies: node: built-ins only. Usage:
//   node scripts/package.mjs [--store] [--out <dir>]
//
// Payload: manifest.json, src/**, icons/** and _locales/** (when present), plus the
// repo-root LICENSE, LICENSE-MIT and NOTICE at the zip root. Nothing else ships.
// Path segments starting with '.' are skipped. The manifest and every local reference
// (manifest paths, HTML script/stylesheet links, relative JS imports) are verified
// against the payload before anything is written.

import { deflateRawSync } from 'node:zlib';
import {
  lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXTENSION_DIR = resolve(HERE, '..');
const DEFAULT_LICENSE_DIR = resolve(HERE, '..', '..');
const LICENSE_FILES = ['LICENSE', 'LICENSE-MIT', 'NOTICE'];
const TREE_ROOTS = ['src', 'icons', '_locales'];

export class PackageError extends Error {
  constructor(problems) {
    const list = Array.isArray(problems) ? problems : [String(problems)];
    super(list.length === 1 ? list[0] : `${list.length} problems:\n  - ${list.join('\n  - ')}`);
    this.name = 'PackageError';
    this.problems = list;
  }
}

// ---------------------------------------------------------------- store hook

const X_MATCHES = ['https://x.com/*', 'https://twitter.com/*'];
// The whole entry the X row may drop; anything else on it (another script, a changed timing) must be a decision.
const X_ENTRY = Object.freeze({ js: ['src/content-loader.js'], css: ['src/content.css'], run_at: 'document_idle' });
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x));

/**
 * Store-only manifest deltas live here and nowhere else: one row per top-level manifest key the
 * Store build changes. storeManifest() applies exactly these rows, and the package test checks that
 * the Store manifest differs from the dev manifest in exactly these keys. A row's apply() gets a
 * copy of the dev value and returns the Store value, or undefined to drop the key. A row whose
 * precondition no longer holds throws rather than shipping a silently different manifest.
 * The self-update needs no row: src/update.js gates it on the update_url the Store adds at install.
 * The dev `key` stays for now (ditz store-manifest-key-delta waits on a Store ruling).
 */
export const STORE_DELTAS = Object.freeze([
  Object.freeze({
    key: 'content_scripts',
    why: 'Drop the hard-coded x.com/twitter.com content script (ditz store-x-content-script-ruling, option A): '
      + 'it is the only install-time host warning. Store users reach X through the per-site grant like any site; '
      + 'unpacked and fleet builds keep it.',
    apply(scripts) {
      if (!Array.isArray(scripts)) throw new PackageError('store delta content_scripts: the manifest has no content_scripts list');
      const isX = (cs) => sameSet(cs?.matches, X_MATCHES);
      const found = scripts.filter(isX).length;
      if (found !== 1) {
        throw new PackageError(`store delta content_scripts: expected exactly one entry matching only ${X_MATCHES.join(', ')}, found ${found}`);
      }
      const entry = scripts.find(isX);
      const shape = Object.fromEntries(Object.entries(entry).filter(([k]) => k !== 'matches'));
      if (JSON.stringify(Object.keys(shape).sort()) !== JSON.stringify(Object.keys(X_ENTRY).sort()) ||
          Object.entries(X_ENTRY).some(([k, v]) => JSON.stringify(shape[k]) !== JSON.stringify(v))) {
        throw new PackageError(`store delta content_scripts: the X entry is no longer exactly ${JSON.stringify(X_ENTRY)} plus matches`);
      }
      const rest = scripts.filter((cs) => !isX(cs));
      return rest.length ? rest : undefined;
    },
  }),
]);

/** The Store build's manifest: a deep copy of the dev manifest with STORE_DELTAS applied. */
export function storeManifest(manifest) {
  const out = structuredClone(manifest);
  for (const { key, apply } of STORE_DELTAS) {
    const value = apply(structuredClone(out[key]));
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out;
}

// ------------------------------------------------------------------ file list

function walk(absDir, relDir, out) {
  const dirents = readdirSync(absDir, { withFileTypes: true });
  dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue;
    const rel = `${relDir}/${d.name}`;
    const abs = join(absDir, d.name);
    if (d.isDirectory()) walk(abs, rel, out);
    else if (d.isFile()) out.push({ name: rel, data: readFileSync(abs) });
    else throw new PackageError(`unsupported file type (symlink or special file) in payload: ${rel}`);
  }
}

/** The files that ship, sorted by path: [{ name, data: Buffer }]. */
export function collectFiles({ extensionDir = DEFAULT_EXTENSION_DIR, licenseDir = DEFAULT_LICENSE_DIR } = {}) {
  const files = [];
  // lstat, never stat: a symlinked root or file could pull content from outside the tree.
  const kind = (abs) => { try { return lstatSync(abs); } catch { return null; } };
  const regularFile = (abs, name, where) => {
    const info = kind(abs);
    if (!info) throw new PackageError(`required file ${name} not found in ${where}`);
    if (!info.isFile()) throw new PackageError(`not a regular file (directory, symlink or special file) in payload: ${name}`);
    return readFileSync(abs);
  };
  files.push({ name: 'manifest.json', data: regularFile(join(extensionDir, 'manifest.json'), 'manifest.json', extensionDir) });
  for (const root of TREE_ROOTS) {
    const abs = join(extensionDir, root);
    const info = kind(abs);
    if (!info) continue;
    if (!info.isDirectory()) throw new PackageError(`unsupported file type (symlink or special file) in payload: ${root}`);
    walk(abs, root, files);
  }
  for (const name of LICENSE_FILES) files.push({ name, data: regularFile(join(licenseDir, name), name, licenseDir) });
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return files;
}

// --------------------------------------------------------------- verification

/** Normalise a manifest-relative path; returns null when it escapes the root or is empty. */
function normalizeRef(p) {
  if (typeof p !== 'string' || p === '') return null;
  const n = posix.normalize(p.replace(/^\/+/, ''));
  if (n === '.' || n === '..' || n.startsWith('../')) return null;
  return n;
}

/** Chrome resource globs: '*' matches any run of characters (including '/'). */
export function globToRegExp(glob) {
  const body = glob.replace(/^\/+/, '').split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}$`);
}

/** Every [label, path] the manifest requires to exist as a single packaged file. */
function manifestFileRefs(m) {
  const refs = [];
  const add = (label, v) => { if (v !== undefined && v !== null) refs.push([label, v]); };
  add('background.service_worker', m.background?.service_worker);
  for (const s of m.background?.scripts ?? []) add('background.scripts', s);
  (m.content_scripts ?? []).forEach((cs, i) => {
    for (const j of cs.js ?? []) add(`content_scripts[${i}].js`, j);
    for (const c of cs.css ?? []) add(`content_scripts[${i}].css`, c);
  });
  add('action.default_popup', m.action?.default_popup);
  const icon = m.action?.default_icon;
  if (typeof icon === 'string') add('action.default_icon', icon);
  else if (icon && typeof icon === 'object') for (const [k, v] of Object.entries(icon)) add(`action.default_icon[${k}]`, v);
  if (m.icons && typeof m.icons === 'object') for (const [k, v] of Object.entries(m.icons)) add(`icons[${k}]`, v);
  add('options_page', m.options_page);
  add('options_ui.page', m.options_ui?.page);
  add('side_panel.default_path', m.side_panel?.default_path);
  add('devtools_page', m.devtools_page);
  if (m.chrome_url_overrides && typeof m.chrome_url_overrides === 'object') {
    for (const [k, v] of Object.entries(m.chrome_url_overrides)) add(`chrome_url_overrides.${k}`, v);
  }
  for (const p of m.sandbox?.pages ?? []) add('sandbox.pages', p);
  for (const r of m.declarative_net_request?.rule_resources ?? []) add('declarative_net_request.rule_resources', r?.path);
  add('storage.managed_schema', m.storage?.managed_schema);
  return refs;
}

/**
 * Mask a JS source for import scanning (heuristic, not a parser): comments are dropped and every
 * string or template literal becomes a placeholder `\u0000N\u0000`, where literals[N] is its raw
 * text, or null for a template with `${}` interpolations. Interpolated expressions are masked
 * recursively and kept in place, so an import() inside one is still seen, while text inside any
 * literal can never look like an import.
 */
export function maskJsLiterals(src, { regexLiterals = true } = {}) {
  const REGEX_AFTER_WORD = /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)\s*$/;
  const literals = [];
  const n = src.length;
  const placeholder = (value) => `\u0000${literals.push(value) - 1}\u0000`;
  // Scans from i; inside an interpolation (nested) it stops at the `}` that closes it.
  function scan(i, nested) {
    let out = '';
    let prev = ''; // last significant (non-space, non-comment) character emitted
    let depth = 0;
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (nested && c === '}' && depth === 0) return [out, i];
      if (c === '/' && d === '/') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && d === '*') {
        const end = src.indexOf('*/', i + 2);
        i = end === -1 ? n : end + 2;
        out += ' ';
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        out += placeholder(src.slice(i + 1, j));
        i = j + 1;
        prev = c;
        continue;
      }
      if (c === '`') {
        let j = i + 1;
        const parts = [];
        while (j < n && src[j] !== '`') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '$' && src[j + 1] === '{') {
            const [inner, close] = scan(j + 2, true);
            parts.push(inner);
            j = close + 1;
            continue;
          }
          j++;
        }
        out += placeholder(parts.length ? null : src.slice(i + 1, j));
        for (const part of parts) out += ` (${part})`;
        i = j + 1;
        prev = c;
        continue;
      }
      if (c === '/') {
        // `x++ / 2` is a division: a postfix operator ends an operand.
        const regexOk = regexLiterals && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) ||
          (/[\w$]/.test(prev) && REGEX_AFTER_WORD.test(out))) && !/(?:\+\+|--)\s*$/.test(out);
        let j = i + 1;
        let inClass = false;
        while (regexOk && j < n && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true;
          else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) break;
          j++;
        }
        // Blank a regex body only when it closes on this line; otherwise it was a division.
        if (regexOk && j < n && src[j] === '/') {
          out += ' '; // regex bodies never hold a specifier
          i = j + 1;
          prev = '/';
          continue;
        }
      }
      if (nested && c === '{') depth++;
      else if (nested && c === '}') depth--;
      out += c;
      if (!/\s/.test(c)) prev = c;
      i++;
    }
    return [out, i];
  }
  return { code: scan(0, false)[0], literals };
}

const LITERAL = '\\u0000(\\d+)\\u0000';
const IMPORT_PATTERNS = [
  new RegExp(`\\bimport\\s*${LITERAL}`, 'g'), // import './x.js'
  new RegExp(`\\b(?:import|export)\\s+(?:type\\s+)?[\\w\\s{},*$]*?\\bfrom\\s*${LITERAL}`, 'g'), // import a from / export * from
  new RegExp(`\\bimport\\s*\\(\\s*${LITERAL}\\s*[,)]`, 'g'), // import('./x.js') or import(`./x.js`)
];

/**
 * Relative module specifiers (./ and ../) referenced by a JS source. Only literal specifiers
 * are seen: computed ones (import(url), interpolated templates) cannot be verified statically.
 * Telling a regex literal from a division needs a parser, so the source is masked twice, once
 * reading regex literals and once reading every slash as division, and the results are joined:
 * a dependency is missed only if both readings misparse it. A spurious match refuses the
 * package (fails closed) rather than shipping it.
 */
export function relativeImports(source) {
  const found = new Set();
  for (const regexLiterals of [true, false]) {
    const { code, literals } = maskJsLiterals(source, { regexLiterals });
    for (const re of IMPORT_PATTERNS) {
      for (const m of code.matchAll(re)) {
        const specifier = literals[Number(m[1])];
        if (typeof specifier === 'string' && /^\.\.?\//.test(specifier)) found.add(specifier);
      }
    }
  }
  return [...found];
}

const isLocalUrl = (u) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);

function attrs(tagBody) {
  const out = {};
  for (const m of tagBody.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

/** Local script src / stylesheet href values in an HTML page. */
export function localHtmlRefs(html) {
  const refs = [];
  const text = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of text.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const a = attrs(m[2]);
    const tag = m[1].toLowerCase();
    const url = tag === 'script' ? a.src : (/\b(?:stylesheet|modulepreload)\b/i.test(a.rel ?? '') ? a.href : undefined);
    if (url && isLocalUrl(url)) refs.push({ tag, url });
  }
  return refs;
}

/** Resolve a URL-ish reference from `fromFile` to a payload path (query/hash stripped). */
function resolveRef(fromFile, url) {
  const clean = url.replace(/[?#].*$/, '');
  const target = clean.startsWith('/')
    ? posix.normalize(clean.slice(1))
    : posix.normalize(posix.join(posix.dirname(fromFile), clean));
  return target.startsWith('../') || target === '..' ? null : target;
}

/**
 * Check the manifest and all local references against the payload.
 * Returns an array of problem strings (empty when everything resolves).
 */
export function verifyPackage(manifest, files) {
  const problems = [];
  const have = new Set(files.map((f) => f.name));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest.json is not a JSON object'];
  if (typeof manifest.version !== 'string' || manifest.version === '') problems.push('manifest.version is missing or not a string');

  for (const [label, raw] of manifestFileRefs(manifest)) {
    const p = normalizeRef(raw);
    if (p === null) problems.push(`manifest ${label}: invalid path ${JSON.stringify(raw)}`);
    else if (!have.has(p)) problems.push(`manifest ${label}: ${p} is not in the package`);
  }

  for (const [i, entry] of (manifest.web_accessible_resources ?? []).entries()) {
    const resources = typeof entry === 'string' ? [entry] : entry?.resources ?? [];
    for (const pattern of resources) {
      if (typeof pattern !== 'string' || !pattern.replace(/^\/+/, '')) {
        problems.push(`manifest web_accessible_resources[${i}]: invalid pattern ${JSON.stringify(pattern)}`);
        continue;
      }
      const re = globToRegExp(pattern);
      if (![...have].some((n) => re.test(n))) problems.push(`manifest web_accessible_resources[${i}]: pattern ${pattern} matches no packaged file`);
    }
  }

  const locales = [...have].some((n) => n.startsWith('_locales/'));
  if (manifest.default_locale !== undefined) {
    const loc = manifest.default_locale;
    if (typeof loc !== 'string' || !/^[\w-]+$/.test(loc)) problems.push(`manifest default_locale: invalid value ${JSON.stringify(loc)}`);
    else if (!have.has(`_locales/${loc}/messages.json`)) problems.push(`manifest default_locale: _locales/${loc}/messages.json is not in the package`);
  } else if (locales) {
    problems.push('_locales/ is packaged but manifest has no default_locale');
  }

  for (const f of files) {
    if (f.name.startsWith('src/') && f.name.endsWith('.html')) {
      for (const { tag, url } of localHtmlRefs(f.data.toString('utf8'))) {
        const target = resolveRef(f.name, url);
        if (target === null || !have.has(target)) {
          problems.push(`${f.name}: <${tag}> ${url} does not resolve to a packaged file`);
        }
      }
    } else if (f.name.endsWith('.js') && !f.name.startsWith('_locales/')) {
      for (const spec of relativeImports(f.data.toString('utf8'))) {
        const target = resolveRef(f.name, spec);
        if (target === null || !have.has(target)) {
          problems.push(`${f.name}: import ${JSON.stringify(spec)} does not resolve to a packaged file`);
        }
      }
    }
  }
  return problems;
}

// ------------------------------------------------------------------------ zip

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const VERSION_MADE_BY = (3 << 8) | 30; // Unix, spec 3.0
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;
const LIMIT = 0xffffffff;

/**
 * Build a zip from [{ name, data }] (sorted by name). Deterministic: fixed timestamps and
 * attributes, deflate level 9 with a stored fallback. No zip64; throws if a limit is exceeded.
 */
export function buildZip(files) {
  if (files.length > 0xffff) throw new PackageError(`too many entries for a non-zip64 archive: ${files.length}`);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    if (name.length > 0xffff) throw new PackageError(`file name too long: ${f.name}`);
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    if (data.length >= LIMIT) throw new PackageError(`file too large for a non-zip64 archive: ${f.name}`);
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const needed = useDeflate ? 20 : 10;
    const flags = /[^\x20-\x7e]/.test(f.name) ? 0x0800 : 0;
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(needed, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(VERSION_MADE_BY, 4);
    ch.writeUInt16LE(needed, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(EXTERNAL_ATTRS, 38);
    ch.writeUInt32LE(offset, 42);

    locals.push(lh, name, body);
    centrals.push(ch, name);
    offset += lh.length + name.length + body.length;
    if (offset >= LIMIT) throw new PackageError('archive too large for a non-zip64 archive');
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  if (offset + centralSize >= LIMIT) throw new PackageError('archive too large for a non-zip64 archive');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

// -------------------------------------------------------------------- package

/**
 * Verify, then build and write the zip. Throws PackageError (writing nothing) when
 * verification fails. Returns { path, entries, bytes, version, files }.
 */
export function packageExtension({
  extensionDir = DEFAULT_EXTENSION_DIR,
  licenseDir = DEFAULT_LICENSE_DIR,
  outDir = join(extensionDir, 'dist'),
  store = false,
} = {}) {
  const files = collectFiles({ extensionDir, licenseDir });
  const manifestFile = files.find((f) => f.name === 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.data.toString('utf8'));
  } catch (err) {
    throw new PackageError(`manifest.json is not valid JSON: ${err.message}`);
  }
  if (store) {
    const shipped = storeManifest(manifest);
    // Keep the original bytes when no delta changes anything; re-serialise only for real deltas.
    if (JSON.stringify(shipped) !== JSON.stringify(manifest)) {
      manifestFile.data = Buffer.from(`${JSON.stringify(shipped, null, 2)}\n`, 'utf8');
    }
    manifest = shipped;
  }
  const problems = verifyPackage(manifest, files);
  if (problems.length) throw new PackageError(problems);

  const zip = buildZip(files);
  const name = `lang-weave-${manifest.version}${store ? '-store' : ''}.zip`;
  if (!/^[\w.+-]+$/.test(name)) throw new PackageError(`unsafe zip file name from manifest version: ${name}`);
  const path = join(outDir, name);
  mkdirSync(outDir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, zip);
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { path, entries: files.length, bytes: zip.length, version: manifest.version, files: files.map((f) => f.name) };
}

// ------------------------------------------------------------------------ CLI

export function parseArgs(argv) {
  const opts = { store: false, outDir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--store') opts.store = true;
    else if (a === '--out') {
      const v = argv[++i];
      if (!v) throw new PackageError('--out requires a directory');
      opts.outDir = resolve(v);
    } else if (a.startsWith('--out=')) {
      if (!a.slice(6)) throw new PackageError('--out requires a directory');
      opts.outDir = resolve(a.slice(6));
    }
    else throw new PackageError(`unknown argument: ${a}\nusage: node scripts/package.mjs [--store] [--out <dir>]`);
  }
  return opts;
}

function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const r = packageExtension({ store: opts.store, ...(opts.outDir ? { outDir: opts.outDir } : {}) });
    console.log(`${r.path}\n${r.entries} entries, ${r.bytes} bytes`);
  } catch (err) {
    console.error(`package failed: ${err instanceof PackageError ? err.message : err}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

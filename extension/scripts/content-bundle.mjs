// Small, fail-closed wrapper for the content script's static ES-module graph. The supported
// syntax is deliberately narrow: relative named imports, named const/function exports and
// named re-exports. New module syntax must be handled explicitly before a Store zip can ship.
import { posix } from 'node:path';
import { Script } from 'node:vm';

export class BundleError extends Error {}

const id = '[A-Za-z_$][\\w$]*';
const named = new RegExp(`^(${id})(?:\\s+as\\s+(${id}))?$`);
const importNamed = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*(['"])([^'"\n]+)\2\s*;?[ \t]*$/gm;
const exportFrom = /^[ \t]*export\s*\{([^}]*)\}\s*from\s*(['"])([^'"\n]+)\2\s*;?[ \t]*$/gm;
const exportLocal = /^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$/gm;
const exportDecl = new RegExp(`^([ \\t]*)export\\s+((?:async\\s+)?function|const|class)\\s+(${id})\\b`, 'gm');

// Preserve UTF-16 offsets while blanking comments, string/template text and their delimiters.
// Template expressions are scanned as code, including nested templates. The regex heuristic
// handles the current closure; unusual new regex syntax needs review before packaging.
function codeMask(source) {
  const out = source.split('');
  const blank = (from, to) => { for (let p = from; p < to; p++) if (source[p] !== '\n') out[p] = ' '; };
  function quoted(start, quote) {
    let i = start + 1;
    while (i < source.length) {
      if (source[i] === '\\') { i += 2; continue; }
      if (source[i] === quote) return i + 1;
      i++;
    }
    throw new BundleError('unterminated string or template literal');
  }
  function template(start) {
    let i = start + 1;
    blank(start, i);
    let textStart = i;
    while (i < source.length) {
      if (source[i] === '\\') { i += 2; continue; }
      if (source[i] === '`') { blank(textStart, i + 1); return i + 1; }
      if (source[i] === '$' && source[i + 1] === '{') {
        blank(textStart, i + 2);
        i = scan(i + 2, true);
        blank(i - 1, i); // closing interpolation brace
        textStart = i;
        continue;
      }
      i++;
    }
    throw new BundleError('unterminated template literal');
  }
  function scan(start, interpolation = false) {
    let depth = 0, i = start, prev = '';
    while (i < source.length) {
      const c = source[i], next = source[i + 1];
      if (interpolation && c === '}' && depth === 0) return i + 1;
      if (c === '"' || c === "'") { const end = quoted(i, c); blank(i, end); i = end; prev = c; continue; }
      if (c === '`') { i = template(i); prev = '`'; continue; }
      if (c === '/' && next === '/') {
        let end = source.indexOf('\n', i + 2);
        if (end < 0) end = source.length;
        blank(i, end); i = end; continue;
      }
      if (c === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2);
        if (end < 0) throw new BundleError('unterminated block comment');
        blank(i, end + 2); i = end + 2; continue;
      }
      if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) ||
          /\b(?:return|throw|case|yield|await)\s*$/.test(source.slice(start, i)))) {
        let end = i + 1, inClass = false;
        while (end < source.length && source[end] !== '\n') {
          if (source[end] === '\\') { end += 2; continue; }
          if (source[end] === '[') inClass = true;
          else if (source[end] === ']') inClass = false;
          else if (source[end] === '/' && !inClass) break;
          end++;
        }
        if (source[end] === '/') {
          end++;
          while (/[a-z]/i.test(source[end] ?? '')) end++;
          blank(i, end); i = end; prev = '/'; continue;
        }
      }
      if (interpolation && c === '{') depth++;
      else if (interpolation && c === '}') depth--;
      if (!/\s/.test(c)) prev = c;
      i++;
    }
    if (interpolation) throw new BundleError('unterminated template interpolation');
    return i;
  }
  scan(0);
  return out.join('');
}

function replaceCode(source, pattern, transform) {
  const mask = codeMask(source);
  return source.replace(pattern, (...args) => {
    const matched = args[0], offset = typeof args.at(-1) === 'object' ? args.at(-3) : args.at(-2);
    const tokenAt = matched.search(/\b(?:import|export)\b/);
    if (tokenAt < 0 || !/^(?:import|export)\b/.test(mask.slice(offset + tokenAt))) return matched;
    return transform(...args);
  });
}

function names(raw, file) {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new BundleError(`${file}: empty named import/export`);
  return parts.map((part) => {
    const m = named.exec(part);
    if (!m) throw new BundleError(`${file}: unsupported named binding ${JSON.stringify(part)}`);
    return [m[1], m[2] || m[1]];
  });
}

function dependency(file, spec) {
  if (!/^\.\.?\//.test(spec)) throw new BundleError(`${file}: non-relative module ${JSON.stringify(spec)}`);
  const target = posix.normalize(posix.join(posix.dirname(file), spec));
  if (target.startsWith('../') || !target.startsWith('src/') || !target.endsWith('.js'))
    throw new BundleError(`${file}: module escapes src or is not .js: ${JSON.stringify(spec)}`);
  return target;
}

function parse(file, source) {
  // This over-rejects matching text in strings/comments, deliberately: a missed dynamic
  // import would package a runtime fetch to a module the Store does not expose.
  if (/\bimport\s*(?:\(|\.\s*meta)/.test(source))
    throw new BundleError(`${file}: dynamic import or import.meta is unsupported`);
  const deps = new Set(), imports = [], reexports = [], exports = new Map();
  const add = (publicName, expression) => {
    if (exports.has(publicName)) throw new BundleError(`${file}: duplicate export ${publicName}`);
    exports.set(publicName, expression);
  };
  let body = replaceCode(source, importNamed, (_whole, raw, _quote, spec) => {
    const target = dependency(file, spec);
    deps.add(target);
    imports.push({ target, bindings: names(raw, file) });
    return '';
  });
  body = replaceCode(body, exportFrom, (_whole, raw, _quote, spec) => {
    const target = dependency(file, spec);
    deps.add(target);
    for (const [remote, publicName] of names(raw, file)) {
      reexports.push({ target, remote });
      add(publicName, `__modules[${JSON.stringify(target)}][${JSON.stringify(remote)}]`);
    }
    return '';
  });
  body = replaceCode(body, exportLocal, (_whole, raw) => {
    for (const [local, publicName] of names(raw, file)) add(publicName, local);
    return '';
  });
  body = replaceCode(body, exportDecl, (_whole, indent, kind, local) => {
    add(local, local);
    return `${indent}${kind} ${local}`;
  });

  // Comments and literals are blanked with a tiny lexical pass so words inside them cannot
  // hide module syntax. Script compilation below also rejects top-level await and bad JS.
  const masked = codeMask(body);
  if (/(^|[^.\w$])(?:import|export)\b|\bimport\s*\.\s*meta\b/.test(masked))
    throw new BundleError(`${file}: unsupported import/export, import.meta or dynamic import`);
  return { file, deps: [...deps].sort(), imports, reexports, exports, body };
}

/** Build a classic script from a map of payload paths to source strings. */
export function bundleContent(files, entry = 'src/content.js') {
  const parsed = new Map(), visiting = new Set(), order = [];
  function visit(file) {
    if (visiting.has(file)) throw new BundleError(`module cycle at ${file}`);
    if (parsed.has(file)) return;
    const source = files.get(file);
    if (source === undefined) throw new BundleError(`missing module ${file}`);
    visiting.add(file);
    const module = parse(file, source);
    for (const dep of module.deps) visit(dep);
    for (const { target, bindings } of module.imports) {
      for (const [remote] of bindings) if (!parsed.get(target).exports.has(remote))
        throw new BundleError(`${file}: ${target} has no named export ${remote}`);
    }
    for (const { target, remote } of module.reexports) if (!parsed.get(target).exports.has(remote))
      throw new BundleError(`${file}: ${target} has no named export ${remote}`);
    visiting.delete(file);
    parsed.set(file, module);
    order.push(file);
  }
  visit(entry);
  const lines = ['// Generated for the Store package by scripts/content-bundle.mjs.', '(() => {', '"use strict";',
    "const __marker = Symbol.for('lang-weave.content-bundle');",
    'if (globalThis[__marker]) return globalThis[__marker];',
    'const __modules = Object.create(null);'];
  for (const file of order) {
    const module = parsed.get(file);
    lines.push(`// ${file}`, `__modules[${JSON.stringify(file)}] = (() => {`);
    for (const { target, bindings } of module.imports) {
      lines.push(`const { ${bindings.map(([remote, local]) => remote === local ? remote : `${remote}: ${local}`).join(', ')} } = __modules[${JSON.stringify(target)}];`);
    }
    lines.push(module.body);
    lines.push(`return { ${[...module.exports].map(([name, value]) => `${JSON.stringify(name)}: ${value}`).join(', ')} };`, '})();');
  }
  lines.push(`globalThis[__marker] = __modules[${JSON.stringify(entry)}];`, 'return globalThis[__marker];', '})();', '');
  const code = lines.join('\n');
  try { new Script(code, { filename: 'src/content-bundle.js' }); }
  catch (error) { throw new BundleError(`bundle is not a classic script: ${error.message}`); }
  return { code, order };
}

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
  const deps = new Set(), imports = [], reexports = [], exports = new Map();
  const add = (publicName, expression) => {
    if (exports.has(publicName)) throw new BundleError(`${file}: duplicate export ${publicName}`);
    exports.set(publicName, expression);
  };
  let body = source.replace(importNamed, (_whole, raw, _quote, spec) => {
    const target = dependency(file, spec);
    deps.add(target);
    imports.push({ target, bindings: names(raw, file) });
    return '';
  }).replace(exportFrom, (_whole, raw, _quote, spec) => {
    const target = dependency(file, spec);
    deps.add(target);
    for (const [remote, publicName] of names(raw, file)) {
      reexports.push({ target, remote });
      add(publicName, `__modules[${JSON.stringify(target)}][${JSON.stringify(remote)}]`);
    }
    return '';
  }).replace(exportLocal, (_whole, raw) => {
    for (const [local, publicName] of names(raw, file)) add(publicName, local);
    return '';
  }).replace(exportDecl, (_whole, indent, kind, local) => {
    add(local, local);
    return `${indent}${kind} ${local}`;
  });

  // Comments and literals are blanked with a tiny lexical pass so words inside them cannot
  // hide module syntax. Script compilation below also rejects top-level await and bad JS.
  const masked = body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\.|[^`])*`|"(?:\\.|[^"\n])*"|'(?:\\.|[^'\n])*'/g,
    (s) => ' '.repeat(s.length));
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
  const lines = ['// Generated for the Store package by scripts/content-bundle.mjs.', '(() => {', '"use strict";', 'const __modules = Object.create(null);'];
  for (const file of order) {
    const module = parsed.get(file);
    lines.push(`// ${file}`, `__modules[${JSON.stringify(file)}] = (() => {`);
    for (const { target, bindings } of module.imports) {
      lines.push(`const { ${bindings.map(([remote, local]) => remote === local ? remote : `${remote}: ${local}`).join(', ')} } = __modules[${JSON.stringify(target)}];`);
    }
    lines.push(module.body);
    lines.push(`return { ${[...module.exports].map(([name, value]) => `${JSON.stringify(name)}: ${value}`).join(', ')} };`, '})();');
  }
  lines.push(`return __modules[${JSON.stringify(entry)}];`, '})();', '');
  const code = lines.join('\n');
  try { new Script(code, { filename: 'src/content-bundle.js' }); }
  catch (error) { throw new BundleError(`bundle is not a classic script: ${error.message}`); }
  return { code, order };
}

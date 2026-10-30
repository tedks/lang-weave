#!/usr/bin/env node
// Render design/icon.svg to icons/icon-{16,32,48,128}.png, deterministically and with node: built-ins only.
// Usage: node scripts/icons.mjs [--check]   (--check renders and compares pixels, writing nothing)
//
// Why not Chromium: Skia's anti-aliasing and PNG encoder output can change between the Chromium
// builds Playwright installs, so a re-render could differ by machine. Here the mark sits on a 16-unit
// integer grid and every size is an integer scale of it, so only the tile's rounded corners need
// anti-aliasing (a fixed 16x16 supersample with integer counts). The pixels are therefore exact
// everywhere; only deflate bytes may differ between zlib builds, so checks compare pixels.
//
// The SVG is a strict subset, refused otherwise: <rect> elements with integer x, y, width, height,
// optional integer rx and a #rrggbb fill, painted in document order, inside a 16x16 viewBox.

import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from './package.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ICON_DIR = resolve(HERE, '..', 'icons');
// The source lives outside icons/ so the package (which ships icons/**) carries only the PNGs.
export const ICON_SVG = resolve(HERE, '..', 'design', 'icon.svg');
const GRID = 16;
const SUPERSAMPLE = 16;
// 128 follows the Store's advice: 96x96 artwork with 16 px of transparent padding.
export const SIZES = Object.freeze({ 16: { scale: 1, pad: 0 }, 32: { scale: 2, pad: 0 }, 48: { scale: 3, pad: 0 }, 128: { scale: 6, pad: 16 } });

export function parseIconSvg(svg) {
  const bad = (why) => { throw new Error(`icon.svg: ${why}`); };
  const text = svg.replace(/<!--[\s\S]*?-->/g, '');
  const root = text.match(/^\s*<svg((?:\s+[a-zA-Z:]+="[^"]*")*)\s*>([\s\S]*)<\/svg>\s*$/);
  if (!root) bad('must be a single <svg> element with nothing before or after it but comments');
  const rootAttrs = Object.fromEntries([...root[1].matchAll(/\s+([a-zA-Z:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  for (const k of Object.keys(rootAttrs)) if (!['xmlns', 'viewBox', 'width', 'height'].includes(k)) bad(`unsupported <svg> attribute ${k}`);
  if (rootAttrs.viewBox !== '0 0 16 16') bad('viewBox must be "0 0 16 16"');
  const body = root[2];
  const rects = [];
  const rest = body.replace(/<rect\b([^>]*)\/>/g, (_, attrs) => {
    const a = {};
    const leftover = attrs.replace(/\s([a-z]+)="([^"]*)"/g, (__, k, v) => {
      if (k in a) bad(`duplicate attribute ${k}`);
      a[k] = v;
      return '';
    });
    if (leftover.trim()) bad(`unsupported rect syntax: ${leftover.trim()}`);
    for (const k of Object.keys(a)) if (!['x', 'y', 'width', 'height', 'rx', 'fill'].includes(k)) bad(`unsupported attribute ${k}`);
    const int = (k, def) => {
      const v = a[k] ?? def;
      if (v === undefined || !/^\d+$/.test(v)) bad(`${k} must be a non-negative integer, got ${JSON.stringify(a[k])}`);
      return Number(v);
    };
    const rect = { x: int('x'), y: int('y'), w: int('width'), h: int('height'), rx: int('rx', '0') };
    if (!/^#[0-9a-f]{6}$/.test(a.fill || '')) bad(`fill must be #rrggbb, got ${JSON.stringify(a.fill)}`);
    if (!rect.w || !rect.h || rect.x + rect.w > GRID || rect.y + rect.h > GRID) bad(`rect outside the 16x16 grid: ${attrs.trim()}`);
    if (2 * rect.rx > Math.min(rect.w, rect.h)) bad(`rx too large: ${attrs.trim()}`);
    rect.rgb = [1, 3, 5].map((i) => parseInt(a.fill.slice(i, i + 2), 16));
    rects.push(rect);
    return '';
  });
  if (rest.trim()) bad(`unsupported content: ${rest.trim().slice(0, 60)}`);
  if (!rects.length) bad('no rects');
  return rects;
}

// Inside test for a rounded rect, in grid units; points exactly on an edge count as inside on the
// top/left edges only, so adjacent rects tile without double coverage.
function inside(r, x, y) {
  if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return false;
  if (!r.rx) return true;
  const cx = Math.min(Math.max(x, r.x + r.rx), r.x + r.w - r.rx);
  const cy = Math.min(Math.max(y, r.y + r.rx), r.y + r.h - r.rx);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r.rx ** 2;
}

/** RGBA pixels (Uint8Array, row-major) for one size. */
export function rasterize(rects, size) {
  const spec = SIZES[size];
  if (!spec) throw new Error(`unsupported icon size ${size}`);
  const { scale, pad } = spec;
  if (pad * 2 + GRID * scale !== size) throw new Error(`size ${size} does not fit scale ${scale} and padding ${pad}`);
  const out = new Uint8Array(size * size * 4);
  const n = SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      const sum = [0, 0, 0];
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const gx = (px - pad + (sx + 0.5) / n) / scale;
          const gy = (py - pad + (sy + 0.5) / n) / scale;
          let top = null;
          for (const r of rects) if (inside(r, gx, gy)) top = r;
          if (!top) continue;
          covered++;
          for (let c = 0; c < 3; c++) sum[c] += top.rgb[c];
        }
      }
      const o = (py * size + px) * 4;
      if (covered) for (let c = 0; c < 3; c++) out[o + c] = Math.round(sum[c] / covered);
      out[o + 3] = Math.round((255 * covered) / (n * n));
    }
  }
  return out;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** An 8-bit RGBA, non-interlaced PNG with filter 0 on every row and no ancillary chunks. */
export function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Decode a PNG this script wrote (strict: RGBA8, filter 0, CRCs checked). Returns { size, rgba }. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let p = 8;
  let size = 0;
  const idat = [];
  let ended = false;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if ((crc32(buf.subarray(p + 4, p + 8 + len)) >>> 0) !== buf.readUInt32BE(p + 8 + len)) throw new Error(`bad CRC in ${type}`);
    if (type === 'IHDR') {
      size = data.readUInt32BE(0);
      if (data.readUInt32BE(4) !== size || !data.subarray(8).equals(Buffer.from([8, 6, 0, 0, 0]))) throw new Error('unsupported IHDR');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') { ended = true; p += 12 + len; break; } else throw new Error(`unexpected chunk ${type}`);
    p += 12 + len;
  }
  if (!ended || p !== buf.length) throw new Error('missing IEND or trailing data');
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== size * (size * 4 + 1)) throw new Error('bad image data length');
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    if (raw[y * (size * 4 + 1)] !== 0) throw new Error('unsupported filter');
    rgba.set(raw.subarray(y * (size * 4 + 1) + 1, (y + 1) * (size * 4 + 1)), y * size * 4);
  }
  return { size, rgba };
}

export const iconFile = (size) => `icon-${size}.png`;

/** Render every size from the SVG. Returns [{ size, name, rgba, png }]. */
export function renderIcons(svg = readFileSync(ICON_SVG, 'utf8')) {
  const rects = parseIconSvg(svg);
  return Object.keys(SIZES).map(Number).map((size) => {
    const rgba = rasterize(rects, size);
    return { size, name: iconFile(size), rgba, png: encodePng(rgba, size) };
  });
}

function main(argv) {
  const check = argv.includes('--check');
  if (argv.some((a) => a !== '--check')) throw new Error('usage: node scripts/icons.mjs [--check]');
  const stale = [];
  for (const { name, rgba, png } of renderIcons()) {
    const path = join(ICON_DIR, name);
    if (check) {
      let same = false;
      try { same = Buffer.from(decodePng(readFileSync(path)).rgba).equals(Buffer.from(rgba)); } catch { /* missing or unreadable */ }
      if (!same) stale.push(name);
      continue;
    }
    const tmp = `${path}.tmp-${process.pid}`;
    try { writeFileSync(tmp, png); renameSync(tmp, path); } finally { rmSync(tmp, { force: true }); }
    console.log(`wrote icons/${name} (${png.length} bytes)`);
  }
  if (stale.length) {
    console.error(`stale icons (run node scripts/icons.mjs): ${stale.join(', ')}`);
    process.exitCode = 1;
  } else if (check) console.log('icons match icon.svg');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}

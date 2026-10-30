import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ICON_DIR, ICON_SVG, SIZES, decodePng, encodePng, iconFile, parseIconSvg, rasterize, renderIcons } from '../scripts/icons.mjs';

const EXT = resolve(import.meta.dir, '..');
const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
const svg = readFileSync(ICON_SVG, 'utf8');

test('icons: committed PNGs are exactly the rendering of design/icon.svg', () => {
  for (const { size, name, rgba } of renderIcons(svg)) {
    const committed = decodePng(readFileSync(join(ICON_DIR, name)));
    expect(committed.size).toBe(size);
    expect(Buffer.from(committed.rgba).equals(Buffer.from(rgba))).toBe(true);
  }
});

test('icons: rendering is deterministic and round-trips through the encoder', () => {
  const a = renderIcons(svg);
  const b = renderIcons(svg);
  for (let i = 0; i < a.length; i++) {
    expect(Buffer.from(a[i].rgba).equals(Buffer.from(b[i].rgba))).toBe(true);
    expect(Buffer.from(decodePng(encodePng(a[i].rgba, a[i].size)).rgba).equals(Buffer.from(a[i].rgba))).toBe(true);
  }
});

test('icons: the manifest names every size for icons and 16/32 for the toolbar, all in icons/', () => {
  expect(manifest.icons).toEqual(Object.fromEntries(Object.keys(SIZES).map((s) => [s, `icons/${iconFile(s)}`])));
  expect(manifest.action.default_icon).toEqual({ 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' });
});

test('icons: 128 keeps the Store\'s 16 px transparent padding; smaller sizes are full bleed', () => {
  const alpha = (size, x, y) => renderIcons(svg).find((i) => i.size === size).rgba[(y * size + x) * 4 + 3];
  for (const [x, y] of [[0, 0], [15, 64], [64, 15], [112, 64], [127, 127]]) expect(alpha(128, x, y)).toBe(0);
  expect(alpha(128, 64, 16)).toBe(255);
  for (const size of [16, 32, 48]) {
    expect(alpha(size, size / 2, 0)).toBe(255);
    expect(alpha(size, 0, 0)).toBeLessThan(128); // rounded corner
  }
});

// WCAG relative luminance and contrast, for the toolbar check below.
const lum = ([r, g, b]) => [r, g, b].map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('icons: legible on light and dark toolbars (tile edge on light, strands on dark, strands on the tile)', () => {
  const [tile, ...strands] = parseIconSvg(svg);
  const colors = [...new Set(strands.map((r) => r.rgb.join()))].map((c) => c.split(',').map(Number)).filter((c) => c.join() !== tile.rgb.join());
  expect(colors.length).toBe(2); // two strands, two languages
  for (const light of [[255, 255, 255], [241, 243, 244]]) expect(contrast(tile.rgb, light)).toBeGreaterThanOrEqual(3);
  for (const dark of [[32, 33, 36], [60, 64, 67]]) for (const c of colors) expect(contrast(c, dark)).toBeGreaterThanOrEqual(3);
  for (const c of colors) expect(contrast(c, tile.rgb)).toBeGreaterThanOrEqual(3);
});

test('icons: the SVG subset is strict', () => {
  const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
  expect(parseIconSvg(wrap('<rect x="0" y="0" width="16" height="16" rx="3" fill="#0f766e"/>'))).toHaveLength(1);
  for (const bad of ['<circle cx="8" cy="8" r="4" fill="#000000"/>', '<rect x="0.5" y="0" width="1" height="1" fill="#000000"/>',
    '<rect x="0" y="0" width="17" height="1" fill="#000000"/>', '<rect x="0" y="0" width="1" height="1" fill="red"/>',
    '<rect x="0" y="0" width="1" height="1" fill="#000000" transform="scale(2)"/>', '<rect x="0" y="0" width="4" height="4" rx="3" fill="#000000"/>', '']) {
    expect(() => parseIconSvg(wrap(bad))).toThrow();
  }
  // Root attributes and surrounding content a browser would render differently from the PNGs are refused.
  for (const bad of ['<svg viewBox="0 0 16 16" opacity="0.5">', '<svg viewBox="0 0 16 16" transform="rotate(90)">',
    '<svg viewBox="0 0 16 16" preserveAspectRatio="none">', '<svg viewBox="0 0 16 16">',
    '<svg xmlns="http://example.com/ns" viewBox="0 0 16 16">', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="0" height="0">',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="128" height="64">',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12.5">',
    // Every root attribute must be double-quoted (so it is parsed and checked) and appear once.
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width=\'0\'>', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width=0>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" width="16" height="16">']) {
    expect(() => parseIconSvg(`${bad}<rect x="0" y="0" width="1" height="1" fill="#000000"/></svg>`)).toThrow();
  }
  expect(() => parseIconSvg(`<?xml-stylesheet href="x.css"?>${wrap('<rect x="0" y="0" width="1" height="1" fill="#000000"/>')}`)).toThrow();
  expect(() => parseIconSvg(`${wrap('<rect x="0" y="0" width="1" height="1" fill="#000000"/>')}<rect/>`)).toThrow();
  expect(() => parseIconSvg('<svg viewBox="0 0 32 32"><rect x="0" y="0" width="1" height="1" fill="#000000"/></svg>')).toThrow();
  expect(() => rasterize(parseIconSvg(svg), 64)).toThrow();
});

import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from '../../scripts/curriculum/build.mjs';
import { L2_WORDS } from '../src/vocabulary.js';

const root = resolve(import.meta.dir, '../..');
const original = JSON.parse(readFileSync(join(root, 'scripts/curriculum/overlay.json')));
const bands = readFileSync(join(root, 'data/curriculum/es/wordfreq-bands.csv'), 'utf8');
const files = (path) => Object.fromEntries(readdirSync(path).map((name) => [name, readFileSync(join(path, name), 'utf8')]));
const scratch = async (fn) => { const path = mkdtempSync(join(tmpdir(), 'lang-weave-curriculum-test-'));
  try { return await fn(path); } finally { rmSync(path, { recursive: true, force: true }); } };

test('fixture build is byte-identical, retains per-row provenance and never ships a candidate', async () => {
  await scratch(async (path) => {
    const a = join(path, 'a'), b = join(path, 'b');
    const first = await build({ out: a });
    await build({ out: b });
    expect(files(a)).toEqual(files(b));
    expect(first.rows).toHaveLength(2);
    expect(first.rows.every((row) => row.status === 'machine-checked' && /^[a-f0-9]{64}$/.test(row.row_hash) &&
      /^[a-f0-9]{64}$/.test(row.provenance.wiktextract_entry_sha256))).toBe(true);
    expect(JSON.parse(files(a)['MANIFEST.json']).shipped).toBe(false);
    expect(L2_WORDS).toHaveLength(226);
  });
});

test('all 226 shipped bands match the committed wordfreq table in original order', () => {
  const table = bands.trimEnd().split('\n').slice(1, 227).map((line) => {
    const fields = line.split(',');
    return { fr: fields[0], band: Number(fields[4]) };
  });
  expect(L2_WORDS.map(({ fr, band }) => ({ fr, band }))).toEqual(table);
  expect(L2_WORDS.slice(0, 30).every((word) => word.band === 0)).toBe(true);
});

test('the twelve deterministic gates fail closed on a bad candidate', async () => {
  const cases = [
    ['duplicate form', (rows) => { rows[0].fr = 'el gato'; }, /duplicate target form/],
    ['accent homograph', (rows) => { rows[0].fr = 'el arbol'; }, /accent-fold collision/],
    ['singular/plural rule', (rows) => { rows[0].number = 'plural'; }, /article\/gender\/number rule/],
    ['common English form', (_, table) => table.replace(/^el sombrero,([^,]+),([^,]+),[^,]+,/m, 'el sombrero,$1,$2,9.00,'), /common English word/],
    ['existing anchor', (rows) => { rows[0].anchors = ['dog']; }, /existing English anchor/],
    ['shared new anchor', (rows) => { rows[1].anchors = ['hat']; }, /shared English anchor/],
    ['missing article rule', (rows) => { rows[0].article_rule = 'none'; }, /article\/gender\/number rule/],
    ['hint format', (rows) => { rows[0].hint = 'sombrero!'; }, /invalid hint/],
    ['band absent', (_, table) => table.replace(/^el sombrero,.*\n/m, ''), /missing frequency band/],
    ['sense note', (rows) => { rows[0].sense = ''; }, /invalid or reserved characters in sense/],
    ['example mismatch', (rows) => { rows[0].example_id = '1604986'; }, /example sentence alignment/],
    ['function word', (rows) => { rows[0].anchors = ['and']; }, /forbidden or existing English anchor/],
    ['reserved characters', (rows) => { rows[0].en = 'the | hat'; }, /reserved characters/],
  ];
  for (const [name, mutate, pattern] of cases) await scratch(async (path) => {
    const rows = structuredClone(original);
    const result = mutate(rows, bands);
    const overlay = join(path, 'overlay.json'), table = join(path, 'bands.csv');
    writeFileSync(overlay, JSON.stringify(rows));
    writeFileSync(table, result || bands);
    await expect(build({ out: join(path, 'out'), overlay, bands: table })).rejects.toThrow(pattern);
  });
});

test('native-reviewed status requires two approvals for the exact row content hash', async () => {
  await scratch(async (path) => {
    const rows = structuredClone(original);
    rows[0].status = 'native-reviewed';
    const overlay = join(path, 'overlay.json'), reviews = join(path, 'reviews.json');
    writeFileSync(overlay, JSON.stringify(rows));
    await expect(build({ out: join(path, 'no-review'), overlay })).rejects.toThrow(/lacks two independent approvals/);
    const base = await build({ out: join(path, 'base') });
    const hash = base.rows.find((row) => row.fr === rows[0].fr).row_hash;
    writeFileSync(reviews, JSON.stringify([
      { reviewer_id: 'reviewer-a', date: '2026-10-31', row_hash: hash, verdict: 'approve' },
      { reviewer_id: 'reviewer-b', date: '2026-10-31', row_hash: hash, verdict: 'approve' },
    ]));
    const accepted = await build({ out: join(path, 'accepted'), overlay, reviews });
    expect(accepted.rows.find((row) => row.fr === rows[0].fr).status).toBe('native-reviewed');
    rows[0].sense = 'sun hat';
    writeFileSync(overlay, JSON.stringify(rows));
    await expect(build({ out: join(path, 'changed'), overlay, reviews })).rejects.toThrow(/lacks two independent approvals/);
  });
});

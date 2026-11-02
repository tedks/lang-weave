import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from '../../scripts/curriculum/build.mjs';
import { L2_WORDS } from '../src/vocabulary.js';
import { isPluralSurface, supportsAnchor } from '../../scripts/curriculum/english-inflections.mjs';

const root = resolve(import.meta.dir, '../..');
const original = JSON.parse(readFileSync(join(root, 'scripts/curriculum/overlay.json')));
const sourcePins = JSON.parse(readFileSync(join(root, 'data/curriculum/es/SOURCES.json')));
const bands = readFileSync(join(root, 'data/curriculum/es/wordfreq-bands.csv'), 'utf8');
const files = (path) => Object.fromEntries(readdirSync(path).map((name) => [name, readFileSync(join(path, name), 'utf8')]));
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const scratch = async (fn) => { const path = mkdtempSync(join(tmpdir(), 'lang-weave-curriculum-test-'));
  try { return await fn(path); } finally { rmSync(path, { recursive: true, force: true }); } };

test('fixture build is byte-identical, retains per-row provenance and never ships a candidate', async () => {
  await scratch(async (path) => {
    const a = join(path, 'a'), b = join(path, 'b');
    const first = await build({ out: a });
    await build({ out: b });
    expect(files(a)).toEqual(files(b));
    expect(first.rows).toHaveLength(2);
    expect(first.rows.find((row) => row.fr === 'el sombrero').anchors).toEqual(['hat', 'the hat']);
    expect(first.rows.every((row) => row.status === 'machine-checked' && /^[a-f0-9]{64}$/.test(row.row_hash) &&
      /^[a-f0-9]{64}$/.test(row.provenance.wiktextract_entry_sha256))).toBe(true);
    expect(hash(join(root, 'scripts/curriculum/fixtures/wiktextract.jsonl'))).toBe(sourcePins.fixture.wiktextract_sha256);
    expect(hash(join(root, 'scripts/curriculum/fixtures/examples.tsv'))).toBe(sourcePins.fixture.prepared_examples_sha256);
    for (const row of first.rows)
      expect(row.provenance.wiktextract_entry_sha256).toBe(sourcePins.fixture.entry_sha256[row.lemma]);
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

test('sentence join keys both IDs when one Spanish sentence has several translations', async () => {
  await scratch(async (path) => {
    const examples = join(path, 'examples.tsv');
    const fixture = readFileSync(join(root, 'scripts/curriculum/fixtures/examples.tsv'), 'utf8');
    writeFileSync(examples, fixture + '3767697\t9999\tElla usaba un sombrero negro.\tShe wore a black hat.\tIXTLA\tAnother\tCC BY 2.0 FR\n');
    const result = await build({ out: join(path, 'out'), examples });
    expect(result.rows.find((row) => row.fr === 'el sombrero').example.translation_id).toBe('2111');
  });
});

test('the twelve deterministic gate classes fail closed on bad candidates', async () => {
  const cases = [
    ['duplicate', (rows) => { rows[0].fr = 'el gato'; }, /duplicate target form/],
    ['accent-fold', (rows) => { rows[0].fr = 'el arbol'; }, /accent-fold collision/],
    ['article', (rows) => { rows[0].number = 'plural'; }, /article\/gender\/number rule/],
    ['english-collision', (_, table) => table.replace(/^el sombrero,([^,]+),([^,]+),[^,]+,/m, 'el sombrero,$1,$2,9.00,'), /common English word/],
    ['anchor', (rows) => { rows[0].anchors = ['dog']; }, /existing English anchor/],
    ['anchor', (rows) => { rows[0].anchors = ['the dog']; }, /existing English anchor/],
    ['anchor', (rows) => { rows[1].anchors = ['hat']; }, /shared English anchor/, 1],
    ['anchor', (rows) => { rows[1].anchors = ['the hat']; }, /shared English anchor/, 1],
    ['sense', (rows) => { rows[0].anchors = ['hat', 'zeppelin']; }, /unsupported by the English gloss/],
    ['anchor', (rows) => { rows[0].anchors = [' HAT ']; }, /noncanonical anchors/],
    ['anchor', (rows) => { rows[0].anchors = ['the  hat']; }, /noncanonical anchors/],
    ['article', (rows) => { rows[0].article_rule = 'none'; }, /article\/gender\/number rule/],
    ['hint', (rows) => { rows[0].hint = 'sombrero!'; }, /invalid hint/],
    ['band', (_, table) => table.replace(/^el sombrero,.*\n/m, ''), /missing frequency band/],
    ['sense', (rows) => { rows[0].sense = ''; }, /invalid or reserved characters in sense/],
    ['example', (rows) => { rows[0].example_id = '1604986'; }, /example sentence alignment/],
    ['function-word', (rows) => { rows[0].anchors = ['and']; }, /forbidden English anchor/],
    ['reserved', (rows) => { rows[0].en = 'the | hat'; }, /reserved characters/],
    ['reserved', (rows) => { rows[0].status = 'unknown'; }, /unknown review status/],
    ['number', (rows) => { rows[0].number = 'plural'; rows[0].fr = 'los sombreros'; rows[0].anchors = ['hat']; }, /plural English anchor/],
    ['number', (rows) => { rows[0].number = 'plural'; rows[0].fr = 'los vasos'; rows[0].en = 'glass'; rows[0].anchors = ['glass']; }, /plural English anchor/],
    ['article', (rows) => { rows[0].pos = 'verb'; }, /non-noun article rule/],
    ['duplicate', (rows) => { rows[1].id = rows[0].id; }, /duplicate overlay id/, 1],
    ['sense', (rows) => { rows[0].wiktextract_entry_sha256 = '0'.repeat(64); }, /Wiktextract lemma/],
  ];
  for (const [gate, mutate, pattern, index = 0] of cases) await scratch(async (path) => {
    const rows = structuredClone(original);
    const result = mutate(rows, bands);
    const overlay = join(path, 'overlay.json'), table = join(path, 'bands.csv');
    writeFileSync(overlay, JSON.stringify(rows));
    writeFileSync(table, result || bands);
    const rejected = await build({ out: join(path, 'out'), overlay, bands: table }).then(() => null, (error) => error);
    expect(rejected, gate).toBeInstanceOf(Error);
    expect(rejected.message).toMatch(pattern);
    expect(rejected.message).toContain(`gate ${gate}`);
    expect(rejected.message).toContain(`row ${createHash('sha256').update(JSON.stringify(rows[index])).digest('hex')}`);
  });
});

test('source-shaped sense, article, example, and English-collision fixtures fail at their own gates', async () => {
  const wikiLines = readFileSync(join(root, 'scripts/curriculum/fixtures/wiktextract.jsonl'), 'utf8').trimEnd().split('\n');
  const examplesText = readFileSync(join(root, 'scripts/curriculum/fixtures/examples.tsv'), 'utf8');
  const cases = [
    ['sense', { wiki: `${wikiLines[0]}\n${wikiLines[0]}\n${wikiLines[1]}\n` }, /multiple Wiktextract entries match/],
    ['sense', { wiki: `${JSON.stringify({ ...JSON.parse(wikiLines[0]), pos: 'verb' })}\n${wikiLines[1]}\n` }, /Wiktextract lemma, gender, POS or gloss missing/],
    ['sense', { wiki: `${JSON.stringify({ ...JSON.parse(wikiLines[0]), senses: [{ glosses: ['hat'], tags: ['feminine'] }] })}\n${wikiLines[1]}\n` }, /Wiktextract lemma, gender, POS or gloss missing/],
    ['example', { examples: examplesText.replace('IXTLA\tCK\tCC BY 2.0 FR', '\tCK\tCC BY 2.0 FR') }, /example sentence alignment failed/],
    ['example', { examples: examplesText.replace('IXTLA\tCK\tCC BY 2.0 FR', 'IXTLA\tCK\tunknown') }, /example sentence alignment failed/],
    ['english-collision', { bands: bands.replace(/^el sombrero,([^,]+),([^,]+),[^,]+,/m, 'el sombrero,$1,$2,9.00,') }, /common English word/],
  ];
  for (const [gate, source, pattern] of cases) await scratch(async (path) => {
    const paths = {};
    for (const [key, content] of Object.entries(source)) {
      paths[key] = join(path, key === 'wiki' ? 'wiki.jsonl' : key === 'examples' ? 'examples.tsv' : 'bands.csv');
      writeFileSync(paths[key], content);
    }
    const rejected = await build({ out: join(path, 'out'), ...paths }).then(() => null, (error) => error);
    expect(rejected?.message).toMatch(pattern);
    expect(rejected?.message).toContain(`gate ${gate} row ${createHash('sha256').update(JSON.stringify(original[0])).digest('hex')}`);
  });
  await scratch(async (path) => {
    const rows = structuredClone(original);
    rows[0].english_collision_approved = true;
    const overlay = join(path, 'overlay.json'), table = join(path, 'bands.csv');
    writeFileSync(overlay, JSON.stringify(rows));
    writeFileSync(table, bands.replace(/^el sombrero,([^,]+),([^,]+),[^,]+,/m, 'el sombrero,$1,$2,9.00,'));
    expect((await build({ out: join(path, 'out'), overlay, bands: table })).rows).toHaveLength(2);
  });
});

test('duplicate frequency rows fail closed before candidate admission', async () => {
  await scratch(async (path) => {
    const table = join(path, 'bands.csv');
    writeFileSync(table, bands + bands.split('\n').find((line) => line.startsWith('el sombrero,')) + '\n');
    await expect(build({ out: join(path, 'out'), bands: table })).rejects.toThrow(/duplicate wordfreq form: el sombrero/);
  });
});

test('a source-shaped irregular plural candidate passes the number gate and builds', async () => {
  await scratch(async (path) => {
    const rows = structuredClone(original);
    Object.assign(rows[0], { fr: 'los pies', en: 'the foot', anchors: ['feet', 'the feet'],
      lemma: 'pie', family_id: 'pie:noun:foot', number: 'plural' });
    const overlay = join(path, 'overlay.json'), table = join(path, 'bands.csv');
    const wiki = join(path, 'wiki.jsonl'), examples = join(path, 'examples.tsv');
    writeFileSync(overlay, JSON.stringify(rows));
    writeFileSync(table, bands + 'los pies,5.00,5.00,0.00,2\n');
    writeFileSync(wiki, `${JSON.stringify({ word: 'pie', lang_code: 'es', pos: 'noun',
      senses: [{ glosses: ['foot'], tags: ['masculine'] }] })}\n${readFileSync(join(root, 'scripts/curriculum/fixtures/wiktextract.jsonl'), 'utf8')}`);
    writeFileSync(examples, readFileSync(join(root, 'scripts/curriculum/fixtures/examples.tsv'), 'utf8')
      .replace('Ella usaba un sombrero negro.\tShe was wearing a black hat.', 'Sus pies tocaron el suelo frío.\tHer feet touched the cold ground.'));
    expect((await build({ out: join(path, 'out'), overlay, bands: table, wiki, examples })).rows
      .find((row) => row.fr === 'los pies')?.anchors).toEqual(['feet', 'the feet']);
  });
});

test('English anchor morphology accepts only regular or explicitly listed irregular surfaces', () => {
  const verb = { pos: 'verb', number: 'none' };
  const noun = { pos: 'noun', number: 'plural' };
  for (const [base, accepted, rejected, row] of [
    ['carry', ['carries', 'carrying', 'carried'], ['carrys', 'carryed'], verb],
    ['box', ['boxes', 'boxing', 'boxed'], ['boxs'], verb],
    ['run', ['runs', 'running'], ['runned', 'runing', 'ran'], verb],
    ['make', ['makes', 'making', 'made'], ['makeing', 'maked'], verb],
    ['stop', ['stops', 'stopping', 'stopped'], ['stoping', 'stoped'], verb],
    ['city', ['cities'], ['citys', 'cityes'], noun],
    ['box', ['boxes'], ['boxs'], noun],
    ['man', ['men'], ['mans'], noun],
    ['foot', ['feet'], ['foots'], noun],
    ['tomato', ['tomatoes'], ['tomatos'], noun],
    ['knife', ['knives'], ['knifes'], noun],
    ['panic', ['panics', 'panicking', 'panicked'], ['panicing', 'paniced'], verb],
    ['die', ['dies', 'dying', 'died'], ['diing'], verb],
    ['dye', ['dyes', 'dyeing', 'dyed'], ['dying'], verb],
    ['quiz', ['quizzes', 'quizzing', 'quizzed'], ['quizes', 'quizing', 'quized'], verb],
    ['put', ['puts', 'putting'], ['putted'], verb],
    ['know', ['knows', 'knowing', 'known'], ['knowed'], verb],
    ['buy', ['buys', 'buying', 'bought'], ['buyed'], verb],
    ['think', ['thinks', 'thinking', 'thought'], ['thinked'], verb],
    ['swim', ['swims', 'swimming', 'swum'], ['swimmed'], verb],
  ]) {
    expect(supportsAnchor(base, base, row)).toBe(true);
    for (const form of accepted) expect(supportsAnchor(base, form, row), `${base} -> ${form}`).toBe(true);
    for (const form of rejected) expect(supportsAnchor(base, form, row), `${base} -/-> ${form}`).toBe(false);
  }
  expect(isPluralSurface('feet')).toBe(true);
  expect(isPluralSurface('hat')).toBe(false);
  expect(isPluralSurface('glass')).toBe(false);
  expect(isPluralSurface('boxes')).toBe(true);
  expect(supportsAnchor('constructor', 'constructors', noun)).toBe(false);
  expect(supportsAnchor('ox', 'oxes', noun)).toBe(false);
  expect(supportsAnchor('stride', 'strided', verb)).toBe(false);
});

test('the build refuses malformed verb surfaces before source review', async () => {
  for (const [base, malformed] of [['carry', 'carrys'], ['carry', 'carryed'], ['box', 'boxs'],
    ['run', 'runned'], ['make', 'makeing'], ['stop', 'stoped'], ['panic', 'panicing'],
    ['die', 'diing'], ['quiz', 'quizes'], ['put', 'putted'], ['know', 'knowed'],
    ['buy', 'buyed'], ['think', 'thinked'], ['swim', 'swimmed']]) await scratch(async (path) => {
    const rows = structuredClone(original);
    Object.assign(rows[0], { fr: 'sombrero', en: base, anchors: [malformed], pos: 'verb',
      article_rule: 'none', number: 'none', gender: 'none' });
    const overlay = join(path, 'overlay.json'), table = join(path, 'bands.csv');
    writeFileSync(overlay, JSON.stringify(rows));
    writeFileSync(table, `${bands}sombrero,5.00,5.00,0.00,2\n`);
    const rejected = await build({ out: join(path, 'out'), overlay, bands: table }).then(() => null, (error) => error);
    const rowHash = createHash('sha256').update(JSON.stringify(rows[0])).digest('hex');
    expect(rejected?.message, `${base} -> ${malformed}`).toContain(`gate sense row ${rowHash}`);
    expect(rejected?.message).toContain('anchor is unsupported by the English gloss');
  });
});

test('candidate anchor colliding with a bundled legacy inflection is refused', async () => {
  await scratch(async (path) => {
    const rows = structuredClone(original);
    rows[0].en = 'likes';
    rows[0].anchors = ['likes'];
    const overlay = join(path, 'overlay.json');
    writeFileSync(overlay, JSON.stringify(rows));
    const rejected = await build({ out: join(path, 'out'), overlay }).then(() => null, (error) => error);
    const rowHash = createHash('sha256').update(JSON.stringify(rows[0])).digest('hex');
    expect(rejected?.message).toMatch(new RegExp(`gate anchor row ${rowHash}.*legacy overlap.*likes.*como`));
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
    writeFileSync(reviews, JSON.stringify([
      { reviewer_id: 'reviewer-a', date: '2026-10-31', row_hash: hash, verdict: 'approve' },
      { reviewer_id: 'reviewer-b', date: '2026-10-31', row_hash: hash, verdict: 'approve' },
      { reviewer_id: 'reviewer-c', date: '2026-10-31', row_hash: hash, verdict: 'reject' },
    ]));
    await expect(build({ out: join(path, 'rejected'), overlay, reviews })).rejects.toThrow(/unresolved native rejection/);
    writeFileSync(reviews, JSON.stringify([
      { reviewer_id: 'reviewer-a', date: '2026-10-31', row_hash: hash, verdict: 'approve' },
      { reviewer_id: 'reviewer-b', date: '2026-10-31', row_hash: hash, verdict: 'approve' },
    ]));
    rows[0].sense = 'sun hat';
    writeFileSync(overlay, JSON.stringify(rows));
    await expect(build({ out: join(path, 'changed'), overlay, reviews })).rejects.toThrow(/lacks two independent approvals/);
  });
});

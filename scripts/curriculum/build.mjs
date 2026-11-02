#!/usr/bin/env node
// Deterministic candidate generation. No network, clock, npm packages, or runtime writes.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { L2_WORDS } from '../../extension/src/vocabulary.js';
import { anchorCollisionKey, englishAnchors } from '../../extension/src/catalog.js';
import { assertPackAnchors, exactFr, glossMatches, legacyInflects, normalizeFr, MAX_PACK_ROWS } from '../../extension/src/levels.js';
import { isPluralSurface, supportsAnchor } from './english-inflections.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const sha = (value) => createHash('sha256').update(value).digest('hex');
async function fileSha(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const simple = (value) => String(value).normalize('NFC').toLowerCase().replace(/[’‘`]/g, "'").trim();
const bare = (fr) => fr.replace(/^(?:el|la|los|las) /, '');
const englishBases = (value) => String(value).split(/\s*[/;,]\s*/).map((part) => simple(part)
  .replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
  .flatMap((part) => [part, part.replace(/^(?:the|a|an|to) /, '')]);
const forbidden = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in', 'is', 'like',
  'no', 'of', 'on', 'or', 'so', 'the', 'to', 'with', 'yes']);
const badChars = /[<>|\r\n\t\u0000-\u001f]/u;
const wordToken = (word) => new RegExp(`(?<![\\p{L}\\p{N}_])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'giu');
const count = (text, word) => [...text.matchAll(wordToken(word))].length;

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function readTsv(path) {
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
  const header = lines.shift().split('\t');
  if (header.join('\t') !== 'es_id\ten_id\tes\ten\tes_author\ten_author\tlicence')
    throw Error('invalid Tatoeba table header');
  return lines.map((line) => {
    const cells = line.split('\t');
    if (cells.length !== header.length) throw Error(`invalid Tatoeba table row: ${line}`);
    return Object.fromEntries(cells.map((value, i) => [header[i], value]));
  });
}
function readBands(path) {
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
  if (lines.shift() !== 'fr,zipf_es,zipf_en,target_zipf_en,band') throw Error('invalid wordfreq table header');
  const bands = new Map();
  for (const line of lines) {
    const fields = line.split(',');
    const [fr, es, en, targetEn, band] = fields;
    if (fields.length !== 5 || !fr || !Number.isFinite(+es) || !Number.isFinite(+en) ||
        !Number.isFinite(+targetEn) || !Number.isInteger(+band))
      throw Error(`invalid wordfreq row: ${line}`);
    if (bands.has(fr)) throw Error(`duplicate wordfreq form: ${fr}`);
    bands.set(fr, { es: +es, en: +en, targetEn: +targetEn, band: +band });
  }
  return bands;
}
async function wikiRows(path, wanted) {
  const input = createReadStream(path);
  const stream = path.endsWith('.gz') ? input.pipe(createGunzip()) : input;
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const entries = new Map();
  for await (const line of lines) {
    if (!line || !/"lang_code"\s*:\s*"es"/.test(line)) continue;
    const data = JSON.parse(line);
    if (data.lang_code !== 'es' || !wanted.has(data.word)) continue;
    if (!entries.has(data.word)) entries.set(data.word, []);
    entries.get(data.word).push({ data, hash: sha(`${line}\n`) });
  }
  return entries;
}

export async function build({ wiki = join(HERE, 'fixtures/wiktextract.jsonl'),
  examples = join(HERE, 'fixtures/examples.tsv'), bands = join(ROOT, 'data/curriculum/es/wordfreq-bands.csv'),
  overlay = join(HERE, 'overlay.json'), reviews = join(HERE, 'reviews.json'), out } = {}) {
  if (!out) throw Error('--out is required; generated candidate rows never enter the extension payload automatically');
  const selected = readJson(overlay);
  if (!Array.isArray(selected) || !selected.length) throw Error('overlay must contain selected rows');
  if (L2_WORDS.length + selected.length > MAX_PACK_ROWS) throw Error(`combined Spanish pack exceeds ${MAX_PACK_ROWS} rows`);
  const frequencies = readBands(bands);
  const source = await wikiRows(wiki, new Set(selected.map((row) => row.lemma)));
  const sentences = new Map();
  for (const sentence of readTsv(examples)) {
    const key = `${sentence.es_id}:${sentence.en_id}`;
    if (sentences.has(key)) throw Error(`duplicate Tatoeba pair ${key}`);
    sentences.set(key, sentence);
  }
  const reviewRows = readJson(reviews);
  if (!Array.isArray(reviewRows)) throw Error('reviews must be an array');
  if (reviewRows.some((review) => typeof review.reviewer_id !== 'string' || !review.reviewer_id ||
    !/^[a-f0-9]{64}$/.test(review.row_hash) || !['approve', 'reject'].includes(review.verdict) ||
    !/^\d{4}-\d\d-\d\d$/.test(review.date))) throw Error('invalid native review record');
  const oldForms = new Set(L2_WORDS.map((word) => exactFr(word.fr)));
  const oldFolds = new Set(L2_WORDS.map((word) => normalizeFr(word.fr)));
  const oldAnchors = new Set(L2_WORDS.flatMap(englishAnchors).map(anchorCollisionKey));
  const newForms = new Set(), newFolds = new Set(), newAnchors = new Set(), ids = new Set();
  const rows = [];
  for (const row of selected) {
    const submittedHash = sha(JSON.stringify(row));
    const reject = (gate, message) => { throw Error(`gate ${gate} row ${submittedHash} (${row.id || '?'}): ${message}`); };
    const fieldGate = { hint: 'hint', sense: 'sense', article_rule: 'article' };
    // Twelve hard gates: exact duplicates, accent homographs, number, English collisions,
    // shared anchors, articles, hints, bands, sense, examples, function words, reserved chars.
    for (const field of ['fr', 'en', 'hint', 'sense', 'lemma', 'family_id', 'pos', 'form_tag', 'article_rule', 'id']) {
      if (typeof row[field] !== 'string' || !row[field] || badChars.test(row[field]) || row[field] !== row[field].normalize('NFC'))
        reject(fieldGate[field] || 'reserved',
          `invalid or reserved characters in ${field}`);
    }
    if (ids.has(row.id)) reject('duplicate', `duplicate overlay id ${row.id}`);
    ids.add(row.id);
    if (row.status && !['candidate', 'machine-checked', 'native-reviewed'].includes(row.status))
      reject('reserved', 'unknown review status');
    if (!Array.isArray(row.anchors) || !row.anchors.length || row.anchors.some((a) => typeof a !== 'string' ||
      !a || badChars.test(a) || a !== simple(a).replace(/\s+/g, ' '))) reject('anchor', 'invalid or noncanonical anchors');
    const form = exactFr(row.fr), fold = normalizeFr(row.fr);
    if (oldForms.has(form) || newForms.has(form)) reject('duplicate', `duplicate target form ${row.fr}`);
    if (oldFolds.has(fold) || newFolds.has(fold)) reject('accent-fold', `accent-fold collision ${row.fr}`);
    newForms.add(form); newFolds.add(fold);
    if (row.fr.length > 50 || row.en.length > 60 || row.hint.length > 60 || !/^[A-Za-z -]+$/.test(row.hint))
      reject('hint', 'invalid hint or runtime field length');
    if (!row.sense.trim() || row.sense.length > 120) reject('sense', 'missing or oversized sense note');
    if (row.pos === 'noun') {
      const article = row.number === 'plural' ? row.gender === 'm' ? 'los' : 'las' : row.gender === 'm' ? 'el' : 'la';
      if (!['m', 'f'].includes(row.gender) || !['singular', 'plural'].includes(row.number) ||
          row.article_rule !== 'def' || !row.fr.startsWith(`${article} `) || row.form_tag !== 'lemma')
        reject('article', 'noun article/gender/number rule failed');
      if (row.number === 'plural' && row.anchors.some((a) => !isPluralSurface(a)))
        reject('number', 'plural row lacks explicit plural English anchor');
    } else if (row.article_rule !== 'none' || row.number !== 'none' || row.gender !== 'none' || /^(?:el|la|los|las) /.test(row.fr)) {
      reject('article', 'non-noun article rule failed');
    }
    const frequency = frequencies.get(row.fr);
    if (!frequency || frequency.band < 1 || frequency.band > 20) reject('band', 'missing frequency band');
    if (frequency.targetEn >= 3.5 && !row.english_collision_approved)
      reject('english-collision', 'Spanish form collides with a common English word');
    const anchors = englishAnchors(row);
    if (anchors.some((anchor) => forbidden.has(anchor))) reject('function-word', 'forbidden English anchor');
    if (anchors.some((anchor) => oldAnchors.has(anchorCollisionKey(anchor)))) reject('anchor', 'existing English anchor');
    if (anchors.some((anchor) => newAnchors.has(anchorCollisionKey(anchor)))) reject('anchor', 'shared English anchor');
    for (const anchor of anchors) for (const old of L2_WORDS) {
      if (glossMatches(anchor, old.en, { inflections: legacyInflects(old) }))
        reject('anchor', `legacy overlap: anchor ${JSON.stringify(anchor)} is claimed by row ${old.fr}`);
    }
    for (const anchor of anchors) newAnchors.add(anchorCollisionKey(anchor));
    const glossBases = englishBases(row.en);
    if (!anchors.every((anchor) => glossBases.some((base) => supportsAnchor(base, anchor, row))))
      reject('sense', 'anchor is unsupported by the English gloss');
    const sourceEntries = (source.get(row.lemma) || []).filter((entry) => entry.data.pos === row.pos &&
      entry.data.senses?.some((sense) => {
        const bases = (sense.glosses || []).flatMap(englishBases);
        return anchors.every((anchor) => bases.some((base) => supportsAnchor(base, anchor, row))) &&
          (row.pos !== 'noun' || (sense.tags || []).includes(row.gender === 'm' ? 'masculine' : 'feminine'));
      }));
    if (sourceEntries.length > 1 && !row.wiktextract_entry_sha256)
      reject('sense', 'multiple Wiktextract entries match; pin one entry hash in the overlay');
    const sourceEntry = row.wiktextract_entry_sha256 ? sourceEntries.find((entry) => entry.hash === row.wiktextract_entry_sha256) : sourceEntries[0];
    if (!sourceEntry)
      reject('sense', 'Wiktextract lemma, gender, POS or gloss missing');
    const example = sentences.get(`${row.example_id}:${row.translation_id}`);
    if (!example || example.en_id !== row.translation_id || !example.es_author || !example.en_author ||
        !['CC0', 'CC BY 2.0 FR'].includes(example.licence) ||
        count(example.es, bare(row.fr)) !== 1 || !anchors.some((anchor) => count(example.en, anchor) === 1) ||
        example.es.split(/\s+/).length < 4 || example.es.split(/\s+/).length > 14)
      reject('example', 'example sentence alignment failed');
    const blank = example.es.replace(wordToken(bare(row.fr)), '____');
    const core = { fr: row.fr, en: row.en, hint: row.hint, anchors, sense: row.sense, lemma: row.lemma,
      family_id: row.family_id, pos: row.pos, gender: row.gender, number: row.number, form_tag: row.form_tag,
      article_rule: row.article_rule, band: frequency.band,
      example: { blank, en: example.en, source_id: example.es_id, translation_id: example.en_id,
        licence: example.licence, author: example.es_author, translation_author: example.en_author } };
    const rowHash = sha(JSON.stringify(core));
    const approvals = reviewRows.filter((review) => review.row_hash === rowHash && review.verdict === 'approve');
    const rejected = reviewRows.some((review) => review.row_hash === rowHash && review.verdict === 'reject');
    if (row.status === 'native-reviewed' && rejected)
      throw Error(`${row.id}: unresolved native rejection for row hash ${rowHash}`);
    if (row.status === 'native-reviewed' && new Set(approvals.map((review) => review.reviewer_id)).size < 2)
      throw Error(`${row.id}: native-reviewed status lacks two independent approvals for row hash ${rowHash}`);
    rows.push({ ...core, row_hash: rowHash, status: row.status === 'native-reviewed' ? 'native-reviewed' : 'machine-checked',
      provenance: { overlay_id: row.id, wiktextract_entry_sha256: sourceEntry.hash,
        wiktextract_word: row.lemma, tatoeba_es_id: example.es_id, tatoeba_en_id: example.en_id,
        wordfreq_version: '3.1.1' } });
  }
  assertPackAnchors(rows);
  rows.sort((a, b) => a.band - b.band || (a.fr < b.fr ? -1 : a.fr > b.fr ? 1 : 0));
  const inputHashes = Object.fromEntries(await Promise.all([['wiktextract', wiki], ['examples', examples], ['bands', bands],
    ['overlay', overlay], ['reviews', reviews]].map(async ([name, path]) => [name, await fileSha(path)])));
  const manifest = { schema: 1, count: rows.length, shipped: false, input_sha256: inputHashes,
    row_hashes: rows.map(({ fr, row_hash }) => ({ fr, row_hash })) };
  const licences = { code: 'AGPL-3.0-or-later', candidate_data: 'CC BY-SA 4.0 (proposed; ruling pending)',
    sources: { wordfreq: 'Robyn Speer; underlying data CC BY-SA 4.0', wiktionary: 'CC BY-SA 4.0',
      tatoeba: 'CC BY 2.0 FR; sentence authors in pack examples' } };
  const notice = `# Candidate curriculum data — not shipped\n\nSource: English Wiktionary via Wiktextract (CC BY-SA 4.0); wordfreq 3.1.1 by Robyn Speer (underlying data CC BY-SA 4.0); Tatoeba examples (CC BY 2.0 France, authors and IDs in pack). Data licence posture awaits curriculum-data-licence-ruling. No row is approved for release without a review record tied to its row hash.\n`;
  mkdirSync(out, { recursive: true });
  for (const [name, value] of [['band-01.json', json(rows)], ['MANIFEST.json', json(manifest)],
    ['LICENCES.json', json(licences)], ['NOTICE-DATA.md', notice]]) writeFileSync(join(out, name), value);
  return { rows, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (!['out', 'wiki', 'examples', 'bands', 'overlay', 'reviews'].includes(key) || !args[i + 1])
      throw Error(`unknown or incomplete argument ${args[i]}`);
    options[key] = resolve(args[i + 1]);
  }
  build(options).then(({ rows }) => console.log(`Built ${rows.length} candidate rows in ${options.out}`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

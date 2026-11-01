#!/usr/bin/env node
// Deliberate, networked source step. Never invoked by tests or package.mjs.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = JSON.parse(readFileSync(resolve(HERE, '../../data/curriculum/es/SOURCES.json')));
const overlay = JSON.parse(readFileSync(join(HERE, 'overlay.json')));
const shaFile = async (path) => { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); };

async function download(source, out) {
  if (!/^[a-f0-9]{64}$/.test(source.sha256) || !source.url.startsWith('https://'))
    throw Error(`unverified source pin: ${source.file}`);
  const path = join(out, source.file);
  if (existsSync(path) && await shaFile(path) === source.sha256) return;
  const part = `${path}.part`;
  if (existsSync(part)) throw Error(`owned partial download already exists: ${part}; inspect it before retrying`);
  const response = await fetch(source.url);
  if (!response.ok || !response.body) throw Error(`${source.url}: HTTP ${response.status}`);
  const hash = createHash('sha256');
  try {
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _, done) { hash.update(chunk); done(null, chunk); } }),
      createWriteStream(part, { flags: 'wx' }));
    const actual = hash.digest('hex');
    if (actual !== source.sha256) throw Error(`${source.file}: SHA-256 mismatch; expected ${source.sha256}, received ${actual}`);
    renameSync(part, path);
  } catch (error) { rmSync(part, { force: true }); throw error; }
}

// Tatoeba publishes bzip2 only. bzip2 is the sole external development tool;
// the generator itself remains Node standard library only and reads this compact join.
async function bzRows(path, filter, callback) {
  const child = spawn('bzip2', ['-dc', path], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let spawnError;
  child.once('error', (error) => { spawnError = error; });
  const closed = new Promise((done) => child.once('close', done));
  child.stderr.on('data', (data) => { stderr += data; });
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    const cells = line.split('\t');
    if (filter(cells)) callback(cells);
  }
  const code = await closed;
  if (spawnError) throw Error(`cannot start bzip2 for ${path}: ${spawnError.message}`);
  if (code !== 0) throw Error(`bzip2 failed on ${path}: ${stderr}`);
}

async function prepareExamples(out) {
  const esIds = new Set(overlay.map((row) => row.example_id));
  const enIds = new Set(overlay.map((row) => row.translation_id));
  const es = new Map(), en = new Map(), links = new Set(), esCc0 = new Set(), enCc0 = new Set();
  await bzRows(join(out, 'spa_sentences_detailed.tsv.bz2'), (cells) => esIds.has(cells[0]), (cells) => es.set(cells[0], cells));
  await bzRows(join(out, 'eng_sentences_detailed.tsv.bz2'), (cells) => enIds.has(cells[0]), (cells) => en.set(cells[0], cells));
  await bzRows(join(out, 'eng-spa_links.tsv.bz2'), (cells) => enIds.has(cells[0]) && esIds.has(cells[1]),
    (cells) => links.add(`${cells[0]}:${cells[1]}`));
  await bzRows(join(out, 'spa_sentences_CC0.tsv.bz2'), (cells) => esIds.has(cells[0]), (cells) => esCc0.add(cells[0]));
  await bzRows(join(out, 'eng_sentences_CC0.tsv.bz2'), (cells) => enIds.has(cells[0]), (cells) => enCc0.add(cells[0]));
  const header = 'es_id\ten_id\tes\ten\tes_author\ten_author\tlicence\n';
  const lines = overlay.map((row) => {
    const a = es.get(row.example_id), b = en.get(row.translation_id);
    if (!a || !b || !links.has(`${row.translation_id}:${row.example_id}`))
      throw Error(`Tatoeba pair ${row.example_id}:${row.translation_id} is absent from the pinned export`);
    const fields = [row.example_id, row.translation_id, a[2], b[2], a[3], b[3],
      esCc0.has(row.example_id) && enCc0.has(row.translation_id) ? 'CC0' : 'CC BY 2.0 FR'];
    if (fields.some((value) => !value || value === '\\N' || /[\t\r\n]/.test(value)))
      throw Error(`invalid Tatoeba fields for ${row.id}`);
    return fields.join('\t');
  });
  writeFileSync(join(out, 'examples.tsv'), header + lines.join('\n') + '\n');
}

const out = process.argv[2] ? resolve(process.argv[2]) : resolve(HERE, '../../.curriculum-inputs');
if (process.argv.length > 3) throw Error('usage: node scripts/curriculum/fetch.mjs [owned-output-directory]');
mkdirSync(out, { recursive: true });
for (const source of [SOURCES.wiktextract, SOURCES.wordfreq, ...SOURCES.tatoeba.files]) {
  console.log(`Verifying ${source.file}`);
  await download(source, out);
}
await prepareExamples(out);
console.log(`Verified pinned archives and prepared ${join(out, 'examples.tsv')}`);

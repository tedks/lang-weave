# Spanish curriculum candidate pipeline

This pipeline produces **candidate data only**. Its output is outside `extension/`, and `extension/scripts/package.mjs` does not include it. The shipped Beginner 30 and Expanded 226 retain their exact target forms, English glosses, hints and order. Each has only a new coarse `band` number. No new vocabulary row is shipped or represented as native reviewed. The data licence and reviewer sourcing decision remains open in `curriculum-data-licence-ruling`.

## Inputs and source pins

`scripts/curriculum/build.mjs` uses Node standard library modules and project source modules only. It never uses the network. This choice keeps the normal build on the extension's existing Node toolchain and avoids a runtime dependency. Fixture inputs are two actual Wiktextract JSONL rows from the English-edition Spanish pages for `sombrero` and `nube`, a two-pair Tatoeba sample, the committed `overlay.json`, empty `reviews.json`, and `data/curriculum/es/wordfreq-bands.csv`. The fixture Wiktextract pages are postprocessed small examples of the JSONL shape; production uses the raw English-edition export. The fixture Tatoeba pairs are Spanish IDs 3767697/1604986 linked to English IDs 2111/18309, from the 2026-10-31 detailed and link exports. Sentence authors and CC BY 2.0 France status stay with the rows. The sample is evidence for the pipeline gates, not a language-quality acceptance.

`data/curriculum/es/SOURCES.json` pins URLs and SHA-256 digests for the raw English Wiktextract archive (2026-10-01 English Wiktionary dump, 2026-10-30 extraction, revision 19f9a30), wordfreq 3.1.1 wheel, and the 2026-10-31 Tatoeba detailed, link and CC0 exports. The Wiktextract and Tatoeba URLs are updated in place by their publishers. SHA-256 makes a changed export fail closed, but long-term availability of these exact bytes requires an archive mirror. No multi-megabyte source dump is committed. The inherited `data/lexicons/spanish.csv` was inspected for context; `data/profiles/spanish.json` named in the dispatch does not exist in this checkout and is not a pipeline input.

The wordfreq table was made once from the SHA-verified 3.1.1 wheel (`4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473`). It stores two-decimal Spanish and English Zipf values, the Spanish form's English Zipf collision proxy, and a coarse band. To regenerate deliberately:

```bash
python3 -m venv /tmp/lang-weave-wordfreq-owned
/tmp/lang-weave-wordfreq-owned/bin/pip download --no-deps wordfreq==3.1.1 -d /tmp/lang-weave-wordfreq-owned
sha256sum /tmp/lang-weave-wordfreq-owned/wordfreq-3.1.1-py3-none-any.whl # compare with SOURCES.json
/tmp/lang-weave-wordfreq-owned/bin/pip install /tmp/lang-weave-wordfreq-owned/wordfreq-3.1.1-py3-none-any.whl
node --input-type=module -e "import {L2_WORDS} from './extension/src/vocabulary.js'; import {readFileSync} from 'node:fs'; const overlay=JSON.parse(readFileSync('scripts/curriculum/overlay.json')); process.stdout.write(JSON.stringify([...L2_WORDS,...overlay].map(({fr,en})=>({fr,en}))))" | /tmp/lang-weave-wordfreq-owned/bin/python scripts/curriculum/generate-wordfreq-table.py > data/curriculum/es/wordfreq-bands.csv
```

The first 30 rows are forced to band 0. Later rows use the lower of Spanish and English Zipf: at least 5.5 → band 1, 4.5 → 2, 3.5 → 3, otherwise 4. The input wheel remains outside the repo; `build.mjs` reads only the committed table. The research report's rank-derived-data licence question remains for Ted.

## Fetch, build, verify

From the worktree root, with Node and the system `bzip2` command available:

```bash
node scripts/curriculum/fetch.mjs .curriculum-inputs
node scripts/curriculum/build.mjs --wiki .curriculum-inputs/raw-wiktextract-data.jsonl.gz --examples .curriculum-inputs/examples.tsv --out .curriculum-inputs/candidate-out
node scripts/curriculum/build.mjs --out .curriculum-inputs/fixture-out
cd extension && nix shell nixpkgs#bun --command bun test test/curriculum-pipeline.test.js test/curriculum-benchmark.test.js
```

`fetch.mjs` verifies each entire archive against `SOURCES.json` before it becomes a local input. It joins only the Tatoeba sentence IDs named in `overlay.json` and verifies that each English/Spanish pair appears in the pinned link export. It marks a pair CC0 only when both sentences are in the pinned CC0 exports; otherwise it retains both author IDs under CC BY 2.0 France. The full raw Wiktextract scan is intentionally a large, explicit operator step. Tests use the small committed fixture and make no network calls.

`build.mjs` writes `band-01.json` (the `{fr,en,hint}` shipped shape plus candidate metadata), `MANIFEST.json` (input digests and row hashes), `LICENCES.json`, and `NOTICE-DATA.md` into the requested directory. Every row carries a content SHA-256 and provenance (overlay ID, Wiktextract entry hash, Tatoeba pair IDs and wordfreq version). Running the fixture build twice produces byte-identical files in a Bun test. The manifest says `shipped: false`. There is no import path from this output into the extension package.

## Admission and review

The build fails on duplicate target forms; accent-fold homographs including `si`/`sí`; bad singular/plural article or anchor rules; common English-colliding Spanish forms without an explicit override; English anchors already in the 226 or shared by candidates; missing article, hint, frequency band or sense note; a sentence where the target or English anchor does not appear exactly once; forbidden function-word anchors; and reserved characters. It also checks the selected Wiktextract POS, gloss and noun gender, and verifies Tatoeba author, ID and licence data. These deterministic checks are stricter than linguistic review. The existing 226 have two legacy shared English anchors (`only` and `free`); candidate admission rejects any new reuse while leaving those original rows intact. The runtime catalog uses explicit candidate `anchors` when present, and the validator does not invent verb forms through English suffix stemming on those rows.

`reviews.json` is an empty committed review ledger. A future reviewer records a pseudonymous reviewer ID, `row_hash`, date and verdict after examining the exact generated row. The builder will label a row `native-reviewed` only when two distinct reviewers approve that exact hash. A changed sense, hint, anchor, example or band changes the hash and invalidates those approvals. No current row has such approvals. Reviewer sourcing, rubric and the first band's release remain open product decisions.

## Runtime ordering and measured ceiling

Due, difficult, active and owned reservations keep their existing priority. Among otherwise new candidates, lower `band` now precedes the existing cognate, encounter, BASIC, match-length and ID ties. The 30 Beginner rows are all band 0, and a test compares their full eligible gradual order with and without bands; it is identical. In the existing representative passage test, the four fresh candidates were previously `la historia, el pueblo, hoy, y`; bands make them `hoy, y, la historia, el pueblo`. The prompt content and ordinary-mode list order do not change.

The Bun benchmark uses synthetic packs of 500, 1,000 and 3,000 unique rows, a 60-word passage, median of seven timed runs after three warmups. Initial observed milliseconds on this host (Bun 1.4.2):

| Rows | `matchingEntries` | adaptive selection | prompt construction | pack admission + level matching |
|---:|---:|---:|---:|---:|
| 500 | 0.43 | 0.79 | 0.05 | 0.40 |
| 1,000 | 1.01 | 1.14 | 0.07 | 0.60 |
| 3,000 | 28.78 | 10.50 | 0.23 | 2.00 |

The test permits 100 ms matching at 500/1,000, 300 ms at 3,000 and 500 ms for the other operations. It reports actual timings on each run; these are local measurements, not a universal browser service-worker guarantee. `MAX_PACK_ROWS` is 3,000 for candidate admission. The extension still ships 226 rows; no 3,000-row ordinary prompt or live Gemini quality/cost claim is made.

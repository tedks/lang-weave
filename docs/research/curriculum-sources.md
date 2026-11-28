# Growing the Spanish pack: sources, licences, pipeline, validation

Research lane for `curriculum-growth` (M4). Checked 2026-10-31 against checkout `i18n-lang` (HEAD 5f376ed). No project code was changed. Licence reading is engineering diligence, not legal advice. Anything I could not fetch is marked **[unverified]**.

## 1. Recommendation in brief

- **Ranking**: wordfreq 3.1.1 Spanish and English lists, used at build time only.
- **Forms, lemmas, glosses, gender, IPA**: Wiktextract extracts of the English Wiktionary, from the official raw dump, not the deprecated postprocessed file.
- **Example sentences**: Tatoeba, preferring its CC0 subset.
- **Posture**: ship the generated data as its own file under CC BY-SA 4.0 with generated notices. Keep all code AGPL-3.0-or-later. Do not inline the data in JavaScript.
- **Pipeline**: one script from pinned inputs plus a committed curation overlay. Humans edit decisions as data, never the output.
- **Validation**: deterministic gates, then independent corpus evidence, then double native review of the first band and sampled review afterwards. Models only triage.
- **First band**: 300 new rows after a 50-row pilot, released only when reviewed.

## 2. What the code requires

- **Row shape**: `{fr, en, hint}`, one exact Spanish surface form per row, articles inside `fr` for nouns. Validation accepts only listed exact forms; only a short AMBIGUOUS_FOLDS list blocks accent-folded matches.
- **Retrieval** (`catalog.js`) matches exact English anchors (the `en` gloss split on `/ ; ,`). No inflection handling: "speaks" never retrieves an anchor "speak". A shared anchor disables both owners ("cannot choose a sense"), so anchors must be unique pack-wide.
- **Working set** (`adaptive.js`): 32 candidates, 3,000 vocabulary characters, 4 fresh words per call, `BACKLOG_THROTTLE = 5`, `newWordsPerDay` 5. This decouples catalog size from prompt size in gradual mode. Ordinary mode still lists the whole level, and tests cap the pack at 240 entries.
- **New-word ordering has no frequency term**: due, owned, cognate, encounters, BASIC, match length, then entry ID (alphabetical). At 3,000 rows rare words would be introduced before core ones. A `band` field must enter the sort.
- **`cognate()`** tests the first four letters plus 70% length overlap. It misses ción/tion and dad/ty and would accept false friends.
- The 226 existing rows are hash-pinned. New data appends only.

## 3. Sources and exact licences

### 3.1 wordfreq 3.1.1 (frequency ranking) — usable, with attribution
- Source: https://github.com/rspeer/wordfreq/blob/master/NOTICE.md (fetched).
- Verbatim: "`wordfreq` is freely redistributable under the Apache license (see `LICENSE.txt`), and it includes data files that may be redistributed under a Creative Commons Attribution-ShareAlike 4.0 license."
- Verbatim: "Robyn Speer must be credited as Robyn Speer ... Crediting Robyn Speer by a different name than one of the above is a serious violation of the license."
- Spanish draws on Wikipedia, OpenSubtitles 2018, NewsCrawl and GlobalVoices, Google Books, OSCAR web text, Twitter and Reddit (README source table). The NOTICE says OpenSubtitles "may be used with attribution" and carries Google Books terms. The wheel I installed has sha256 `4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473`.
- The data is frozen at about 2021 (SUNSET.md). That is useful: it predates large-model web slop.
- **Posture**: use at build time. Ship only a coarse band number, never raw Zipf values or full ranks, as the 226-word slice did. Credit stays in NOTICE regardless. Whether a rank-derived band is an "Adaptation" is a legal question I cannot settle, so label the data file BY-SA anyway (section 4).

### 3.2 Wiktionary and Wikcionario (glosses, forms, IPA) — usable under CC BY-SA 4.0
- Source: https://en.wiktionary.org/wiki/Wiktionary:Copyrights (fetched).
- Verbatim: "The original texts of Wiktionary entries are dual-licensed to the public under both the Creative Commons Attribution-ShareAlike 4.0 International License (CC-BY-SA) and the GNU Free Documentation License (GFDL)." We take the CC BY-SA option.
- Same page: "Individual words are not copyrightable... Using a definition from a copyright dictionary may infringe on copyrights." Short glosses are thin, but selection and arrangement of many is not, so provenance matters.
- **Use the English edition** (English glosses). Spanish Wikcionary glosses are Spanish and are not a drop-in English source. Its licence page was not fetched **[unverified]**.

### 3.3 Kaikki.org / Wiktextract — the extraction route
- Wiktextract code is MIT ("Certain files have different open source licenses"). Extracted data inherits Wiktionary's licence; kaikki.org states no separate data licence on the pages I fetched (its own wording **[unverified]**).
- Use the official raw English-edition JSONL (2.9 GB gzip, all languages, per the earlier audit). Filter once to `lang_code == "es"` and pin dump date and digest. Do not bulk-scrape per-word pages. The postprocessed Spanish file is deprecated and merges sources.
- Sample `casa`: noun, feminine, plural `casas`, gloss "house", IPA `/ˈkasa/` without dialect tag; the verb entry is a form-of `casar`. Lemma links are machine-readable, dialect IPA is not guaranteed.

### 3.4 FreeDict — not needed; optional cross-check only
- `eng-spa` 2025.11.23 (64,258 headwords) is CC BY-SA 3.0 per the private audit's header reading, built by WikDict from Wiktionary via DBnary. BY-SA 3.0 allows adaptations under "a later version of this License with the same License Elements" (verified in the 3.0 legalcode), so 3.0 rows could sit in a 4.0 dataset. It is not independent of Wiktionary, though.
- `spa-eng` 0.3.1 (4,502 headwords) is GPL-2.0-or-later, from Ergane/Travlang, with no part of speech. Too small and weak. GPLv2-or-later can be used under GPLv3 and AGPLv3 section 13 allows combining with GPLv3, but there is no reason to take the friction.
- Do not copy FreeDict rows. A build-time comparison that copies nothing carries no licence duty.

### 3.5 Other frequency lists
- **Routledge "Frequency Dictionary of Spanish" (Davies)**: copyrighted book. **Not usable**; do not copy its list or glosses.
- **Hermit Dave FrequencyWords** (`es_50k`, 2018): README says "MIT License for code. CC-by-sa-4.0 for content." It derives from OpenSubtitles2018, which wordfreq already includes, keeps names (rachel, dean, antonio sit in the top 3,000 lines I sampled) and mixes Spain and Latin America. Use only as a rank-correlation check; do not redistribute.
- **CREA / CORPES (RAE)**: rae.es returned HTTP 403 to automated fetch, so terms are **[unverified]**. Do not use; a human spot-check only.
- **Leipzig Corpora**: terms page sat behind a proof-of-work gate. A third-party table says CC BY 4.0 **[unverified]**. Possible independent cross-check once read by hand.
- **SUBTLEX-ESP**: no licence found; treat as all rights reserved.

### 3.6 Tatoeba (example sentences) — usable, CC0 subset preferred
- Terms (https://tatoeba.org/en/terms_of_use, fetched): "Tatoeba's technical infrastructure uses the default Creative Commons Attribution 2.0 France license (CC-BY 2.0 FR) ... using, reusing, modifying and distributing the sentence is only allowed if the name of the author is cited."
- Downloads page: "These files are released under CC BY 2.0 FR. ... A part of our sentences are also available under CC0 1.0." Per-language `*_sentences_CC0.tsv.bz2` exists.
- `user_languages` is "self-reported skill levels", so it is a weak signal, not certification.
- **Posture**: take sentences from the CC0 subset first (no author table). Fall back to CC BY 2.0 FR with a generated attribution file keyed by sentence ID. The size of the Spanish CC0 subset is unmeasured. Measure it in the pilot.

## 4. Licence posture for an AGPL extension on the Chrome Web Store

1. **Code stays AGPL-3.0-or-later.** NOTICE already says the MIT portions and wordfreq credit are preserved.
2. **The data is a separate work.** The CC FAQ says collections are allowed: "You may choose a license for the collection, however this does not change the license applicable to the original material."
3. **Label the generated data CC BY-SA 4.0.** CC's compatibility page lists the only permitted adapter licences for BY-SA 4.0 material: BY-SA 4.0 or later, the Free Art License 1.3, and GPLv3 ("compatibility with the GPLv3 is one-way only"). **AGPLv3 is not on that list.** Do not relicense the data under AGPL, and do not inline it into `vocabulary.js`, which would make a mixed-licence file.
4. **Attribution (BY-SA 4.0 §3(a)(1))** requires creator identification, a copyright notice, a licence notice, a URI to the material, "indicate if You modified the Licensed Material", and a licence link. A link satisfies it "in any reasonable manner". Ship a generated `NOTICE-DATA.md`, an in-extension "Open source notices" page, and the same text in the Store listing's source link.
5. **Share-alike scope.** §3(b)(3): "You may not offer or impose any additional or different terms or conditions on, or apply any Effective Technological Measures to, Adapted Material that restrict exercise of the rights granted." So the data file must stay readable and unobfuscated in the package. Minifying is fine, encryption is not.
6. **Consistency with the roadmap.** M5 says "Never sell vocabulary packs." A BY-SA data file fits that.
7. **Chrome Web Store.** I know of no rule against copyleft data if notices ship; the Store's IP and attribution policy pages were not fetched **[unverified]**. Name the data sources in the listing.
8. **Get one human legal read** before first public release of the data file. The open question (is a rank band an Adaptation) is real and cheap to settle.

## 5. Word families, headwords and forms

The extension matches English anchors and validates one exact Spanish form per row. So a "family" is a build-time grouping, and a "row" is one teachable surface form.

- `family_id` = Wiktionary lemma plus part of speech plus sense index. Each row stores `lemma`, `form_tag` and `family_id`. Rows of one family share a `family_id` but have distinct, unique English anchors.
- **Nouns**: singular with article (existing convention) first. A plural row ("los libros", anchor "books") is a later, separate row, because the validator rejects a plural English anchor mapped to a singular Spanish noun. Flag stressed-a feminines (`el agua`) as `article_rule: special` and exclude them early.
- **Adjectives**: epicene first (grande, fuerte, fácil, feliz, importante), because English never marks gender and a masculine swap beside an unswapped feminine noun is wrong. The 226 already contain masculine-only forms such as bueno and nuevo, which `spanish-curriculum-review` mentions. Gender-variable adjectives wait for a row family with `agr` tags plus a context check, or are excluded.
- **Verbs**: infinitive, third-person singular present, gerund and participle only. Preterite and other person-bound forms are wrong for most English subjects ("they spoke" to "they habló"), and no deterministic check exists. Irregular high-frequency verbs stay as fixed chunks, as `hay` and `creo que` already do.
- **Function words**: exclude bare prepositions and clitics (de, a, en, que, se, lo). They are polysemous and hold most top-100 mass. Keep only fixed phrases.
- **English anchors must list surface forms.** Retrieval is exact, so a verb row needs "speak / speaks / speaking" as explicit anchors. This also needs a code change so the validator's suffix-stemming does not turn "speaking" into the infinitive. Put that in the CTO's integration list.
- **Rank on both sides.** The swap triggers on English text, so score each row by a combination of Spanish and English Zipf (for example, the lower of the two). Drop rows whose Spanish form is much rarer than its English anchor (gap above 1.5 Zipf): that usually means a rare sense was picked for a common English word.

Measured with wordfreq 3.1.1 (large list, my script, scratch only):

| Spanish forms covered | Share of running tokens |
|---|---|
| top 1,000 | 69% |
| top 3,000 | 79% |
| top 10,000 | 88% |

The current pack's 208 single-token forms are all within the top 11,000, with a median rank of about 560. Together they cover about 18% of Spanish tokens. 866 of the top 1,000 forms are still missing. The 2 to 3k target is therefore sound, but these are forms not families, and the family count needs the Wiktextract join to measure (pipeline step 0).

## 6. Pack fields

Keep `fr`, `en`, `hint` byte-compatible and add the rest in a generated JSON file: `anchors` (explicit English surface forms, unique pack-wide), `sense` (short disambiguating note), `lemma`, `family_id`, `pos`, `gender`, `number`, `form_tag`, `article_rule` (`def`, `none`, `special`, `plural`), `band`, coarse `rank_es` and `rank_en`, `cognate` (`true`, `false`, `false_friend`), `example` (`blank`, `en`, `source_id`, `licence`, `author`), `provenance` (pinned versions, Wiktextract entry hash, overlay row ID) and `status` (`candidate`, `machine-checked`, `native-reviewed`, `rejected`, plus review record hash).

- **Hint**: Spanish orthography is nearly phonemic, so generate the respelling by rule (syllabify, stress in capitals, v as b, ll as y, z/c as s, j as h, qu as k, ñ as ny; seseo, so it leans Latin American like the current hints). Check stress against Wiktionary IPA. Loanwords go in the overlay.
- **Cognate**: replace the four-letter test with accent-stripped similarity after known suffix maps (ción to tion, dad to ty, oso to ous, mente to ly) plus a shared Latin or Greek root from Wiktionary etymology. Subtract a committed, cited **false-friend list** (actual, embarazada, sensible, éxito, carpeta, librería, asistir, constipado) so false friends are never marked guessable.
- **Regional lean**: drop senses tagged Spain-only, vulgar, offensive, slang, dated or obsolete. Keep a committed list of regionally risky lemmas (for example `coger`) that always go to review, and prefer the Latin American term when both are tagged.

## 7. Reproducible generation pipeline

Inputs are pinned in `data/curriculum/es/SOURCES.json` with version and digest: wordfreq wheel sha256, the Wiktextract English-edition dump date and digest, Wiktextract revision, the Tatoeba export date and digest, plus the overlay file and the false-friend list.

0. **Spike** (bounded): download the raw dump once, filter to Spanish, and measure the form-to-lemma ratio in the top 3,000 forms. This tells us the real family count.
1. **Candidates**: top 12,000 wordfreq Spanish forms. Join to Wiktextract. Drop proper nouns, form-of entries for non-target forms, misspellings (wordfreq contains `tambien`, `fué`, `éste`), and rows with unwanted tags.
2. **Families and rows**: emit rows by the part-of-speech rules in section 5.
3. **Anchors**: take the cleaned first gloss (strip parentheticals), prefer the highest English Zipf, cap at two anchors, then expand to English surface forms from Wiktextract English forms. The overlay can override with a recorded reason.
4. **Hint, cognate, article rule** by rule.
5. **Bands**: sort by combined score and cut into 300-row bands. Never reorder an earlier band.
6. **Examples**: Tatoeba pairs where the Spanish contains the form as a whole token once, is 4 to 14 tokens, has at least 95% of other tokens inside the current and lower bands, and has an English translation. Mask the form to make the blank.
7. **Gates** (section 8A). The script fails on any hard failure.
8. **Emit** `data/curriculum/es/band-NN.json`, `MANIFEST.json` (counts, digests, per-row source IDs) and `NOTICE-DATA.md`.

**Where human judgment enters.** Only through committed, reviewable data: `overlay.csv` (include, exclude, replace anchor, reason, reviewer ID, date) and `reviews/*.csv`. The generator is deterministic. Running it twice must give a byte-identical output; add that as a test. Any later change to a row's content changes its content hash and **invalidates its review**, so a `native-reviewed` status is always tied to exactly what the reviewer saw.

**Cost and size.** About 3,000 rows is under 1 MB. Measure service-worker parse time and the per-batch cost of `matchingEntries`, which builds one regular expression per anchor; a pre-built token index is the fix if it exceeds a budget such as 50 ms.

## 8. Validation plan

### A. Deterministic gates (hard fail)
1. No duplicate exact `fr` and no duplicate normalized anchor pack-wide, including the 226.
2. **Accent-fold collisions.** The top 3,000 forms hold 59 groups and the top 5,000 hold 112 (de/dé, el/él, si/sí, mi/mí, te/té, tu/tú, este/esté/éste, esta/está). Both members get exact-only matching and review. Regenerate AMBIGUOUS_FOLDS from this check instead of maintaining it by hand.
3. Singular and plural rows have distinct anchors; a plural anchor never maps to a singular noun.
4. **Spanish form equals a common English word.** A noisy proxy (English Zipf 3.5 or more) flags 356 of the top 3,000, including `son`, `sin`, `era`, `sea`, `casa`, `general`. Much is noise from Spanish text in English corpora, so use a clean English word list (check its licence). Flagged rows need a decision and default to excluded.
5. No stopword or bare BASIC word as an anchor without a qualifier.
6. Article matches gender; `special` articles excluded early.
7. The 226 are byte-identical (existing hash test).
8. Hint format and the length limits in `languages.js`.
9. Tag filter plus committed denylist for names, vulgar, offensive and high-stakes lemmas.
10. Each example holds the target once and its source ID resolves in the pinned export.
11. Two runs are byte-identical.
12. Working-set size under the 3,000-character cap and retrieval under the time budget.

### B. Independent evidence (soft flags that route rows to humans)
- **Tatoeba alignment**: does the Spanish form co-occur in translation pairs with one of its anchors? Zero support in a large corpus is a flag. This is independent human translation, unlike Wiktionary-derived lists.
- English-to-Spanish translation tables inside Wiktionary entries, as a weak second path through the same site.
- Rank mismatch between Spanish and English (above).
- Optional rank-correlation with Hermit Dave or Leipzig as a check on wordfreq outliers, copying nothing.
- **Model triage**: a different-provider model may flag suspicious senses to prioritise review. Its output is a sort key, never an accept, which keeps the pass or fail decision off a model's judgment.

### C. Native-speaker review protocol
- **Reviewers**: two per band, ideally one Latin American speaker plus one from another variety, backgrounds recorded, working independently. Platform self-reported levels are not credentials.
- **Per row**: is it the most common everyday sense of the anchor; gender, article and number; three real English sentences with the anchor, rated yes, awkward or no for substitution (this tests actual use); hint readable to a Latin American speaker; register, regional or offensive flag; example natural.
- **Band 1 plus the existing 226**: 100% double review, with Cohen's kappa reported. Below 0.6, fix the rubric first. This also closes `spanish-curriculum-review`.
- **Later bands**: a stratified sample of 60 rows plus every machine-flagged row. Zero substantive defects in 60 bounds the defect rate near 5% at 95% confidence (rule of three). One to three defects: fix them, find the cause, sample 60 more. More than three: review the whole band.
- **Recording**: committed `reviews/band-NN-<reviewer-id>.csv` with pseudonymous ID, date, row content hash and verdict. The generator refuses `native-reviewed` without a matching record; disagreements go to a third reviewer and the resolution lands in the overlay.
- **Ship rule**: only `native-reviewed` rows ship. The original 226 stay labelled AI-drafted until reviewed.
- Effort is an assumption: about 30 to 45 seconds a row, so 4 to 6 hours per reviewer for 526 rows.

## 9. Staging and the gradual policy

- **Arithmetic**: with `newWordsPerDay = 5`, a 300-row band is about 60 days of introductions for a daily reader, and 3,000 rows is about 20 months. Introductions are budgeted per day, so catalog size does not change the pace, but the order in which new words are drawn does.
- **Order**: add `band` to the `selectWorkingSet` sort (before cognate) or gate by band. A simple unlock rule: band N+1 becomes eligible when at least 60% of band N has been introduced. The ruling on which is the CTO's.
- **Level mapping**: bands load only in gradual mode, because ordinary mode lists the whole level and the tests cap it at 240 entries. This needs the CTO to decide whether to add levels beyond `MAX_BUILT_LEVEL = 2` or make bands a separate catalog path.
- **Pilot then band 1**: a 50-row pilot (about 17 from each of nouns, verbs and adjectives or fixed chunks) to prove the pipeline, the reviewers' rubric and the Tatoeba CC0 yield. Then 300 new rows (pack goes from 226 to 526). Later bands are 300 each, so about 9 more to reach roughly 3,000 rows.
- **Release gates per band**: all deterministic gates green on the exact commit, review record present, prompt and retrieval budgets met, version bump aligned across manifest and package files, and the usual council to fixpoint.

## 10. Risks and open questions for the CTO

1. Is a rank-derived band an Adaptation of wordfreq data? Treated as yes at no real cost, but a legal read is still advisable before publishing.
2. Gradual-only growth versus lifting the 240-entry test cap. Needs a product ruling.
3. Verb scope (infinitive, 3sg, gerund, participle only) and the epicene-first adjective rule are product limits, not just data choices.
4. Reviewer sourcing and pay. This lane cannot decide it. It blocks all "native-reviewed" claims.
5. RAE and Leipzig terms are unverified because the sites blocked automated fetch. A human should read them if either is wanted.
6. A code change is needed for explicit English surface forms and for turning off suffix stemming on verb-form rows.
7. Perf of `matchingEntries` at 3,000+ anchors is unmeasured.

## Sources
wordfreq NOTICE/README/SUNSET (github.com/rspeer/wordfreq); en.wiktionary.org/wiki/Wiktionary:Copyrights; creativecommons.org (BY-SA 4.0 and 3.0 legalcode, compatible-licenses page, FAQ); tatoeba.org/en/terms_of_use and /downloads; github.com/hermitdave/FrequencyWords; kaikki.org/dictionary/rawdata.html; github.com/tatuylonen/wiktextract; freedict.org/freedict-database.json; gnu.org/licenses/agpl-3.0.txt; local files under `extension/src/` and `docs/`.

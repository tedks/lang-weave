# A public-domain Spanish–English vocabulary source?

Ted asked whether a public-domain source would let Lang Weave skip the CC BY-SA data posture and the double native review proposed in [curriculum-sources.md](curriculum-sources.md) and `curriculum-data-licence-ruling`. This note answers that question. Sources were fetched and probed on 2026-11-02/03 (UTC) from branch `vocabulary-public-domain` at `72a36e8`. The probes were read-only. They ran in session scratch space, and no data, dependency or vocabulary row was added to the repository. This is engineering diligence, not legal advice. Anything I could not fetch is marked **[unverified]**.

## 1. Answer in brief

- **No public-domain or CC0 source on its own gives modern English glosses for 2–3k high-frequency Spanish words.** The best CC0 source is Wikidata Lexemes. It has English meanings for **979 of the top 3,000** Spanish word forms (33%) and **91 of our 226 shipped rows**. The nearest public-domain glosses are the typed vocabularies of four 1900–1919 American school readers on Project Gutenberg. They are US public domain. Their headwords match about **2,477 of the top 3,000** forms. But the senses are dated and book-specific, the spelling is pre-1952 (`fué`, `á`), and modern words such as `internet`, `foto` and `televisión` are missing (section 4.1). Full historical dictionaries exist only as noisy OCR scans.
- **Ted's challenge still largely holds.** The BY-SA posture comes from one decision: copying Wiktionary glosses and wordfreq data into the shipped file. The 226 shipped rows are our own drafts and were never copied from Wiktionary. The same approach can scale:
  1. **We write the English gloss ourselves.** A single word pairing such as "casa → house" is not copyrightable; even Wiktionary's own copyright page says so.
  2. **Take Spanish morphology from Wikidata Lexemes, which is CC0.** That covers forms, part of speech and gender. 2,831 of the top 3,000 forms resolve to a lexeme or one of its forms, and the verb paradigms are complete.
  3. **Check every row against independent evidence that we use but do not copy.** The evidence is Tatoeba translation pairs, Wikidata meanings and the Gutenberg school vocabularies. Rows where the evidence disagrees go to one fluent human.
- **The remaining gap is frequency ordering.** No CC0 frequency list matches wordfreq's quality (section 3.3). There are three options, and Ted decides:
  - keep the coarse wordfreq bands that already ship with attribution;
  - rank from Tatoeba, which is CC BY 2.0 FR (attribution only, no share-alike);
  - accept a weaker CC0 ranking.
- **Double native review of every row was never backed by evidence.** Section 5 proposes a smaller check:
  - deterministic gates;
  - an automatic Tatoeba alignment flag;
  - one fluent reader for the flagged rows plus a 50-row random sample per band.

  On our own 226 rows, the alignment flag already finds real sense problems. For example, it flags `divertido → funny`, where Tatoeba translators overwhelmingly write "fun".

## 2. What counts as "public domain" here

Each candidate gets checked on five separate points:

1. **The work's own status.** CC0 is a waiver that is meant to work worldwide. Expiry of US copyright is a US-only status: works published before 1931 are in the US public domain as of 2026. Under 17 U.S.C. §105, US federal works have no US copyright, and §105 says nothing about copyright abroad.
2. **The edition and transcription.** A public-domain dictionary can reach us through a scan or transcription that has its own terms. Project Gutenberg, for example, has trademark terms.
3. **Database or extraction rights.** The EU sui generis database right can apply to an extraction even when the individual entries are free.
4. **Contributor provenance.** Wikidata states that "When any Wikidata user makes a contribution to Wikidata, that user applies a CC0 license to their contribution ... irrespective of whether the user has any claim of ownership to the data they contribute" ([Wikidata:Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing), fetched 2026-11-03). So a CC0 label is a contributor's declaration, not a guarantee of provenance.
5. **Modern annotations.** Part-of-speech tags, cleaned glosses or frequency counts added to a public-domain text are new material with their own status.

## 3. Candidates with modern language

### 3.1 Wikidata Lexemes: CC0, strong on morphology, weak on English

- **Licence (primary):** "All structured data (i.e. the main, Property, Lexeme, and EntitySchema namespaces) is released into the public domain under Creative Commons Zero." ([Wikidata:Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing), fetched 2026-11-03.)
- **Probe:**
  - **Input:** the dump `https://dumps.wikimedia.org/wikidatawiki/entities/latest-lexemes.json.bz2` (Last-Modified 2026-10-28, 485,025,719 bytes, sha256 `49bc13d3…eef8f`), plus SPARQL counts from query.wikidata.org.
  - **Size:** 67,954 Spanish lexemes. 35,249 are nouns, and 35,136 of those nouns carry grammatical gender (P5185). 8,562 of the 8,578 verbs have at least 50 forms, so the full paradigms are present. For example, `hablar` has 68 forms: hablo, hablas, habla, hablamos, habláis, hablan, hablé, …
  - **Spanish sense data:** only 16,651 lexemes have any sense at all.
  - **English meanings are sparse.** Senses reach English in three ways, and each is thin:
    - 1,458 lexemes have an English-language sense gloss;
    - 5,608 link a sense to a Wikidata item (P5137), whose English label works as a gloss;
    - 362 link a sense to an English lexeme (P5972 translation).
- **Coverage against the top wordfreq 3.1.1 Spanish forms** (wordfreq used only as a measuring stick):

  | Set | Lemma or form found | Has any sense | Has an English meaning |
  |---|---:|---:|---:|
  | top 1,000 | 959 | 502 | 403 |
  | top 3,000 | 2,831 | 1,195 | 979 |
  | shipped 226 (article removed) | 216 | 125 | 91 |

  Among the top 300 forms, these have no English meaning: `que, en, por, para, como, pero, todo, ya, cuando, muy, también, porque, bien, ahora, nada, algo, mejor, mucho, vida, mundo, gente, gracias, nunca, trabajo`.
- **Sample** (seeded random draw from top-3,000 forms that have English):
  - Good:
    - `fútbol` → soccer
    - `abrir` → to open
    - `pudo` → poder → to be able to / can
    - `llevo` → llevar → to take / to wear / to carry
    - `hoy` → today
    - `principalmente` → mainly
  - Noisy or wrong:
    - `trabajador` → "Wren-like Rushbird", a bird species, through a P5137 item link
    - `tú` → "second-person singular", a grammar label rather than a gloss
    - `hierro` → "element with atomic number 26"
    - `agua` S1 also links to "ice" and "vapor"
  - Sense order is not frequency order. For example, `casa` lists a lineage sense and an astrology sense next to "house".
- **Verdict:** the best CC0 source for **forms, part of speech, gender and lemma links**. Inflection data is what our English-anchor and Spanish-form gates need, and it is complete here. Wikidata is a **cross-check** for English meanings, not a primary source. Item-label meanings need filtering: drop taxon, chemistry and grammar-term items, and prefer real glosses and P5972 translations.

### 3.2 Tatoeba CC0 subset: too small

The pipeline already pins `spa_sentences_CC0.tsv.bz2` (sha256 `e8cecab4…36c7`, export of 2026-10-31; unchanged when re-downloaded on 2026-11-03). It contains **37 Spanish sentences** out of 443,052, from 1,956 contributors in the detailed export. That is not a usable corpus, and so the CC0-first example plan in curriculum-sources.md §3.6 does not hold for Spanish.

The full corpus is CC BY 2.0 FR. "using, reusing, modifying and distributing the sentence is only allowed if the name of the author is cited" ([terms](https://tatoeba.org/en/terms_of_use), quoted in curriculum-sources.md, fetched 2026-10-31). That is attribution only, with no share-alike.

### 3.3 Frequency without BY-SA

wordfreq's data is CC BY-SA 4.0 (curriculum-sources.md §3.1). I compared each candidate ranking with wordfreq's top Spanish lists. The figures are top-N overlap with wordfreq at N = 500 / 1,000 / 3,000, counting alphabetic tokens only.

- **Common Voice Spanish text: CC0.**
  - **Licence:** the dataset's text licence is the CC0 1.0 file `server/data/LICENSE` in [common-voice/common-voice](https://github.com/common-voice/common-voice/tree/main/server/data) (the `es` directory was last changed in commit `2d05d6a`, 2022-11-23). Mozilla's description of how it obtained the Wikipedia-sourced sentences under CC0 was not fetched **[unverified]**.
  - **Overlap:** 264 / 590 / 1,945. The corpus is 1.17M sentences and 11.5M tokens, and 1.17M of the sentences come from Wikipedia.
  - **Problems:** it is encyclopedic text, so first- and second-person verbs (`tengo, quiero, voy, puedo, eres`) fall outside its top 5,000. It also has an unexplained filtering hole: **`también` does not appear once** (only 20 unaccented `tambien`). The same is true of `qué`, `después` and `través`. **Not usable as a ranking.**
- **Tatoeba full Spanish corpus: CC BY 2.0 FR.**
  - **Overlap:** 356 / 665 / 1,991. The corpus is 443,052 sentences and 3.2M tokens.
  - **Strengths:** it is conversational, which fits learners. Its disagreements with wordfreq are mostly wordfreq noise: `the`, `i`, unaccented `tambien`/`aqui`, and country names.
  - **Weaknesses:** it carries Tatoeba's own biases: `tom`, `boston`, `sami`, `yanni`, `esperanto` and `ajedrez` rank high.
  - **Verdict:** usable with a committed denylist, and attribution only (no share-alike) if counts are treated as derived at all.
- **Historical frequency lists: US public domain.** Buchanan's *A Graded Spanish Word Book* (1927) is covered in section 4.

### 3.4 Not public domain (for contrast)

- **Wiktionary and Kaikki:** CC BY-SA 4.0 or GFDL. FreeDict `eng-spa` is CC BY-SA 3.0 and is itself derived from Wiktionary.
- **Apertium es-en and FreeDict `spa-eng`:** GPL.
- **MUSE es-en ground-truth dictionaries (Meta):** CC BY-NC 4.0 per its README **[unverified this session]**.
- **Open Multilingual Wordnet / MCR Spanish:** CC BY 3.0 **[unverified this session]**.

None of these offers a public-domain route.

## 4. Historical and government sources

Probed by a bounded research worker on 2026-11-03 UTC. I re-checked the Gutenberg licence quote, the PanLex licence, the Internet Archive status of Velázquez, and the vocabulary sample lines myself. The coverage figures below are my own measurements.

### 4.1 Project Gutenberg school-reader vocabularies: US public domain, typed, and better than expected

Four American school editions on Project Gutenberg have complete Spanish–English vocabularies in parseable `=headword=` markup:

| Ebook | Title (publication) | Vocabulary entries (approx.) |
|---|---|---:|
| [PG 36805](https://www.gutenberg.org/ebooks/36805) | Hills, *Spanish Tales for Beginners* (1909, 1919) | ~4,400 |
| [PG 27738](https://www.gutenberg.org/ebooks/27738) | Palacio Valdés, *José*, Hubbard ed. (1900) | ~4,100 |
| [PG 24250](https://www.gutenberg.org/ebooks/24250) | Wilkins, *Lecturas fáciles* (1916) | ~3,800 |
| [PG 22065](https://www.gutenberg.org/ebooks/22065) | Harrison, *An Elementary Spanish Reader* (1912) | ~1,800 |

- **Licence (primary, [gutenberg.org/policy/license.html](https://www.gutenberg.org/policy/license.html), fetched 2026-11-03):**
  - "If you strip the Project Gutenberg license and all references to Project Gutenberg from the text, you are left with a text unrestricted by U.S. intellectual property law."
  - Each ebook header tells readers outside the US to check local law.
  - All four were published in the US before 1931, so they are US public domain.
  - Status elsewhere depends on the editors' death dates, which I did not check **[unverified]**.
  - The trademark terms apply only if we redistribute the files under the Project Gutenberg name.
- **Coverage.** I merged the four vocabularies into 8,480 distinct headwords. I then matched the top wordfreq forms to them, either directly or through their Wikidata lemma:
  - **917 of the top 1,000** match;
  - **2,477 of the top 3,000** match.
  - Some misses are parser misses rather than real gaps (`primero`, `quién`, `dónde`), so these figures are approximate.
  - Genuinely modern words are missing: `internet, video, foto, película, televisión, teléfono, avión, información, programa`.
- **Sample entries** (exact):
  - `=divertido, --a=, entertaining, amusing, funny.`
  - `=barco=, _m._, ship, vessel.` and `=barco= _m._ boat`
  - `=pueblo=, _m._, town, village; people.`
  - `=coger=, to catch, seize, get, take hold of, take, pluck.`
  - `=trabajar=, to work, labor, toil; endeavor.`
  - `=gente=, _f._, people.`
  - `embarazada` has no entry.
- **Quality:**
  - Senses are the ones each book needed.
  - Agreement across the four books is a useful signal. All four give `trabajar → to work` and `gente → people`; the books differ on `barco` (ship / boat).
  - Spelling is pre-1952: the headwords include `fué`, `dió`, `vió` and the accented preposition `á`.
  - Nouns carry gender; other words have little POS marking.
  - The vocabulary is mostly peninsular and literary. `coger` carries no regional warning.
- **Verdict:** a genuine public-domain **second witness for English senses** of most core words, and an acceptable source of starting glosses that we then modernise. Not a drop-in modern dictionary.

### 4.2 Historical bilingual dictionaries: US public domain, OCR only

- **Velázquez, *A New Pronouncing Dictionary of the Spanish and English Languages* (1900).**
  - [archive.org/details/newpronouncingdi01velrich](https://archive.org/details/newpronouncingdi01velrich). Its metadata says `possible-copyright-status: NOT_IN_COPYRIGHT`, with no licence URL; I re-fetched this on 2026-11-03.
  - The OCR is noisy. For example: `Hablar [ab-biar'], va. 1. To speak, to exi)ress tlioughts by words.`
  - Accents are mostly lost.
  - Sense order is archaic: `embarazada → Pregnant` appears only as a tail sub-entry.
  - `ordenador` has only its old "ordering" sense, and `computadora` is absent.
- **Cuyás, *Appleton's New Spanish-English Dictionary* (1922 printing).**
  - [archive.org/details/appletonsnewspan00cuyrich](https://archive.org/details/appletonsnewspan00cuyrich), `NOT_IN_COPYRIGHT`.
  - The OCR is worse, for example "Casaci6n", and headwords do not start lines, so it cannot practically be parsed.
  - Appleton editions from 1940 on are access-restricted.
- **Neuman & Baretti (1827, 1851).** Scans exist; the worker did not sample them.
- **Verdict:** cross-check only. Cleaning the OCR would cost more than writing the glosses.

### 4.3 Historical frequency lists: not obtainable

- **Buchanan, *A Graded Spanish Word Book* (1927).**
  - Open Library work [OL253510W](https://openlibrary.org/works/OL253510W) reports `no_ebook`.
  - Internet Archive, Gutenberg and the Online Books Page show no copy.
  - HathiTrust blocked automated fetch **[unverified]**.
- **Keniston, *A Standard List of Spanish Words and Idioms* (1941).**
  - [archive.org/details/kenistonstdlists0000keni](https://archive.org/details/kenistonstdlists0000keni) is `access-restricted-item: true`, borrow only.
  - Copyright renewal status is unknown: the Stanford renewal database did not return results to automated fetch **[unverified]**.

### 4.4 US government sources: public domain in the US, too thin

- **Host and its statement.** [fsi-languages.yojik.eu](https://fsi-languages.yojik.eu/) states "All the FSI, DLI and Peace-Corps content is public domain". It also says "May be some copyrights infringements but the documents are old, the authors are dead", and it hosts non-government courses alongside the government ones.
- **Course text.** [archive.org/details/Fsi-SpanishProgrammaticCourse-Texts](https://archive.org/details/Fsi-SpanishProgrammaticCourse-Texts) carries a public-domain licence URL and uses Latin American Spanish.
- **No glossary to extract.** No machine-extractable glossary was found, only scattered OCR'd quiz answers (`lejos : far, distant`).
- **Status.** §105 is US-only, and contractor material inside the courses is possible. DLI and Peace Corps glossaries are **[unverified]**.

### 4.5 Excluded after checking

[PanLex](https://panlex.org/license/) is "Creative Commons Attribution-NonCommercial-ShareAlike 4.0", which is not public domain and not usable commercially.

## 5. A simpler data path and checks that earn their place

### 5.1 The path

1. **Candidate list:** top forms by the chosen ranking (section 3.3), grouped by lemma through Wikidata forms (CC0).
2. **Row:** we write `fr`, `en`, `hint` and `sense` ourselves, as for the 226.
   - Part of speech, gender, number and verb form come from Wikidata, so the article gate checks against CC0 data.
   - Modern-language annotations stay under the project's own licence. Nothing third-party is copied into the shipped file.
   - The wordfreq or Tatoeba band, if chosen, is the only derived field.
3. **Evidence (stored as build metadata, not shipped):**
   - Wikidata English meanings, where present (33% of the top 3,000);
   - Gutenberg school-vocabulary senses, which are US public domain and cover about 80% of the top 3,000 headwords. They are a second witness and can supply a starting gloss that we then modernise;
   - Tatoeba alignment support;
   - optionally, the historical-dictionary sense for spot checks.
4. **Admission:** the existing deterministic gates in [CURRICULUM-PIPELINE.md](../CURRICULUM-PIPELINE.md) apply unchanged.

**What fails if we just don't use Wiktionary?**

- **Glosses.** We lose a single, modern, machine-readable gloss for every word. The public-domain witnesses cover most core words but not modern ones.
- **IPA.** Glosses for 2–3k core words are short and we already write them. Hints are rule-generated from spelling (curriculum-sources.md §6). IPA would only check stress, and Wikidata forms carry no IPA. That is a real but small loss.

### 5.2 Alignment check, measured on the shipped 226

For each shipped row, I collected the Tatoeba Spanish–English pairs whose Spanish side contains the exact target form. I then measured what share of those pairs had the row's English anchor (lightly inflected) on the English side. The input was 283,847 linked pairs from the pinned 2026-10-31 exports, whose digests matched SOURCES.json on re-download. Every row had at least one pair.

- **Distribution:** 5 rows fall below 10% support, 16 below 25% and 45 below 50%.
- **The lowest-support rows were real findings, not noise.** Each line below gives the row, its support, and the most strongly associated English words with their counts:

  - `divertido → funny`, 0.14: **fun** 168, funny 31, amusing 10. A sense error: "funny" is closer to `gracioso`.
  - `el pueblo → the town`, 0.24: **village** 132, town 88.
  - `el barco → the boat`, 0.16: **ship** 194, boat 50.
  - `el avión → the airplane`, 0.19: **plane** 255, airplane 63. The anchor misses the common word.
  - `todos → everyone`, 0.20: everyone 687, everybody 297. Also "all".
  - `hace falta → we need`, 0.01: the anchor is person-bound.
  - `después → afterward / later`, 0.09: **after** 978.
  - `creo que → I think that`, 0.08: an English that-omission artefact. Correct, but the flag fires.
  - `no → no`, 0.07: Spanish negation maps to English not/don't. Correct, but the flag fires.

So the check is cheap: about one minute on a laptop, with no network beyond the pinned exports. It is independent of the gloss author, because the translations are by Tatoeba contributors. And 7 of the 9 lowest-support rows listed above were real anchor or sense problems. It **ranks rows for human attention; it never approves a row.** Function words and fixed phrases need an allowlist, because English realises them differently.

### 5.3 Proposed review, replacing 100% double native review

- **Deterministic gates:** the existing twelve admission classes, unchanged.
- **Automatic flags:**
  - alignment support below 0.25;
  - a Wikidata English meaning or Gutenberg vocabulary sense that shares no token with our anchors, where one exists;
  - no public-domain witness at all, which is typical of modern words;
  - Spanish/English frequency-gap rows;
  - regional or false-friend list hits.
- **Human pass:** one fluent reader, not necessarily native, reviews every flagged row plus a seeded random sample of 50 unflagged rows per 300-row band.
  - **Zero sample defects:** ship the band. The rule of three bounds the residual defect rate near 6% at 95% confidence, which suits a reading aid with an "again"/override path.
  - **Any sample defect:** fix it, add the defect class as a flag, and resample.
- **Second reviewer:** only for disagreements, or for any row the first reader marks unsure.
- **Cost estimate (an assumption):** about 75 flagged rows plus 50 sampled per band, at under a minute each, so roughly 2 hours per band, compared with 4–6 hours per reviewer twice.
- **What this drops, and why:** inter-rater kappa and mandatory double review. Neither has evidence that it catches defects the alignment flag plus a single reader misses. If the first band's sample shows defects that the flags missed, add review then, on evidence.

## 6. The exact gap

- **No modern public-domain or CC0 English glosses at scale.**
  - CC0 Wikidata covers 33% of the top 3,000 forms, with noise.
  - The US-public-domain Gutenberg school vocabularies cover about 80%, but in 1900–1919 senses and spelling, with no modern words.
  - Their status outside the US depends on the editors' death dates, which are unchecked.
  - Full dictionaries exist only as OCR scans.

  We therefore write the glosses ourselves and use these sources as witnesses, rather than importing either one wholesale.
- **No CC0 frequency ranking of wordfreq's quality.** The candidates are wordfreq (BY-SA, already shipping as coarse bands with credit), Tatoeba (BY) and Buchanan 1927 (US public domain, literary, about 100 years old).
- **No public-domain IPA.**

## 7. For Ted to decide

Filed as ditz `open-questions` issue `vocabulary-pd-path-ruling`.

1. **Glosses.** Adopt the self-authored-gloss path (5.1) and drop the plan to copy Wiktionary glosses into the shipped data? *Recommendation: yes.*
2. **Frequency source.** The choices are:
   - keep the wordfreq coarse bands (BY-SA credit, already shipped);
   - switch to Tatoeba-derived bands (BY credit; needs a name denylist).

   Buchanan 1927 is not obtainable. *Recommendation:* keep wordfreq bands now. Switch to Tatoeba only if removing every BY-SA credit from the shipped data matters to Ted.
3. **Review.** Replace 100% double native review with the flagged-plus-sample single-reader pass (5.3)? *Recommendation: yes.*

## Sources (fetched 2026-11-02/03 UTC unless noted)

- https://www.wikidata.org/wiki/Wikidata:Licensing
- https://dumps.wikimedia.org/wikidatawiki/entities/latest-lexemes.json.bz2 (Last-Modified 2026-10-28)
- https://query.wikidata.org/sparql
- https://downloads.tatoeba.org/exports/per_language/ (spa, eng, eng-spa links; digests as in `data/curriculum/es/SOURCES.json`)
- https://tatoeba.org/en/terms_of_use (fetched 2026-10-31 per curriculum-sources.md)
- https://github.com/common-voice/common-voice/tree/main/server/data (LICENSE and `es/`)
- wordfreq 3.1.1 (PyPI wheel, sha256 as in SOURCES.json), measurement only
- https://www.gutenberg.org/policy/license.html and ebooks 36805, 27738, 24250, 22065 (`cache/epub/<id>/pg<id>.txt`)
- https://archive.org/details/newpronouncingdi01velrich, https://archive.org/details/appletonsnewspan00cuyrich, https://archive.org/details/kenistonstdlists0000keni, https://archive.org/details/Fsi-SpanishProgrammaticCourse-Texts
- https://openlibrary.org/works/OL253510W
- https://fsi-languages.yojik.eu/
- https://panlex.org/license/

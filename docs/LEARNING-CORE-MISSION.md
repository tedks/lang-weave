# Learning core: FSRS scheduler and local learning log

State: phase 1 (standalone modules) merged in PR #19 at `eee1bfe`. Phase 2 is a two-PR stack. The bottom PR is the tolerant-reader release, 0.12.3 on branch `learning-core-reader`. The top PR is the writer release on branch `learning-core-writer`. Ditz issues `fsrs-scheduler` and `learning-event-log` stay open until the writer merges.

## Phase 2, step 1: tolerant reader (0.12.3)

This release reads everything the writer will produce and changes nothing a user sees:
- **Backups.** `parseBackup` accepts schema 1 and schema 2. Export still writes schema 1, without FSRS state, log or `desiredRetention`, so 0.12.2 can still import its files.
- **Unknown future schemas** fail with a message naming the schema and telling the user to update.
- **Schema 2 content.** `fsrs` on cards is validated with `cleanFsrsState`. It is kept only while it agrees with the card's `due` and `interval`, and dropped as stale otherwise. `learningRetrievals` and `learningExposures` in any scope are validated strictly, so malformed data fails closed. Well-formed entries whose word is not in the scope's catalog are omitted and counted in the preview. That is ruling B on `learning-log-export-unverified-ruling`.
- **`desiredRetention`** is accepted between 0.85 and 0.9.
- **Storage.** The two log keys are known learning keys everywhere a key list exists: `storageEntries`, `learningPatch`, `alreadyImported` and `targetFresh`. They now derive from one table, `SCOPE_FIELDS`. A target with logged progress is not fresh, and an unknown log shape conflicts.
- **Cards.** `cleanReview` keeps a stored `fsrs` only while it agrees with the schedule. This build schedules without FSRS, so a card it rates loses the stale state at the next load. No new field is ever created.
- **Settings.** `cleanSettings` keeps `desiredRetention` when it is valid and never adds a default. A downgrade to 0.12.2 therefore stays possible unless the user imported a schema 2 file with that preference.
- **Old scheduler.** This build's scheduler deletes a card's `fsrs` whenever it rates the card, Again included, because the state no longer describes the card. A stored state also needs at least one review and no more lapses than reviews.
- **Schema 1 export** ignores stored `fsrs` without validating it, and drops a scope that held only log data instead of exporting it empty. It silently omits FSRS state, the log and `desiredRetention`, which is inherent to schema 1. That only matters after a schema 2 import into this build.
- **Repeat imports.** A fresh target may already hold an empty log. `alreadyImported` accepts an empty log of exactly the version 1 shape that the import did not write. `targetFresh` treats any other log shape as a conflict.
- **Known limit.** An exposure word spelled exactly `constructor` or `prototype` fails the whole import as an unsafe key, as review cards already do.
- **Interpretation.** Migration on read in this step means accepting and validating persisted state, not deriving it. Derivation with `withFsrs` starts in the writer, which is also the first build to persist it.

Verified against 0.12.2's own `portability.js`, extracted from `origin/main`:
- It refuses a schema 2 file with "unsupported format or schema version".
- It refuses to export once any log key exists, with "unknown storage format". That cannot be fixed retroactively, so the writer's release notes must say to update to 0.12.3 or later first.
- It imports this build's schema 1 export.

## Intent

Make every review count (roadmap M1). The research report found that exposure alone does not stick, that the current interval rules waste reviews, and that nothing records elapsed time or outcome, so retention cannot be measured ([learning-science.md](research/learning-science.md), recommendations 1, 2, 5 and 7; evidence sections 3 and 9). Phase 1 delivers the two standalone pieces with tests: a memory model that schedules on actual elapsed time and keeps memory across lapses, and a bounded local log that can show whether it works. Phase 2 integrates them after the worker split lands.

## Phase 1 deliverables

- `extension/src/fsrs.js`: an independent port of the published FSRS-6 formulas with the 21 default weights. Pure functions only: `initialState`, `nextState(state, rating, elapsedDays)`, `intervalDays(stability, retention)`, `retrievability`/`predictedRecall`, `elapsedDays(fromMs, toMs)`, `reviewCard` (one scheduler step returning the new state plus the values the log records), `cleanFsrsState`, and the migration `migrateCard`/`withFsrs`.
- `extension/src/learning-log.js`: a scope-local retrieval log and exposure aggregates, with one function per measurement in section 9 of the research report and a `summarize` for one scope.
- Tests: `extension/test/fsrs.test.js` and `extension/test/learning-log.test.js`.
- NOTICE credits the MIT-licensed source of the FSRS default parameters. No code is vendored.

## Assumptions

- **Ratings.** Again, Hard, Medium and Easy map to FSRS grades 1 to 4. Hard is a pass, as in FSRS. The inline "Already know" is a claim. It is logged as outcome `known` and never counted as a recall.
- **Elapsed time** is whole 24-hour periods since the last review, as py-fsrs counts it. A review less than a day later uses FSRS's short-term formula and is never a lapse. Calendar days were tried first. The council reproduced a ten-minute retry across midnight being scored as a one-day review and a second lapse. A clock rollback counts as zero days. The current clock is trusted as a correction, so the rollback review becomes the new last review and due never precedes it.
- **Again** keeps the existing ten-minute retry step (`AGAIN_STEP_MS`) and stores the FSRS post-lapse stability. This replaces the old reset to zero. There is no learning-step state machine and no interval fuzz, so the worker tests can pin dates.
- **Desired retention** defaults to 0.9 and is accepted between 0.85 and 0.9. Values outside that range throw.
- **Intervals** are capped at 365 days. This is the bound `portability.js` and `cleanReview` already enforce for `interval`. `reviewCard` refuses a larger maximum.
- **Rounding.** Intervals round half up (`Math.round`); py-fsrs rounds half to even. They differ only when the raw interval is exactly an odd half, which the reference comparison never hit.
- **Constants and formulas** were checked on 2026-10-30 against two current upstream implementations at tagged versions. One is py-fsrs v6.3.2 (`fsrs/scheduler.py`, commit `9446cb06`, https://github.com/open-spaced-repetition/py-fsrs/blob/v6.3.2/fsrs/scheduler.py). The other is ts-fsrs v6.0.0 (`packages/fsrs/src/models/fsrs-6/`, https://github.com/open-spaced-repetition/ts-fsrs/tree/v6.0.0/packages/fsrs/src/models/fsrs-6). Both carry the same 21 default weights. The check found one difference from the first port: since py-fsrs v6.3.2 (#155), and in ts-fsrs v6.0.0, a same-day Hard is floored like Good and Easy, so it never lowers stability. The port now does the same. `extension/test/fsrs-reference.json` holds 24 review sequences of 13 steps, with 14 same-day Hard steps among them. They were generated by py-fsrs v6.3.2's own formula methods, run from source fetched at the tag, with fuzz off and a 365-day maximum. The port matches them to 1e-12 with identical intervals. The tests also pin the weights, the identity R(S, S) = 0.9, the first intervals of 1, 1, 2 and 8 days, and a seven-step sequence computed separately in Python. ts-fsrs rounds intermediate values to 8 decimals and py-fsrs does not; the port follows py-fsrs. ts-fsrs v6 also ships FSRS-7. This port stays on FSRS-6, as the mission asked, and evaluating FSRS-7 is a follow-up issue.

## Migration of existing cards

`review.js` cards hold `due`, `interval` in days, `reviews`, and optionally `familiar`, `easyStreak`, `introducedDay`, `introGateDay` and `introReceipt`. There is no per-review history to lose. The migration is additive: `withFsrs(card)` returns a copy with every original field unchanged plus `fsrs: { stability, difficulty, lastReview, lapses }`.

`due` and `interval` stay authoritative. A stored `fsrs` is kept only when it agrees with them exactly as `reviewCard` writes them. For a positive interval that means due equals last review plus the interval in days. For an Again (interval 0) the due time is a retry step of at most a day after the last review. Any other stored state, malformed or disagreeing, is replaced by a fresh derivation. That covers a path that moved the schedule without the scheduler, such as a future "practice now". This mirrors how `cleanReview` already drops malformed cards. Such a state can only come from corruption or a write path that bypassed the scheduler. Phase 2 should count these replacements in its diagnostics so they are visible.

| Old card | Inferred last rating | FSRS state |
|---|---|---|
| `reviews` = 0 | none | no state; the first rating uses `initialState` |
| `interval` = 0, `reviews` > 0 | Again | S = w0, D = D0(Again), last review = due minus 10 minutes |
| `interval` = 1 | Hard | S = 1, D = D0(Hard) |
| `easyStreak` > 0 | Easy | S = interval, D = 1 (D0(Easy) clamped) |
| otherwise | Medium | S = interval, D = D0(Good) |

Last review is `due − interval days`, so at 0.9 retention FSRS reproduces each migrated card's due date exactly. No card is rescheduled by the migration. Lapses before migration were never recorded and start at 0. A card whose derived last review would precede the epoch gets no state rather than a guess; its other fields are still kept. `familiar` is untouched. The `familiar-maintenance` mission decides its future.

## Storage keys

All keys follow the existing scope convention through `scopedStorage`: unprefixed for Spanish, `lang:<language>:<pack version>:<key>` for generated packs, and `lang:personal:<language>:<key>` for personal words.

| Key | Contents | Bound |
|---|---|---|
| `learningRetrievals` | `{ version: 1, retrievals: [[word, at, source, direction, outcome, prior, latencyMs, elapsedDays, intervalDays, predicted], ...] }`, oldest first | 5,000 entries per scope, oldest dropped |
| `learningExposures` | `{ version: 1, words: { [word]: [count, peeks, distinctDays, firstDay, lastDay] } }` | 5,000 words per scope, least recently seen evicted |
| card field `fsrs` (phase 2) | `{ stability, difficulty, lastReview, lapses }` inside `recallReview` cards and `personalVocabularyV1.history` cards | one per card |

The word is the card ID: the `fr` form for catalog scopes and `personal:<language>:<uuid>` for personal words. Exposures use the same ID so they join the retrievals and the cards. They do not use the `catalog.js` entry IDs that `encounters.js` uses.

**Privacy.** The guarantee is catalog membership. Every write requires the scope's catalog: the bundled list, a `cleanPack`-validated generated pack (forms of at most 50 characters), or personal IDs, which are UUIDs and never contain the learner's text. Only the fixed fields are copied. The shape check is a second line, and it cannot tell a five-word phrase from a short passage. It accepts either an exact personal ID, or a form of at most 50 characters and five words with no colon, slash, `@`, markup, control character or dot followed by a letter or digit. So `example.com:443` and `p.ej.` are refused even when listed. Some forms that `cleanPack` accepts are refused too, such as `il/elle`, `z.B.` or `1.000`. Their retrievals and exposures are not logged, which biases measurements for those words but loses no learning state. Phase 2 should count refused writes in diagnostics, and ideally `cleanPack` and this guard should share one form contract. All 226 bundled Spanish forms and every personal-ID language code that `languageCode` returns pass. Loading keeps structurally valid entries whose word has since left the catalog, as `cleanReview` keeps orphan cards. Only the extension writes this storage, and any import must apply the catalog check. Timestamps and latencies are stored. No URL, host, title, passage or page text is ever stored. Nothing leaves the browser.

**Size.** These are compact JSON figures:

| Store | Spanish | Personal |
|---|---|---|
| Retrieval entry | 75 bytes | 123 bytes |
| Exposure entry | 45 bytes | 90 bytes |
| Full retrieval log, 5,000 entries | about 375 KB | about 615 KB |
| Exposures at the real catalog bound | about 10 KB for 226 words | about 27 KB for 300 entries |

The 5,000-word exposure cap is only a safety bound. In practice the catalog bounds each exposure store: 226 bundled Spanish words, at most 80 words per generated pack, and at most 300 personal entries (`MAX_PERSONAL`). Orphans kept after a catalog change are the only way past that. The retrieval log is the store that grows. The backup writes JSON indented by two spaces, which roughly triples these figures. The extension has no `unlimitedStorage` permission, so its local quota is 10 MB, shared with caches. Phase 2 must set a global budget, for example full caps only for the active language and its personal scope and lower caps elsewhere. Each rating also rewrites the whole retrieval array, up to about 600 KB, and every write reaches `storage.onChanged` listeners such as the review page. Phase 2 should measure that cost and, if it matters, split the log into fixed-size chunk keys.

## Backup and import plan (phase 2; `portability.js` is unchanged in phase 1)

Today any new key or card field breaks the learning backup:
- `storageEntries` rejects an unprefixed unknown key as "unknown storage format". A scoped key with an unknown suffix fails earlier, in `storageScopeKey`, as "unsupported scoped storage key".
- Both export and `targetFresh` would then fail.
- `card()` rejects any unknown card field.
- `cleanReview` silently drops unknown card fields on every load.

**Release order.** Ship a tolerant reader one release before the first writer. In the event, 0.12.3 went further than this plan's first draft, which only skipped and stripped the new data: it reads and validates all of it. "Phase 2, step 1" above describes what it does. A user who then downgrades from the writer to 0.12.3 can still export schema 1, and startup does not set `startupUnsupportedSettings`. Older builds such as 0.12.2 fail their export as soon as a log key exists. That cannot be fixed retroactively, so the writer's release notes must say to install 0.12.3 or later first.

The first phase 2 release that writes any of these keys or the `fsrs` field must include all of the following in the same PR:

1. **Schema 2.** Set `BACKUP_SCHEMA` to 2 and keep a strict schema 1 reader. A schema 1 file imports as before, and its cards are migrated with `withFsrs` after import. A schema 2 file is refused by 0.11.x, as it already refuses unknown versions.
2. **Card field.** `card()` accepts optional `fsrs` validated by `cleanFsrsState`, and it fails closed on an invalid one. `cleanReview` keeps a valid `fsrs`. The personal-only `exportPersonal` strips `fsrs`, as it strips `introReceipt`, so its format v1 is unchanged. There is no personal-only importer today. `personalExportResult` in `background.js` must decide whether that file carries the personal retrieval log; the recommendation is no, since the learning backup is the complete format.
3. **Scope fields.** Every hard-coded key list must change together, or logs are silently dropped:
   - `LEARNING_SUFFIXES` gains `learningRetrievals` and `learningExposures`.
   - `DIRECT_KEYS` gains them through `LEARNING_SUFFIXES`.
   - The suffix-to-field map inside `storageEntries` maps them to `retrievals` and `exposures`. Without it, scoped logs get the field name `undefined`.
   - The separate unprefixed Spanish loop in `storageEntries` needs them too. Without it, the Spanish logs, which `DIRECT_KEYS` skips, are left out of the export without any error.
   - `learningPatch` needs its field-to-suffix list extended, or imports drop the logs.
   - `alreadyImported` in `background.js` needs its learned-key list extended.
   - `feedback()` validates the new fields with the strict rejection the rest of the file uses, so malformed data stops the export instead of being cleaned.
4. **Catalog verification.** Apply the same exact-membership rule as cards and feedback. The open question is whether an unverified log ID stops the whole export, as an unverified card does, or is omitted with a count. The log is measurement data, not learning state, so omission is defensible. This needs a CTO ruling; the recommendation is omission with a count, because blocking a backup over a removed pack's measurements loses more than it protects.
5. **Fresh target.** `targetFresh` treats any retrieval or exposure as learning progress.
6. **Size.** The indented 1 MiB file cannot hold even one full Spanish retrieval log, which is 1.15 MB indented. Raising the limit does not work on its own. The import journal stores the raw file as a string in `chrome.storage.local`, plus before-values, and then writes the patch while the journal still exists. An 8 MiB file would need about 9 MB of journal plus about 3 MB of patch, which exceeds the 10 MB quota. This is arithmetic from measured ratios, not a Chrome run. Recommendation:
   - Serialize the backup without indentation. That alone roughly triples the headroom, and the import parser does not care.
   - Give the whole log section one byte budget across all scopes of 512 KiB of compact JSON. Fill it in this order, stopping when the next item does not fit:
     1. Exposure aggregates for the current scopes: Spanish, each installed pack and each personal language. Only catalog-verified words are exported, so orphans do not count. For a personal scope the step 1 catalog is the personal entry IDs, at most 300. It is not the wider set of history card IDs that `portability.js` also accepts for that scope. The word entries have a hard bound from the validators:
        - The catalogs allow at most 926 words: 226 Spanish words, 5 packs (`MAX_PACKS`) of at most 80 words, and 300 personal entries (`MAX_PERSONAL`).
        - A form ID is at most 50 UTF-16 units. Each unit is at most 3 UTF-8 bytes, because a quote escapes to 2 bytes and `validWordId` refuses backslashes and control characters. That makes a form ID at most 150 bytes.
        - A personal ID is ASCII and at most 100 bytes.
        - Each entry adds at most 55 bytes of frame: three counters of at most 7 digits each, two quoted days, brackets, colon and commas. A form entry is therefore at most 205 bytes and a personal entry at most 155.
        - Entries total at most 174,830 bytes.
        - Scope keys and wrappers are not bounded by a validator. Estimating 120 bytes for each of at most 306 scopes, which assumes every personal entry is in a different language, gives about 207 KiB in all.
       Step 1 is therefore expected to fit with room to spare, but that is not guaranteed. If it does not fit, the omitted current-scope exposure words are counted in the preview like every other omission.
     2. Retrievals, newest first across all scopes.
     3. Exposure aggregates for historical scopes, meaning old pack versions, up to 80 scopes. Take the scopes with the most recent last day first, and whole scopes only.
   - State in the preview how many exposure words and how many retrievals were left out, from any step. Nothing is omitted silently.
   - Size-test the worst case: maximum cards, five packs, 300 personal entries, every scope's log full. Test it against both the 1 MiB file cap and the journal's quota use.
   - Do not raise `MAX_BACKUP_BYTES` until the journal stops storing the raw file.
7. **Preview** shows totals of logged reviews and exposure words, plus everything left out. Schema 2 has an optional `state.logOmitted` with `retrievals` and `exposureWords`, which the exporter fills with what its budget and ruling B left out. The import preview adds those to the entries it drops itself. Per-language counts were dropped from the plan as unnecessary.
8. **Downgrade.** Phase 2 keeps writing `due` and `interval` with their current meanings: absolute due time, and scheduled days of at most 365, with 0 for Again. An older build that drops `fsrs` still has a usable schedule, and a later upgrade re-migrates. A build that has `learning-log.js` refuses to overwrite a newer-version log. The backup consequences of a downgrade are under "Release order" above.
9. **Retention setting.** `desiredRetention` must be added to `SETTINGS_FIELDS` and `cleanSettings` before it is ever written. Otherwise `validateStorageSettings` fails at the next worker start, which sets `startupUnsupportedSettings` and disables both export and import.

## Phase 2 integration points

`background.js` is being split concurrently, so the names below are today's. They may move into a review module.

- **Load.** `cleanReview` in `review.js` keeps a valid `fsrs`. `reviewState` and the personal history path in `cleanPersonal` call `withFsrs` on each card as they load. The migration is idempotent and needs no stored flag.
- **Rating.** `scheduleCard` in `review.js` becomes a call to `reviewCard(card.fsrs ?? null, rating, now, { retention })`. It writes `fsrs`, `due` and `interval`, keeps `reviews` and `easyStreak`, and keeps clearing `familiar` on Again. Rating validation, ticket, revision, reveal and serialization stay exactly as they are. For the first rating, `reviewCard` returns null elapsed time because there is no prior state. The card stores only its local `introducedDay`, so the log's `elapsedDays` for that rating is local calendar days since `introducedDay`. Every later rating logs the scheduler's 24-hour count. Next-day recall reads the first kind.
- **Log writes.** `reviewRate` and the rating branch of `inlineAction` append one retrieval in the same locked section and the same scope as the card write. Standalone ratings use source `standalone` and inline ratings use `inline`. Direction is `productive` today, because both surfaces prompt with English and ask for the target form. The inline `known` is logged as a claim. `reviewKnown` (standalone "familiar") is also logged as `known`.
- **Latency** is the whole review: rating time minus prompt time, measured by the worker. That is what "seconds per review" means. `nextReview` and `beginInline` record a prompt timestamp on `current`/`inline`. The timestamp is ephemeral and never exported. Do not trust a page-supplied latency. A recall-only latency, prompt to reveal, would need a second field and a schema change; it is not needed for the section 9 measurements.
- **Exposures.** The encounter path, in the locked section that calls `countEncounters`, also calls `countExposures` with the matched card IDs and `seen`. One call counts each listed word once, so one delivery counts as one exposure per word, however many times it appears. The `record` handler for `peek` events calls it with `peek`. Personal words go to the personal scope, as encounters do. Flips are not exposures. Distinct days only grow when a day is later than the last one counted, the same rollback rule `encounters.js` uses. After a clock rollback the distinct-day count is a lower bound, never an overcount.
- **Retention setting.** Add `desiredRetention`, 0.85 to 0.9, default 0.9, to settings. Phase 2 decides whether it is user-visible. It is a learning preference, so the backup's `preferences` list grows with schema 2.
- **View.** Use one worker message that returns `summarize` for the active scope and its personal scope. It is restricted to extension pages, as `reviewStatus` is. It feeds the "is this working?" panel and the roadmap's `today-progress` headline of verified-known words.
- **Peeks as weak evidence** (recommendation 7) and **familiar maintenance** (recommendation 5) are separate missions. The log records what they need, and phase 2 does not implement them.

## What phase 1 proves

- The FSRS port matches values computed separately in Python from the published formulas across initial states, recall, forgetting with its short-term cap, same-day steps, Hard and Easy modifiers, difficulty mean reversion, retention and interval caps. Lateness raises stability, and Again keeps memory instead of resetting.
- The migration preserves every existing card field and reproduces every migrated due date at 0.9 retention.
- The log stores only catalog IDs and fixed fields, stays within its caps, keeps scopes separate, refuses to overwrite a newer format, and each measurement matches hand-computed expectations.
- Mutation probes go red for each formula detail, privacy guard, cap and measurement rule. They were run while writing the tests and are not a committed harness.
- The FSRS tests pass in UTC, America/New_York, Asia/Tokyo, Australia/Lord_Howe and Pacific/Kiritimati. The midnight-retry regression fails under the old calendar-day rule in every one of them.

## What phase 1 does not prove

- Agreement with ts-fsrs, or with py-fsrs's full `review_card` state machine with its learning steps and fuzz. Only the formula methods were compared; the scheduling policy around them is this module's own.
- That FSRS defaults are calibrated for in-page recall. The defaults come from self-graded flashcards. Only the phase 2 log can test calibration, through `calibration().beatsConstant` after a few hundred reviews.
- Anything about the worker, storage quota behaviour, backup round-trips, or the browser. Phase 1 changes no runtime path.
- That the migration's difficulty estimate is good. It is a defensible starting point that FSRS corrects within a few reviews, not a measurement.

## Record

- 2026-10-30: lane claimed from `ac71cb7` (0.11.1). Issues started and synced. `2c15927` added FSRS-6 with 14 tests; ten mutation probes on formula details went red. `9e24aec` added the learning log with 12 tests; fourteen mutation probes on guards, caps and measurement rules went red. Draft PR #19 opened.
- Council round 1 on `d752371`. Seats: Anthropic native subagent on Opus, OpenAI through ask-agent on gpt-6-sol, and Google agy empty because of its individual quota (reset in about 31 hours), with no substitute.
  - Anthropic: no Critical, four Important. Two were in elapsed time and calibration, both reproduced. Two were in the backup plan: missing key lists and the size and journal arithmetic.
  - OpenAI: one Critical, `example.com:443` passing the ID guard, which was reproduced. Eight Important, overlapping on the interval cap, long-retention population, leech rule and size estimate, plus rollback, invalid stored state, distinct days and counter consistency.
  - All were addressed in the fix commits that follow this entry. Three of them are by stated policy rather than code: clock rollback, invalid stored state replaced by derivation, and distinct days as a lower bound after rollback. The record above explains each.
- The CTO clarified that "no network" bounds the extension and its tests, not research. They required the constants to be verified against published upstream source rather than memory. The lane fetched py-fsrs v6.3.2 and ts-fsrs v6.0.0 at their tags. The weights matched both. The same-day Hard floor did not, because it was fixed upstream after the remembered version. The fixture was regenerated from py-fsrs v6.3.2. It failed against the unfixed port, and the port was corrected. The Anthropic seat's earlier py-fsrs 6.3.0 wheel check is superseded. No dependency was added, and the tests use no network.
- Convergence rounds on the fix deltas used the same seats, with Google agy empty in every round because of its quota.
  - Anthropic, round 1 fixes (`d752371..940085c`): one Important, the per-scope export not fitting 1 MiB. The delta had already replaced that plan. Nits were applied: exact `withFsrs` schedule agreement and the 5-word cap restored.
  - OpenAI: three Important. The tolerant reader must strip `fsrs`. Exposures can exceed a per-scope budget. A third, about a calibration fixture, was not a bug: the helper supplies a default elapsed time.
  - Upstream verification then corrected the same-day Hard floor (py-fsrs v6.3.2, ts-fsrs v6.0.0).
  - Rounds 2 to 5 narrowed the export-size plan to a hard bound on word entries plus counted omissions. Writing the round 4 brief exposed an uncapped personal-ID length, now capped at 100.
  - Final verdicts at `88eaf90`: Anthropic CLEAN, with 3,900 states compared against py-fsrs v6.3.2 and 0 interval mismatches, and a worst-case step 1 of 193,544 bytes. OpenAI CLEAN.
  - The one-sentence personal-catalog nit was applied after CLEAN as a documentation-only change.
- Follow-ups filed: `learning-log-export-unverified-ruling` (open question, CTO), `fsrs-7-evaluation`, and `learning-log-form-contract`.

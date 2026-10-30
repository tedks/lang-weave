# Learning core: FSRS scheduler and local learning log (phase 1)

State: phase 1 modules on branch `learning-core`, PR #19. Ditz issues `fsrs-scheduler` and `learning-event-log` stay open for phase 2. Nothing here is wired into the worker, content script, review page or backup yet, so user-visible behaviour and stored data are unchanged.

## Intent

Make every review count (roadmap M1). The research report found that exposure alone does not stick, that the current interval rules waste reviews, and that nothing records elapsed time or outcome, so retention cannot be measured ([learning-science.md](research/learning-science.md), recommendations 1, 2, 5 and 7; evidence sections 3 and 9). Phase 1 delivers the two standalone pieces with tests: a memory model that schedules on actual elapsed time and keeps memory across lapses, and a bounded local log that can show whether it works. Phase 2 integrates them after the worker split lands.

## Phase 1 deliverables

- `extension/src/fsrs.js`: an independent port of the published FSRS-6 formulas with the 21 default weights. Pure functions only: `initialState`, `nextState(state, rating, elapsedDays)`, `intervalDays(stability, retention)`, `retrievability`/`predictedRecall`, `elapsedDays(fromMs, toMs)`, `reviewCard` (one scheduler step returning the new state plus the values the log records), `cleanFsrsState`, and the migration `migrateCard`/`withFsrs`.
- `extension/src/learning-log.js`: a scope-local retrieval log and exposure aggregates, with one function per measurement in section 9 of the research report and a `summarize` for one scope.
- Tests: `extension/test/fsrs.test.js` and `extension/test/learning-log.test.js`.
- NOTICE credits the MIT-licensed source of the FSRS default parameters. No code is vendored.

## Assumptions

- **Ratings.** Again, Hard, Medium and Easy map to FSRS grades 1 to 4. Hard is a pass, as in FSRS. The inline "Already know" is a claim. It is logged as outcome `known` and never counted as a recall.
- **Elapsed time** is whole local calendar days, using the same local-day convention as `events.js`. A review on the same local day uses FSRS's short-term formula. A clock rollback counts as zero days.
- **Again** keeps the existing ten-minute retry step (`AGAIN_STEP_MS`) and stores the FSRS post-lapse stability. This replaces the old reset to zero. There is no learning-step state machine and no interval fuzz, so the worker tests can pin dates.
- **Desired retention** defaults to 0.9 and is accepted between 0.85 and 0.9. Values outside that range throw.
- **Intervals** are capped at 365 days. This is the bound `portability.js` already validates for `interval`.
- **Constants.** The default weights were transcribed from the published FSRS-6 defaults without network access. The tests pin them, the identity R(S, S) = 0.9, the first intervals of 1, 1, 2 and 8 days, and a seven-step review sequence. The sequence values were computed separately in Python from the formulas. A one-time comparison against upstream py-fsrs or ts-fsrs output is still owed; see "What phase 1 does not prove".

## Migration of existing cards

`review.js` cards hold `due`, `interval` in days, `reviews`, and optionally `familiar`, `easyStreak`, `introducedDay`, `introGateDay` and `introReceipt`. There is no per-review history to lose. The migration is additive: `withFsrs(card)` returns a copy with every original field unchanged plus `fsrs: { stability, difficulty, lastReview, lapses }`.

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

**Privacy.** Every write requires the scope's catalog and copies only the fixed fields. A word ID that looks like a URL, host, address, markup or passage is refused even when listed. Timestamps and latencies are stored. No URL, host, title, passage or page text is ever stored. Nothing leaves the browser.

**Size.** A Spanish entry is about 75 bytes of JSON and a personal entry about 123. One full scope is roughly 375 to 615 KB. The extension has no `unlimitedStorage` permission, so its local quota is 10 MB, which caches share. Phase 2 must set a global budget, for example full caps only for the active language and personal scope and a lower cap elsewhere. It should not let a dozen full scopes approach the quota.

## Backup and import plan (phase 2; `portability.js` is unchanged in phase 1)

Today any new key or card field breaks the learning backup. `storageEntries` rejects an unprefixed unknown key as "unknown storage format" and a scoped unknown suffix as "unknown learning key". Both export and `targetFresh` would then fail. `card()` rejects any unknown card field. `cleanReview` silently drops unknown card fields on every load.

The first phase 2 release that writes any of these keys or the `fsrs` field must therefore include all of the following in the same PR:

1. **Schema 2.** Set `BACKUP_SCHEMA` to 2 and keep a strict schema 1 reader. A schema 1 file imports as before, and its cards are migrated with `withFsrs` after import. A schema 2 file is refused by 0.11.x, as it already refuses unknown versions.
2. **Card field.** `card()` accepts optional `fsrs` validated by `cleanFsrsState`, and it fails closed on an invalid one. `cleanReview` keeps a valid `fsrs`. The personal-only `exportPersonal` passes `fsrs` through its card spread, so its importer must validate it too.
3. **Scope fields.** Add `learningRetrievals` and `learningExposures` to `LEARNING_SUFFIXES`. In `state.scopes` they become `retrievals` and `exposures`, validated by `cleanRetrievals` and `cleanExposures` with the strict rejection the rest of the file uses. Malformed data stops the export instead of being cleaned.
4. **Catalog verification.** Apply the same exact-membership rule as cards and feedback. The open question is whether an unverified log ID stops the whole export, as an unverified card does, or is omitted with a count. The log is measurement data, not learning state, so omission is defensible. This needs a CTO ruling; the recommendation is omission with a count, because blocking a backup over a removed pack's measurements loses more than it protects.
5. **Fresh target.** `targetFresh` treats any retrieval or exposure as learning progress.
6. **Size.** The 1 MiB file limit cannot hold even two full personal logs. Either raise `MAX_BACKUP_BYTES`, the import page's read limit and its tests together, or export only the newest N retrievals per scope and say so in the preview. Recommendation: raise the limit to 8 MiB and keep the per-scope caps.
7. **Preview** shows the retrieval count per language.
8. **Downgrade.** Phase 2 keeps writing `due` and `interval` with their current meanings: absolute due time, and scheduled days of at most 365, with 0 for Again. An older build that drops `fsrs` still has a usable schedule, and a later upgrade re-migrates. An older build refuses a newer-version log instead of overwriting it.

## Phase 2 integration points

`background.js` is being split concurrently, so the names below are today's. They may move into a review module.

- **Load.** `cleanReview` in `review.js` keeps a valid `fsrs`. `reviewState` and the personal history path in `cleanPersonal` call `withFsrs` on each card as they load. The migration is idempotent and needs no stored flag.
- **Rating.** `scheduleCard` in `review.js` becomes a call to `reviewCard(card.fsrs ?? null, rating, now, { retention })`. It writes `fsrs`, `due` and `interval`, keeps `reviews` and `easyStreak`, and keeps clearing `familiar` on Again. Rating validation, ticket, revision, reveal and serialization stay exactly as they are. For the first rating, the log's `elapsedDays` is measured from `introducedDay`, because `reviewCard` returns null when there is no prior state.
- **Log writes.** `reviewRate` and the rating branch of `inlineAction` append one retrieval in the same locked section and the same scope as the card write. Standalone ratings use source `standalone` and inline ratings use `inline`. Direction is `productive` today, because both surfaces prompt with English and ask for the target form. The inline `known` is logged as a claim. `reviewKnown` (standalone "familiar") is also logged as `known`.
- **Latency.** Use reveal time minus prompt time, measured by the worker. `nextReview` and `beginInline` record a prompt timestamp on `current`/`inline`, and the reveal handlers record the reveal timestamp. Both are ephemeral and are never exported. Do not trust a page-supplied latency.
- **Exposures.** The encounter path, in the locked section that calls `countEncounters`, also calls `countExposures` with the matched card IDs and `seen`. The `record` handler for `peek` events calls it with `peek`. Personal words go to the personal scope, as encounters do. Flips are not exposures.
- **Retention setting.** Add `desiredRetention`, 0.85 to 0.9, default 0.9, to settings. Phase 2 decides whether it is user-visible. It is a learning preference, so the backup's `preferences` list grows with schema 2.
- **View.** Use one worker message that returns `summarize` for the active scope and its personal scope. It is restricted to extension pages, as `reviewStatus` is. It feeds the "is this working?" panel and the roadmap's `today-progress` headline of verified-known words.
- **Peeks as weak evidence** (recommendation 7) and **familiar maintenance** (recommendation 5) are separate missions. The log records what they need, and phase 2 does not implement them.

## What phase 1 proves

- The FSRS port matches values computed separately in Python from the published formulas across initial states, recall, forgetting with its short-term cap, same-day steps, Hard and Easy modifiers, difficulty mean reversion, retention and interval caps. Lateness raises stability, and Again keeps memory instead of resetting.
- The migration preserves every existing card field and reproduces every migrated due date at 0.9 retention.
- The log stores only catalog IDs and fixed fields, stays within its caps, keeps scopes separate, refuses to overwrite a newer format, and each measurement matches hand-computed expectations.
- Mutation probes go red for each formula detail, privacy guard, cap and measurement rule. They were run while writing the tests and are not a committed harness.

## What phase 1 does not prove

- That the transcribed default weights equal upstream's. They match the published FSRS-6 defaults as known to this lane, but no upstream implementation was run, because the lane had no network. A comparison against py-fsrs or ts-fsrs output on the same review sequence is owed before phase 2 ships. A mismatch changes constants, not structure.
- That FSRS defaults are calibrated for in-page recall. The defaults come from self-graded flashcards. Only the phase 2 log can test calibration, through `calibration().beatsConstant` after a few hundred reviews.
- Anything about the worker, storage quota behaviour, backup round-trips, or the browser. Phase 1 changes no runtime path.
- That the migration's difficulty estimate is good. It is a defensible starting point that FSRS corrects within a few reviews, not a measurement.

## Record

- 2026-10-30: lane claimed from `ac71cb7` (0.11.1). Issues started and synced. `2c15927` added FSRS-6 with 14 tests; ten mutation probes on formula details went red. `9e24aec` added the learning log with 12 tests; fourteen mutation probes on guards, caps and measurement rules went red. Draft PR #19 opened.

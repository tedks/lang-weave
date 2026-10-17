# Current state

State: browser-local recall implementation complete in draft [PR #2](https://github.com/tedks/spanish-weave/pull/2); council review and root integration are pending. Root CTO owns cross-repository integration and fleet deployment; this Lead lane owns learning code and review fixes in `learning-review`. No takeover or Duolingo credentials authorized by this mission.

Lane: Codex Lead, worktree `learning-review` from `ae3809d` on 2026-10-17. Exclusive source edits here; root owns integration. Acceptance evidence is local unit/worker/UI gates plus Chromium MV3 smoke with synthetic Gemini, version and Python gates, and a pushed draft PR. Stop for any product ruling outside voluntary local reviews.

## Work package

Intent: continue Spanish learning functionality after the accepted core. Add a browser-local recall review queue with easy/medium/hard ratings, persistent scheduling, and a usable popup/review surface. Keep sightings distinct from recall mastery. No API call is needed to review cards.

Assumptions: existing profile-local storage; existing 30/147 bundled Spanish words; users choose when to review; no forced navigation. Acceptance: deterministic clock-based scheduling, one rating per revealed due card, worker-owned validation and serialization, persistence, meaningful regression tests, real Chromium smoke with synthetic Gemini, council convergence before merge. Preserve key isolation and site controls.

Boundary: separate repository/worktree from dotfiles fleet integration. The root owns the consolidated delivery record and PR merge decision. Stop for keys, spending, outward publication or takeover product decisions. Setup repairs within this worktree and existing dev dependencies are allowed; no personal-browser modification.

## Implementation assumptions

- A review prompts with the bundled English gloss and asks the learner to recall Spanish. Reveal shows the canonical Spanish word and pronunciation hint before a rating is accepted.
- Reviewing is voluntary and offline. A button explicitly introduces five words from the current reading level; reading sightings, peeks and flips do not introduce cards or affect the recall schedule.
- Cards use absolute browser-clock timestamps and fixed day intervals. Ratings are subjective self-assessment, not a graded answer or a certified proficiency level.
- One persistent active review ticket across extension review tabs is sufficient. The worker serializes transitions; a ticket is consumed by the first rating, so later duplicate or stale submissions fail.

## Surface and schedule

The popup shows due count and opens `src/review.html` in a new extension tab. `reviewStatus` is available to popup and review page; `reviewIntroduce`, `reviewNext`, `reviewReveal`, and `reviewRate` are review-page-only worker messages. Website messages cannot call them. State is `recallReview` in `chrome.storage.local`, separate from `readingEvents` and the model key. The worker validates saved cards against the bundled Spanish vocabulary on every load. No page text, site URL, API key, or Gemini request participates in review.

Five unintroduced words enter due now per explicit click. Hard schedules one day; Medium schedules at least three days and doubles the previous interval; Easy schedules at least seven days and triples it. Intervals cap at 365 days. One active ticket is persisted; reveal is required before rating and the first serialized rating consumes the ticket. Level 2 cards remain saved but are not shown or rated while Level 1 is selected; switching levels may reset the active prompt and require a fresh reveal. A browser-clock rollback may defer cards until the local clock again reaches their absolute due time.

The fleet payload needs `extension/manifest.json`, `extension/src/*.js`, `extension/src/*.html`, `extension/src/*.css`, and `LICENSE`; there are no new runtime dependencies. The Chromium smoke accepts `SPANISH_WEAVE_TEST_EXTENSION=/absolute/path/to/extension` to run against staged files, defaulting to the repository extension. It copies that source into an isolated synthetic profile, never the user's browser profile.

## 2026-10-17 evidence

- Source head `b2ef902`: Bun 94/94 tests, Python 85/85 tests, version 0.3.0 → 0.4.0 gate, and 35 inherited French blocks check passed. Real Chromium MV3 smoke passed for popup entry, introduce, reveal, persisted UI reload, rating, no review Gemini call, and prior reading/privacy/site controls; Gemini response was synthetic, with no live-service claim.
- Mutation checks: removing the reveal guard failed both scheduler and worker tests; removing the interval cap failed the scheduler test (900 vs 365 days); removing the selected-level guard failed the worker test. Each guard was restored.
- After adding the source override, real Chromium smoke passed in both default mode and `SPANISH_WEAVE_TEST_EXTENSION=/absolute/staged/extension` mode using the repository files as the staged source. The actual fleet-installed path awaits the root's installer staging.
- Council fix delta from `69e0682`: the due-card comparator now subtracts both due timestamps. A regression with a later-list, more-overdue card failed on the old comparator (`and` instead of `but`) and passes with the fix. Worker acceptance checks confirm cache clearing preserves reviews, malformed saved tickets are rejected, and a revealed Level 2 ticket resets across a Level 1 switch without losing cards or rating history. Chromium smoke also checks a meaningful popup operation status.

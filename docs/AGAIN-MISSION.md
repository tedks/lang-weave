# Explicit failed-recall rating

## Current state

2026-10-27 REPAIR IN PROGRESS. Lead: OpenAI gpt-6-sol in `again-rating` at source `a0d939104756ad8b4e87dc8cb26313a53f61e944`. PR #12 was opened as a draft at `564201e8703293deff6d7f42e5909a0b8fd355b9` and marked ready after the first full gate pass. Root owns acceptance, merge and release. This branch owns the local source, tests, version, issue and PR readiness; no fleet or personal-profile work.

## Intent and bounds

Add `Again` after reveal in inline and standalone review. A valid failed recall waits 10 minutes from the saved rating time, resets the Easy streak and preserves the card's identity, review count and introduction history. Existing Hard remains one day; Medium and Easy retain their intervals. Revealing alone has no recall outcome. Manual review remains available, and the same-day automatic cue guard remains in force.

Rating remains entirely local. Existing ticket, revealed, word, document, revision, permission, serialization and storage retry checks authorize mutations. No model call, provider setting, introduction allowance or privacy boundary changes. The 10-minute duration is a product engineering default, not an optimal SRS claim.

## Assumptions and failure modes

- Saved version-1 cards and day-based intervals must load unchanged. Absolute `due` already uses milliseconds, so a short wait can be represented without changing the storage schema. `interval` is the completed day interval and may reset to zero on Again.
- A forged, unknown, stale, duplicate or unrevealed rating must fail before changing a card. Failed storage writes must leave the persisted ticket available for retry.
- A short due time must not create an immediate re-quiz loop or bypass the next-local-day guard on an introduced word. A previously familiar card must not remain mastered if a valid miss route ever reaches it.
- The browser proof will use an isolated unpacked extension, synthetic model response and virtual clock. It will not use a personal profile, key or live Gemini.

## Acceptance evidence

Unit, worker and DOM tests; mutation-red timing guard; guarded isolated MV3 inline miss-to-later-review flow; frozen Bun install, full Bun and Python suites, version and block checks, diff check, guarded smoke/gradual/quota/gloss/highlights; provider-diverse council to fixpoint; exact final-head proof after any pull/rebase. Root then audits and handles normal merge and release.

## Execution log

- 2026-10-27: Confirmed clean `again-rating` worktree and source SHA; read roles, doctrine, design and root mission read-only. Audited the existing review engine, worker persistence path and both review surfaces. Bounded implementation helper owns scheduling and pure-state tests; Lead owns UI, worker/DOM/browser evidence, version and integration.
- 2026-10-27 checkpoint `564201e`: targeted 22 Bun tests/216 expectations, frozen Bun install, full 145 Bun tests/2923 expectations, 91 Python tests, version `0.8.0` from `0.7.2`, 35 blocks and diff check passed. Guarded Chromium smoke, gradual, quota, gloss, highlights and focused Again all passed with synthetic data; no live Gemini. Isolated +1-minute scheduler mutation made three tests fail as intended. This is a checkpoint, not final-head evidence.
- 2026-10-27 council round 1 on `564201e`: OpenAI native seat CLEAN with a browser call-counter nit; Anthropic Opus found two Important gaps and nits; Google seat was unavailable due to an explicit quota error. The scheduler now defensively removes `familiar` on Again, while existing valid routes still reject familiar cards. A new same-local-day test proves manual review is due at ten minutes while the automatic inline cue waits until the next local day. The browser checks calls before and after rating, keyboard focus remains on Hard, a saved short due survives legacy cleaning semantically, and worker Hard/Again paths are deterministic. Harness and version-checker entries now name the new Again browser test. Follow-up delta review and final-head gates remain outstanding.

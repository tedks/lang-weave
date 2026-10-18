# Gradual learning lane

## Current state

State: implementation checkpoint on `gradual-learning`, stacked on published `generic-language` checkpoint `63f3522`. Draft PR #4 targets `generic-language`. Root owns merge, cutover, and fleet acceptance. Source issue: `gradual-inband-learning` depends on the lower language lane. This is a handoff checkpoint, not a review-ready head.

## Intent and scope

Let an opted-in reader meet a bounded number of new words while reading, encounter due words when a passage fits, and optionally practice recall inline. Translation density is independent. Keep ordinary reading, offline standalone reviews, permissions, and language/pack isolation intact.

## Assumptions before code

- English source and exact target vocabulary come from the lower lane's published `context()` and `scopedStorage` contract. The stored pack is complete; policy changes only the active candidates sent for contextual placement.
- Gradual mode starts off for saved profiles. When enabled, its default is five new words per browser-local calendar day, with a small bounded setting. A daily introduction is durable only after a successful worker storage write. Clock rollback must not grant an extra allowance; prior cards and absolute due times remain intact.
- Density choices are bounded and enter both the model prompt and deterministic maximum. A target word can be placed only where the model finds its documented English gloss in readable text; due status is priority, never permission to force a mismatch.
- Familiarity is explicit or earned through reviewed recall, never through page exposure. “Already know” is a deliberate user action and needs the same trusted worker path as a rating. Existing standalone cards and history remain shared.
- Inline recall is optional. An inline cue is attached only to a validated due word in an enabled, permitted, readable page. A worker-issued ticket binds a specific document/frame, revision, scope, and word; it is single use after reveal. Disabling access, mode, or switching language invalidates it. The page never gets general review mutation authority.
- Source text, page URL, and model key are never written into learning history. Gemini results are untrusted; malformed, late, or failed results leave original reading intact. DOM injection uses text nodes only.
- Browser state is shared across tabs. The worker serializes quota and rating read-modify-write operations; concurrent requests cannot spend one budget twice or rate one ticket twice. Malformed saved values are sanitized without erasing unrelated valid history.

## Failure cases to prove

Boundary day and rollback; exhausted and raced quota; stale page/document/scope/ticket; denied or disabled site; language and pack switch; failed storage; malformed saved data; model returning unlisted words or over-dense swaps; sensitive/form/editable content; cache results under changed controls; two ratings for one ticket; reveal-before-rate; restart and standalone review interoperability. Each negative check gets a live positive counterpart. Mutation checks must make the intended guards fail red.

## Acceptance and authority

Evidence: source tests, worker tests, real isolated Chromium with synthetic Gemini, inherited Python/version gates, mutation checks, exact-head council to fixpoint and pushed review-ready PR. No live Gemini or personal browser state is authorized. This lane may repair its own source, tests, and bounded setup. Escalate product rulings, keys/spending, irreversible or outward acts, contract changes, or a thrice-failed approach. Do not merge or deploy.

## Record

- 2026-10-18: worktree and branch verified at `63f3522`; global/repo instructions, doctrine, stacked-PR workflow and published language API read. Interface coordination opened directly with lower Lead. No deviation.
- 2026-10-18: opt-in controls, deterministic density ceiling, worker-serialized daily introductions, due-first selection, familiar marking, inline document-bound reveal/rating, and isolated Chromium synthetic-Gemini flow implemented. Targeted Bun review/learning tests 10/10 and Chromium gradual smoke passed after latest source edits. Full Bun 101/101 passed before the final familiar-queue guard (targeted tests reran after). Python gate was 83/85 at the inherited lower checkpoint: version files and Lang Weave manifest expectation disagreed; lower Lead reports those fixed and Python 85/85 on its later tree. Rebase, version 0.6.0, exact-head full gates, mutation checks, full council and fixpoint remain open.

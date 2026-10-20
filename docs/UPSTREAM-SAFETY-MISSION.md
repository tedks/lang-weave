# Upstream safety and semantics mission

## Current state

- STARTED 2026-10-20. Lead: OpenAI Codex, `upstream-safety-guards` worktree and branch at `8cc33e24165844d32a73289b6095419de5893829`, clean at claim. One bounded implementation worker owns semantic validation and placement; lead owns privacy path, integration, gates, review, and PR. Root retains acceptance and merge authority.
- Scope: adapt local page-title and high-stakes blocking before network or cache display, then deterministic quote, capitalization, name-like, idiom, and pronoun-I placement guards. Expected first patch version: 0.6.2. No live Gemini or profile/key use.

## Assumptions and failure modes before coding

- A page title is untrusted local context, may change during an asynchronous cache or model request, and must never be included in Gemini input. A missing or stale title cannot establish that a page is safe. Frames may have neutral document titles while the top tab is sensitive.
- Passage text and cached swaps remain scoped by existing revision, language, and gradual policy. A sensitive title must suppress both cached swaps and a new model call, even if passage text is neutral. Site-off and permission revocation can happen at any `await` and keep their existing stale-result behavior.
- High-stakes terms must match words or phrases with Unicode-aware boundaries and common English inflections, while benign substrings and unrelated homographs remain readable. The guard is conservative and necessarily finite; tests establish the listed terms, not semantic understanding of all possible titles.
- Model anchors can be repeated, quote delimiters can be apostrophes, and names/all-caps can be ordinary words in other contexts. Deterministic rejection must use actual placement and avoid making ordinary prose inert. Target-language packs must keep their exact-form and scoped history rules.
- Client-side title/SPA changes must clear displayed swaps as well as prevent the next request. A worker reply that arrives after a title change cannot repaint a sensitive page.

## Acceptance evidence to collect

- Paired safe and unsafe cases and mutation-red checks for every new protection. Existing consent/revision/visible introduction and review guards remain green.
- Exact-head frozen Bun install, full Bun and Python gates, version and 35-block checks, diff check, guarded isolated synthetic Chromium smoke/gradual/highlights and focused flow as needed. Browser network denial must fail closed.
- Ready source PR with immutable tested/reviewed SHA, provider-diverse council fixpoint or explicitly empty seats, provenance footers and MIT attribution. Root performs acceptance and normal merge; this lane holds IDLE afterward.

## Context and boundaries

- Source design: `docs/DESIGN.md`; accepted private audit: `UPSTREAM-AUDIT-20261020.local.md` at project root outside worktrees. Frozen upstream `756e32cbfee573fac8ac746857271fdfffd0df59`, local base `8cc33e24165844d32a73289b6095419de5893829`.
- Preserve current site permissions, per-dispatch consent/revision checks, language and gradual cache scopes, visible introduction reservations, review ticket timing, delayed 700ms hover, solid 2px highlight, stable installation path. No native host, provider chain change, paid spend, no-key mode, telemetry, framework/dependency, CI, fleet release, or unrelated upstream phase.

## Implementation and verification log

- Confirmed the title gap against local code: the worker filtered passage text but read cached swaps and dispatched neutral passages without consulting the page title. A neutral passage under a sensitive title could therefore reach Gemini. The content script also lacked title-change reversion. No live disclosure was attempted.
- Adapted a finite, Unicode-boundary high-stakes list from upstream safety commits `5a659e3fac0263075d389633404476032739bf1c`, `4b40c2e2b3766e3c910448454e66a3ce91ad316e`, and `bab145a61cc1357ba200b499bc23535d0ca80bb1`. Worker uses the current tab title and content document title locally; it rechecks after cache I/O, before cached delivery, and before each primary/fallback fetch. Non-top-frame swap requests fail closed because the installed scripts target the top frame and the worker has no live frame-title source. Title and site identifiers are absent from Gemini payloads. The content script reverts on SPA title changes.
- Adapted deterministic source checks from upstream commits `68a60b6bcec2ef3e7b5e958ed0b355695cbe87fd`, `b1260fd8875ae9bc1877f95e1592b46319dcf5a8`, `ea435572b2b52e3aafcdf511460dd4730edb82ae`, and `cd21f0c5fe35644b3587c1c3ecb3fa55b68644a2`, with placement casing from `86374ffb8ff5fb7d6bcc43c90bbd116807ace900`. The worker and final DOM placement both reject deterministically unsafe anchors. The original French Weave MIT license and attribution remain in `LICENSE`.
- Preliminary gates on the uncommitted candidate: frozen Bun install; 124 Bun tests / 1,586 assertions, 91 Python tests, version 0.6.2 and 35 blocks, diff check. Guarded synthetic Chromium smoke, gradual and light/dark highlights passed. The smoke includes a sensitive SPA title transition and browser-level DNS/proxy denial. These are mocked model results, not linguistic or live Gemini QA.
- Mutation-red in an isolated copy: removing the high-stakes filter failed `levels.test.js`; removing the first title veto or final prefetch title recheck each failed `language-worker.test.js`. The semantic worker separately removed each new quote, all-caps, name, fixed phrase and pronoun-placement rule (including Turkish locale casing) and observed focused test failures, then restored them. The integrated worktree was not mutated for these checks.
- Root `%741` STARTED brief submitted through shared tmux transport with a new receipt. No branch/PR/merge has yet been claimed at this checkpoint.
- Source checkpoint `f1408973e77ab37844e0b65686a87f531954cdfc` pushed and draft PR #8 opened. First council round: OpenAI native seat found frame-title staleness, missing checking/credit-card terms, unclosed/whitespace single quotes and abbreviation names (Important); fixes and paired tests were added. Google seat was unavailable because its quota was exhausted; Anthropic seat pending at this write. Convergence and exact-head gates remain.

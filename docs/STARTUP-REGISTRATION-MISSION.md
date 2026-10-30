# Startup site registration repair

## Current state

State: implementation on `startup-registration-race`, based on `origin/main` `c4bbd46` (0.12.12). Full gates, light council and merge are pending. This is the CTO's bounded prerequisite to PR #31.

## Intent, authority and assumptions

- Lead: Codex/OpenAI. The fresh `main-probe` worktree classified the fault before source changes: pristine `81f88d2` `quota-status` Chromium runs were PASS, PASS, FAIL, with the failing run unable to process the second page after restart. The same immediate registration assertion failed on main.
- Intent: restore dynamic granted-site content-script registration before the worker answers its first routed message after restart, with existing consent rechecks intact.
- Assumption: an unpacked profile can expose its new MV3 worker before Chrome exposes a restored dynamic script. Chrome documents `persistAcrossSessions` as true by default; the synthetic restart nonetheless observed zero registrations at raw worker wake. This source repair makes the setting explicit and waits for registration before a routed reply. A page opened before any worker reply can still miss injection; this bounded contract does not retroactively inject into an already-loaded page.
- Repair authority: `sites.js`, `background.js`, focused tests/e2e, docs and patch version. No new permissions, alarms, Store manifest deltas, ticket semantics or consent changes.
- Acceptance: a test fails on main when a held registration is outrun by the first routed reply; it passes after the repair. The Chromium quota restart obtains a routed status reply, then finds registration before loading the next reading page. Full local gates, three quota runs, a light two-seat council and normal merge are required.
- Stop: three unsuccessful repair attempts. The agy council seat is EMPTY due quota; no same-provider substitute.

## Evidence log

- 2026-10-30: Test-first commit on `c4bbd46` fails in Bun: the first `config` reply arrives while `registerContentScripts` is held. The original raw Chromium assertion also fails at worker wake with zero `weave-sites` registrations.
- 2026-10-30: First source repair makes `persistAcrossSessions:true` explicit and chains routed replies through `sitesReady = ready.then(registerSites)`. Focused Bun site and worker tests pass. The raw-wake Chromium assertion still fails, so the e2e now tests the authorized first-reply boundary: an extension popup status reply precedes the registration check and next reading page. The Chromium quota flow passes on this bounded contract. The remaining raw-wake gap and its risks were delivered to the CTO by tmux message.
- 2026-10-30: CTO accepted the first-reply barrier and explicitly kept the earlier-page-load gap outside this PR. The follow-up `startup-injection-gap` records the Chromium evidence, Chrome's documented default persistence, the raw-wake observation, and two candidate designs: retrospective injection through the existing popup fallback path or a different registration model. Duplicate-script behavior and Store bundle differences need assessment. The issue is synchronized on `ditz-metadata`.
- 2026-10-30: Council found that letting a registration rejection poison the shared startup promise made all later messages fail, while retrying indiscriminately could bypass failed storage recovery. The gate now waits for the registration attempt and logs its failure while preserving the prior message path for settings and permission recovery. A failed `ready` still blocks routed handlers. The Bun test covers both failure paths.

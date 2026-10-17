# Current state

State: core implemented and locally verified; preparing council review of PR #1. Codex owns integration as CTO/implementer. One bounded test worker completed its five-file assignment and is idle; no work remains delegated. Source branch `spanish-extension`; base `59b9b02`. No owned servers or running browsers.

Intent and acceptance: [DESIGN.md](DESIGN.md). Issue `spanish-core` is in progress on `ditz-metadata`. Fork `tedks/spanish-weave`; Actions disabled. No existing project roster or predecessor handoff.

## Decision log

- 2026-10-17: User permits direct implementation, overriding the default CTO delegation rule. Fork rather than fresh scaffold preserves the upstream graph, MIT license and inherited tools. Apply the repository setup skill only to missing fork infrastructure; do not replace existing tooling or add a language scaffold.
- 2026-10-17: Standalone Spanish browser operation is the core acceptance target. Retain inherited French terminal tools as legacy; isolate the extension from their native messaging state. Stretch integrations remain follow-up work after core acceptance.
- 2026-10-17: Read org roles, doctrine and Codex binding before implementation. Use durable records for evidence and name testing limits explicitly.
- 2026-10-17: Native host removed from Spanish worker and manifest permission. Chrome assigns a separate unpacked extension ID because the inherited fixed French key is omitted. Legacy CLI tools remain French-oriented and unsupported as Spanish extension setup. Repository version advanced together to 0.3.0 to satisfy the inherited release gate.
- 2026-10-17: Test worker delivered five adapted integration suites; root inspected its diff and ran the full gate. No worker commit or external writes. Core and QA form one logical PR; no separate feature stack is needed.
- 2026-10-17: Follow-ups created and synchronized: `local-spaced-repetition`, `review-takeover-policy` (open-questions, CEO decision), `duolingo-level-import`, `spanish-curriculum-review`. Stretch integrations are deferred; none blocks core acceptance.

## Verification before council

- `cd extension && bun install --frozen-lockfile`: passed with Bun 1.4.2 (provided through `nix shell nixpkgs#bun --command`). No runtime dependencies added; Playwright is development-only and pinned.
- `cd extension && bun test`: 90 tests passed, zero failures, 1,033 assertions. Includes standalone worker/content interactions and inherited generic/legacy tests.
- `python3 -m unittest discover -s tests`: 85 tests passed. The old manifest-key equality test now checks the Spanish/French identity separation.
- `python3 tests/check_version_bump.py --base origin/main`: passed, 0.2.1 → 0.3.0.
- `python3 scripts/make_blocks.py --check`: passed; inherited 35 French levels remain unchanged.
- `cd extension && node e2e/smoke.mjs`: passed in real Playwright Chromium 156.0.8078.4. MV3 worker, dynamic site injection, Spanish words, hover, click/Enter, local feedback, sensitive-site and form exclusions, popup/level controls, pause/resume, and site-off restoration verified. Gemini response is synthetic, not a real-service or translation-quality check. Isolated test profile and extension copy removed after closing the browser.
- Mutation checks: removing ñ preservation made `manana` incorrectly resolve to `mañana` and the Spanish accent test failed; removing accent homograph protection made L1 `si` resolve to `sí` and the same test failed. Restoring each fix returned all four Spanish tests to green.
- `git diff --check`: passed. Browser cache installed for reproducible development QA is intentionally retained. No credentials used; no extension installed in the user's browser; no live Gemini call made.

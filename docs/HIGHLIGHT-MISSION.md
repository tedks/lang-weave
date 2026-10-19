# Visible highlights mission

## Current state

State: PR #7 is council CLEAN in OpenAI and Anthropic seats; Google was unavailable due to quota. The source and synthetic screenshots are pushed, with final exact-head gate details on the PR. Root CTO owns acceptance, merge and rollout; this lane has no further source work.

## Context and assumptions

- Role: Lead, Codex/OpenAI, branch `visible-highlights`.
- Intent: make translated words noticeably visible on light and dark pages, especially Twitter dark mode, while keeping existing hover, recall, practice, link and keyboard behaviors.
- Assume the reported cue is the default `.fw-word` underline. Confirm the actual selectors and rendered states before editing.
- Assume synthetic pages and a test extension profile can represent contrast and CSS interactions; they cannot prove appearance on Ted's live sites.
- Existing runtime behavior, learning state, permissions, network behavior and user profiles are outside this patch.
- Acceptance: version parity at 0.6.1; a test that fails against the old cue; browser computed and visual evidence for light/dark ordinary, link, practice and hover states; exact-head local gates; provider-diverse council to fixpoint; clean pushed PR and handoff to root.
- Repair authority: bounded test environment and harness fixes only. Stop on privacy/security/learning-contract changes, new money or keys, data loss, or external scope beyond the authorized PR.

## Evidence log

- 2026-10-18: Confirmed clean designated worktree and `18a0407` base. Read org roles/doctrine, Codex binding, project design and relevant skills. No edits outside this record yet.
- 2026-10-18: Inspected `text.js` and `content.js`: ordinary/new/known/flipped words share `.fw-word`; active/shaky have a blue status underline; practice is dashed; hover adds `.fw-tip` after dwell; links are excluded from actual swaps. `text.js` gives completed reading/practice spans `tabindex=0` and `role=button`; reserved English introductions are intentionally not interactive. The existing smoke flow checks Enter and real hover dwell on an owned swap. The highlight fixture checks CSS rendering of a synthetic hover cue and nested link, not those runtime behaviors.
- 2026-10-18: Browser regression failed against original CSS at `dotted !== solid`, then passed after changing the ordinary underline to solid 2px `currentColor`, active/shaky blue to a 2px line, adding a keyboard focus outline, and mapping the active cue to system text color in forced colors. No text color or box dimensions change. Synthetic light/dark computed checks include contrast above 3:1 for ordinary and active underlines; practice, hover, link, flipped and keyboard CSS states are asserted. Screenshots: `docs/artifacts/highlights-light.png` and `docs/artifacts/highlights-dark.png`. No personal pages, real Gemini, account or key were used.
- 2026-10-18: Version metadata agrees at 0.6.1. The version checker classifies the new browser harness as developer-only, while its existing fail-closed treatment of unknown e2e files remains.
- 2026-10-18: Local gate command for this regression: from `extension/`, `npm run test:highlights` (or `node e2e/highlights.mjs`); the latter accepts `--save-screenshots` to refresh the two committed synthetic images. A normal gate run writes screenshots only to its owned scratch directory. The original cue fails the browser assertions at `dotted !== solid`.
- 2026-10-18: At `49557e1`, frozen Bun install, 118 Bun tests/1504 assertions, 91 Python tests, version 0.6.0→0.6.1, 35 blocks, diff check, guarded smoke and gradual Chromium flows, and the highlight Chromium flow passed. Both browser flows used synthetic Gemini and isolated profiles; smoke verified an owned loopback positive control and external HTTP/HTTPS proxy denial. Council full round: OpenAI native CLEAN; Anthropic raised two evidence/gating Important findings; Google returned a quota error and its seat stayed empty. The repair at `6519b56` names the highlight gate, routes ordinary screenshots to owned scratch, rejects translucent colors in the contrast assertion, and qualifies keyboard/hover/link evidence. OpenAI and Anthropic fix-delta convergence were CLEAN with no new Critical/Important. Remaining minor observations: the forced-colors check verifies the outcome rather than proving the fallback is necessary, and the line-height check covers this fixture only; neither changes the shipped behavior or claims.
- 2026-10-18: At `8f2a262`, frozen Bun install, 118 Bun tests/1504 assertions, 91 Python tests, version/blocks/diff checks and all three guarded Chromium flows passed again. The final documentation checkpoint follows this unchanged source tree; PR #7 carries its exact-head gate record. The two remaining evidence nits are tracked as `highlight-harness-precision`, separate from this rollout. `visible-word-highlights` stays in progress until root accepts and merges.

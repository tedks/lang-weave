# Visible highlights mission

## Current state

State: focused source and browser regression committed as `6a4ad6c` over `18a0407`; targeted Chromium evidence passes and light/dark screenshots are retained under `docs/artifacts/`. Full gates, PR and council remain pending. Root CTO owns acceptance, merge and rollout.

## Context and assumptions

- Role: Lead, Codex/OpenAI, worktree `/home/tedks/Projects/spanish-weave/visible-highlights`, branch `visible-highlights`. Root contact: tmux socket `/tmp/tmux-1000/personal`, pane `%741`.
- Intent: make translated words noticeably visible on light and dark pages, especially Twitter dark mode, while keeping existing hover, recall, practice, link and keyboard behaviors.
- Assume the reported cue is the default `.fw-word` underline. Confirm the actual selectors and rendered states before editing.
- Assume synthetic pages and a test extension profile can represent contrast and CSS interactions; they cannot prove appearance on Ted's live sites.
- Existing runtime behavior, learning state, permissions, network behavior and user profiles are outside this patch.
- Acceptance: version parity at 0.6.1; a test that fails against the old cue; browser computed and visual evidence for light/dark ordinary, link, practice and hover states; exact-head local gates; provider-diverse council to fixpoint; clean pushed PR and handoff to root.
- Repair authority: bounded test environment and harness fixes only. Stop on privacy/security/learning-contract changes, new money or keys, data loss, or external scope beyond the authorized PR.

## Evidence log

- 2026-10-18: Confirmed clean designated worktree and `18a0407` base. Read org roles/doctrine, Codex binding, project design and relevant skills. No edits outside this record yet.
- 2026-10-18: Inspected `text.js` and `content.js`: ordinary/new/known/flipped words share `.fw-word`; active/shaky have a blue status underline; practice is dashed; hover adds `.fw-tip` after dwell; links are excluded from actual swaps. A synthetic nested-link sample checks that host link color and underline remain intact.
- 2026-10-18: Browser regression failed against original CSS at `dotted !== solid`, then passed after changing the ordinary underline to solid 2px `currentColor`, active/shaky blue to a 2px line, adding a keyboard focus outline, and mapping the active cue to system text color in forced colors. No text color or box dimensions change. Synthetic light/dark computed checks include contrast above 3:1 for ordinary and active underlines; practice, hover, link, flipped and keyboard states are asserted. Screenshots: `docs/artifacts/highlights-light.png` and `docs/artifacts/highlights-dark.png`. No personal pages, real Gemini, account or key were used.
- 2026-10-18: Version metadata agrees at 0.6.1. The version checker classifies the new browser harness as developer-only, while its existing fail-closed treatment of unknown e2e files remains.

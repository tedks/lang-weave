# Calmer cues and keyboard commands

## Current state

State: implementation pushed on `calmer-cues` in draft PR #31. Full gates, council review, final rebase, and merge are pending.

## Context and assumptions

- Lead: Codex/OpenAI; designated worktree `calmer-cues`, starting from `origin/main` `47cb440` (0.12.10).
- Intent: keep reading fluid while retaining the established inline recall ticket and review rules.
- Assumption: due practice spans can wait for a visible invitation without changing worker ticket issuance. The worker still chooses due words; the content script only selects at most two visible markers.
- Assumption: the command's “this page” scope means a site override for the active tab's hostname, using the existing `save` path. The shortcut never creates a grant or turns on an ask-first site; the popup remains the explicit enable route.
- Environment: Bun via `nix shell nixpkgs#bun`; isolated Playwright Chromium uses synthetic Gemini and a throwaway profile.
- Acceptance: English practice word plus dashed underline and superscript `?`; no more than two active viewport cues; placement by measured space; one row of four ratings with secondary Already know; Reveal focused first; Escape returns to the word; light/dark/forced-colors styling; pause/review commands; full local gates and council fixpoint.
- Repair authority: content rendering/layout, command wiring, tests, e2e, docs, and patch version. Ticket issuance, revision semantics, Store deltas, alarms, new permissions and live Gemini are outside scope.
- Stop conditions: any cap/placement need for ticket issuance is a ruling; three failures of the same browser gate are blocked.

## Decisions and evidence

- 2026-10-30: The marker cap is presentation-only. Due practice spans outside the two visible slots remain their English text without button semantics or marker; scrolling or resolving a word recalculates slots. Superscript is `aria-hidden`, and the span's accessible label names the English word and inline recall action. The worker's `inlineBegin`, reveal, rating and revision checks are unchanged.
- 2026-10-30: The panel uses the existing `placeTip` geometry helper, which chooses a fully available side and clamps inside the viewport. The gloss box, fixed placement behavior and 700 ms delay are unchanged. The panel keeps `role=group`, live status, trusted-click checks, Escape restoration and the existing post-reveal Hard focus.
- 2026-10-30: `pause-on-this-page` toggles only a granted active tab's hostname through `save({siteOverride})`; an ungranted, inactive, hidden-URL, global-off or ask-first site fails closed. `open-review` opens the exact extension review URL. Command names are pinned in `router.js` but do not enter the sender message surface table. No permission was added.
- 2026-10-30: Focused Bun cue/command tests passed (5/5); Chromium `gradual`, `again` and `highlights` passed with synthetic Gemini and throwaway profiles. The highlights fixture checks the revealed rating row, panel contrast, and forced colors in light/dark themes. These are interim checks, not exact merge-head evidence.

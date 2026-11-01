# i18n scaffold and lang attribute mission

## Current state

State: started. Lang attribute series in progress on branch `i18n-lang` (base `origin/main` `d7caaa7`, 0.12.17).

## Context and assumptions

- Lead: Claude Opus 5.5 (Anthropic), native subagent of the session team lead; worktree `/home/tedks/Projects/lang-weave/i18n-lang`; ditz `i18n-and-lang-attr`.
- Intent (ux-audit #17, #22; roadmap M3): screen readers voice swapped words in the target language, and the UI copy is ready for `chrome.i18n` without translating anything.
- Assumption: `lang` describes the text a span currently shows. A span showing the target word carries the target code; a span showing English (flipped, waiting practice, reserved introduction) carries no `lang` and inherits the page's English. Putting `es` on visible English text would make a screen reader voice English with Spanish rules.
- Assumption: the scanner reads `lang` only through `el.closest('[lang]')` on the passage element (`page.js`), which walks up from the passage and never into its swap spans, so span `lang` cannot make a passage unreadable. Tests must prove it.
- Assumption: the description elements live in one hidden extension container outside every passage. A hidden or `aria-hidden` element inside a passage would make `readable()` reject it on the next scan.
- Acceptance: lang and describedby on target-language spans with unit tests for rescans and churn; highlights and gloss Chromium gates assert both; `_locales/en/messages.json` with `default_locale`; manifest and page copy through messages, English byte-identical; fixed status and badge copy still allowlisted against the messages file; both package modes ship `_locales`; 0.12.18 on three surfaces; all gates; council fixpoint; normal merge.
- Repair authority: the user-facing surfaces named in the brief and their tests. Stop conditions: a string that cannot move without behaviour change stays fixed and is listed; a scanner regression needing a change to the non-English skip rule is NEEDS RULING; a thrice-failed browser gate is BLOCKED.

## Decisions and evidence

- 2026-10-31: Claimed `i18n-and-lang-attr`; read ROLES (Lead), DESIGN, ROADMAP M3, ux-audit (f) and section 3, the highlight and cue records, and the swap, scanner and churn code.

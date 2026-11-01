# i18n scaffold and lang attribute mission

## Current state

State: implementation merged on branch `i18n-lang` (PR #38, 0.12.18). Full gates and council review are in progress; the PR record carries the final head, gates and council outcome.

## Context and assumptions

- Lead: Claude Opus 5.5 (Anthropic), native subagent of the session team lead; worktree `/home/tedks/Projects/lang-weave/i18n-lang`; ditz `i18n-and-lang-attr`. Three Sonnet implementers migrated the pages in their own worktrees (`i18n-pages-a`, `-b`, `-c`); the lead reviewed and cherry-picked their commits.
- Intent (ux-audit #17, #22; roadmap M3): screen readers voice swapped words in the target language, and the UI copy is ready for `chrome.i18n` without translating anything.
- Assumption: `lang` describes the text a span currently shows. A span showing the target word carries the target code. A span showing English (flipped, waiting practice, a reserved introduction) carries no `lang` and inherits the page's English. Putting `es` on visible English would make a screen reader voice English with Spanish rules.
- Assumption: the scanner reads `lang` only through `el.closest('[lang]')` on the passage (`page.js`), which walks up from the passage and never into its swap spans.
- Assumption: description elements must live outside every passage. A hidden or `aria-hidden` element inside a passage makes `readable()` reject it on the next scan.
- Acceptance, repair authority and stop conditions are those of the brief: no behaviour change, English byte-identical, fixed copy still allowlisted, both packages ship `_locales`, all gates, council fixpoint, normal merge.

## Lang attribute: what changed

- A target-language span gets `lang` set to the canonical BCP-47 code (`es` for the bundled pack; the generated pack's code from the content-script config). An unparseable code leaves `lang` off.
- The span has no `aria-label` while it shows the target word, so its accessible name is the word alone, computed from its `lang`-tagged text. `aria-describedby` points at a description holding the gloss and the action, for example `and · "ee". Show English`. A flipped span's description is the action (`Show Spanish`) and its name is the English word.
- Descriptions live in one hidden, `lang="en"` container appended to the document element, never inside a passage. Ids carry a random per-instance prefix. `revert` and `dropIntroduction` remove a span's description. The content script prunes descriptions of spans the page removed after every mutation batch. A container the page removes is re-attached on the next description.
- The gloss box stays `aria-hidden`, the 700 ms beat and fixed placement are unchanged, and the scanner rule is unchanged.
- Evidence: Bun tests prove a passage holding its own `es` spans stays readable and repaints identically on a rescan, the non-English skip rule still skips, the container is never a passage on X or prose pages, pruning follows the page, and in the churn harness the tagged span is not repainted and costs no model call. The gloss Chromium gate asserts the real painted span's `lang` and description and reads Chrome's own accessibility tree over the DevTools protocol: name `y`, description the gloss. The highlights gate asserts the `lang`-tagged fixture keeps the reader's font and line box and the container never renders.

## i18n scaffold: what moved

- `_locales/en/messages.json` holds 442 English messages, each with a translator description; dynamic parts are named placeholders with examples. `src/messages-en.js` mirrors it for contexts without `chrome.i18n` (happy-dom tests). `node extension/scripts/messages.mjs` regenerates the mirror and `--check` verifies it.
- `src/i18n.js`: `t(key, ...subs)` returns Chrome's message, else the bundled English, else `''` as Chrome does. `tn(key, count, ...)` selects `key_one`/`key_other` (or any CLDR form a locale defines) by the plural rules of the messages' own language (`locale_lang`), falling back to `_other`. `localize()` fills `data-i18n` text and `data-i18n-aria-label`/`title`/`placeholder`/`alt` attributes; an element with child elements keeps them as `$1..$9` in its message, and a message that does not name each child exactly once is skipped. No markup comes from a message. Pages keep their English in the markup, so nothing flashes and a missing message changes nothing.
- Manifest: `default_locale` `en`; name, description, toolbar title and both shortcut descriptions are `__MSG_` keys.
- Moved surfaces: popup, settings, welcome, review, My words, capture, backup (markup and script), the shared progress copy (`progress-text.js`), the inline recall panel and ratings (`content.js`), the practice cue and swap descriptions (`text.js`), the model status labels (`quota-status.js`) and the toolbar badge titles and `NEW` (`badge.js`).
- Fixed copy stays allowlisted. Status labels are whole sentences per category, with and without a retry time; tests compare every status label and badge title against the `status_` and `badge_` messages with a locally formatted time as the only substitution.
- Packaging: both builds ship `_locales` (they already walked it); `verifyPackage` now refuses a malformed locale file or a manifest `__MSG_` key the default locale lacks. The e2e harnesses copy `_locales` beside `src` and `icons`.

## What stayed fixed, and why

- Text the worker sends and pages only display: worker error strings, capture and backup handler errors, the My words `reason` (compared byte-for-byte with a worker literal), and the capture context-menu title in `capture-handlers.js` (worker code outside this lane's authority). Filed as a follow-up.
- Language names from `Intl.DisplayNames(['en'])` (`language-name.js`), so `Show Spanish` names the language in English in every locale. Filed as a follow-up.
- The welcome demo sentence: `applySwaps` matches its English against the fixed demo word list.
- Symbols and separators (`!`, `•`, `–`, `·`, `⇄`), identifiers, file names, option values, model names, numbers and dates formatted by `Intl`, and user or product data, which enter messages only as substitutions.
- `progress-text.js` still exports its old English `plural()` for compatibility; nothing in the pages uses it.

## How a translator adds a locale

1. Copy `extension/_locales/en/messages.json` to `extension/_locales/<code>/messages.json`, using Chrome's locale directory names (for example `fr`, `pt_BR`).
2. Translate each `message`. Keep every `$NAME$` placeholder; reorder them freely. Read the `description` for context and the placeholder `example` for its shape. Never add markup.
3. Set `locale_lang` to the locale's BCP-47 code (for example `pt-BR`). Pages use it for their `lang` attribute and plural rules.
4. For each `_one`/`_other` pair, add any other CLDR plural forms the language needs (`_zero`, `_two`, `_few`, `_many`) with the same placeholders. A missing form falls back to `_other`.
5. A missing message falls back to English, key by key. Keep `badge_new_text` to four characters or fewer.
6. Run `cd extension && node scripts/package.mjs` (it refuses malformed locale files) and load the extension with Chrome set to that UI language.

## What was not tested

- Real screen readers (NVDA, JAWS, VoiceOver, TalkBack). The evidence is Chrome's computed accessibility tree, which is what assistive technology reads, not a spoken check.
- A non-English locale end to end. Only the English messages exist; the `chrome.i18n` path is exercised in real Chromium for English and through mocks in unit tests.
- Live Gemini; every browser gate uses synthetic Gemini.

## Decisions and evidence

- 2026-10-31: Claimed `i18n-and-lang-attr`; read ROLES (Lead), DESIGN, ROADMAP M3, ux-audit (f) and section 3, the highlight and cue records, and the swap, scanner and churn code.
- 2026-10-31: Bend, logged: `lang` follows the shown face rather than every swap span (see assumptions). The flipped state also drops its `aria-label` in favour of a description, so both faces use one mechanism.
- 2026-10-31: Bend, logged: `progress-text.js` was not named in the brief but holds only page copy for the popup, settings and My words; it moved with them, with its exports unchanged.
- 2026-10-31: Lang series passed 360 Bun tests and the gloss, highlights and smoke Chromium gates before the i18n work began. Implementers reported green Bun tests and their page gates; after cherry-picking, 378 Bun tests passed on the merged head.

# Selective upstream gloss integration

## Current state

REVIEW CLEAN on `upstream-fixed-gloss` from the merged 0.7.1 baseline. PR #11 holds the bounded 0.7.2 gloss placement repair. The PR records exact-head local gate results and readiness; source acceptance, merge and fleet rollout belong to the parent controller. This public record contains no private coordination data.

## Context and assumptions before edits

- The shipped `content.js` waits 700 ms before adding `.fw-tip` and records a hover peek only after that timer; focus does not record a peek. `content.css` currently renders `data-tip` through `::after` inside the word, so an overflow ancestor can clip it. The existing 2 px solid underline, state cues, and forced-colors behavior are accepted.
- Only a connected, current, listed target span may show the delayed visual gloss. Ordinary woven words already carry an immediate accessible gloss in their label; this remains for screen-reader use. A practice/inline-recall span or an unrevealed introduction has no answer through any visual or accessible surface. A flipped English span should not leave a stale box.
- Page text, settings and DOM may change while a delayed timer is pending. Site disablement, permission loss, sensitive title, language/revision change, reversion, removal and orphaning must cancel or suppress disclosure. Programmatic page events must not create a trusted interaction.
- The page may use clipping, stacking contexts, broad CSS, long text and narrow viewports. One page-level fixed box with bounded dimensions is sufficient for ordinary pages; a hostile page can still tamper with extension DOM and absolute guarantees against arbitrary CSS are outside this work.
- The box is display only and uses text nodes/textContent. It must not enter passage scanning or model requests. Existing legacy `fr` identifiers and target casing/article validation are authoritative.

## Acceptance plan

Adapt the frozen upstream fixed-box and host-CSS evidence selectively, retaining local delayed hover, peek accounting, recall exclusion and highlight rules. Add paired positive/negative DOM tests with mutation-red proof, then isolated real Chromium checks using production assets and synthetic provider replies. Check clipping, edges, light/dark/forced colors, keyboard/focus, lifecycle cleanup, long content and host CSS. Run frozen install, full Bun/Python, version/35-block/diff and guarded browser flows at final immutable head. Council review to fixpoint precedes a ready PR; no live provider, personal profile or fleet action is claimed.

## Provenance

Frozen upstream `b1a7a766c0626801f4fc04c0376b9b48a30480ff` supplies the page-level fixed placement concept; `ffae3ccf7c0eba3364b8fe22cd86a5939612c1c0` identifies word-inclusive text and a `:not(:defined)` host-CSS failure. Upstream `dcdfa406a5b2e7d8b264cafd1c27a4290a73ec46` changes disclosure timing and is excluded. The local implementation and tests determine behavior.

## Implementation and preliminary evidence

- A single `div.fw-gloss` is appended to the document root only after the current 700 ms timer. It renders the display target, English gloss and available hint with `textContent`, and is hidden from the accessibility tree because the owned word already has a usable label. Focus does not count a peek; trusted hover does. Ordinary target labels now include the sound hint, while inline recall labels and attributes remain answer-free until Reveal.
- The fixed box has viewport-bounded width/height and wrap, explicit font/color, pointer passthrough and forced-colors rules. Existing solid 2 px word underline, active/practice cues, and link behavior remain. Removal covers flip, pointer/focus departure, scroll, resize, hidden tab, text mutation, reversion, site/title/config transitions and orphaning.
- Focused Bun DOM tests and temporary-copy mutation-red probes cover box creation, hover/focus overlap, pointer exit before reveal, null event targets, focused fallback, focus scroll, and keyboard priority. Each targeted mutation made the relevant assertion fail; shared source was not changed for those checks.
- Preliminary full gates on the earlier repair head passed: frozen Bun install; **140 Bun tests, 2,862 assertions**; **91 Python tests**; 0.7.1→0.7.2 version check across three surfaces; 35 generated blocks; diff check. Guarded synthetic Chromium smoke, gradual, quota/status, highlights and focused gloss flows passed. The final exact-head results are in PR #11. The focused flow uses production extension assets with a throwaway profile and browser-level DNS/proxy denial plus an owned positive control. Latest hover-to-box measurements were **704 ms light / 702 ms dark**; both box rectangles were `x=90.58..177.64, y=54..82.19`, outside the clipped ancestor's `y=20..46` and inside the `620×420` viewport. An early 250 ms check found no visual box or peek. It also checks edge/zoom/long text, keyboard/focus including a parked pointer, scrolling, resize, page mutation, sensitive title, site-off and forced colors. The long text was a deliberate post-validation DOM change for layout stress, not evidence that a model returned that content.
- Screenshots: `docs/artifacts/gloss-light.png`, `gloss-dark.png`, `gloss-light-forced.png`, and `gloss-dark-forced.png`. Computed visibility/position/contrast assertions supplement visual inspection. DOM assertions support accessible markup, but no screen-reader user testing or live Gemini was done.

## Known layout limit

Very long glosses are bounded to the viewport and can truncate at extreme lengths. A page that deliberately overrides the extension's high-specificity styles or transforms the document root may still interfere with placement; page DOM is not a security boundary. These limits do not affect ordinary clipping-container placement demonstrated above.

The bounded 250 ms focus-scroll grace covers ordinary immediate focus scrolling; unusually long smooth scrolling may still close the box. A pointer crossing a focused word before reveal restarts its dwell, so repeated passes may defer that focus gloss. Follow-up issues `gloss-smooth-focus-scroll` and `gloss-focus-pointer-dwell` capture these minor cases with rationale and test expectations.

## First council round and repair

- Reviewed pushed `2fa65d8`: OpenAI native CLEAN with two pointer/focus overlap nits; Anthropic Opus found an Important ordinary-element `mouseout`/`focusout` null-target error and an Important non-diagnostic passage-leak assertion. Google was unavailable because its individual quota was exhausted; its seat remains empty.
- The event guard is repaired; a focused DOM test now covers hover/focus overlap, focused-word restoration after another hover, ordinary-element leave events and focus-induced scroll. Temporary-copy mutations of the overlap, restoration, null guard and scroll repair each made the relevant assertion fail. The focused Chromium flow also proves an offscreen loaded target gains a delayed gloss after focus scroll.
- The browser assertion now checks actual visible gloss text and a long synthetic hint against captured model passages after the observer's flush window. Highlight CSS checks now assert computed box colors, high contrast, forced-color border and pointer passthrough. The original self-confirming fixture-text assertion was removed.

## Convergence record

- The first repair delta through `977def9` was CLEAN from native OpenAI and foreign Anthropic. The next pointer/focus polish delta through `316a446` exposed an Important early-`mouseout` timer cancellation in both seats. The focused word could otherwise remain without a gloss after pointer exit.
- The fix at `4d4748e` retains a pending focus reveal while canceling a separate hover peek. DOM cases cover both hover/focus orders before reveal, a focused box with an early pointer exit, and a full 700 ms hover peek. Temporary-copy mutations of the priority, focused-box preservation, repositioning and pending-timer repair each failed the corresponding test. The focused Chromium flow also proves keyboard focus takes over from a pointer parked on another word. A page-error listener was removed from the browser proof because its coverage of isolated content-script exceptions was unproven; the direct DOM handler test covers the event-guard defect.
- Native OpenAI and foreign Anthropic convergence reviews on `316a446..4d4748e` were CLEAN: zero new Critical or Important findings. The two earlier Important findings and the later timer cancellation were reverified fixed. Google could not sit because its individual quota was exhausted; its seat stayed empty. Non-blocking focus-scroll and pointer-dwell polish was filed in the issues above. The final PR comment records review seats and exact-head gates. No live provider call or screen-reader user test is claimed.

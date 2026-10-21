# Selective upstream gloss integration

## Current state

STARTED on `upstream-fixed-gloss` from merged 0.7.1 baseline. This lane owns a bounded 0.7.2 gloss placement repair, its tests and evidence, and a ready reviewable PR. Source acceptance, merge and fleet rollout belong to the parent controller. This public record contains no private coordination data.

## Context and assumptions before edits

- The shipped `content.js` waits 700 ms before adding `.fw-tip` and records a hover peek only after that timer; focus does not record a peek. `content.css` currently renders `data-tip` through `::after` inside the word, so an overflow ancestor can clip it. The existing 2 px solid underline, state cues, and forced-colors behavior are accepted.
- Only a connected, current, listed target span may disclose a gloss. A practice/inline-recall span or an unrevealed introduction has no gloss through any visual or accessible surface. A flipped English span should not leave a stale box.
- Page text, settings and DOM may change while a delayed timer is pending. Site disablement, permission loss, sensitive title, language/revision change, reversion, removal and orphaning must cancel or suppress disclosure. Programmatic page events must not create a trusted interaction.
- The page may use clipping, stacking contexts, broad CSS, long text and narrow viewports. One page-level fixed box with bounded dimensions is sufficient for ordinary pages; a hostile page can still tamper with extension DOM and absolute guarantees against arbitrary CSS are outside this work.
- The box is display only and uses text nodes/textContent. It must not enter passage scanning or model requests. Existing legacy `fr` identifiers and target casing/article validation are authoritative.

## Acceptance plan

Adapt the frozen upstream fixed-box and host-CSS evidence selectively, retaining local delayed hover, peek accounting, recall exclusion and highlight rules. Add paired positive/negative DOM tests with mutation-red proof, then isolated real Chromium checks using production assets and synthetic provider replies. Check clipping, edges, light/dark/forced colors, keyboard/focus, lifecycle cleanup, long content and host CSS. Run frozen install, full Bun/Python, version/35-block/diff and guarded browser flows at final immutable head. Council review to fixpoint precedes a ready PR; no live provider, personal profile or fleet action is claimed.

## Provenance

Frozen upstream `b1a7a766c0626801f4fc04c0376b9b48a30480ff` supplies the page-level fixed placement concept; `ffae3ccf7c0eba3364b8fe22cd86a5939612c1c0` identifies word-inclusive text and a `:not(:defined)` host-CSS failure. Upstream `dcdfa406a5b2e7d8b264cafd1c27a4290a73ec46` changes disclosure timing and is excluded. The local implementation and tests determine behavior.

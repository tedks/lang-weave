# Lang Weave language mission

## Current state

State: visible generic Lead owns this branch and the installer compatibility
branch. Source draft PR #3 targets `main`; installer draft PR #200 remains at
`9507a25` with its old pin. Reviewed source `4efb3af` passed 101 Bun tests (1263
assertions), 85 Python tests, version/block/diff checks and real Chromium with
synthetic Gemini. The prior fix delta through `9ed09c2` passed three-seat
convergence. The lower branch rotates a persisted epoch on effective settings
and pack changes and permission events, so a round trip cannot revive an old
page revision. A second repair guards primary and fallback network dispatch
after asynchronous storage reads; held quota, key, review and cache reads plus
a held counter write test site-off or permission revocation with zero sends,
and a permitted case sends once. Mutation checks made
the pre-dispatch guard and the post-counter guard fail red before restoration.
The latest review found and repaired an update-check lock inversion; its
held-read regression also failed red under the old order. Native and Anthropic
reviews of the `5fb9f2d..80947e6` repair delta and the final
`80947e6..4efb3af` polish delta are CLEAN; Google was quota unavailable.
Next: run exact-head gates after this record/test cleanup, then publish the
immutable lower SHA to the upper Lead and CTO. The upper gradual-learning
branch owns inline recall ticket checks against this opaque revision and is
holding rebase. A separate 0.4 privacy
backport candidate is being prepared for CTO review. Neither source nor
installer has been merged or released. The CTO owns bottom/top merge, GitHub
rename timing, installer pin and fleet release. This record belongs to the
language Lead; other mission records have separate owners.

## Intent and boundaries

Extend the standalone Chrome extension to teach target languages while reading
English. Spanish remains the default and its bundled vocabulary must work
offline. A user may select another target and explicitly generate a bounded,
experimental local vocabulary pack with their own Gemini key. Progress,
reviews, reading events, cache entries, and asynchronous results must not cross
target-language or pack boundaries.

The product and GitHub repository will be named Lang Weave. The unpacked
installation directory stayed `spanish-weave/extension` until 0.12.0, because
moving it changed Chrome's extension identity; since 0.12.0 a manifest key fixes
the identity and installs move once to `lang-weave/extension`
([record](STABLE-ID-MISSION.md)). English remains the source language. Generated packs are not a
linguistic quality guarantee. Adaptive density, in-band recall, takeover,
Duolingo import, and native hosting are outside this mission.

## Assumptions and failure modes

- The extension's browser storage is the only persistent product state. The
  user's API key stays there and is used only on explicit setup or enabled
  reading requests. Development uses synthetic model responses.
- Existing Spanish settings and progress must survive upgrade, restart,
  switching away, and switching back. Migration must be repeatable.
- Generated content and language labels are untrusted data. Invalid identifiers,
  oversized or malformed packs, duplicate words, invalid glosses, or model
  instructions disguised as data must fail without replacing a working pack or
  changing the selected language.
- Site permission, sensitive-content, editable-text, off-switch, and stale
  response guards continue to govern every target. A late response from a
  prior language or pack must not mutate the current page or history.
- One Latin-script and one non-Latin target are verification fixtures, not
  claims that arbitrary languages are grammatically supported.
- Repository rename and installer pinning are coupled: an archive can change
  its prefix or digest after the GitHub rename even if its commit is the same.
  The fleet installer must validate the actual post-rename archive before an
  installed payload is changed.

## Acceptance evidence to collect

Unit and browser tests for Spanish migration, generation validation, restart,
switching, review isolation, and stale responses; local source gates on the
exact reviewed head; council convergence; normal PR merge; verified owned
GitHub rename; checksum-pinned installer tests and archive staging; targeted
host status showing staged payload separately from browser activation.
No live Gemini request is part of development verification.

## 2026-10-18 implementation and gate evidence

- `src/languages.js` validates canonical language identifiers and bounded
  generated packs (20–80 entries, two levels, unique target forms, short
  fields, no markup/control characters). The popup explicitly generates a
  pack with the saved key, then selects it only if generation and validation
  succeed. A failed generation preserves the selected target and histories.
- `src/scope.js` maps reading and recall state by language and pack version.
  The legacy Spanish storage keys are retained. Cache keys include the
  context revision; content events include that revision and the worker
  rejects late events after a switch. The same revision guard rejects late
  model swaps. Spanish-specific article/diacritic behavior remains confined
  to Spanish; other targets use exact listed forms and gloss matching.
- Focused tests cover French and Japanese fixtures, malformed output,
  generation failure/success, migration, restart, language switch-back,
  same-spelled event isolation, recall isolation and stale events. Removing
  the event revision check made the stale cross-language event test fail;
  restoring it returned the test to green.
- At the initial implementation checkpoint before council: Bun 100/100 tests, Python
  85/85 tests, version 0.4.0→0.5.0 gate, 35 inherited block check and
  `git diff --check` passed. Real Playwright Chromium MV3 smoke passed with
  synthetic Gemini for Spanish migration, generated French and Japanese,
  source reading switches, review isolation, privacy gates and pause/site-off.
  No live Gemini request or linguistic quality claim was made. Final exact
  commit gates and council evidence remain to be recorded.

## Authority and stop conditions

This lane may edit its source and dotfiles feature branches, make reviewed
setup repairs, create PRs, rename the specifically authorized repository, and
perform targeted fleet rollout. Stop for secrets, spending, a changed product
ruling, an unsafe state that cannot be preserved, or an outward act beyond
this named repository and fleet workflow. Record deviations and exact evidence
here as work advances.

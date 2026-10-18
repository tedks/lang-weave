# Lang Weave language mission

## Current state

State: the visible generic Lead's source and installer implementation missions are
accepted and merged. The predecessor's transferred checkpoints were clean/pushed
source `5ad04de` and installer `9507a25`; this Lead audited that handoff,
completed the remaining regression and consent-dispatch repairs, and kept the
source and installer worktrees separately owned. Source PR #3 merged normally as
`31b1cc3f68770015543d6c88edf4681a8c4c0acf` in the renamed
`tedks/lang-weave` repository. Its merged tree matches the fully gated source
code checkpoint `e005d7f73d72bb187bcc90b4eeb39b37747a7bd0`: 101 Bun tests,
85 Python tests, version/block checks and real Chromium MV3 with synthetic
Gemini. OpenAI and Anthropic fix-delta council seats were CLEAN; Google was
quota unavailable. The root CTO performed the merge and rename.

Installer PR #200 merged normally as `c2243c18ce8fd646b4e2f551ad8e7aefb236dcbd`
from exact gated installer head `7123f4a412f02e3cab0eb25f0b82368300598f2b`.
The pin uses the measured archive digest for the merged source commit and keeps
the historical `spanish-weave/extension` installed path. Eighteen installer
tests, 186 integration checks, syntax/diff checks, isolated actual-archive
install/status and staged Chromium passed. The actual renamed archive of 0.4.0
also passed an isolated 0.5.0-to-0.4.0 rollback test. OpenAI and Anthropic
fix-delta seats were CLEAN; two presentation nits are tracked separately.
Acceptance evidence is recorded on PR #3 and PR #200. The CTO verified
0.5 payload installation and `--status` on framework0, drynwyn, splinter1
and tower0 at those exact merges; a real Chromium MV3 smoke using synthetic
Gemini passed from framework0's staged installed path. The stable installation
paths, browser profile data, backups and unrelated tower0 files were preserved.
This is file-staging evidence: browser reload, per-profile activation and live
Gemini remain unverified. splinter0.local was unreachable by DNS and was not
mutated; its existing follow-up remains open. The CTO posted the rollout
receipt on PR #200 and owns any remaining host work.

A separate legacy 0.4 consent hotfix candidate remains coherent and local at
`0c9c681`, without a public branch or PR. Its final head passed focused tests
only; full gates were last run on an earlier checkpoint, so it is not a
verified release candidate. The separate 0.4 release path is redundant after
the verified 0.5 rollout; preserve the candidate/evidence without publishing it.
The upper gradual-learning work is separately owned. Next bounded action for
this lane: preserve the private handoff and scratch inventory, then remain
idle for the CTO's receipt. No additional release, product phase or branch
deletion is authorized.

## Intent and boundaries

Extend the standalone Chrome extension to teach target languages while reading
English. Spanish remains the default and its bundled vocabulary must work
offline. A user may select another target and explicitly generate a bounded,
experimental local vocabulary pack with their own Gemini key. Progress,
reviews, reading events, cache entries, and asynchronous results must not cross
target-language or pack boundaries.

The product and GitHub repository will be named Lang Weave. The existing
unpacked installation directory remains `spanish-weave/extension` under the
effective XDG data directory because moving it can change Chrome's extension
identity. English remains the source language. Generated packs are not a
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

The source and installer implementation missions are merged, and the CTO
owns rollout and any remaining host work. This lane now owns only preservation:
tracker accuracy, this mission record, the private handoff and the local
unpublished hotfix candidate. No new product phase, deployment, merge or
branch deletion is authorized. Record exact evidence and keep browser
activation distinct from installed files.

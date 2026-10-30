# First-run welcome page

State: council fixpoint CLEAN and all local gates passed for PR #29. The PR records the exact final gate SHA and merge state. Issue: `welcome-page`. The earlier export failure was closed as `welcome-portability-export-timeout`. Initial source commit: `31eb1b6`.

## Decisions

- Only a fresh install with no saved settings receives `consentShown: false`. An existing profile whose flag is absent remains allowed, including after the upgrade normalizes its settings.
- The demo selects a fixed set of entries by English gloss from the bundled Spanish Beginner list. `text.js` creates the same span markup and flip behavior as a reading page; a small page-local handler recreates the content script's delayed gloss without starting its scanner or worker requests.
- The all-sites choice requests optional host access from its click and records consent only after Chrome grants it. The recommended only-sites choice saves `newSitesEnabled: false` with no permission request. Neither choice is automatic.
- The worker checks consent before reading model dispatch, using the same storage read as the key and quota state. The flag changes only from false to true through the UI, so a request that began without consent cannot dispatch when consent is later given. Key tests and generated language requests are gated too. The `gradual:true` install hook remains pending Ted's ruling; the page recommends five words per day without changing defaults.
- **Export repair.** `consentShown` is local site policy, outside the learning backup. `portability.js` excludes that key from the strict learning-key scan. A new test first failed with `Learning backup: unknown storage format`, then passed after the exclusion; it also checks that the marker is absent from the exported file and is not imported into a fresh target.

## Verification so far

- `nix shell nixpkgs#bun --command bun install --frozen-lockfile`: 11 development packages installed.
- `nix shell nixpkgs#bun --command bun test`: 297 passed, 0 failed (47,785 assertions).
- `python3 -m unittest discover -s tests`: 91 passed.
- `python3 tests/check_version_bump.py --base origin/main`: 0.12.8 → 0.12.9, passed.
- `git diff --check`: passed.
- `node extension/scripts/package.mjs` and `--store`: verified; each archive has 67 entries, including `welcome.html` and `welcome.js`.
- Real Chromium, synthetic fixtures: all eleven scripts passed: `smoke`, `again`, `adaptive`, `highlights`, `personal`, `portability`, `gradual`, `gloss`, `quota-status`, `store`, and `welcome`. The welcome test found the install tab, delayed gloss, flip and only-sites consent, and observed no Gemini request.
- The prior `portability` timeout was diagnosed: the backup tab was the clicked page; no page received a download; its port was connected and ready; its notice said `Learning backup: unknown storage format`. The new `consentShown` top-level key caused strict export validation to reject storage. After the repair, the download fired on the backup tab, its notice reported success, and the complete portability script passed after both deliberate MV3 idle waits. Temporary diagnostic instrumentation was removed from the harness.

## Not verified

No live Gemini request, real user profile, Chrome Web Store installation, or Store upload was used. The browser gates used synthetic model responses and isolated profiles.

## Council

- Round 1 at `816ae08`: OpenAI native Codex `gpt-6-sol` CLEAN with one copy nit; Anthropic Claude Opus found one plausible Important migration concern and nits; Google agy EMPTY (quota exhausted, no substitute).
- The migration concern was checked against `targetFresh` and pinned with an explicit import target after either welcome choice. The copy now distinguishes page text from Settings' key-test probe. Other in-scope nits fixed: local consent refusal no longer writes model diagnostics; Test key reports consent refusal accurately inside the lock; the welcome tab creation promise is caught; the gesture test checks synchronous permission-request order; router near-miss coverage was restored; key-test and pack-generation consent gates have tests.
- Convergence on `816ae08..2e9d3c4`: both OpenAI and Anthropic seats returned CLEAN, with no new Critical or Important findings. Anthropic's remaining nits were filed. Follow-ups: `welcome-consent-navigation`, `welcome-model-gate-centralization`, `welcome-upgrade-consent-test`, `welcome-e2e-ready-helper`, and `welcome-tab-sync-error`. The first issue also covers the Settings site-choice inconsistency explicitly.

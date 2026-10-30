# First-run welcome page

State: blocked on `welcome-page`; no merge. Issue: `welcome-page`, paused. The gate failure is tracked as `welcome-portability-export-timeout`. Source commit: `31eb1b6`.

## Decisions

- Only a fresh install with no saved settings receives `consentShown: false`. An existing profile whose flag is absent remains allowed, including after the upgrade normalizes its settings.
- The demo selects a fixed set of entries by English gloss from the bundled Spanish Beginner list. `text.js` creates the same span markup and flip behavior as a reading page; a small page-local handler recreates the content script's delayed gloss without starting its scanner or worker requests.
- The all-sites choice requests optional host access from its click and records consent only after Chrome grants it. The recommended only-sites choice saves `newSitesEnabled: false` with no permission request. Neither choice is automatic.
- The worker checks consent before reading model dispatch, using the same storage read as the key and quota state. The flag changes only from false to true through the UI, so a request that began without consent cannot dispatch when consent is later given. Key tests and generated language requests are gated too. The `gradual:true` install hook remains pending Ted's ruling; the page recommends five words per day without changing defaults.

## Verification so far

- `nix shell nixpkgs#bun --command bun install --frozen-lockfile`: 11 development packages installed.
- `nix shell nixpkgs#bun --command bun test`: 295 passed, 0 failed (47,580 assertions).
- `python3 -m unittest discover -s tests`: 91 passed.
- `python3 tests/check_version_bump.py --base origin/main`: 0.12.8 → 0.12.9, passed.
- `git diff --check`: passed.
- `node extension/scripts/package.mjs` and `--store`: verified; each archive has 67 entries, including `welcome.html` and `welcome.js`.
- Real Chromium, synthetic fixtures: `e2e/again.mjs`, `adaptive.mjs`, `highlights.mjs`, `personal.mjs`, `smoke.mjs`, and `welcome.mjs` passed. The welcome test found the install tab, delayed gloss, flip and only-sites consent, and observed no Gemini request.
- `e2e/portability.mjs` timed out waiting for the source profile's export download after its intentional 35-second idle wait in three consecutive runs. Waiting for initial settings storage in its fixture did not resolve it. Per the package stop condition, the lane stopped. The old page's notice/port state has not been captured, so causality is unknown.

## Not verified

The remaining browser gates (`gradual`, `gloss`, `quota-status`, `store`) and council review were not run after the stop condition. No live Gemini request, real user profile, Chrome Web Store installation, or Store upload was used.

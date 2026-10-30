# Store readiness: engineering half

State: implemented on `store-engineering`, [PR #23](https://github.com/tedks/lang-weave/pull/23); council review and merge evidence are on the PR. Lead: Claude Opus 5.5 native subagent `lead-store-engineering`. Issues: `icons-and-listing`, `privacy-and-fingerprinting` and `gate-self-update` (engineering halves only), plus `store-x-content-script-ruling` option A. The fingerprint itself is not removed. Item 2 below explains why, and the fix awaits a ruling (`content-bundle-no-war`).

## Intent and boundary

Make the extension's own engineering ready for a Chrome Web Store build without changing learning behaviour. The scope is icons, the web-accessible surface, an inherited log tag, a gated self-update and a table-driven Store manifest delta. There was no Store upload, no real browser profile, no live Gemini call and no new runtime dependency. The listing, screenshots, consent screen, privacy policy and Dashboard forms remain open on their issues.

## What changed

1. **Icons.** `extension/design/icon.svg` is the source: a teal tile with two white and two amber strands woven over and under, on a 16-unit pixel grid. `extension/scripts/icons.mjs` renders it to `extension/icons/icon-{16,32,48,128}.png` with node built-ins only. The manifest declares all four sizes as `icons`, and 16 and 32 as `action.default_icon`. The 128 icon keeps the Store's 16 px transparent padding.
   - *Why a Node renderer, not Chromium:* Skia's anti-aliasing and PNG output can change between the Chromium builds Playwright installs. Here every size is an integer scale of the grid, so only the rounded tile corners need anti-aliasing, done with a fixed 16×16 supersample. Pixels are exact, and the checks compare pixels rather than deflate bytes, which differ between zlib builds.
   - The SVG lives outside `icons/` so the package ships only the PNGs.
2. **Web-accessible surface.** `web_accessible_resources` no longer exposes every `src/*.js` to every origin. It lists exactly `content.js` and its static import closure, 15 of 47 files, with no globs. A test derives the closure with the package script's import scanner and requires equality. Worker, popup, router and update code are no longer probeable. The 15 listed files still are, at `chrome-extension://lkbkmlgogcpcacjmdmoecgacdbfddbnh/src/content.js`, so the fingerprint remains.
   - *Why not `use_dynamic_url`:* in Chromium 156, `chrome.runtime.getURL` in a content script returns the per-session dynamic URL, and `content.js` loads from it. But the loaded module's `import.meta.url` is the static-ID URL, so every relative import resolves to the static ID and Chrome denies it. Smoke times out. This was reproduced with a two-file probe extension and with the e2e smoke. That is the brief's stop condition, so it was reported as NEEDS RULING with options. Option A, this narrowing, landed. A Store-only classic content bundle is recommended before the first upload (`content-bundle-no-war`).
3. **Log tag.** `content-loader.js` logs `[lang-weave]`. Other inherited French identifiers in shipped `src/` stay as they are, for the reasons in the decision log.
4. **Self-update gate.** `update.js` runs the disk-manifest check, `chrome.runtime.reload()`, the NEW badge and the 30-minute alarm only when the running manifest has no `update_url`. Without them the status reply's `update` stays empty, so the popup banner stays hidden with no popup change. The Chrome Web Store and Edge Add-ons write `update_url` into the manifest they install. Unpacked loads, including the fleet's, read the source manifest, which has none, and a test pins that.
5. **Store manifest delta.** `package.mjs` `STORE_DELTAS` is a table with one row per top-level manifest key the Store build changes, each with its reason. `storeManifest()` applies exactly those rows. A test requires that the Store manifest differs from the dev manifest in exactly the table's keys. The one row today removes the x.com/twitter.com `content_scripts` entry, but only when that entry is exactly the loader: `content-loader.js`, `content.css` and `document_idle`. A row whose precondition fails throws rather than shipping a different manifest. The dev `key` stays in both builds, because `store-manifest-key-delta` waits on a ruling.
   - `sites.js` used to exclude X from the dynamic registration unconditionally, which would have made X unreachable in the Store build even after a grant. It now excludes exactly the hosts where the running manifest injects the loader, ignoring unrelated scripts. It always passes an explicit list. That matters because `updateContentScripts` keeps an omitted property, while an empty list clears it. Both behaviours were observed in Chromium 156.

## Verified

The exact commands and the commit they ran on are on the PR. In summary:

- `bun test`: all pass, including the new `icons`, `update-gate`, `sites` and `web-accessible` tests and the rewritten `package` Store tests. Mutation checks:
  - Removing either self-update gate fails the gate test.
  - Restoring the hard-coded X exclusion fails the sites unit test and the Store e2e.
  - Omitting the empty exclusion fails the Store e2e's restart check.
  - Counting unrelated manifest scripts fails the sites test.
  - Dropping the X-entry shape check fails the package test.
- `e2e/store.mjs` (new), in real Playwright Chromium 156, with DNS resolving nothing and Gemini mocked:
  - **Store manifest,** with an `update_url` added to stand in for the one the Store writes at install, plus test-only grants. No `updates` alarm is armed. Granted sites are registered with an empty exclusion. A granted X page is woven through the dynamic registration. A stale X exclusion is cleared by a restarted service worker, stopped through the DevTools Protocol with the extension still loaded. Relaunching the browser would not exercise this, because reloading an unpacked extension drops dynamic registrations.
  - **Dev manifest.** The alarm is armed. A granted X page is woven from the manifest entry, while the dynamic registration excludes X.
  - **Both builds.** The `src/*.js` a web page can fetch are exactly those `web_accessible_resources` lists.
- `e2e/smoke.mjs`, `highlights.mjs`, `personal.mjs`, `quota-status.mjs` and `gloss.mjs` pass with the narrowed resources. That shows the dynamic `import()` and the whole content graph still load. `e2e/portability.mjs` fails at the review page's `#empty` wait. It fails identically on the untouched base `ebf183c`, so the failure predates this PR; it is reported to the learning-core lane. Every e2e harness now copies `icons/`, because Chrome refuses to load an unpacked extension whose declared icons are missing. That was observed: smoke timed out waiting for the service worker before the fix. Smoke and portability can also load an alternate source tree, such as a pre-0.12.5 release with no `icons/`, so those two copy it only when it exists.
- `node scripts/icons.mjs --check`, `node scripts/package.mjs` and `--store`, the Python suite, the version-bump check and `git diff --check`.
- The icon preview was inspected at 16, 32, 48 and 128 on white, light-grey, `#202124` and `#3c4043` toolbars. WCAG contrast tests check three things: the tile against light toolbars, the strands against dark toolbars, and the strands against the tile.

## Not verified

- **No Store upload or real Store install.** That the Store and Edge write `update_url` into the installed manifest is documented, widely relied-on behaviour. Here it was only simulated, by adding the key to an unpacked copy. Chrome does expose it through `getManifest()` there.
- **No real profile, no live Gemini, no Edge or Firefox run.** Firefox AMO installs carry no `update_url`, so the `firefox-support` mission must revisit the gate, probably with `management.getSelf().installType`.
- **No real toolbar rendering.** Chrome's own toolbar was not screenshotted, and badge text over the icon was not tried.

## Council

- **Round 1 at `d8078c2`.** Seats: Claude (native Opus subagent), Codex (`gpt-6-sol` via ask-agent), agy EMPTY (quota exhausted today, not backfilled). No Critical.
- **Fixed:**
  - Claude: the alternate-source mode of smoke and portability broke on the unconditional `icons/` copy.
  - Codex: the X Store row checked only `matches`.
  - Both seats: `declaredMatches` counted unrelated manifest scripts.
  - Both seats, as nits: the SVG root attributes and prolog were unchecked.
  - Claude, nit: the closure test missed runtime loads.
  - Codex, nit: a comment called page code unprobeable.
  - Claude, nit: the update path with an empty exclusion was proven only by a mock. It now has a real-Chromium restart check.
- **Filed:** `store-drop-alarms-permission` (Claude, Important; it needs `background.js`, outside this lane's repair authority) and `store-suggest-x-onboarding`.
- **Already recorded:** the remaining fingerprint and the fleet installer (Codex, Important).

## Found on the way

- **The unpacked X content script never weaves without a separate x.com grant.** This is pre-existing. Chrome hides the tab title for a host reached only through `content_scripts` matches, so `safePageTitle` fails closed (`x-content-script-needs-grant`).
- **The fleet installer refuses any release with these icons.** It ships only the manifest, LICENSE and `src/`, and fails closed on unshipped manifest assets. Fleet installs keep working at their current pin, but the pin cannot advance past this release until the installer ships `icons/` (`fleet-installer-ships-icons`).

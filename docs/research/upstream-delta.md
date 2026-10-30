# Upstream delta audit: french-weave after 2026-10-20

Scope: upstream commits after the frozen audit head 756e32c, up to upstream/main 65699b9 (fetched 2026-10-30). Compared against the fork at store-progress-portability (manifest 0.11.0). Read-only; nothing modified. The only local effect was fetching upstream refs, including PR #5.

## Method and caveats

- The delta is 12 non-merge commits touching 17 files: 991 insertions, 79 deletions. Only the extension files matter here; `fw.py`, `commands/`, `INSTALL-FOR-AGENTS.md` and the Python tests are French companion tooling.
- Upstream's `public-release` branch does not exist on the public remote. Its merges are visible only as commit messages (c8c423f). Branches `narration-off` (fca3baa) and `ci-version-warning` (98a7fc0) are unchanged since the last audit and were already dispositioned Skip.
- Upstream's end-to-end test is Playwright on Chromium. No upstream test runs Firefox, so Firefox claims below are static reading plus two web searches, not a Firefox run. Items marked UNVERIFIED need a real Firefox before anyone relies on them.
- No upstream script was executed.

## Disposition table

| # | Upstream change (commits, files) | Fork equivalent | Risk vs fork invariants | Approach / size | Disposition |
|---|---|---|---|---|---|
| 1 | Cross-browser manifest: background `scripts` beside `service_worker`, `browser_specific_settings.gecko` (id, strict_min_version 140, data_collection_permissions). 75aa6f2, `extension/manifest.json` (+11), popup wording 6d14890 | None. Fork manifest is Chrome-only, no gecko block | Key separation may not hold on Firefox (see Firefox section). Gecko id is a permanent identity needing Ted's ruling | Add manifest keys, neutral popup wording, one real-Firefox smoke. M | **Adapt**, behind a product ruling on id/publisher and the key-storage finding |
| 2 | Firefox native host, `--browser` setup, host-manifest trust logic. 75aa6f2, 385442e, 3301bf1, 05be761; `scripts/fw.py`, `commands/setup.md`, README, Python tests | Fork has no native host or setup path | Not applicable | Nothing to port | **Skip** |
| 3 | Hover-audio speaker button in the gloss. 691d482, 0ad71b3, ce4f4ac (tagged 0.2.6, merged in 6d14890/3c02df3); `content.js` (+154), `content.css` (+56), new `speech.js` (51 lines), `speech.test.js` (446), e2e | Fork has the fixed gloss box but a different structure (below). No speech code | Sound disclosure: voices flagged `localService:false` send the word off-device. Gloss state machine differs, so a straight port conflicts | Port the pure voice picker (S). Port the button and pointer/focus logic against the fork's 700ms delayed-tip machine (L). Safer minimal variant: a keyboard/click action on the word, no pointer bridge (M) | **Adapt, local voices only**, after a product ruling on audio. Defer the full pointer/focus machinery |
| 4 | `config.language` added to the worker config so the content script can pick a voice. 691d482, `background.js` +3 | Fork's config already carries `language` code (`ctx.language`) | None | Map code to a locale tag instead of a display name | Included in row 3 |
| 5 | Popup notices made browser-neutral. 6d14890, `popup.js` | Fork popup still says "Chrome" (lines 32, 97, 137) | None | Two string edits. S | **Adopt** (only if row 1 proceeds) |
| 6 | Docs, RELEASING history rewrite, README tweaks. b79b4cc, 4647ad6 | Not applicable | None | None | **Skip** |
| 7 | Hover-audio review fixes for `content.js`: refocus the word when the box hides over a focused button, ignore pointer passes while the button has focus, no Tab hijack inside `aria-modal`, no button while a modal `<dialog>` is open. ce4f4ac, 0ad71b3 | Fork has no button, so these bugs cannot occur | Only matter if row 3 is ported | Use as a checklist for any port | Folded into row 3 |
| 8 | `narration-off`, `ci-version-warning` branches | Not applicable | None | None | **Skip** (unchanged from last audit) |

No standalone bug fix in `content.js` or page handling exists in this range. Every `content.js` change after 756e32c belongs to the speaker. The fork has nothing to catch up on there.

## (1) Firefox support in detail

### What upstream changed in the manifest

Verbatim from upstream/main:

- `background`: `{ "service_worker": "src/background.js", "scripts": ["src/background.js"], "type": "module" }`. Chrome runs the service worker and ignores `scripts`. Firefox ignores `service_worker` and runs `scripts` as a non-persistent event page. `type: module` is honored by both.
- `browser_specific_settings.gecko`: `id: "french-weave@frenchweave"`, `strict_min_version: "140.0"`, `data_collection_permissions: { required: ["websiteContent"] }`.
- Unchanged and still valid for Firefox: `permissions` (storage, alarms, scripting, activeTab), `host_permissions`, `optional_host_permissions` for `http://*/*` and `https://*/*`, static X content scripts, `web_accessible_resources` for `src/*.js`.
- Dropped for Firefox: nothing. Upstream also keeps the Chrome `key` field, which Firefox ignores, and `nativeMessaging`, which the fork lacks.

A single manifest can serve both. Chrome may print an "unrecognized key `browser_specific_settings`" warning when loading unpacked. That is a warning, not an error. If the Chrome Web Store submission is strict about it, generate the store manifest at packaging time and keep the dev manifest unified. Upstream's Chromium e2e was updated against the unified manifest. I did not run it.

### Which fork APIs Firefox MV3 has

Static grep of the fork's `extension/src`. Firefox exposes `chrome.*` with promises in MV3.

| API used by the fork | Firefox MV3 |
|---|---|
| `storage.local`, `alarms`, `action.setBadgeText`, `tabs` (get, query, sendMessage, onRemoved) | Supported |
| `scripting.registerContentScripts`, `updateContentScripts`, `unregisterContentScripts`, `getRegisteredContentScripts`, `insertCSS`, `executeScript` | Supported (Firefox 102+) |
| `permissions.request`, `contains`, `getAll`, `onAdded`, `onRemoved` | Supported. Firefox 127+ grants manifest host permissions at install |
| `contextMenus` (selection, `documentUrlPatterns`) | Supported. The fork already guards with `chrome.contextMenus?.create` |
| `runtime.reload`, `getManifest`, `getURL`, `onConnect`, `onInstalled`, `onStartup` | Supported |
| `chrome.offscreen`, `declarativeNetRequest`, `sidePanel`, `storage.session` | Not used by the fork. No blocker |
| `storage.local.setAccessLevel` (background.js:88) | **UNVERIFIED, probably unsupported.** See below |

### Fork-specific Firefox risks upstream did not have to face

1. **API key separation.** The fork keeps the Gemini key in `storage.local` and calls `setAccessLevel('TRUSTED_CONTEXTS')` only `if (store.setAccessLevel)`. In Firefox, content scripts can read `storage.local` by default. My search found MDN compatibility data showing the setting only for `storage.session`, but I could not confirm the current Firefox row. If it is absent, the code silently skips the guard, and the store-readiness record's "key separated from content scripts" claim becomes false on Firefox. This invariant matters more than the manifest edits. Verify in Firefox; if confirmed, fetch the key only through the worker or store it somewhere content scripts cannot reach.
2. **Gemini host permission.** Firefox lets users revoke the manifest `host_permissions` in about:addons. The worker's fetch then fails. The popup should check `permissions.contains` for the Gemini origin. S.
3. **Content-script dynamic import.** `content-loader.js` does `import(chrome.runtime.getURL('src/content.js'))`. This relies on web-accessible modules working in a Firefox content script. UNVERIFIED; upstream ships the same loader but no Firefox test exists.
4. **Event page lifetime.** Firefox event pages idle out like Chrome service workers. The fork's in-memory state (capture drafts, cooldown maps) is already designed for worker restarts, so this is low risk, but the consent rechecks after awaits need a Firefox pass.
5. **`checkUpdate` self-reload.** `fetch(getURL('manifest.json'))` plus `runtime.reload()` works in Firefox but is only meaningful for unpacked installs. Firefox temporary add-ons vanish at restart. Store-readiness already flags this alarm as doubtful.
6. **data_collection_permissions.** Required in the manifest for new AMO submissions from 2025-11-03 ([MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)). Upstream declares `websiteContent`. The fork also sends the user's API key to Google, so `authenticationInfo` is arguably needed too. A forum thread reports Firefox 127 and below error on the key; set `strict_min_version` to at least 140 as upstream does. Treat the category list as a product and privacy ruling.
7. **Gecko id.** The id is the add-on's permanent identity and storage key. Choosing it is a publisher ruling for Ted, not an implementation detail.

### Firefox disposition

Adapt, but not first. It touches the store-readiness posture and has an unverified security assumption. The cheap, safe prerequisite is a real-Firefox probe of items 1 and 3, which needs no repo change.

## (2) Hover-audio speaker in detail

### How it produces audio

- Web Speech API only: `speechSynthesis.getVoices()` and `new SpeechSynthesisUtterance(word)` in `content.js`. There is no TTS endpoint, no backend, no bundled audio and no new permission.
- `speech.js` (`voiceFor`) is a pure function. It matches voices to the language name through `Intl.DisplayNames` and `Intl.Locale`, so no language table is needed. Ranking: local voice before online, then the named regional variant, then the language's home region (`es` maps to ES, so es-ES before es-MX), then the browser default.
- A button appears only if a matching voice exists. Speech happens only on click, Enter or Space, never on hover or flip. Presses queue; upstream never calls `cancel()`.

### Spanish voices

Whatever the browser or OS installs. Firefox uses OS voices (speech-dispatcher on Linux, system voices on macOS and Windows). Chrome on Linux has only online "Google" voices unless started with `--enable-speech-dispatcher`. So Spanish availability varies by machine, and the button silently disappears where there is no voice.

For the fork, the `voiceFor` ranking prefers es-ES for `es`. The fork's curriculum leans Latin American (docs/UPSTREAM-CURRICULUM-MISSION.md), so a port should prefer es-MX and es-US. Generated packs carry a BCP-47 code (`ctx.language`), so the picker can match on the tag directly and drop the display-name path.

### Privacy and licensing

- Local voices (`localService: true`) keep the word on the machine. Online voices send the word to the voice provider; upstream's tooltip says so, and it falls back to online voices when no local voice exists.
- This is the sole reason it is not a plain Adopt. The fork's posture is no telemetry, and the store-readiness record tells the listing to disclose every data flow. A fallback to online voices adds a flow to a provider other than Google Gemini. Recommendation: local voices only, no button otherwise. That makes the feature a zero-network, zero-permission addition that needs no privacy-policy change, but Ted should confirm.
- No licensing issue found. The code is MIT upstream; the fork is relicensing to AGPLv3 and MIT code can be incorporated with the notice retained. No audio assets are involved.

### Why a port is large

The fork's gloss box (`content.css`, `content.js`) differs structurally from upstream's:

- Fork: a `div.fw-gloss` created per show, `pointer-events: none !important`, shown after a 700ms `TIP_TIMER`, text `word · gloss`, `aria-hidden`.
- Upstream: a persistent `fw-gloss` custom element, shown instantly, with a pointer-active speaker child, an 8px hover bridge, a 300ms grace timer and Tab redirection.
- Combining a button with the delayed reveal, focus restoration and peek accounting (`tipHovered`, `tipFocused`, `focusedTip`) is the work. Upstream needed two review rounds to settle the edge cases. Use its fix list (row 7) as the checklist.

A cheaper design that avoids pointer-state work: speak from the word itself via a keyboard shortcut, or add the button to the click-to-English flow. That is Ted's UX call. The pure `voiceFor` (about 50 lines plus its test) ports cleanly in an hour regardless.

## Recommendation, in order

1. Run a real-Firefox probe now (no code change): does `storage.local.setAccessLevel` exist, and does the dynamic content import load? This decides whether row 1 is an Adapt or a Defer.
2. Port `voiceFor` with a BCP-47-tag matcher and Latin American preference as a standalone, tested module. Local voices only. Ship the button only after a UX ruling on the keyboard-versus-pointer design.
3. Firefox manifest, popup wording and the Gemini host-permission check, once the key-storage question is settled and Ted picks the gecko id and data categories.

## Questions for Ted

- Is audio acceptable if it never leaves the machine (local voices only)? Recommendation: yes.
- What is the Firefox add-on id and publisher, and are `websiteContent` plus `authenticationInfo` the right data categories? Recommendation: declare both.
- Is the Firefox target worth store-readiness complexity now, or after the Chrome listing? Recommendation: after.

Sources consulted: [MDN storage.StorageArea.setAccessLevel](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/StorageArea/setAccessLevel), [MDN browser_specific_settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings), [Mozilla Discourse on data_collection_permissions](https://discourse.mozilla.org/t/do-older-firefox-versions-ignore-data-collection-permissions/145985).

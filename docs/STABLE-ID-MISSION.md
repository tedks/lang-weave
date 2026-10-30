# Stable extension ID (0.12.0)

State: implemented on `stable-extension-id`, based on `origin/main` `d13e30d` (0.11.0). Draft PR; not merged, not deployed. Issue: `stable-extension-id`. The fleet installer change is a separate draft PR in `tedks/dotfiles` and keeps its pin on the current source commit until this PR merges.

## Intent and boundary

Give Lang Weave one extension ID on every path and host, so the fleet payload can move from the historical `spanish-weave` directory to `lang-weave` once, and never again. The ID is fixed by a public `key` in `extension/manifest.json`. This change does not touch any browser profile, does not upload anything to the Chrome Web Store and does not call Gemini.

The new ID is:

```
lkbkmlgogcpcacjmdmoecgacdbfddbnh
```

## Assumptions and failure modes

- Chrome derives the ID of an extension that carries a manifest `key` from that key, not from its load path. Verified below in real Chromium from two unrelated directories.
- Every existing unpacked install was loaded without a key, so its ID is a hash of its path. Moving to 0.12.0 gives each of them a new ID with empty storage. The only supported carry-over is the Learning backup export and import from 0.11.0 ([contract](STORE-PORTABILITY-MISSION.md)).
- **An in-place update of a keyless install strands its progress.** 0.11.x reloads itself when the manifest version on disk changes (`checkUpdate` in `src/background.js`). In isolated Chromium, a 0.11.0 install whose directory was overwritten with 0.12.0 and then reloaded lost its old ID at once. After a browser restart only the new ID ran, with empty storage. The old ID's storage directory stayed on disk but no extension could read it. So the old directory must never receive 0.12.0 before the user exports. The fleet installer leaves the old payload untouched for this reason. A user running from a git checkout must export before pulling.
- Two loaded copies now share one ID. Chrome will not run both at once, so a developer checkout and the fleet payload cannot be loaded in the same profile side by side. Use a separate profile for development.
- The private key is the only way to sign a `.crx` with this ID, and possibly the only way to give a future Store item this ID. If it is lost, the unpacked ID keeps working because it needs only the public key, but a Store item would get a different ID.

## What the Chrome documentation says

Read on 2026-10-30. Quotes are verbatim.

**The manifest key fixes the ID during development.** From [Manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key):

> "This value maintains the unique ID of an extension, or theme when it is loaded during development."

**The documented procedure takes the key from the Store, not the other way round.** Same page, under "Keep a consistent extension ID" (the [OAuth guide](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth) repeats it):

> "Package the extension directory into a `.zip` file and upload it to the Chrome Developer Dashboard without publishing it"
>
> "Go to the **Package** tab and click **View public key**."
>
> "Copy the code in between `-----BEGIN PUBLIC KEY-----` and `-----END PUBLIC KEY-----`."
>
> "Add the code to the `manifest.json` under the `"key"` field. This way the extension will use the same ID."
>
> "Compare the extension ID on the extensions management page to the Item ID in the Developer Dashboard. They should match."

**The ID is a hash of the public key, and the private key must be kept.** From [Host on Linux](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux):

> "The extension ID is generated based on a hash of the public key"
>
> "**Do not lose the private key!** Keep the `.pem` file in a secret and secure place; it will be needed to update the extension."

**An older official guide says the Store keeps a self-generated ID if the private key is in the zip.** From the 2013 "Packaging" page, "Uploading a previously packaged extension to the Chrome Web Store" (no longer on developer.chrome.com; read from an [archived copy of the site source](https://raw.githubusercontent.com/pbojinov/developer.chrome.com/master/apps/packaging.html), "Last updated August 2, 2013"):

> "unless you take special steps, the extension's ID in the Chrome Web Store will be different from its ID in the package you created."
>
> "Rename the private key that was generated when you created the .crx file to key.pem."
>
> "Put key.pem in the top directory of your extension."
>
> "Compress that directory into a ZIP file."
>
> "Upload the ZIP file using the Chrome Developer Dashboard."

**Verified uploads keep an existing item's ID; they do not set it.** From [Verified uploads in the Chrome Web Store](https://developer.chrome.com/blog/verified-uploads-cws) (May 7, 2025):

> "If an upload passes this verification, it will be automatically repackaged with the existing private key before publication. This ensures the extension keeps the same ID"

From [Update your Chrome Web Store item](https://developer.chrome.com/docs/webstore/update):

> "After opting in, all updates to your extension package must be signed with a key you provide."

**What no current page says.** None of the current pages on the manifest key, publishing, preparing a package, the Web Store FAQ, updating or troubleshooting says whether the Store honors a manifest `key` in a first-upload zip, rejects it, or strips it. None documents the `key.pem` route today.

## Conclusion on the Store

The current docs do not show that a self-generated key fails on the Store, so the mission's stop condition did not trip. They also do not show that it works. Two outcomes are possible at the first Store upload:

1. The Store still honors `key.pem` in the zip root, as the 2013 guide says. The Store item gets `lkbkmlgogcpcacjmdmoecgacdbfddbnh`, and unpacked users who migrated in 0.12.0 never move again.
2. The Store assigns its own key. The Store item gets a different ID, the manifest `key` must be replaced with the Store's public key, and unpacked users repeat the backup and import once more.

Taking the key from the Store first would avoid outcome 2. It needs a developer account and an unpublished upload, which are money and an outward act, so it is the CEO's call. It is filed as an open question. The self-generated key is still the right step now, because it ends path-dependent IDs on the fleet today whichever way the Store goes. The key path should be checked with an unpublished upload before any Store release.

How the first upload would carry the key, if outcome 1 holds: copy the private key to `key.pem` at the top of the zipped extension directory for that one upload only. Never commit it, and never leave it in a package anyone else receives.

## Key custody

- Private key: `~/.local/share/lang-weave-keys/lang-weave.pem` on framework0. RSA 2048, PKCS#8 PEM, mode 600, directory mode 700. It is outside every repository. **It must be backed up.** It exists on one disk only.
- Public key: `extension/manifest.json` `key`, base64 DER SubjectPublicKeyInfo, generated with `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048` and `openssl pkey -pubout -outform DER`.
- ID derivation: take sha256 of the DER public key, keep the first 32 hex digits, and map each digit 0-f to a-p. Both identity tests recompute it this way and pin the result.

## Acceptance evidence

On `8d5b914`, in this worktree:

- `nix shell nixpkgs#bun --command bun install --frozen-lockfile` and `bun test` inside `extension/`: 193 pass, 0 fail, 3650 assertions.
- `python3 -m unittest discover -s tests`: 91 tests OK.
- `python3 tests/check_version_bump.py --base origin/main`: "Version 0.11.0 -> 0.12.0 for 2 shipped file(s). Version check passed: 0.12.0".
- `node e2e/smoke.mjs` inside `extension/`: PASS in Playwright Chromium. Gemini mocked; no live model call.
- Two-path ID probe: the 0.12.0 runtime copied to two unrelated directories and loaded unpacked in headless Playwright Chromium. Both service workers ran at `chrome-extension://lkbkmlgogcpcacjmdmoecgacdbfddbnh/`.
- In-place update probe: described under the assumptions above. The old ID was `hmgjolibpmknjfiebhnfbikfechbgecj` for that scratch path.

Repaired tests: `tests/test_weave.py` and `extension/test/spanish.test.js` previously asserted that the manifest has no `key`. That kept Lang Weave from inheriting French Weave's fixed key. They now pin this key's ID, and the Python test asserts it differs from the French `EXTENSION_ID`.

## Not tested

- Chrome's **Load unpacked** button in a real profile. The probes loaded the extension with `--load-extension` in a throwaway headless profile. That uses the same unpacked loader but not the same saved profile entry, so Ted's profile may treat the old ID differently on reload. The migration steps avoid depending on either behavior.
- Ted's Chrome profile and the fleet hosts. Nothing here touched them.
- Any Chrome Web Store upload.
- Packing a `.crx` with the private key.

## Migration

The README's "Move to the stable ID (0.12.0)" section is the user procedure. In short: export a Learning backup from the old install, load the new path unpacked, import before entering a Gemini key, check the review queue, and only then remove the old entry. The old directory is kept until the user deletes it.

## Record

- 2026-10-30: Lead (Claude Opus 5.5) took the mission from the CTO. Chrome docs read through a fetch agent and checked against the archived 2013 guide and the 2025 verified-uploads post. Stop condition judged not tripped; the Store question is filed for the CEO.
- 2026-10-30: Keypair generated on framework0; private key written outside the repository with mode 600. Manifest key, version 0.12.0 and repaired identity tests committed at `8d5b914`.
- 2026-10-30: The in-place update probe found that the extension's own self-reload strands progress when a keyless directory receives 0.12.0. The migration steps and the fleet installer keep the old directory untouched for this reason.

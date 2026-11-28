# Chrome Web Store images

These images come from `extension/e2e/store-shots.mjs`. It loads the packaged Store build in an isolated Chromium profile, adds a test-only grant for a synthetic reading host and a test-only `update_url`, and intercepts Gemini in the test worker. The article is original sample prose; no real account, key, personal page, or live Gemini call is used. Chromium is forced to a light theme at a 1× scale. The reading and promo images contain no browser chrome.

| File | Dimensions | Listing caption |
|---|---:|---|
| `01-welcome.png` | 1280×800 | **Try it first.** “Try a bundled reading sample before you add a key. It stays on your device.” |
| `02-hover.png` | 1280×800 | **Hover.** “Hover a word for its meaning and a written pronunciation hint.” |
| `03-flip.png` | 1280×800 | **Flip.** “Click a word to flip it back to English.” |
| `04-review.png` | 1280×800 | **Review.** “Words you met while reading come back for a quick recall check, scheduled with FSRS.” |
| `05-progress.png` | 1280×800 | **Progress.** “See what you have introduced, seen and recalled. All of it stays in your browser.” |
| `small-promo.png` | 440×280 | Lang Weave · Learn Spanish while you read. |

The captions match `docs/STORE-SUBMISSION-PACKET.md`. In 0.16.1 the welcome page opens with the bundled reading sample (language and passage pickers), so `01-welcome.png` now shows the sample and the start of the privacy section; the site-policy buttons are below the fold, and the caption changed to match. The 0.16.1 refresh of `01-welcome.png`, `04-review.png` and `05-progress.png` was rendered with the cached Playwright Chromium revision 1247 (Chrome for Testing 155.0.8059.12), because the pinned revision 1248 was not cached and the host disk was too full to download it. In the same run `02-hover.png`, `03-flip.png` and `small-promo.png` came out byte-identical to the committed copies, so the renderer difference did not change pixels where the UI did not change. The review image shows “but,” which was swapped in the sample article. This fixture starts the review session with the page’s **Add 5 new words** control; the current gradual-learning flow can also introduce words from reading, as `extension/e2e/gradual.mjs` verifies. Reading encounters in this fixture contribute to the Progress page.

From the repository root, install the locked development dependencies once, then regenerate and check the images:

```sh
cd extension
nix shell nixpkgs#bun --command bun install --frozen-lockfile
nix shell nixpkgs#bun --command bunx playwright install chromium # only if Chromium is missing
node e2e/store-shots.mjs
cd ..
node extension/e2e/store-shots.mjs --check
```

The `--check` mode reads the PNG signature, IHDR dimensions, bit depth and RGB color type, and final IEND chunk with Node’s standard library. The script uses the existing `unzip` command to load the generated Store zip and checks captures in scratch before copying them to this directory. Screenshots are reproducible for the pinned Playwright Chromium build; exact PNG bytes can vary with browser or font versions.

# Chrome Web Store images

These images come from `extension/e2e/store-shots.mjs`. It loads the packaged Store build in an isolated Chromium profile, grants access only to a synthetic reading host, and intercepts Gemini in the test worker. The article is original sample prose; no real account, key, personal page, or live Gemini call is used. Chromium is forced to a light theme at a 1× scale. The reading and promo images contain no browser chrome.

| File | Dimensions | Listing caption |
|---|---:|---|
| `01-welcome.png` | 1280×800 | **Welcome page.** “Pick where it may read. Only sites you turn on, or all except sensitive ones. You choose before anything is sent.” |
| `02-hover.png` | 1280×800 | **Hover.** “Hover a word for its meaning and how it sounds.” |
| `03-flip.png` | 1280×800 | **Flip.** “Click a word to flip it back to English.” |
| `04-review.png` | 1280×800 | **Review.** “Words you met while reading come back for a quick recall check, scheduled with FSRS.” |
| `05-progress.png` | 1280×800 | **Progress.** “See what you have introduced, seen and recalled. All of it stays in your browser.” |
| `small-promo.png` | 440×280 | Lang Weave · Learn Spanish while you read. |

The five screenshot captions match the draft on `listing-docs`; no caption change is needed. The review image shows a bundled-word review session. Reading encounters in this fixture contribute to the Progress page, while the review cards are introduced through the extension’s real review flow.

From the repository root, install the locked development dependencies once, then regenerate and check the images:

```sh
cd extension
nix shell nixpkgs#bun --command bun install --frozen-lockfile
nix shell nixpkgs#bun --command bunx playwright install chromium # only if Chromium is missing
node e2e/store-shots.mjs
cd ..
node extension/e2e/store-shots.mjs --check
```

The `--check` mode reads the PNG signature and IHDR width and height with Node’s standard library. The script uses the existing `unzip` command to load the generated Store zip. Screenshots are reproducible for the pinned Playwright Chromium build; exact PNG bytes can vary with browser or font versions.

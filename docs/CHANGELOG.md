# Changelog

User-facing changes from 0.11.0 to 0.12.21, newest first. One entry per pull request merged into `main` through `git log --first-parent --merges`, with its number and a one-line summary. Entries are grouped by the version in `extension/manifest.json` at the merge. A pull request title or body sometimes cites an earlier number, because the branch was rebased before it merged. A pull request marked "no bump" changed no shipped file. Earlier history, 0.2.0 to 0.10.0, is in the pull request list.

Fork pull requests: <https://github.com/tedks/lang-weave/pulls?q=is%3Apr+is%3Amerged>

## 0.12.21 (2026-11-02)

- #42 Adds an opt-in Guess first setting for gradual learning. Hovering or focusing a learning word on its first encounters offers its meaning among a few options before showing it: three guesses per word, at most one a day. A wrong guess counts like a peek, and My words shows first-guess accuracy and next-day recall of guessed words. Backups leave guesses out until a later release, because older versions refuse them. See [the mission record](INFERENCE-MISSION.md).

## 0.12.20 (2026-11-01)

- #44 Already-open granted pages recover weaving after the worker restarts; a rejected Gemini key stops further model requests until replaced; inline recall cues in separate tabs keep independent tickets.

## 0.12.19 (2026-11-01)

- #41 New words now come in frequency-band order: each of the 226 bundled words gains a coarse band, the Beginner 30 stay first, and unbanded personal words sort with the lowest band present. Adds an offline, pinned curriculum build pipeline with an English-anchor collision gate and a 3,000-row pack ceiling. It ships no new vocabulary rows. See [the pipeline record](CURRICULUM-PIPELINE.md).

## 0.12.18 (2026-10-31)

- #38 Swapped words now carry their language code, and a screen reader announces the word alone, with the gloss and the action as a description. The popup, Settings, welcome, review, My words, capture and backup text moved into a locale file. The interface is still English only.

## 0.12.17 (2026-10-30 to 2026-10-31)

- #35 With gradual learning on, reading now ranks due and weak words first, then under-met learning words, and skips a word seen three times in a day. Two same-day peeks on a rated learning word bring its review forward. "Familiar" words return as occasional maintenance reviews instead of retiring, "Already know" is verified by one later check, and due, learning and new words together are capped near 2% of the words read.
- #37 Adds the Chrome Web Store screenshots and promo tile under `docs/store-assets` (no bump).
- #39 Adds the curriculum sources and validation plan under `docs/research` (no bump).

## 0.12.16 (2026-10-30)

- #36 The review finish card shows the deck's next due time. Welcome and Settings state that the Gemini API requires users to be 18 or older. The Store build suggests an explicit x.com grant during onboarding.

## 0.12.15 (2026-10-30)

- #34 Chrome 140 is now the minimum. Lang Weave takes, saves and uses a Gemini key only after Chrome restricts extension storage to trusted contexts, and otherwise shows fixed guidance. An existing key can still be removed.

## 0.12.14 (2026-10-30)

- #31 Inline recall cues are calmer: an English word with a dashed underline and a small ?, at most two visible at a time, with one row of four ratings. Alt+Shift+W pauses or resumes the current site, and Alt+Shift+R opens review.

## 0.12.13 (2026-10-30)

- #32 After a browser restart, granted sites are registered before the first reply from the background worker. A page that loads before any reply can still miss weaving.

## 0.12.12 (2026-10-30)

- #28 Adds a Today line, a days-practised-this-week line and a verified-known count to the popup. Adds the My words page with word stages, search, Practice now, Already know, Reset and an "Is this working?" section. The popup's main button reads Review N due words, Add words or Practice.

## 0.12.11 (2026-10-30)

- #30 The Store build bundles the content script into one file and drops the `alarms` permission and the web-accessible resources. The unpacked extension is unchanged.

## 0.12.10 (2026-10-30)

- #27 The toolbar icon and its tooltip now say why Lang Weave is or is not working on the current tab, without storing page or host data.

## 0.12.9 (2026-10-30)

- #29 A welcome page opens on a fresh install, with a bundled demo and an explicit choice of site policy. Nothing is sent to Gemini on a fresh profile until you choose. Saved profiles keep the access they had.

## 0.12.8 (2026-10-30)

- #25 The popup keeps only the switch, the current site, today's progress, one review button and links. Learning, sites and privacy, Gemini, data and About controls move to a Settings page.

## 0.12.7 (2026-10-30)

- #23 Adds the toolbar and extension icons. Narrows the web-accessible resources, tags the content loader's log lines `[lang-weave]`, and runs the self-update check and NEW badge only for unpacked installs. Adds a `--store` package that omits the x.com content script.

## 0.12.6 (2026-10-30)

- #26 Reviews are scheduled with FSRS-6 on the actual time since each review, aiming for 90% recall, and a lapse keeps a word's history. Each review is recorded, and each seen or peeked word is counted, in a local learning log of word IDs, times, outcomes and counts, with no text. Learning backups now use format 2.

## 0.12.5 (2026-10-30)

- #24 The backup reader accepts formats 1 and 2, so this build can import a 0.12.6 backup. Export still writes format 1. Install this before 0.12.6.

## 0.12.4 (2026-10-30)

- #22 Key setup links to the key page, confirms a save, adds a Test key button, shows a clear message for a rejected key, and adds Remove key.

## 0.12.3 (2026-10-30)

- #20 The review page names the language, shows card N of M, and ends with a finish card. Space or Enter reveals, 1 to 4 rate, and focus moves to the next control after each action. The Refresh button is gone.

## 0.12.2 (2026-10-30)

- #21 Splits the background worker into a message router and feature modules, with no behavior change, and adds shared interface color tokens and a package script.

## 0.12.1 (2026-10-30)

- #19 Adds the FSRS-6 scheduler and local learning log as standalone modules that nothing calls yet, so behavior and stored data are unchanged.

## 0.12.0 (2026-10-30)

- #18 The manifest now carries a public key, so Chrome gives Lang Weave the same ID, `lkbkmlgogcpcacjmdmoecgacdbfddbnh`, from any folder on any machine. Every earlier install gets a new ID with empty storage and moves across once through a Learning backup. Do not update an old folder to this version. See [the stable ID record](STABLE-ID-MISSION.md).

## 0.11.1 (2026-10-30)

- #16 Relicenses Lang Weave under AGPL-3.0-or-later. The inherited MIT license and Jackie Oliver's copyright stay for upstream-origin portions.
- #17 Adds the product roadmap and four research reports (no bump).

## 0.11.0 (2026-10-28)

- #15 Adds a Learning backup: an explicit local export, and a previewed import into a separate fresh, keyless install. Keys, site grants, caches and page text are excluded.

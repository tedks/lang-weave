# Lang Weave product roadmap

Written 2026-10-30 by the Lang Weave CTO from four research lanes run that day. The lane reports are in [docs/research/](research/): [learning science](research/learning-science.md), [market and policy](research/market.md), [product and UX audit](research/ux-audit.md), and [upstream delta](research/upstream-delta.md). This page is the synthesis and the plan; the reports carry the evidence and citations. Ted's standing direction: build the best immersive language-learning system, make every review count, grow vocabulary naturally, streamline the interface, and go from a utility to a product.

## What the research settled

1. **Exposure alone does not stick.** The one controlled study of in-page word substitution (Broccoli, N=58) beat word-list memorisation immediately and was equal to it after one to four weeks, at about 30% recall. Lang Weave's scheduled retrieval layer is therefore the product, and the weaving is how that layer gets its encounters. Everything in the "reviews" and "vocabulary" sections below follows from this.
2. **The current scheduler wastes reviews.** Hard drops any card to one day, Again erases history, and lateness is ignored even though late reviews are the normal case for a passive tool. Nothing records elapsed time or outcome, so retention cannot be measured.
3. **The market position is open.** Toucan, the only incumbent, is parked under Babbel since 2023 with recent reviews complaining about out-of-context swaps. No competitor is open source, account-free and bring-your-own-key at once. Products that charge successfully in the category sell saving and review, not ambient exposure.
4. **Onboarding is the weakest point.** A new install shows nothing on any page, opens no welcome page, has no icon, and asks for a Gemini key before showing any value. The popup holds 22 controls in a column taller than Chrome's 600px popup limit.
5. **Google's Gemini API terms are the main product risk.** They say the API is "not for consumer use", free-tier input may be read by human reviewers, EEA/UK/Swiss clients must use paid services, and users must be 18 or older. A hosted tier on a billed Lang Weave project is the cleanest long-term fit; it is not authorised yet.
6. **Upstream has nothing to catch up on in page handling.** Its Firefox support and hover-audio speaker are the two adoptable pieces; both need a product ruling and a real-Firefox probe first.

## Positioning

> Learn a language from the web you already read. Open source, no account, your key, your data stays in your browser.

Do not claim "private" without qualification: a free-tier key lets Google use the text. The honest claim is that no Lang Weave server ever sees the reading.

## Milestones

Each milestone is a set of bounded missions. Substantive code goes through the council to fixpoint; the invariants in [DESIGN.md](DESIGN.md) and the "must be preserved" list in the UX audit hold throughout: consent rechecks after every await, sender-scoped router, no telemetry, per-language scoped history, no model output ever inserted as HTML.

### M1. Make every review count (learning core)

| Mission | What | Why | Size |
|---|---|---|---|
| learning-event-log | Record every retrieval (word ID, time, source inline/standalone, direction, outcome, latency, elapsed days, scheduled interval, predicted recall) and per-word exposure aggregates, word-ID only, bounded, no URLs or passages. Expose a small "is this working?" view. | Prerequisite for measuring anything. | S–M |
| fsrs-scheduler | Replace the interval rules with FSRS default parameters at a target retention of 0.85–0.90, scheduling on actual elapsed time and keeping memory across lapses. Port the formulas or vendor the MIT `ts-fsrs` ESM build with its notice. Migrate existing cards without losing history. | Stops wasting reviews; calibratable against the log. | M |
| objective-grading | Typed recall checked by the existing accent-aware normaliser, or four-option choice, recorded with correctness and latency; self-rating shrinks to Again / Good (Easy optional). Opt-in at first. | Self-judgments are poorly calibrated and "Hard as a pass" corrupts the schedule. | M |
| encounter-engineering | Target 8–12 in-context encounters per new word over distinct days in its first three weeks; cap same-word placements at 2–3 a day; rank under-exposed learning words first; treat a peek on a learning word as weak failure evidence that can only bring a review earlier. | The lever a flashcard app does not have. | M |
| familiar-maintenance | Replace permanent "familiar" with long maintenance intervals; verify "Already know" with one later retrieval. | Learners drop cards too early. | S |
| review-keyboard-flow | Fix the verified focus loss after Reveal and after every rating; Space/Enter to reveal, 1–4 to rate; `aria-busy`. | Accessibility bug with a measured repro. | S |
| review-clarity | Name the language, show "3 of 8", finish card with the next due date, rating help, bundled example sentences with a blank; remove Refresh. | Review feels finite and rewarding. | S–M |

Rulings needed: whether productive recall (English to Spanish, typed) is a goal or only reading (sets the weight of objective grading and receptive/productive tracking).

### M2. Onboarding and the popup (activation)

| Mission | What | Size |
|---|---|---|
| worker-split | Split the 1,353-line background worker into a declarative surface-to-message router plus reading, review, capture, backup and update modules, with no behaviour change; shared CSS tokens; a package script that zips only shipped files. Ships alone with a council fixpoint. Unblocks every new surface. | M–L |
| key-setup-truth | Link to the key page, "Saved" confirmation, explicit Test key through the model queue, a `key_rejected` status category with fixed copy, Remove key. | S–M |
| welcome-page | Opens on install only: a pre-woven demo paragraph with working hover and flip and no model call; a privacy and sites step with an explicit choice between "only sites I pick" and "all except sensitive"; a guided key step; one-line explanations of level and gradual. Never grants anything by itself. | M |
| badge-state | Per-tab toolbar badge and tooltip: needs key, needs this site, cooling down (review still works), working. "NEW" only for development builds. | M |
| popup-ia and options-page | Popup becomes status, this site, today, one primary button (Review 3 due, Practice, Add words), links to Settings, My words, Help. Everything else moves to a plain-HTML options page: Learning, Sites and privacy, Gemini, Your data, About. | M |
| my-words | Searchable list of learning and personal words with gloss, stage, next due; Practice now, Already know, Reset. Personal entries reachable without a selection. | M |
| today-progress | "Today" line (introduced, seen, peeked, flipped, reviewed), words by stage, a 30-day activity strip, "days practised this week" instead of a brittle streak, and the verified-known count (recalled at 21+ days) as the headline number. Derived only from existing bounded local data. | M |
| calmer-cues | Practice words as English with a dashed underline and a small "?", at most one or two cues per viewport, cue placed by available space, one row of four ratings with Already know quieter, first focus on Reveal. | S–M |
| keyboard-commands | `commands` for pause-on-page and open-review. | S |

Rulings needed: gradual learning on for new installs (written at install time, never by changing the default); the default new-site policy for Store installs; a zero-key starter mode (deterministic unambiguous swaps) or Chrome's on-device model.

### M3. Store readiness and reach

| Mission | What | Size |
|---|---|---|
| stable-extension-id | Public `key` in the manifest so unpacked and packaged installs share one ID across paths and hosts; migration via the 0.11 learning backup; dotfiles installer moves to the lang-weave path. In flight. | M |
| icons-and-listing | 16/32/48/128 icons legible in light and dark; five listing screenshots from the audit harness; description that leads with "learn while you read" and states the privacy model; 18+ in the listing. | S–M |
| privacy-and-fingerprinting | In-extension consent screen before the first Gemini call (Store policy: not only in a privacy policy or the listing); hosted privacy policy and Limited Use statement on the project page; Dashboard data-use form; `use_dynamic_url` or a single content bundle so no script is web-accessible; fix the `[french-weave]` log tag. | M |
| drop-x-content-script | Remove the hard-coded x.com content script from the Store manifest; suggest X during onboarding. Existing unpacked users: ruling. | S |
| gate-self-update | Run the unpacked self-update and "NEW" banner only when `installType === 'development'`. | S |
| edge-listing | Publish the same build on Edge Add-ons at launch. | S |
| firefox-probe then firefox-support | Probe in real Firefox: does `storage.local.setAccessLevel` exist (the key-isolation guard silently skips if not) and does the content loader's dynamic import work. Then the unified manifest (`background.scripts`, gecko id, `strict_min_version` 140, `data_collection_permissions` websiteContent plus authenticationInfo), browser-neutral popup copy, a Gemini host-permission check. Also reaches Firefox for Android. | S, then M |
| i18n-scaffold and lang-attr | `_locales/en/messages.json` with `default_locale`; `lang` on swapped spans with the gloss in `aria-describedby`. | M |
| speech-voicefor | Port upstream's pure voice picker with BCP-47 matching and a Latin American preference; local voices only, never on hover, never auto-play. The gloss button waits for a UX ruling. | S, then M |

Rulings needed: Gemini consumer-use interpretation and territory (filed), Store site-consent default (filed), Firefox add-on id and data categories, audio local-only.

### M4. Vocabulary growth and the ceiling

| Mission | What | Size |
|---|---|---|
| coverage-cap | Cap still-unknown swapped words near 2% of running words regardless of density; introduce new words where they are guessable, cognates first. | S |
| context-variety | Prefer a site or topic unlike a word's recent ones (a salted host-hash bucket count needs a privacy ruling); rotating example sentences in review. | M |
| receptive-productive | Track reading knowledge and production knowledge separately; start receptive, add productive once stable. | M |
| curriculum-growth | Grow the 226-word pack toward the 2–3k high-frequency families that give useful coverage, frequency-weighted by what the user reads, with native-speaker review (ditz `spanish-curriculum-review`, `licensed-spanish-catalog-import`). | L |
| inference-step | Opt-in guess-first step on first encounters: three or four candidate meanings before the answer. | M |

### M5. Business

- Keep bring-your-own-key free forever with nothing gated. Add GitHub Sponsors or Open Collective now.
- Add a waitlist button for a hosted "no key" tier inside the key step, counting demand only.
- Only after retention is proven: a hosted tier at about $4–5 a month with a hosted cap near 50 calls a day on the cheapest model that passes the swap-quality tests. At the current 1,000-call cap a heavy user costs $45–100 a month; the cap is the margin.
- Never sell vocabulary packs or paywall review.

## Sequencing

1. M1 review-keyboard-flow and review-clarity (small, isolated) alongside M2 worker-split (mechanical, council fixpoint) and the standalone parts of M1 fsrs-scheduler and learning-event-log (new modules with tests, integrated after the split lands).
2. M2 key-setup-truth, welcome-page, badge-state, then popup-ia with options-page.
3. M3 icons, privacy, drop-x, gate-self-update, Edge; the Firefox probe can run any time.
4. M4 and the remaining M1 items as the log starts showing what works.

## Measurements that decide the next steps

Next-day recall after introduction; retention at 21+ days against the scheduler target; calibration of predicted against observed recall; verified-known count; per-word peek rate; exposures and distinct days per learning word; reviews per day and seconds per review; leeches. All local, all word-ID only.

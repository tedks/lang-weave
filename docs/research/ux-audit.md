# Lang Weave 0.11.0: product and UX audit

Product/UX lane (Opus 5.5), 2026-10-30. Source: read-only checkout `store-progress-portability` at `fa56327` (merged main, 0.11.0). Nothing in that checkout was modified.

**Evidence.** I read every user-facing surface and the relevant worker code. I drove a scratch copy in real Playwright Chromium (MV3, headless) with three profiles:

- a true first run: real manifest, no host grant, no key;
- a reading profile: test host grants, a synthetic key and a synthetic Gemini responder;
- a quota profile: a synthetic 429 daily-quota reply.

Gemini DNS was blocked throughout, and no live model call was made. The smoke test also passed in the scratch copy. My responder swaps every listed word it finds. The screenshots therefore show how the UI renders, not real swap quality or density.

**Screenshots.** There are 24 PNGs in `(session scratch, not committed) ux-audit/shots/`.

- **Prefix A:** first run. Article with nothing happening, popup, review, capture, backup, and key-without-grant.
- **Prefix B:** reading. Swaps, gloss, flip, gradual and inline recall, in light and dark.
- **Prefix C:** daily-quota state.

The driver is `ux-audit/extension/e2e/shots.mjs`. The focus probe is `e2e/focus.mjs` in the same scratch copy.

---

## 1. First-run journey and drop-off points

1. **Install (D1).** Chrome warns "Read and change your data on x.com and twitter.com". That comes from the hard-coded `content_scripts` on `extension/manifest.json:22-35`, which is odd for a language app. There are no `icons`, so the toolbar shows a grey letter, hidden in the puzzle menu until pinned. `onInstalled` only arms an alarm and a context menu (`background.js:1329,1351`). No welcome page opens.
2. **Visit a site (D2).** Nothing happens (A1). There is no badge, no icon state and no in-page hint. The user does not know that a key and a site permission are needed.
3. **Open the popup (D3).** There are 22 controls in a 300 px column, about 985 px tall (A2). Chrome caps popups at 600 px, so the key field, Open review and the privacy paragraph are below the fold. The status says "Add a Gemini key to start", but the key field has only an `AIza…` placeholder and no link to get a key (`popup.html:76`).
4. **Get a key (D4).** The user leaves for AI Studio, signs in, creates a key and pastes it. It saves on blur (`popup.js:221`). The only feedback is a truncated "saved (paste to replace)" placeholder (C2). Nothing validates the key. A bad key surfaces only after a page request, as "Model request failed. Try again later." (`quota-status.js:161`), because 400/403 fall into `request_failed`. The advice is wrong: retrying never helps. A key also cannot be removed. The field resets to empty, and clearing an empty field fires no `change`.
5. **Grant the site (D5).** The status says "This site needs your OK" (A9). The fix is a bare checkbox beside the hostname. "Other sites: On by default" sits under a note saying Chrome has not allowed other sites. "Allow all websites" plus "On by default" sends every non-sensitive site's text to Gemini. That is disclosed only below the fold.
6. **Words appear.** They render as underlines (B1). Hover shows a gloss after 700 ms and click flips the word (B2/B3). The how-to text is a stray popup row (`popup.html:81`).
7. **Learning loop (D6).** `gradual` defaults to false (`settings.js:9`). Reading then never creates review cards. The review page's "Add 5 new words" draws bundled words unrelated to the user's reading (A4). Inline recall stays disabled. The two halves of the product do not connect by default.
8. **Quota (D7).** Free-tier daily quota is the common case. The page silently stops weaving (C1). The popup says "Daily model quota reached. Retry after …" (C2), with no badge. It suggests no alternative and does not mention that review still works offline.

---

## 2. Ranked improvements

| # | Group | Improvement | Effort |
|---|---|---|---|
| 1 | a | Welcome/onboarding page on install | M |
| 2 | a | Guided key setup, explicit test, "key rejected" status, remove key | S–M |
| 3 | e | Per-tab toolbar state saying why nothing is happening | M |
| 4 | b | Popup reduced to status, this site, today, Review | M |
| 5 | b | Real options page | M |
| 6 | d | Gradual learning on for new installs (ruling) | S |
| 7 | g | Icons and listing assets | S–M |
| 8 | g | Privacy disclosures, policy, fingerprinting fix | M |
| 9 | f | Review keyboard flow (verified focus bug) | S |
| 10 | d | Review clarity and session shape | S–M |
| 11 | e | Local "Today" and progress summary | M |
| 12 | e | My words: browse the deck | M |
| 13 | a | Zero-key starter mode or on-device model (ruling) | L |
| 14 | c | Calmer practice markers and inline cue | S–M |
| 15 | c | Keyboard commands: pause on page, open review | S |
| 16 | b | Personal entries reachable; side-panel capture later | S, then M |
| 17 | f | `lang` on swapped words | M |
| 18 | c | Pronunciation audio | M |
| 19 | g | Drop the hard-coded X content script | S |
| 20 | g/h | Gate the unpacked-only self-update | S |
| 21 | h | Split the worker, route table, shared CSS, package script | M–L |
| 22 | f | `chrome.i18n` scaffolding | M |

Each entry below gives the problem with evidence, the change, the value, the effort and the invariant risk.

### (a) First-run onboarding and empty states

**#1 Welcome page.** *Problem:* D1–D5. *Change:* open `welcome.html` from `onInstalled` only when `reason === 'install'`. It has three steps.

- **How it works:** a demo paragraph with real swaps from the bundled list. It needs no model call, and hover and flip work on it.
- **Privacy and sites:** what is sent, when, and the free-key caveat. Offer an explicit choice between "Only sites I pick" (recommended) and "All sites except sensitive". The second requests permission from that click.
- **Key, level and gradual:** a guided key step (#2), with one-line explanations of level and gradual.

*Value:* the biggest activation lever, and consent is informed before any grant. *Effort:* M. *Risk:* low. Reuse the gesture-bound grant path (`popup.js:222-233`). Add the page to the router's sender allowlist. The page must never grant anything by itself.

**#2 Key setup that tells the truth.** *Problem:* D4. *Change:*

- Link to `https://aistudio.google.com/apikey` with three steps.
- Show "Saved ✓" after a save.
- Add an explicit **Test key** click. It makes one tiny call through the `modelCall` queue and counts against the local cap.
- Add an allowlisted `key_rejected` category (400 `API_KEY_INVALID`, 401, 403) with fixed copy: "Gemini rejected this key. Paste a new one."
- Add **Remove key**. It clears `apiKey`, rotates `keyEpoch` and `epoch`, and clears quota state, mirroring `background.js:724-730`.

*Value:* removes the commonest silent failure. Key removal is basic control and a reviewer expectation. *Effort:* S–M. *Risk:* low, if the category joins `STATUS_CATEGORIES` and copy stays local and secret-free.

**#13 Zero-key or on-device mode (operator ruling).** *Problem:* BYOK is a wall for Store users. They need a Google key before seeing any value, and free keys may train Google's models. *Change:* offer either of two options on the welcome page.

- **(a) Offline starter.** Deterministic swaps of a strictly unambiguous subset, such as y, pero, porque, siempre, nunca, hoy, mañana and gracias. Words with sense ambiguity, such as "so", "like" and "well", are excluded.
- **(b) Chrome's built-in on-device model.** Investigate the extension Prompt API on supported hardware.

*Value:* instant value and a "nothing leaves your browser" story. *Effort:* L. *Risk:* medium. DESIGN.md assumes model sense-selection, and option (a) trades accuracy for reach. It must keep the title, high-stakes and form exclusions. File it under `open-questions`.

**Empty states (fold into #1, #4 and #10).**

- **Capture page opened directly** shows an empty bordered box (A5). That is the `.selected` paragraph with no text (`capture.html:13`). Hide it when there is no nonce.
- **Review page.** "Come back when a card is due" should say when (`review-page.js:37-39`).

### (b) Popup information architecture

**#4 Popup as status-and-go.** *Problem:* 22 controls at about 985 px in a 600 px popup (A2, C2). It mixes several kinds of control:

- per-tab state;
- global site policy;
- the curriculum;
- the provider;
- stats;
- navigation;
- maintenance (Clear cache);
- legal copy.

The popup also has local defects:

- "Level: L1" sits beside a select whose first two options both say Beginner (`popup.html:51-58`).
- "30 Spanish words" is catalog size but reads like progress.
- The model name and the key placeholder are truncated.
- The "On" label shows beside an unchecked box.

*Change:* keep the following above the fold, and move the rest to options (#5).

- A one-sentence state line.
- A labelled pause switch (`role="switch"`).
- One row for this site, which becomes "Turn on for this site" when permission is missing.
- A "Today" line.
- One primary button: "Review 3 due words", "Practice" or "Add words".
- Links to Settings, My words and Help.

Keep the rare budget-recovery prompt (`popup.html:65-69`) in the popup. *Value:* the popup answers "is it working here, and what next?" at a glance. *Effort:* M. *Risk:* low. Keep the permission-request-first ordering and the `inject()` fallback (`popup.js:179-186,222-231`).

**#5 Options page.** *Problem:* the manifest has no `options_ui`. Backup and personal entries are orphan tabs. *Change:* add `options.html` with five sections.

- **Learning:** language, generated languages, level, gradual, words/day, density, inline recall, each explained in one line.
- **Sites and privacy:** new-site default, allow-all, exceptions, and the full disclosure.
- **Gemini:** key, test, remove, model, and the daily cap.
- **Your data:** backup, personal export, and Clear cache, explained.
- **About:** version, license, credits, curriculum limits.

**No build step is needed.** It is plain HTML plus an ES module, like `review.html`. *Value:* removes about 15 popup controls and gives users the expected Options entry. *Effort:* M. *Risk:* low. The router's popup-only allowlist (`background.js:1294`) must admit the options URL for the settings messages. Do that via #21's table, not another string comparison.

**#16 Personal entries reachable.** *Problem:* the entry list, search, archive and export live only on `capture.html`. That page is reachable only from the selection menu, which always opens a new tab (`background.js:1025`). *Change:* first, link "My words" from popup and options to `capture.html` without a nonce. Later, move capture and review into a Chrome side panel; the `sidePanel` permission has no install warning. *Value:* a shipped feature becomes discoverable, and capturing no longer costs a tab switch. *Effort:* S, then M. *Risk:* low. The side panel needs its own sender entry and must keep the nonce, two-minute expiry and document rechecks.

### (c) The reading experience

**#14 Calmer practice and cue.** *Problem:* practice words render as `The problem → [?]` inside prose (B6). That is four on one short article. The cue covers the next line (B7). After reveal it shows six buttons that wrap in 292 px, leaving "Already know" alone on a second row (B8). Its prompt repeats the inline text, and first focus lands on Dismiss (`content.js:216`). *Change:*

- Show the English word with a dashed underline and a small superscript "?".
- Cap practice cues to one or two per viewport.
- Place the cue by available space, as `placeTip` does (`content.js:105-117`).
- Use one row of four ratings, with "Already know" as a quieter item.
- Focus "Reveal answer" first, and keep Escape returning to the word.

*Value:* reading stays reading. *Effort:* S–M. *Risk:* low. Tickets and revisions are unchanged, but tests that match the `[?]` DOM need updating.

**#15 Keyboard commands.** *Problem:* there is no quick way to hide swaps when the user needs to read precisely, and no shortcut to review. *Change:* add `commands` entries, for example Alt+Shift+W to pause and Alt+Shift+R to open review. The `commands` key carries no warning. *Value:* an escape hatch and a habit trigger. *Effort:* S. *Risk:* low. Reuse the existing `enabled` save, which already restores text.

**#18 Pronunciation audio.** *Problem:* hints are approximate respellings, and there is no audio anywhere. *Change:* add a speak control on the review card and in the inline cue, using `chrome.tts` with a Spanish voice and preferring local voices. *Value:* a core learner need. *Effort:* M. *Risk:* low to medium. Network voices send the single word to Google, so disclose that. Never auto-play in pages.

**Preserve.** Keep the 700 ms gloss beat (`content.js:38`). It is deliberate recall time. One thing to watch: currentColor underlines on new and known words could read as links on some sites. If users report that, try a dotted style, keeping the "never change text color" rule.

### (d) The review experience

**#6 Gradual on for new installs (operator ruling).** *Problem:* D6. *Change:* the welcome page recommends gradual learning at five words a day. Write `gradual: true` explicitly on `reason === 'install'`. Do **not** change `DEFAULT_SETTINGS`, because `cleanSettings` back-fills missing keys and would silently flip existing profiles. *Value:* the default becomes a learning loop, not a word swapper. *Effort:* S. *Risk:* medium, because it is a product ruling. Existing users are unaffected by the explicit install-time write. The learning-science lane may have a view on words/day.

**#9 Review keyboard flow (verified bug).** *Problem:* `run()` disables every button during an action (`review-page.js:53`). In real Chromium, focus fell to `<body>` after Reveal and after every rating, measured by `e2e/focus.mjs`. Keyboard and screen-reader users must Tab back in after each card. Space does not reveal. *Change:*

- Focus Reveal after load, and focus a rating after reveal.
- Bind Space/Enter to reveal and 1–4 to the ratings, with visible hints.
- Use `aria-busy`, or restore focus in `finally`.

*Value:* faster cards for everyone, and an accessibility fix. *Effort:* S. *Risk:* none. Ticket and generation guards are untouched.

**#10 Review clarity.** *Problem:*

- The copy says "the selected language" three times, though the page knows it is Spanish (`review.html:23,30`).
- There is no session progress or finish screen.
- "Refresh queue" leaks implementation, since `storage.onChanged` already reloads (`review-page.js:88-93`).
- "Already know" versus "Easy" is unexplained.
- Prompts only run English to target, with no example sentence.

*Change:*

- Name the language.
- Show "3 of 8" progress.
- Add a finish card: "Done. Next review tomorrow, 3 words."
- Remove Refresh.
- Add one-line rating help.
- Add bundled example sentences where available.

*Value:* review feels finite and rewarding. *Effort:* S–M. *Risk:* low. Do not store page sentences as card context. Events deliberately hold no passages, and that would widen history scope.

### (e) Feedback and progress visibility

**#3 Per-tab toolbar state.** *Problem:* D2 and D7. Every failure is invisible outside the popup: no key, no permission, site off, sensitive site, quota, bad key. The badge is reserved for the unpacked "NEW" update notice (`background.js:1235`; `UPSTREAM-QUOTA-MISSION.md:39`). *Change:* set the badge text, color and title per tab with the `tabId` option.

| State | Badge and tooltip |
|---|---|
| Working on this tab | No badge, or the number of woven words |
| Needs key | "!" with "Add your Gemini key" |
| Needs this site's OK | "•" with "Click to turn on here" |
| Cooling down | A muted mark with "Paused until 1:46 PM; review still works" |

An opt-in due count is possible. "NEW" stays for development builds only (#20). *Value:* users learn why nothing is happening without opening anything. *Effort:* M. *Risk:* low. Compute state from the same `activeOn`, `siteEnabled` and `hasSiteAccess` predicates. Store no hosts, and put no page content in the badge.

**#11 "Today" and progress.** *Problem:* there is no sense of progress. The popup shows catalog size and "0 due". The worker already keeps per-target `readingEvents` (seen, peek, flip and day), review cards with intervals and familiarity, and encounters, all without URLs. *Change:*

- A popup "Today" line: introduced, seen, peeked, flipped, reviewed.
- An options or side-panel section with words by stage, a 30-day activity strip, and a forgiving "days practised this week" instead of a brittle streak.

*Value:* retention. *Effort:* M. *Risk:* low, if derived only from existing bounded local data. Nothing new is stored and nothing leaves the device.

**#12 My words.** *Problem:* the user cannot see their words, their status or their due dates. The only way to suspend a word is "Already know". *Change:* a searchable list merged with personal entries (#16). Show gloss, stage and next due, with actions for Practice now, Already know and Reset. *Value:* agency and trust. *Effort:* M. *Risk:* low, through the existing serialized, scoped review writes.

### (f) Accessibility and i18n

**#9** is the most urgent accessibility item.

**#17 `lang` on swapped words.** *Problem:* swapped spans have no `lang` (`text.js:44-53`). Screen readers voice "y" as the English letter. The single `aria-label` ("y: and · ee. Show English") can't mix languages. *Change:* set `lang` to the target code on the span, and carry the gloss via `aria-describedby` so the name is the target word alone. *Value:* correct speech for screen-reader users. *Effort:* M. *Risk:* medium. The scanner skips non-English `[lang]` subtrees, and the extension's own spans interact with rescans and the churn guard. Test it carefully.

**Small fixes.** Make the "On" checkbox a labelled switch, and give the site checkbox a visible action label. Popup greys pass contrast today, so keep checking them in dark mode.

**#22 `chrome.i18n`.** *Problem:* about 150 strings are hard-coded across six surfaces. Retrofitting gets harder with each new surface. *Change:* add `_locales/en/messages.json` and `default_locale` now. The UI can stay English. This enables a localized Store listing and future non-English source users. *Value:* reach. *Effort:* M. *Risk:* low, though tests that match copy will change.

### (g) Web Store readiness

**#7 Icons and listing.** *Problem:* there are no `icons` or `action.default_icon`. The Store requires a 128 px icon, at least one 1280×800 screenshot and a 440×280 promo tile. *Change:*

- Design a 16/32/48/128 mark legible in light and dark, with a neutral base for #3's badges.
- Capture five listing screenshots with a cleaned-up copy of this harness: onboarding, gloss, flip, review, progress.
- Write a description that leads with "learn while you read" and states the privacy model.

*Value:* a Store requirement and the first impression. *Effort:* S–M. *Risk:* none.

**#8 Privacy and fingerprinting.** *Problem:*

- The Store data-usage form must declare **website content** sent to a third party. That needs a hosted privacy policy and the Limited Use certification. Today the disclosure is popup copy only.
- `web_accessible_resources` exposes `src/*.js` to every web origin (`manifest.json:37-47`). With a fixed Store ID, any site can probe `chrome-extension://<id>/src/content.js` and learn the user is learning a language.
- `content-loader.js:7` still logs `[french-weave]`.

*Change:*

- Write a policy that matches the README's privacy section.
- Fill the data-usage form and write per-permission justifications.
- Set `use_dynamic_url: true`, after checking support at the minimum Chrome version, or ship one classic content bundle so nothing is web-accessible.
- Fix the log tag.

*Value:* avoids rejection and protects users. *Effort:* M. *Risk:* low. The dynamic `import()` in `content-loader.js` must keep working, and the smoke test covers it.

**#19 Drop the X content script.** *Problem:* the x.com and twitter.com match is a personal-use artifact. It causes the only install-time host warning and an inconsistent consent model. *Change:* remove it from the Store manifest and suggest X during onboarding. *Value:* a cleaner install and one consent path. *Effort:* S. *Risk:* existing unpacked users lose implicit X access. Keep it in a dev manifest or prompt them once. That is an operator call.

**#20 Gate the self-update.** *Problem:* `checkUpdate()` (`background.js:1222-1240`) fetches the disk manifest every 30 minutes, calls `chrome.runtime.reload()`, and shows "NEW" plus a "click the reload arrow" banner (`popup.html:34-35`). In a Store build that is meaningless, and it is the main reason for `alarms`. *Change:* enable it only for `installType === 'development'`, or via the package script (#21). *Value:* less permission surface and no confusing banner. *Effort:* S. *Risk:* low. Fleet unpacked installs keep it.

### (h) Engineering hygiene that blocks product work

**#21 Split, route table, shared CSS, package script.** *Problem:*

- `background.js` is 1,353 lines covering context, swaps, gradual budgets, review, inline recall, capture, backup and journal, update, site registration and routing.
- Authorization is one long boolean of sender-URL comparisons (`background.js:1243-1301`). Each new surface (welcome, options, side panel) edits it, and that is where a permission mistake would hide.
- Each page has its own palette.
- A Store zip would need hand-excluding `test/`, `e2e/` and `node_modules/`.

*Change:*

- Extract `router.js` as a declarative surface→messages table, plus `reading.js`, `review-handlers.js`, `capture-handlers.js`, `backup-handlers.js` and `update.js`, with no logic change.
- Add `src/ui.css` tokens with light and dark values.
- Add `scripts/package.mjs`. It zips `manifest.json`, `src/`, `icons/` and `_locales/`, applies Store manifest deltas (#19, #20) and verifies the file list.
- Add no bundler. Options, welcome and the side panel need none.

*Value:* unblocks #1, #4, #5 and #16 safely. *Effort:* M–L. *Risk:* medium. It is a large mechanical diff over the recheck-after-await guards. Ship it alone, with no behavior change, full gates and a council fixpoint.

**Reachability, answering the brief.** The review page opens **only** from the popup's "Open review" button, below the 600 px fold. There is no options link, command or toolbar menu item. Personal entries open only from a selection capture. #4, #5, #15 and #16 fix this.

---

## 3. Excellent; must be preserved

- **Consent architecture.** It uses per-site optional permissions requested from a user gesture and sensitive-site defaults off. It has title and high-stakes guards, skips forms, editable text and code, and rechecks consent after every await. Nothing may route around `activeOn`/`hasSiteAccess`.
- **Sender-scoped router.** Each surface may send only its own messages. Make it declarative, but never loosen it.
- **Honest fixed copy.** Status text is allowlisted, with no raw provider text and no secrets (`quota-status.js:131-162`). The free-key training disclosure is unusually candid. Keep that voice.
- **No telemetry; local, scoped learning data.** Events have no URLs or passages. Histories are per language and pack version, and the backup is fail-closed and excludes keys, grants and consent. Build all progress features from this data, never by widening it.
- **Gloss craft.** It has the 700 ms recall beat and fixed placement that never clips. The visual box is `aria-hidden` with the meaning in the accessible name. It supports `forced-colors` and light and dark, and never changes text color. Only trusted events count, and Enter/Space flip with a visible focus ring.
- **Learning integrity.** Reveal comes before rating, and sightings never count as recall. "Already know" exists, and the budget recovers from clock skew. In inline recall, Escape returns to the word.
- **Offline personal capture.** It makes no network call, labels provenance honestly, and archive keeps history.
- **No build step.** Keep it auditable. Add only a package script.

## 4. Suggested sequencing

1. **Hygiene:** #21 as its own PR, with no behavior change.
2. **Activation:** #9 (independent and quick), then #2, #1 and #3. Then #4 with #5, since the popup shrinks only once options exist.
3. **Store:** #7, #8, #19 and #20, plus the listing.
4. **Retention:** #10, #11, #12, #14 and #16.
5. **Rulings for `open-questions`:**
   - #6, the gradual default.
   - #13, zero-key or on-device mode.
   - #19, X access for existing users.
   - The default new-site policy for Store installs: allowlist versus all-but-sensitive.

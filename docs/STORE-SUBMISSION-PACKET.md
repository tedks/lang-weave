# Chrome Web Store submission packet (DRAFT for Ted's review)

> **Status: draft. Nothing here has been entered in, uploaded to, or checked against the Developer Dashboard.** No account, key, upload or publish action was taken.
> Written against Lang Weave **0.16.1**, source commit `39b264a` (tag `v0.16.1-beta.1`), and the Store build from `node extension/scripts/package.mjs --store` at that commit (91 zip entries, inspected November 28, 2026). Citations are `file:line` at `39b264a`.
> Policy and Dashboard quotes were fetched from developer.chrome.com on November 28, 2026. Every fetch returned HTTP 200 except the two pages marked 404 in section 10. Quotes are short excerpts; follow the URL for full text.
> Companion: [PRIVACY-POLICY.md](PRIVACY-POLICY.md). The Dashboard privacy answers here must agree with it ("If the information listed in your privacy fields contradicts the information provided in your privacy policy", listing requirements). This packet replaces the old STORE-LISTING.md, which is now a pointer.
> This is preparation, not an approval prediction and not legal advice.

## 0. What the Store build is

The Store zip is the shipped extension with three manifest deltas, applied only in `package.mjs` (`extension/scripts/package.mjs:53-96`):

| Delta | Dev/unpacked manifest | Store manifest |
|---|---|---|
| X content script | `content_scripts` injects `src/content-loader.js` on `https://x.com/*`, `https://twitter.com/*` (`extension/manifest.json:37-51`) | Removed. X works only after a normal per-site grant |
| `alarms` | Declared (`manifest.json:11`), used for the unpacked self-update timer | Removed |
| `web_accessible_resources` | 19 `src/` modules for all HTTP(S) origins (`manifest.json:52-79`) | Removed. The content script ships as one classic file, `src/content-bundle.js`, and `src/sites.js` is rewritten to register it (`package.mjs:585-601`) |

Unchanged in the Store build, and therefore part of the review: the manifest `key` (`manifest.json:6`), `minimum_chrome_version` 140 (`manifest.json:5`), the two `commands` (`manifest.json:27-36`), `storage`, `scripting`, `activeTab`, `contextMenus`, the Gemini host permission and the optional `http://*/*` and `https://*/*` host permissions (`manifest.json:9-22`). The zip also carries `LICENSE`, `LICENSE-MIT` and `NOTICE` (`package.mjs:25`, `:146`) and five modules that nothing in the Store build loads (see risk R9): `src/content-loader.js`, the dev-build loader that `src/content-bundle.js` replaces and the only file with a dynamic `import()`; and `src/content.js`, `src/page.js`, `src/panel-style.js` and `src/personal-capture.js`, whose code is bundled into `src/content-bundle.js`.

## 1. Store listing tab

| Field | Draft | Notes |
|---|---|---|
| Name | **Lang Weave** | From `__MSG_ext_name__` (`extension/_locales/en/messages.json` `ext_name`). No Google mark in the name, as the branding guide asks: "Don't use any Google trademarks or any confusingly similar marks as the name of your extension" (<https://developer.chrome.com/docs/webstore/branding>). |
| Summary | `Learn languages through the English you already read: contextual words, hover hints and click-to-English.` (105 characters) | **Fixed by the package.** The summary is the manifest `description` (`__MSG_ext_description__`), which "no more than 132 characters" (<https://developer.chrome.com/docs/extensions/reference/manifest/description>) and "After uploading your item, you won't be able to edit the metadata of your manifest in the developer dashboard" (<https://developer.chrome.com/docs/webstore/prepare>). Changing it is a code change and a version bump. |
| Category | Education [VERIFY in the Dashboard's current category list] | The listing docs name a "primary category" but do not list the categories. |
| Language | English | The extension ships only `_locales/en`, with every `__MSG_` key the manifest uses present (`ext_name`, `ext_description`, `action_title`, `command_pause`, `command_review`). |
| Store icon | `extension/icons/icon-128.png` | "A 128x128 px to use as your store icon" (cws-dashboard-listing). The images guide wants a 96×96 mark with 16 px transparent padding; [VERIFY the icon's padding]. |
| Screenshots | Section 3 | "At least one 1280x800 px or 640x400 px screenshot, up to 5 total" (cws-dashboard-listing). |
| Small promo tile | `docs/store-assets/small-promo.png` (440×280) | |
| Marquee | None | Optional. |
| Official URL | [OFFICIAL URL: only a site verified in Search Console appears in the pull-down] | |
| Homepage URL | <https://tedks.com/projects/lang-weave/> [CONFIRM] | |
| Support URL | [SUPPORT URL, e.g. https://github.com/tedks/lang-weave/issues] | |
| Mature content | Off | |

### Detailed description

Plain text, no markup. Every claim is checked against the code in the "Source" column of section 1a.

```
Learn a language while you read.

Lang Weave swaps a few words on the English pages you choose into the language you are learning, right where they make sense. Hover or focus a word to see its meaning and a written pronunciation hint. Click it to flip it back to English. Words you meet come back later in a short spaced review. Spanish and Paraguayan Guaraní are bundled.

TRY IT WITHOUT A KEY
- The welcome page has short bundled reading samples you can hover and flip.
- Practice a paragraph: paste your own English text and try bundled words in it. It stays in that tab.
- Review and My words work offline.

HOW IT WORKS ON WEBSITES
- You choose where it may read: only sites you turn on (recommended), one Chrome permission prompt per site; or all sites, one Chrome prompt that grants access to every HTTP and HTTPS site, after which Lang Weave itself keeps sensitive sites switched off until you turn one on.
- Gradual learning introduces a few new words a day (5 by default; you set the pace or turn it off).
- Reviews are scheduled with FSRS, an open spaced-repetition method.
- Save your own words from a page: select, right-click, Add to Lang Weave. Saving sends nothing; with gradual learning on, a saved word can later be offered to Gemini as a candidate.
- You can also generate a starter vocabulary for another language. Generated packs are experimental and not checked by a native speaker.

HOW YOUR DATA IS HANDLED
- No account, no Lang Weave server, no analytics or tracking. Your settings and review history are stored only in your browser.
- Weaving on websites sends Google's Gemini API, with your own Gemini API key: readable text from the sites you allow; your reading level, density and language; and the candidate words. With gradual learning on, the candidates are grouped and ordered by your progress (learning words, due first; known words), with a swap budget and eligible saved words; with it off, the request reflects which words you have already seen today. Testing your key and generating a new language also send short requests. The page address and tab title are not sent as fields, but on-page headings and anything else in a passage can be.
- With a free key, Google may use that text to improve its products and human reviewers may read it; Google advises not to send sensitive, confidential or personal information with a free key. A billed key avoids the product-improvement use. Under Google's terms, users in the EEA, Switzerland and the UK need a billed key. [HOLD: this paragraph follows the D3a ruling.]
- Webmail, messaging, AI chat, password managers, banking, health, government and private-network sites start switched off. This is a heuristic safety net and cannot recognise every private page.
- Lang Weave is for people 18 and older, as Google's Gemini API terms require.
- You need your own Gemini API key from Google AI Studio for weaving on websites. Google's quotas and charges apply to your key. Lang Weave limits itself to 1,000 requests a day; that is not a spending cap.

OPEN SOURCE
Free software under the GNU AGPL v3 or later, forked from Jackie Oliver's French Weave (MIT). Source: https://github.com/tedks/lang-weave
Privacy policy: [PRIVACY POLICY URL]

The bundled vocabulary is a curated starter set, not a certified curriculum, and the model can make contextual or grammatical mistakes. This is mixed-language reading, not translation.

Lang Weave is not affiliated with or endorsed by Google or Duolingo. Gemini is a trademark of Google LLC; Duolingo is a trademark of Duolingo, Inc.
```

`[DECIDE: "beta"]` The GitHub release is tagged `-beta.1`. The Store has no beta label and nothing in the policy pages forbids the word. If Ted wants it, put it in the description ("This is an early release"), not the name, so the name does not change later.

### 1a. Description sources

| Claim | Source |
|---|---|
| Swaps, hover/focus hint, click/Enter/Space to flip | `README.md` opening paragraph; `extension/src/welcome.html:44` |
| Spanish and Paraguayan Guaraní bundled | `README.md` "Install in Chrome"; `extension/src/welcome-demo.js:2-3` |
| Keyless samples and paragraph practice stay local | `extension/src/welcome.html:31-46`; `_locales/en/messages.json` `paragraph_intro`; no `fetch`/`sendMessage` in `welcome-demo.js`, `paragraph-page.js` |
| Review works without key or network | No `fetch` in `review*.js`, `words.js`, `progress*.js` |
| Two site policies; per-site grant or one all-sites grant; sensitive defaults applied by Lang Weave, not Chrome | `extension/src/welcome.html:53-56`; `extension/src/welcome.js:6-9`, `:33`; `extension/src/popup.js:73`; `extension/src/sites.js:41-50` |
| Gradual learning on for new installs, 5 a day | `extension/src/settings.js:18-22`; `extension/src/welcome.html:70` |
| FSRS | `extension/src/fsrs.js:6-10` |
| Add to Lang Weave | `extension/src/capture-handlers.js:235-242` |
| Generated packs experimental, up to five | `_locales/en/messages.json` `options_add_language_intro`; `extension/src/languages.js:11` |
| Data handling, sensitive sites, 1,000 a day | PRIVACY-POLICY.md Appendix A (C1-C18) |
| What is sent to Google | PRIVACY-POLICY.md C1, C3, C6, C8, C9, C12, C13 |
| Saving sends nothing | `extension/src/capture-handlers.js` (no `fetch`); PRIVACY-POLICY.md C14 |
| 18+ | `extension/src/welcome.html:51`; `extension/src/options.html:58` |

### 1b. What the listing must not claim

1. "Private", "your data never leaves your device", "nothing is sent". Page text goes to Google.
2. "No data collection" without the Gemini sentence. The privacy tab declares website content and authentication information.
3. "Free" without the key caveat; "no sign-up" without saying a Google account and key are needed for weaving.
4. "Works offline" for weaving. Only samples, paragraph practice and review work offline.
5. "Works on any website", "any language". Sensitive sites start off; two languages are bundled; others are generated and experimental.
6. "Accurate", "native-speaker reviewed", "CEFR-aligned", "certified", "proven". None is established.
7. "Safe for kids" or any under-18 audience.
8. "GDPR compliant", "compliant with Google's terms" or any legal conclusion. `store-provider-region-ruling` is open.
9. "Automatically protects banking and health". The blocklist is heuristic.
10. "Powered by Google", "official Gemini extension", Google, Duolingo or other logos.
11. "Works on X out of the box". The Store build has no X content script.
12. "Pronunciation audio", "hear how it sounds". Hints are written only.
13. "Syncs across devices", "cloud backup", other browsers. Backup is a manual JSON file.
14. "Unlimited". The local cap and the key's quota apply.
15. "Imports your Duolingo progress". The placement preview only orders local examples from a number you type (`extension/src/placement.js:3-11`).
16. Superlatives, competitor comparisons, user counts, ratings or testimonials.
17. "Your progress never leaves your browser" or "your settings never leave your browser". Reading level, density and language go to Google with every reading request, and with gradual learning on so does the progress grouping of the candidate words.

## 2. Single-purpose statement

> Lang Weave helps adults learn a language while they read: it replaces a few words in English web pages they choose with the language they are learning, shows a meaning and pronunciation hint, and schedules those words for spaced review.

Every feature serves that purpose: page swaps, the keyless samples and paragraph practice, review and My words, the selection menu for saving words, generated packs, the Spanish placement preview, and the learning backup. The Dashboard says the purpose must be "narrow and easy to understand" (<https://developer.chrome.com/docs/webstore/cws-dashboard-privacy>).

## 3. Screenshots

All images come from `extension/e2e/store-shots.mjs`, which loads the packaged Store build in an isolated profile, grants only a synthetic host (`reading.example`), fails closed on every DNS name and intercepts Gemini with a canned reply. The article is original sample prose. No real account, key, personal page or live Gemini call is used. See `docs/store-assets/README.md`.

0.16.1 refresh (this branch): `01-welcome.png`, `04-review.png` and `05-progress.png` changed because the UI changed; `02-hover.png`, `03-flip.png` and `small-promo.png` rendered byte-identical. The run used cached Chromium revision 1247 because the pinned 1248 was not cached and the disk was too full to download it. `--check` passes (dimensions and format only). Not yet done: a render with the pinned revision and an eyes-on comparison against an installed Store build (R15). Fixture note for the record: the review image's session starts from the page's **Add 5 new words** control, not from reading-introduced words.

| # | File | Caption (Dashboard has no caption field; use as alt text or overlay only if Ted wants) |
|---|---|---|
| 1 | `01-welcome.png` | **Try it first.** Try a bundled reading sample before you add a key. It stays on your device. |
| 2 | `02-hover.png` | **Hover.** Hover a word for its meaning and a written pronunciation hint. |
| 3 | `03-flip.png` | **Flip.** Click a word to flip it back to English. |
| 4 | `04-review.png` | **Review.** Words you met while reading come back for a quick recall check, scheduled with FSRS. |
| 5 | `05-progress.png` | **Progress.** See what you have introduced, seen and recalled. |
| promo | `small-promo.png` (440×280) | Lang Weave · Learn Spanish while you read. |

**Capture instructions.** From a checkout with network access to the bun cache and Playwright's pinned Chromium:

```sh
cd extension
bun install --frozen-lockfile          # playwright 1.64.1
bunx playwright install chromium        # only if revision 1248 is missing
node e2e/store-shots.mjs                # renders in a temp dir, checks, copies into docs/store-assets
cd .. && node extension/e2e/store-shots.mjs --check
git diff --stat docs/store-assets       # review every changed image by eye before committing
```

Use a fresh, isolated profile only (the script creates one). Never capture from a personal profile, a real feed or a real key.

**Better five for 0.16.1 (recommended, needs a harness change).** The Store allows only five screenshots. The current set spends two on hover and flip. Shots that would sell the current product and show reviewers the consent flow:

| Proposed shot | Caption | How to capture |
|---|---|---|
| Site-access chooser | **You choose where it reads.** The welcome page says what is sent to Google before you pick "Only sites I turn on" or "All sites except sensitive ones." | In `store-shots.mjs`, scroll `#privacyHeading` to the top of a 1280×800 viewport on `welcome.html` before capture. |
| Keyless sample, Guaraní | **Two bundled languages.** Hover a Paraguayan Guaraní word in a sample, no key needed. | Select Guaraní in `#demoLanguage`, hover the first swap. |
| Practice a paragraph | **Bring your own sentence.** Paste English and try bundled words in it. Nothing leaves the tab. | Open `src/paragraph.html`, fill the synthetic article's first paragraph. |
| Popup on a new site | **One site at a time.** Turn Lang Weave on for this site and Chrome asks for that site only. | Popup on `reading.example` before the test grant shows "This site needs your OK". The popup is a separate window; render `popup.html` in a 1280×800 page with a neutral backdrop. |

Suggested five: site-access chooser, hover, keyless sample (or paragraph practice), review, progress. That replaces flip (the hover image already shows a swapped word) and moves the consent screen into the gallery. Filed as a recommendation, not done here, because it edits the harness.

## 4. Privacy practices tab

### What goes to Google (single account used everywhere in this packet and the policy)

| Request | Contents | When |
|---|---|---|
| Reading | Always: up to 8 passages of page text (at least 6 words and at most 2,000 characters each) with `revision:hash` ids; your key in the `x-goog-api-key` header; instructions carrying reading level, density, target language and the candidate words (target form, English gloss). With gradual learning on (new-install default): candidates grouped and ordered by progress (LEARNING, due first; KNOWN), a per-request swap budget, and eligible saved personal words. With it off: today's shown forms, listed (generated languages) or used for ordering only (Spanish). A fallback retry resends the same body to Flash-Lite. | Only on an enabled, granted site after the welcome choice, with a key, under the daily cap (PRIVACY-POLICY C6, C8, C9, C11, C33) |
| Key test | `Reply OK.` with your key | User presses **Test key**, after the welcome choice (C12) |
| Language generation | Language code and English name, with your key | User adds a generated language, after the welcome choice (C13) |

Never sent as records: review schedule and ratings, reading events, reading dates, learning log, encounter counts, site choices, cache, backups. Stored settings stay in the browser, but their reading level, density and language values are written into every reading request. With gradual learning on, the progress grouping and ordering derived from the review history travel with the candidates; with it off, today's shown forms do.

### 4a. Permission justifications

Enter one per permission in the Store manifest. The Dashboard warns "Requesting broader permissions than necessary may cause your extension to be rejected" (cws-dashboard-privacy).

| Permission | Justification | Evidence |
|---|---|---|
| `storage` | Keeps the user's settings, Gemini API key, site choices, saved words, review schedule, learning log and cached word choices in `chrome.storage.local`, plus a short-lived guess ticket in `chrome.storage.session`. The extension has no sync or upload of this storage; what is sent to Google per request is listed above. | `extension/src/background.js:29`; `extension/src/cache.js:62-66`; `extension/src/reading.js:401-412` |
| `scripting` | Registers the reading script only for origins the user has granted (`registerContentScripts`), and injects it into the open tab right after the user turns that site on from the popup, so they do not have to reload. | `extension/src/sites.js:24-36`, `:56-60` |
| `activeTab` | When the user opens the popup or uses a shortcut, gives access to the current tab's address so the popup can show and switch Lang Weave for that site and ask Chrome for that one site's permission. | `extension/src/popup.js:73`; `extension/src/commands.js:6-13` |
| `contextMenus` | Adds one item, "Add to Lang Weave", for selected text on web pages, so the user can save a word to their own vocabulary. Saving sends nothing; it opens an extension page and stores the entry locally. | `extension/src/capture-handlers.js:235-242` |
| Host `https://generativelanguage.googleapis.com/*` | The only server Lang Weave contacts, always with the user's own key: reading requests (page text plus candidate words and settings, as listed above), a one-line key test, and an optional generated-language request. | `extension/src/gemini.js:9`, `:24-30`; `extension/src/settings-handlers.js:249-255`; `extension/src/languages.js:55-64` |
| Optional hosts `http://*/*`, `https://*/*` | Never requested at install. Requested only from a user click. "Only sites I turn on" asks Chrome for one site at a time from the popup. "All sites except sensitive ones" (welcome page or Settings) asks Chrome once for every HTTP(S) site; Chrome then grants all of them, and it is Lang Weave, not Chrome, that keeps a list of sensitive sites switched off until the user turns one on from the popup. The X suggestion asks for `https://x.com/*` only. The wildcard declaration is needed for both choices because Chrome only lets an extension request origins it declares. | `extension/src/popup.js:73`; `extension/src/sites.js:47-50`; `extension/src/welcome.js:33`, `:56`; `extension/src/options.js:189-190`; `extension/src/settings.js:55-96` |
| `commands` (manifest key, not a permission) | Two keyboard shortcuts: pause or resume Lang Weave on the current site, and open the review page. | `extension/manifest.json:27-36`; `extension/src/commands.js:4-29` |

Not requested: `tabs`, `history`, `cookies`, `identity`, `webRequest`, any website host access at install (the only install-time host is the Gemini API), `alarms` (Store build).

### 4b. Remote code

**"No, I am not using remote code."** All JavaScript is in the package. Two kinds of model output exist, and both are data:

- **Swap responses** are parsed as JSON (`extension/src/gemini.js:50-57`), validated against the listed vocabulary (`extension/src/engine.js:40`) and written with `textContent` or text nodes (`extension/src/text.js:175`, `:192`, `:205`).
- **Generated-language packs** are parsed as JSON and validated field by field (`cleanPack`, `extension/src/languages.js:17-29`: 20–80 entries, level 1 or 2, bounded form, gloss and hint) before storage. Their words then flow through the same swap and text-node path. A negative search found no `innerHTML` in `extension/src/`; the single `insertAdjacentHTML` (`extension/src/placement-page.js:6`) inserts a static template.

The Store zip scan found no `eval(`, `new Function`, `importScripts` or remote `<script src>`. The only dynamic `import()` is in the unreferenced `src/content-loader.js`, and it imports the extension's own file. MV3 guidance: RHC "does not include data or things like JSON or CSS" (<https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code>); "Communicating with remote servers for certain purposes is still allowed" (<https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements>). Residual: R19 below.

### 4c. Data usage

The fetched Dashboard page does not list the category names or their definitions; the user-data FAQ lists examples instead. Rows use the names Ted will see [VERIFY each name and definition live]. The FAQ says extensions "are required to disclose how they handle user data, even when data is processed or stored locally" (user-data-faq Q3).

| Category | Answer | Why |
|---|---|---|
| Website content | **Yes** | Readable text from allowed pages is sent to Gemini (PRIVACY-POLICY C6). Short fragments are cached locally (C15). |
| Authentication information | **Yes** | The user's Gemini API key is stored locally and sent to Google as the request credential (C3, C4). |
| User activity | **Yes** | Local records of hovers, flips, guesses and review outcomes on Lang Weave's own words, with times (C16). Signals derived from them go to Google with candidate words: progress grouping and ordering with gradual learning on, today's shown forms with it off (C8). |
| Web history | No [Ted: confirm against the live definition] | No list of visited pages is kept or sent. Host names the user turns on or off are stored as settings; reading dates hold dates only (C16). The current tab's URL is processed transiently: the popup and shortcut read it to show and switch the site, the worker uses it to check site access, and a capture draft holds it in worker memory. If the definition covers transient processing of the current URL, the answer changes. |
| Location | No | Not collected. Google sees the request IP under its own terms. |
| Personal communications | **UNRESOLVED** | *For No:* no communication is read as such; webmail, messaging and AI chat start off (C10). *For Yes:* a user can turn such a site on, and its readable text is then sent like any page; the cache keeps 2–4-word excerpts around each swap (C15); text a user selects and saves with Add to Lang Weave is kept locally (C14). Depends on the live definition: "handles" vs "collects as a category". |
| Personally identifiable information | **UNRESOLVED** | *For No:* Lang Weave never asks for a name, email or ID. *For Yes:* passages can contain names and other identifiers of the user or of other people (policy C9), and they are sent to Google; cache excerpts and saved selections can retain them locally. |
| Health information | **UNRESOLVED** | *For No:* health portals start off, and health passages and titles are skipped (C10). *For Yes:* the filter is a fixed word list and heuristic; a user can enable a health site; missed passages are sent; cache excerpts and saved selections are not filtered by topic. |
| Financial and payment information | **UNRESOLVED** | *For No:* banking and payment sites start off; financial passages, titles and checkout/billing paths are skipped (C10). *For Yes:* same heuristic limits; a user can enable such a site; cache excerpts and saved selections can retain such text locally. |

The listing requirements reject privacy fields that contradict the privacy policy ("If the information listed in your privacy fields contradicts the information provided in your privacy policy", listing-requirements); no fetched page says that over-disclosure is safe, so the aim is accuracy, not a direction of error. Ted decides the four unresolved rows (and web history) against the live definitions, checking page-text sending, cache excerpts and selection capture for each; whichever way, the policy must say the same thing (R7).

### 4d. Certifications

> **HOLD — pending Ted ruling (DECISIONS D3a, D5). Do not tick any certification, including Limited Use.** D3a (current head of `managed-key-spec-nov28`) lists: option 1, the Store build requires a **billing attestation**; option 2, accept the risk with disclosure; option 3, do not list for now. **No option lifts the hold by disclosure alone.** Under option 1 the hold stays until the packet (a) names the Limited Use exception that covers the paid tier's abuse logging and any review, and (b) establishes a basis covering free-key requests that the `_freetier` quota signal misses (a mistaken or false attestation still sends page text under the free terms). If either cannot be established, option 3 applies. Option 2 is not a fix: Ted would be explicitly accepting the risk of rejection and of certifying something that may be untrue, and it is not recommended. D5 completes certifications only after the hold is cleared.
>
> Status of (a): candidate exceptions are the transfer exception "to protect against malware, spam, phishing, or other fraud or abuse" and the human-interaction exception "It's necessary for security purposes (e.g., investigating abuse)" (limited-use page). Both are worded for the developer's own handling; that they cover Google's logging of a request made with the user's key is **not established**. Status of (b): **no basis established.**

The Dashboard's three checkboxes (wording from the previous draft; the fetched docs only say "Use the second group of checkboxes to certify that you comply with each of the disclosure statements" [VERIFY verbatim live]):

1. I do not sell or transfer user data to third parties, outside of the approved use cases. **HOLD.** Lang Weave transfers to Google's Gemini API the full inventory in the table above: page text, the key, reading level, density, language, the candidate words, with gradual learning the progress grouping, swap budget and eligible saved words, without it today's shown forms, plus key-test and generation requests. Whether a free-key transfer, which Google may use for its own products, is an approved use case is D3a.
2. I do not use or transfer user data for purposes that are unrelated to my item's single purpose. **HOLD** for the same reason (Google's secondary use under Unpaid terms).
3. I do not use or transfer user data to determine creditworthiness or for lending purposes. True for Lang Weave; **HOLD** with the others.

Limited Use certification: HOLD (D3a). It also needs the hosted policy page to carry the Limited Use statement ("must show a Limited Use disclosure on your project's homepage or on a page one click away from the homepage", user-data-faq). Privacy policy URL: [PRIVACY POLICY URL, e.g. https://tedks.com/projects/lang-weave/privacy/ once tedks/website#53 is merged].

## 5. Reviewer test instructions

Paste into the **Test instructions** tab. The docs call that tab optional and "only useful if the item requires restricted credentials or a paid account for full access to all features" (<https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions>).

**BLOCKER (R10): there is no settled, compliant way for a reviewer to exercise real-site weaving yet.** Steps 1–6 need nothing. Steps 7–11 need a Gemini key, and which kind of key is acceptable depends on D3a and R6: a reviewer may not be able or allowed to create one, and if the Store build requires a billed key (D3a option a), an unpaid reviewer key would not match the intended configuration. Ted must provide a compliant credential path before submission: (a) a dedicated, capped, billed review key in its own Cloud project, deleted after review; or (b) instructions for the reviewer's own key, if that matches the D3a ruling. A keyless-only submission stays **pending**: the only Store guidance found says the Test instructions tab is "only useful if the item requires restricted credentials or a paid account for full access to all features" (cws-dashboard-test-instructions), which does not say that testing the preview alone is enough. Whichever path, the reviewer must be able to exercise the real grant, weave and pause flow. The draft below assumes (b) and must be revised to the ruling.

```
No account or key is needed to see the product.

1. Install. A welcome tab opens.
2. Under "1. Try a reading sample", choose Spanish or Paraguayan Guaraní and a passage. Hover or focus an underlined word for its meaning; click it (or Enter/Space) to flip it to English. This uses bundled data only; there is no network request.
3. Click "Practice a paragraph". Paste any English paragraph and try the suggested words. Nothing leaves the tab.
4. Under "2. Choose where it may read", read the disclosure, then click "Only sites I turn on · recommended". Until a choice is made the extension refuses every Gemini request, including key tests. (The other choice, "All sites except sensitive ones", makes Chrome ask once for access to every HTTP and HTTPS site; Lang Weave then keeps webmail, banking, health and similar sites off until you turn one on from the popup.)
5. Open the toolbar popup > My words, and Practice. Add five new words and rate them. Review works offline.
6. Optional: Settings > Your data > Learning backup downloads a local JSON file of progress (no key, no site data).

Weaving on real websites (needs a Gemini API key) [REVISE TO D3a / R6 RULING]:
7. [KEY SOURCE: per Ted's ruling.] Do not use a key that matters.
8. Settings > Gemini: paste the key, Save key, Test key (sends "Reply OK." to Google).
9. Open a plain English article on a non-sensitive site, open the popup, tick "Turn on for this site" and accept Chrome's prompt for that one site. A few words are swapped. Hover for meaning; click to flip. The request carries the passages, the key, the reading level, density and language, and the candidate words (with gradual learning on, grouped by progress with a swap budget).
10. Untick the site: original text is restored there and no new reading requests are sent from that site. Switch the popup's On switch off: weaving stops everywhere. Removing Chrome's access to the site has the same effect. A request already in flight can still complete. Webmail, banking and health sites start off even with "All sites except sensitive ones", until turned on from the popup.
11. Select a word on the page, right-click > Add to Lang Weave to save it locally. Saving sends nothing.

X/Twitter is not injected without a grant in this build: an all-sites grant covers it like any site, or the welcome page's "Allow x.com" or the popup grants it alone.
```

## 6. Distribution recommendation

**Resolve R6 (provider-terms fit) before making even an Unlisted build available.** Distribution choices narrow some provider risks but do not resolve them.

| Setting | Recommendation | Reason |
|---|---|---|
| Visibility | **Unlisted** for the first review, then Public | "All visibility settings have the same policy requirements and will go through the same review process" (cws-dashboard-distribution), so Unlisted buys no easier review; it limits who finds an early build. Do not create a second "beta" item. |
| Regions | **United States only** to start [Ted decides under `store-provider-region-ruling`] | Gemini terms: "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom." The obligation falls on whoever makes the client available; telling users to use billed keys while accepting any key does not establish compliance there, so excluding those territories is the only option the current build supports. The terms also limit use to "an available region"; the US is listed (available-regions page, fetched Nov 28, 2026). US-only addresses only this clause. |
| Professional/business use | **Open (R6)** | Gemini terms describe the APIs as "for professional or business purposes, not for consumer use." Distribution settings cannot resolve this. Ted/counsel must decide the approved audience and use, then state it in the listing and reviewer instructions. |
| Age | **Open (R6)** for the "likely to be accessed" clause | "You must be 18 years of age or older to use the APIs" and API Clients must not be "directed towards or is likely to be accessed by individuals under the age of 18." The product and listing state 18+; the Store has no age gate, so "likely to be accessed" depends on audience and marketing. Do not market to students or schools. Mature content stays off; it is a content flag, not an age gate. |
| Deferred publishing | Use it | "Once the review is complete, you will have up to 30 days to publish" (<https://developer.chrome.com/docs/webstore/publish>). |
| Pricing | Free | No in-item purchases. |

## 7. Developer account checklist (Ted's actions; none taken)

| Item | Requirement (source) |
|---|---|
| Register and pay | "pay a one-time registration fee" (<https://developer.chrome.com/docs/webstore/register>); amount not on the page. |
| Developer email | "After an account is created, you cannot change its email address" (set-up-account). Use a durable address. |
| Publisher name | Required; "Appears under "Offered by:"" (set-up-account). |
| Verified contact email | "Verify your email (Required)"; shown under the item's contact information. |
| 2-Step Verification | "2-Step Verification is required for all developer accounts prior to publishing an extension" (<https://developer.chrome.com/docs/webstore/program-policies/two-step-verification>). |
| Trader / non-trader (EU DSA) | **Conditional.** "it is the developer's responsibility to accurately self-declare their trader/non-trader status"; traders are verified with "their legal name, contact details, and possibly other relevant identification documents", and "The verified information of traders is available to users of the Chrome Web Store" (<https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure>). Which status applies, and whether it matters if the item is not offered in the EU, was not established (the account and DSA support pages returned 404). Ted or counsel decides. |
| Physical address | **Conditional.** The set-up-account page requires it for items that "offer functionality to purchase items, additional features, or subscriptions"; Lang Weave has none. A trader declaration may separately require verified contact details, possibly including an address; not established. |
| Item ID | Decide `store-first-upload-key` before the first upload (R2). |

## 8. Placeholders Ted must fill

| Placeholder | Where | Notes |
|---|---|---|
| Publisher name | Account; PRIVACY-POLICY.md header | Shown as "Offered by". |
| Developer and contact email (verified) | Account | Cannot change later. |
| Support URL | Listing | GitHub issues or an email. |
| Official URL | Listing | Needs Search Console verification. |
| Homepage URL | Listing | Draft: tedks.com/projects/lang-weave/. |
| Privacy policy URL | Privacy tab; description | Live only after tedks/website#53 merges. |
| Effective date | PRIVACY-POLICY.md | |
| Contact method | PRIVACY-POLICY.md | |
| Change-notification method | PRIVACY-POLICY.md | |
| Visibility | Distribution | Recommendation: Unlisted. |
| Regions | Distribution | Recommendation: US only; `store-provider-region-ruling`. |
| Trader/non-trader | Account | |
| Category | Listing | Verify "Education" exists. |
| "beta" wording | Description | Decide. |
| Manifest `key` / first-upload method | Package | `store-first-upload-key`, `store-manifest-key-delta`. |
| D3a free-key ruling | Policy Limited Use; 4d certifications; description data paragraph | (a) billed key required, (b) accept with disclosure, (c) delay. Blocks submission (R5). |
| Sensitive-category answers | 4c | Four rows UNRESOLVED; decide against live definitions. |
| Approved audience and use | Listing; reviewer instructions | R6, with counsel. |
| Reviewer key plan | Test instructions | Section 5 options (a)-(c); never a personal key. |
| Trademark lines | Description | Ted or counsel confirm. |
| Consent disclosure and wording change (R1) | Code | Gap: name the full payload, affirmative buttons, versioned consent. Needs a ruling and a release. |
| Trader status and any address | Account | Conditional (section 7). |
| Icon padding check | Listing | 96×96 mark in 128×128. |

## 9. Rejection-risk register

Likelihood (L) and impact (I) are judgments (H/M/L), not measurements. Status tiers: **BLOCKER** (a ruling or code change is needed; do not submit), **PREREQUISITE** (work that must be finished and checked before submission). **Sort order, strictly:** BLOCKER rows first, then PREREQUISITE rows, then the rest; within each tier by likelihood × impact (H=3, M=2, L=1), highest first; handled rows last. Ties keep register order.

Submission prerequisites, in one place: a live privacy policy URL (R8); accurate Dashboard answers that match the policy (R7, section 4c); the encryption-applicability check (R4); the developer account (R23). These sit below the blockers only because they need work, not a ruling.

| # | Risk | L | I | Status / evidence | Fix |
|---|---|---|---|---|---|
| R5 | **Free-key transfer vs Limited Use: BLOCKER.** Under the Unpaid terms Google uses submitted content "to provide, improve, and develop Google products and services" and "human reviewers may read, annotate, and process your API input and output". Limited Use allows transfer only "If necessary to providing or improving your single purpose" and says "Do not allow humans to read user data, unless" one of four exceptions applies. No exception that covers either was identified. A user-supplied key does not change who receives the data. Disclosure (`welcome.html:50`; `options.html:65`, `:71`) informs users but does not resolve it. | M | H | **BLOCKER: open, DECISIONS D3a/D5** | D3a: (1) billing attestation, (2) accept with disclosure, (3) do not list. The hold on the Limited Use statement and every certification stays under every option until (a) a Limited Use exception is named that covers paid-tier abuse logging and review and (b) a basis covers free-key requests the `_freetier` signal misses; otherwise option 3. Option 2 is explicit acceptance of rejection and misstatement risk, not a fix, and not recommended. Status in section 4d: (a) candidates only, (b) none. |
| R2 | **Manifest `key` in the uploaded zip.** The Store build keeps the dev `key` (`manifest.json:6`; `package.mjs:51`). No fetched page says what the Store does with a `key` in an upload; outcomes range from ignoring it to rejecting the upload to assigning a different item ID. | M | H | **BLOCKER: open** (`store-first-upload-key`, `store-manifest-key-delta`) | Ted rules before the first upload. Do not upload a `-store` zip until then. |
| R6 | **Gemini terms fit**: "not for consumer use", 18+, and API clients "likely to be accessed" by minors; Paid Services only in the EEA, Switzerland and the UK. US-only distribution covers only the last of these. | M | H | **BLOCKER: open** (`store-provider-region-ruling`) | Ted/counsel decide the approved audience and use before any build, Unlisted included, is available. State the result in the listing and reviewer instructions. |
| R1 | **Consent does not yet cover the payload.** The FAQ wants a disclosure that describes "the types of user data to be collected and how they will be used", and consent through "a specific action clearly agreeing to the disclosure", "within the Product's user interface". **Check of 0.16.1:** (1) *Recipient*: the welcome page names Google's Gemini API and the user's key, and Google's free-key use and human review (`welcome.html:49-50`). Covered. (2) *Payload*: it names readable page text, the key test and pack generation (`welcome.html:49`, `:52`). It does **not** say that candidate words with progress-derived labels, eligible saved words, or reading level, density and language travel with the text. Not covered. (3) *Action*: every Gemini path stays blocked until a site-policy click (`background.js:81`; `reading.js:231-236`; `settings-handlers.js:46`, `:59`, `:227`, `:243`), but the buttons read "Only sites I turn on · recommended" and "All sites except sensitive ones", not agreement. Partly covered. (4) *All-sites path*: the same disclosure sits above both buttons. Covered, with the payload gap from (2). (5) *X grant*: "Allow x.com" sits in the same section and grants only a host; model calls still need the policy click. Covered. (6) *Settings actions*: key test and generation are gated on the same flag. Covered. (7) *Upgrades*: the flag is set to false only on a profile with no stored settings (`background.js:81`). A profile that predates the consent screen is never asked, and a later change to the disclosure does not ask again. Backup import does not carry the flag. Whether every Store install starts with fresh storage is **not established** while the Store item's ID is unresolved (R2): with a key-stripped upload (DECISIONS D1) the item gets a new ID and fresh storage, but a Store install that kept the unpacked ID could in principle meet existing storage. Open, and also a gap for future disclosure changes (R16). (8) *Popup per-site grant*: no disclosure at the moment of the grant; it relies on the earlier welcome choice. | M | H | **BLOCKER: open, code gaps** (payload not disclosed; buttons not affirmative) | Code gaps (not changed here): extend the welcome disclosure to name the candidate words, their progress labels, saved words and reading settings; make the buttons state agreement ("Agree and use only sites I turn on"); version the consent so that a changed disclosure asks again; consider one line at the first popup grant. Needs a ruling and a release. |
| R10 | **Reviewer cannot exercise real-site weaving reproducibly.** The keyless path works (`welcome.html:31-46`). The website workflow needs a key, and which key is acceptable depends on D3a and R6. | M | M | **BLOCKER: open** (no compliant reviewer credential path) | Provide a compliant credential path (section 5) consistent with D3a and R6, exercising grant, weave and pause. Keyless-only stays pending: the Store's guidance found (cws-dashboard-test-instructions) does not say preview-only testing is enough. |
| R7 | **Privacy fields vs policy mismatch** ("If the information listed in your privacy fields contradicts the information provided in your privacy policy", listing-requirements). Four sensitive-category answers are UNRESOLVED (4c). | M | H | **PREREQUISITE** (accurate Dashboard answers) | Settle 4c against the live definitions, then diff the packet, the policy and the hosted page before submitting. |
| R8 | **Privacy policy URL not live** at submission. | M | M | **PREREQUISITE** (live privacy policy URL); tedks/website#53 is a draft with `draft: true` | Merge #53 (Ted) after D3a, with placeholders filled. |
| R23 | **Developer account gaps**: 2-Step Verification, verified email, trader declaration. | M | M | **PREREQUISITE** (Ted's account actions) | Section 7. |
| R4 | **Data at rest not encrypted.** FAQ Q9 describes data "stored at rest using a strong encryption method such as RSA or AES"; the index says "Keep authentication information secure." The key, cached page fragments (`cache.js`), saved words and learning data are in `chrome.storage.local` with `TRUSTED_CONTEXTS` (`background.js:60-64`), which controls access but does not encrypt. | L | M | **PREREQUISITE** (encryption-applicability check before submission) | Verify whether Q9 applies before submission. If it does, disclosure alone does not satisfy it. Candidate designs (not evaluated): session-only key, shorter cache retention, encryption with a key derived or stored separately. |
| R3 | **Broad optional host permissions** `http://*/*`, `https://*/*`. "Request access to the narrowest permissions necessary" covers optional permissions as well ("The policy applies to both required and optional permissions", user-data-faq). "Reviews may take longer for extensions that request broad host permissions" (review-process). The all-sites choice gives Chrome-level access to every site in one prompt; the sensitive-site defaults are Lang Weave's own and the user can override them per site. | M | M | Mitigated by design: optional, user-initiated, per-site by default (`popup.js:73`; `sites.js:47-50`; `settings.js:55-96`) | Use the 4a wording, which states the breadth. Fallbacks, both product changes: remove the all-sites choice **and** reassess the wildcard optional declaration (per-site requests still need the declaration to cover the requested origin; Chrome has no narrower declarative form for "any site the user picks"). |
| R15 | **Screenshots do not match the build.** Refreshed for 0.16.1, but rendered with cached Chromium 155, checked by `--check` (dimensions only) and by eye against the previous images, not against an installed Store build. | L | M | **Open** | Before upload: render with the pinned revision and compare by eye with the same Store zip installed locally (unpacked from the packaged build) in a clean profile. A Store-installed copy can only be checked after upload. |
| R19 | **Remote code / model-controlled input.** Swaps and generated packs are traced as data (4b), and the zip scan found no eval or remote script. The scan is a text search, and the generated-pack path is traced statically (`languages.js:17-29`, text-node rendering), not exercised in a browser test with hostile pack content. | L | M | **Open** where the evidence stops | Add a browser check with adversarial generated-pack fields (markup, scripts) to confirm text-only rendering on every page that shows pack words. |
| R13 | **Single purpose breadth** (weave, review, capture, generated packs, placement, paragraph practice). "Excessive permissions unrelated to your extension's single purpose" (quality FAQ). | L | M | All features are language learning | Use section 2 wording. |
| R11 | **Trademarks.** "Gemini", "Google", "Duolingo" in UI and description; the name is clean. Branding guide: "Give proper attribution for the use of any Google trademarks". The Duolingo Score field has no non-affiliation line in the product. | L | M | Attribution lines in description | Keep them; consider a non-affiliation note beside the Duolingo field (code). |
| R16 | **Later data-practice changes** ("the extension must prominently disclose data practice changes"). | L | M | Future risk; see R1 item 7 | Versioned consent (code gap). |
| R22 | **Duplicate listing / spam** if a separate "beta" item is created. | L | M | Not planned | One item only. |
| R12 | **Self-update code in the Store build.** `update.js` ships and does nothing when the installed manifest has an `update_url` (`update.js:22`, `:43`, `:84`). The harness *supplies* `update_url`, so the real Store-install path is not shown. If a Store install had no `update_url`, `arm()` would run `checkUpdate()` at install and startup (`background.js:193`, `:198`): it fetches the packaged `manifest.json`, compares versions (equal, so no reload), and `chrome.alarms` is absent, so no timer is set. Static reading only; the no-`update_url` branch has not been run against a Store-shaped build. | L | L | **Open** | Run the Store-shaped build without `update_url` in a test profile; after the first Store install, read the installed manifest. |
| R9 | **Unloaded modules in the zip.** Five files ship that nothing in the Store build loads: `src/content-loader.js` (with a dynamic `import()` of the extension's own `src/content.js`), `src/content.js`, `src/page.js`, `src/panel-style.js`, `src/personal-capture.js` (computed from the static import graph of the manifest entry points, HTML pages and `src/content-bundle.js`). MV3 wants "the full functionality of an extension must be easily discernible from its submitted code". Not remote code, but unexplained duplicate code invites questions. | L | L | Open (`store-bundle-dead-loader`) | Omit them from the Store zip in `package.mjs`, or explain them in the test instructions. |
| R14 | **Text-heavy images.** Images guide: "Avoid text"; best listing: "Images should not use too much text". | L | L | Screenshots are real UI; promo has one line | Keep the promo minimal. |
| R20 | **`minimum_chrome_version` 140.** | L | L | Not a policy issue | — |
| R21 | **Localization.** | L | L | Only `en`; every manifest `__MSG_` key present | — |
| R17 | **Static X/Twitter injection** (dev manifest). | — | — | Handled: removed in the Store build (`package.mjs:54-75`); explicit "Allow x.com" grant offered (`welcome.js:11-16`, `:56`) | — |
| R18 | **`web_accessible_resources` exposing 19 modules** (dev manifest). | — | — | Handled: removed in the Store build; content runs as one classic bundle (`package.mjs:85-95`, `:585-601`) | — |

## 10. Policy check (fetched November 28, 2026)

| Policy clause (short quote, URL) | Behavior and evidence in 0.16.1 | Evidence | Residual risk |
|---|---|---|---|
| "Extensions may only collect, use, or transmit user data that is necessary for the extension's disclosed single purpose" (<https://developer.chrome.com/docs/webstore/program-policies/limited-use>) | Reading requests carry the inventory in section 4 (passages, key, level, density, language, candidates; progress grouping, budget and saved words with gradual learning; today's shown forms without it); key tests and generation carry a fixed prompt or a language code and name. All serve weaving. | PRIVACY-POLICY C1, C6, C8, C9, C12, C13 | R5 |
| "Only transfer user data to third parties ... If necessary to providing or improving your single purpose" (limited-use) | One recipient, Google's Gemini API, under the user's key. Under Unpaid terms Google may also use the data for its own products. | `gemini.js:9`, `:24-30` | **R5 (BLOCKER)** |
| "Do not allow humans to read user data, unless:" (limited-use) | Publisher reads nothing; Google's reviewers may read free-key requests; no exception identified | `welcome.html:50` | **R5 (BLOCKER)** |
| "must show a Limited Use disclosure on your project's homepage or on a page one click away from the homepage" (<https://developer.chrome.com/docs/webstore/program-policies/user-data-faq>) | Statement drafted, on HOLD (D3a) | PRIVACY-POLICY.md "Limited Use disclosure" | R5, R8 |
| "If your Product handles any user data, then you must post an accurate and up to date privacy policy." "All parties the user data will be shared with." (<https://developer.chrome.com/docs/webstore/program-policies/privacy>) | Policy names Google's Gemini API as the only recipient and lists every request type | PRIVACY-POLICY.md | R8 |
| "The prominent disclosure and consent must occur within the Product's user interface." / "a specific action clearly agreeing to the disclosure" (user-data-faq Q10) | Welcome-page disclosure; every model call blocked until a site-policy click | `welcome.html:47-56`; `background.js:81`; `reading.js:231-236`; `settings-handlers.js:46`, `:59`, `:227`, `:243` | R1 (payload and button gaps) |
| "Extensions must transmit user data over a secure connection (e.g. HTTPS, WSS)" (user-data-faq Q9) | HTTPS only | `gemini.js:9` | Low |
| "stored at rest using a strong encryption method such as RSA or AES" (user-data-faq Q9); "Keep authentication information secure." (<https://developer.chrome.com/docs/webstore/program-policies/policies>) | Key and local data isolated to trusted contexts, not encrypted | `background.js:60-64` | R4 |
| "Request access to the narrowest permissions necessary" (<https://developer.chrome.com/docs/webstore/program-policies/permissions>) | Host access optional, per site by default, all-sites only on request; no `tabs`; `alarms` dropped from Store | `manifest.json:9-22`; `package.mjs:76-84` | R3 |
| "the full functionality of an extension must be easily discernible from its submitted code" (<https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements>) | All code packaged and readable; AGPL source public | Store zip | R9 |
| "Using JavaScript's eval() method or other mechanisms to execute a string fetched from a remote source" is remote code (mv3-requirements) | No eval; swap and pack responses parsed as data and rendered as text | `gemini.js:50-57`; `engine.js:40`; `languages.js:17-29`; `text.js:175`, `:192`, `:205` | R19 |
| "Extensions with broken functionality---such as dead sites or non-functioning features---are not allowed." (<https://developer.chrome.com/docs/webstore/program-policies/minimum-functionality>) | Keyless features work; weaving needs a key | `welcome.html:31-46` | R10 |
| "Unnatural repetition of the same keyword more than 5 times"; "misleading, inaccurate, incomplete" metadata (<https://developer.chrome.com/docs/webstore/program-policies/listing-requirements>) | Description checked against code (1a, 1b) | Section 1 | R7 |
| "Don't represent that your product is authorized by, endorsed by, or produced by another company" (<https://developer.chrome.com/docs/webstore/program-policies/impersonation-and-intellectual-property>) | Non-affiliation lines; no logos | Section 1 description | R11 |
| "Affiliate links, codes, or cookies must only be included when..." (<https://developer.chrome.com/docs/webstore/program-policies/affiliate-ads>) | None | Negative search | n/a |
| "We don't allow extensions that send messages on behalf of the user without giving the user the ability to confirm" (<https://developer.chrome.com/docs/webstore/program-policies/spam-and-abuse>) | Sends no messages on any site | Code | n/a |
| "The outcome of any user interaction should match the reasonable expectations that were set with the user." (<https://developer.chrome.com/docs/webstore/program-policies/deceptive-installation-tactics>) | No install funnels; listing matches behavior | Section 1b | Low |
| "An extension must have a single purpose that is narrow and easy to understand." (policies, Quality Guidelines); "toolbars that are implemented using content scripts to inject UI into every page are not recommended" (<https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq>) | One learning purpose; no injected toolbar, only inline word spans and a guess panel on granted sites | Section 2 | R13 |
| "2-Step Verification is required for all developer accounts prior to publishing an extension" (two-step-verification) | Ted's account action | Section 7 | R23 |
| Mature content | n/a | | n/a |

Fetch notes: all pages above returned 200. `https://developer.chrome.com/docs/webstore/cws-dashboard-account` and `.../support-dsa` returned 404. The Dashboard privacy page does not list the data categories or the certification wording, so section 4c/4d names are marked [VERIFY]. The branding guide covers Google marks only. No fetched page states what the Store does with a manifest `key` or `update_url` in an uploaded zip.

## 11. Not verified

- Nothing was entered in or checked against the Developer Dashboard; field names and category lists marked [VERIFY] come from docs or the earlier draft.
- No Store upload, no Store install, no live Gemini call. Store zip contents come from running the package script locally and reading the zip.
- Screenshots were rendered with Chromium 155 (revision 1247), not the pinned 156 (revision 1248).
- The `update_url` behavior of Store installs (R12) and the treatment of `key` (R2) are not confirmed by any fetched page, and the no-`update_url` branch was read, not run.
- Whether user-data FAQ Q9 (encryption at rest) applies to extension-local storage (R4).
- The sensitive-category definitions on the live Dashboard (4c).
- The generated-pack rendering path was traced statically, not tested with hostile content (R19).
- Gemini terms and regions were fetched once on November 28, 2026; they change.

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

Unchanged in the Store build, and therefore part of the review: the manifest `key` (`manifest.json:6`), `minimum_chrome_version` 140 (`manifest.json:5`), the two `commands` (`manifest.json:27-36`), `storage`, `scripting`, `activeTab`, `contextMenus`, the Gemini host permission and the optional `http://*/*` and `https://*/*` host permissions (`manifest.json:9-22`). The zip also carries `LICENSE`, `LICENSE-MIT` and `NOTICE` (`package.mjs:25`, `:146`) and two now-unreferenced modules, `src/content-loader.js` and the ES-module `src/content.js` (see risk R9).

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

Lang Weave swaps a few words on the English pages you choose into the language you are learning, right where they make sense. Hover or focus a word to see its meaning and a pronunciation hint. Click it to flip it back to English. Words you meet come back later in a short review, so they stick. Spanish and Paraguayan Guaraní are bundled.

TRY IT WITHOUT A KEY
- The welcome page has short bundled reading samples you can hover and flip.
- Practice a paragraph: paste your own English text and try bundled words in it. It stays in that tab.
- Review and My words work offline.

HOW IT WORKS ON WEBSITES
- You choose where it may read: only sites you turn on (recommended), or all sites except sensitive ones. Chrome asks you for each grant.
- Gradual learning introduces a few new words a day (5 by default; you set the pace or turn it off).
- Reviews are scheduled with FSRS, an open spaced-repetition method.
- Save your own words from a page: select, right-click, Add to Lang Weave.
- You can also generate a starter vocabulary for another language. Generated packs are experimental and not checked by a native speaker.

HOW YOUR DATA IS HANDLED
- No account, no Lang Weave server, no analytics or tracking. Your key, settings, saved words and progress stay in your browser.
- Weaving on websites sends readable text from the sites you allow to Google's Gemini API, using your own Gemini API key. Page addresses and titles are not sent.
- With a free key, Google may use that text to improve its products and human reviewers may read it. A billed key avoids that use. Under Google's terms, users in the EEA, Switzerland and the UK need a billed key.
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
| Two site policies, Chrome grant per request | `extension/src/welcome.html:53-56`; `extension/src/welcome.js:6-9`, `:33`; `extension/src/popup.js:73`; `extension/src/sites.js:41-50` |
| Gradual learning on for new installs, 5 a day | `extension/src/settings.js:18-22`; `extension/src/welcome.html:70` |
| FSRS | `extension/src/fsrs.js:6-10` |
| Add to Lang Weave | `extension/src/capture-handlers.js:235-242` |
| Generated packs experimental, up to five | `_locales/en/messages.json` `options_add_language_intro`; `extension/src/languages.js:11` |
| Data handling, sensitive sites, 1,000 a day | PRIVACY-POLICY.md Appendix A (C1-C18) |
| Addresses and titles not sent | PRIVACY-POLICY.md C9 |
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
12. "Pronunciation audio". Hints are written only.
13. "Syncs across devices", "cloud backup", other browsers. Backup is a manual JSON file.
14. "Unlimited". The local cap and the key's quota apply.
15. "Imports your Duolingo progress". The placement preview only orders local examples from a number you type (`extension/src/placement.js:3-11`).
16. Superlatives, competitor comparisons, user counts, ratings or testimonials.

## 2. Single-purpose statement

> Lang Weave helps adults learn a language while they read: it replaces a few words in English web pages they choose with the language they are learning, shows a meaning and pronunciation hint, and schedules those words for spaced review.

Every feature serves that purpose: page swaps, the keyless samples and paragraph practice, review and My words, the selection menu for saving words, generated packs, the Spanish placement preview, and the learning backup. The Dashboard says the purpose must be "narrow and easy to understand" (<https://developer.chrome.com/docs/webstore/cws-dashboard-privacy>).

## 3. Screenshots

All images come from `extension/e2e/store-shots.mjs`, which loads the packaged Store build in an isolated profile, grants only a synthetic host (`reading.example`), fails closed on every DNS name and intercepts Gemini with a canned reply. The article is original sample prose. No real account, key, personal page or live Gemini call is used. See `docs/store-assets/README.md`.

0.16.1 refresh (this branch): `01-welcome.png`, `04-review.png` and `05-progress.png` changed because the UI changed; `02-hover.png`, `03-flip.png` and `small-promo.png` rendered byte-identical. The run used cached Chromium revision 1247 because the pinned 1248 was not cached and the disk was too full to download it. `--check` passes.

| # | File | Caption (Dashboard has no caption field; use as alt text or overlay only if Ted wants) |
|---|---|---|
| 1 | `01-welcome.png` | **Try it first.** Try a bundled reading sample before you add a key. It stays on your device. |
| 2 | `02-hover.png` | **Hover.** Hover a word for its meaning and how it sounds. |
| 3 | `03-flip.png` | **Flip.** Click a word to flip it back to English. |
| 4 | `04-review.png` | **Review.** Words you met while reading come back for a quick recall check, scheduled with FSRS. |
| 5 | `05-progress.png` | **Progress.** See what you have introduced, seen and recalled. All of it stays in your browser. |
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

### 4a. Permission justifications

Enter one per permission in the Store manifest. The Dashboard warns "Requesting broader permissions than necessary may cause your extension to be rejected" (cws-dashboard-privacy).

| Permission | Justification | Evidence |
|---|---|---|
| `storage` | Keeps the user's settings, Gemini API key, site choices, saved words, review schedule, learning log and cached word choices in `chrome.storage.local`, plus a short-lived guess ticket in `chrome.storage.session`. Nothing is synced or uploaded by the extension. | `extension/src/background.js:29`; `extension/src/cache.js:62-66`; `extension/src/reading.js:401-412` |
| `scripting` | Registers the reading script only for origins the user has granted (`registerContentScripts`), and injects it into the open tab right after the user turns that site on from the popup, so they do not have to reload. | `extension/src/sites.js:24-36`, `:56-60` |
| `activeTab` | When the user opens the popup or uses a shortcut, gives access to the current tab's address so the popup can show and switch Lang Weave for that site and ask Chrome for that one site's permission. | `extension/src/popup.js:73`; `extension/src/commands.js:6-13` |
| `contextMenus` | Adds one item, "Add to Lang Weave", for selected text on web pages, so the user can save a word to their own vocabulary. It opens an extension page; nothing is sent anywhere. | `extension/src/capture-handlers.js:235-242` |
| Host `https://generativelanguage.googleapis.com/*` | The only server Lang Weave contacts. With the user's own key, it sends readable text from user-allowed pages to Google's Gemini API to choose which words to swap; it also sends a one-line key test and an optional generated-language request when the user asks. | `extension/src/gemini.js:9`, `:24-30`; `extension/src/settings-handlers.js:249-255`; `extension/src/languages.js:55-64` |
| Optional hosts `http://*/*`, `https://*/*` | Never requested at install. Requested only from a user click: one site from the popup, or all sites from the welcome page or Settings if the user chooses that. Lets the reading script read and rewrite text on those sites. Sensitive sites stay off even when all sites are granted. | `extension/src/popup.js:73`; `extension/src/sites.js:47-50`; `extension/src/welcome.js:33`; `extension/src/options.js:189-190`; `extension/src/settings.js:55-96` |
| `commands` (manifest key, not a permission) | Two keyboard shortcuts: pause or resume Lang Weave on the current site, and open the review page. | `extension/manifest.json:27-36`; `extension/src/commands.js:4-29` |

Not requested: `tabs`, `history`, `cookies`, `identity`, `webRequest`, `<all_urls>` at install, `alarms` (Store build).

### 4b. Remote code

**"No, I am not using remote code."** All JavaScript is in the package. Gemini returns JSON, which is parsed (`extension/src/gemini.js:50-57`), validated against the listed vocabulary (`extension/src/engine.js:40`) and inserted as text (`extension/src/text.js:118-123`). The Store zip scan found no `eval(`, `new Function`, `importScripts` or remote `<script src>`; the only dynamic `import()` is in the unreferenced `src/content-loader.js`, and it imports the extension's own file. The MV3 guidance: RHC "does not include data or things like JSON or CSS" (<https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code>), and "Communicating with remote servers for certain purposes is still allowed" (<https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements>).

### 4c. Data usage

The fetched Dashboard page does not list the category names; the user-data FAQ lists examples instead. The rows below use the category names Ted will see [VERIFY each name live]. Over-disclosure is the safe error: the FAQ says extensions "are required to disclose how they handle user data, even when data is processed or stored locally" (user-data-faq Q3).

| Category | Answer | Why |
|---|---|---|
| Website content | **Yes** | Readable text from allowed pages is sent to Gemini (PRIVACY-POLICY C6). Short fragments are cached locally (C15). |
| Authentication information | **Yes** | The user's Gemini API key is stored locally and sent to Google as the request credential (C3, C4). |
| User activity | **Yes** (judgment) | Local records of hovers, flips, guesses and review outcomes on Lang Weave's own words, with times (C16). Not transmitted. |
| Web history | No | No list of visited pages is kept. Host names the user turns on or off are stored as settings; reading dates hold dates only (C16). [Ted: confirm] |
| Personally identifiable information | No | Nothing asks for a name, email or ID. |
| Personal communications | No | Webmail, messaging and AI chat start off (C10). A user who turns such a site on sends its text as website content, already declared. |
| Health information, Financial and payment information | No | Not collected by design; health, banking and payment sites start off and high-stakes passages are skipped (C10). |
| Location | No | Not collected. Google sees the request IP under its own terms. |

### 4d. Certifications

The Dashboard's three checkboxes (wording from the previous draft; the fetched docs only say "Use the second group of checkboxes to certify that you comply with each of the disclosure statements" [VERIFY verbatim live]):

1. I do not sell or transfer user data to third parties, outside of the approved use cases. **True**: the only transfer is page text and the key to Google's Gemini API, necessary for the single purpose, under the user's own key.
2. I do not use or transfer user data for purposes that are unrelated to my item's single purpose. **True.**
3. I do not use or transfer user data to determine creditworthiness or for lending purposes. **True.**

Also tick the Limited Use certification only after the hosted policy page carries the Limited Use statement ("must show a Limited Use disclosure on your project's homepage or on a page one click away from the homepage", user-data-faq). Privacy policy URL: [PRIVACY POLICY URL, e.g. https://tedks.com/projects/lang-weave/privacy/ once tedks/website#53 is merged].

## 5. Reviewer test instructions

Paste into the **Test instructions** tab. The docs call that tab optional and "only useful if the item requires restricted credentials or a paid account for full access to all features" (<https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions>). A Gemini key is a free credential a reviewer can make, so the instructions say how, and no one's key is shared.

```
No account or key is needed to see the product.

1. Install. A welcome tab opens.
2. Under "1. Try a reading sample", choose Spanish or Paraguayan Guaraní and a passage. Hover or focus an underlined word for its meaning; click it (or Enter/Space) to flip it to English. This uses bundled data only; there is no network request.
3. Click "Practice a paragraph". Paste any English paragraph and try the suggested words. Nothing leaves the tab.
4. Under "2. Choose where it may read", read the disclosure, then click "Only sites I turn on · recommended". Until a choice is made the extension refuses every Gemini request, including key tests.
5. Open the toolbar popup > My words, and Practice. Add five new words and rate them. Review works offline.
6. Optional: Settings > Your data > Learning backup downloads a local JSON file of progress (no key, no site data).

Weaving on real websites (needs a Gemini API key):
7. Create a free key in Google AI Studio (https://aistudio.google.com/apikey) with a test Google account. Do not use a key that matters; with a free key Google may use requests to improve its products.
8. Settings > Gemini: paste the key, Save key, Test key (sends "Reply OK." to Google).
9. Open a plain English article on a non-sensitive site, open the popup, tick "Turn on for this site" and accept Chrome's prompt for that one site. A few words are swapped. Hover for meaning; click to flip.
10. Untick the site or switch the popup's On switch off: original text is restored and no further requests are sent. Webmail, banking and health sites stay off even with "All sites except sensitive ones".
11. Select a word on the page, right-click > Add to Lang Weave to save it locally (no network call).

X/Twitter is not injected by default in this build; it needs the same per-site grant as any site.
```

[OPTIONAL, Ted's account action] If Ted prefers reviewers not to create a key, make a dedicated Google Cloud project with a low quota cap, create a key there for review only, put it in the test-instructions field, and delete the key after review. Never reuse a personal key.

## 6. Distribution recommendation

| Setting | Recommendation | Reason |
|---|---|---|
| Visibility | **Unlisted** for the first review, then Public | "All visibility settings have the same policy requirements and will go through the same review process" (cws-dashboard-distribution), so Unlisted buys no easier review, but it limits who finds an early build while support and the consent wording settle. Private needs a tester list. Do not create a second "beta" item: one item avoids a duplicate listing and a second ID. |
| Regions | **United States only** to start [Ted decides under `store-provider-region-ruling`] | Gemini terms: "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom." Lang Weave cannot tell whether a key is billed, so EEA, UK and Swiss distribution makes the publisher rely on users following the in-product note (`options.html:71`). The terms also limit use to "an available region"; the US is listed on the available-regions page (fetched Nov 28, 2026; about 190 countries, EEA, UK and Switzerland all listed). Other non-EEA/UK/CH available regions can be added once support exists. |
| Age | No Store control; state 18+ in listing and product | Gemini terms: "You must be 18 years of age or older to use the APIs" and API Clients must not be "directed towards or is likely to be accessed by individuals under the age of 18." Do not market to students or schools. Leave Mature content off; it is for content, not age gating. |
| Consumer use | Open question for Ted/counsel | Gemini terms describe the APIs as "for professional or business purposes, not for consumer use." A BYOK consumer extension sits uneasily with that line. Not a Store review rule, but a provider-terms risk (R6). |
| Deferred publishing | Use it | "Once the review is complete, you will have up to 30 days to publish" (<https://developer.chrome.com/docs/webstore/publish>). Lets Ted inspect the approved item before it goes live. |
| Pricing | Free | No payments, so no physical address requirement ("Required in some circumstances", only for items that sell items, features or subscriptions, set-up-account). |

## 7. Developer account checklist (Ted's actions; none taken)

| Item | Requirement (source) |
|---|---|
| Register and pay | "pay a one-time registration fee" (<https://developer.chrome.com/docs/webstore/register>); amount not on the page. |
| Developer email | "After an account is created, you cannot change its email address" (set-up-account). Use a durable address. |
| Publisher name | Required; "Appears under "Offered by:"" (set-up-account). |
| Verified contact email | "Verify your email (Required)"; shown under the item's contact information. |
| 2-Step Verification | "2-Step Verification is required for all developer accounts prior to publishing an extension" (<https://developer.chrome.com/docs/webstore/program-policies/two-step-verification>). |
| Trader / non-trader (EU DSA) | "it is the developer's responsibility to accurately self-declare their trader/non-trader status"; "The verified information of traders is available to users of the Chrome Web Store" (<https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure>). A free hobby item may be non-trader; Ted or counsel decides. If the item is not offered in the EU (section 6), the question matters less but still appears. |
| Physical address | Not required for a free item without purchases (set-up-account). |
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
| Reviewer key (optional) | Test instructions | Dedicated, capped, deleted after review. |
| Trademark lines | Description | Ted or counsel confirm. |
| Consent wording change (R1) | Code | Gap; needs a ruling and a release. |
| Icon padding check | Listing | 96×96 mark in 128×128. |

## 9. Rejection-risk register

Likelihood and impact are judgments (H/M/L), not measurements. Ranked by likelihood × impact.

| # | Risk | L | I | Status / evidence | Fix |
|---|---|---|---|---|---|
| R1 | **Affirmative consent not explicit enough.** The FAQ wants "a specific action clearly agreeing to the disclosure before collecting or handling user data", "within the Product's user interface", not "only in a privacy policy". 0.16.1 shows the disclosure on the welcome page and blocks every Gemini call until the user clicks a site-policy button (`welcome.html:47-56`; `reading.js:231-236`; `settings-handlers.js:227`). The buttons say "Only sites I turn on · recommended" / "All sites except sensitive ones", not "I agree". A reviewer may read them as a settings choice rather than consent. | M | H | Partly handled | Code gap: relabel the buttons to carry agreement (for example "Agree and use only sites I turn on"), and show one line of the disclosure at the popup's first per-site grant. Needs a ruling and a release. |
| R2 | **Manifest `key` in the uploaded zip.** The Store build keeps the dev `key` (`manifest.json:6`; `package.mjs:51`). The key docs only describe keeping a dev ID; no fetched page says what the Store does with a `key` in an upload. Outcomes range from ignore to reject to a different item ID. | M | H | Open (`store-first-upload-key`, `store-manifest-key-delta`) | Ted's ruling before the first upload. Do not upload a `-store` zip until then. |
| R3 | **Broad optional host permissions** `http://*/*`, `https://*/*`. "Request access to the narrowest permissions necessary" applies to optional ones too ("The policy applies to both required and optional permissions", user-data-faq). "Reviews may take longer for extensions that request broad host permissions" (review-process). | M | M | Handled in design: optional, per-site by default, user-initiated, sensitive sites off (`popup.js:73`; `sites.js:47-50`; `settings.js:55-96`) | Use the 4a justification verbatim. If rejected, the fallback is to drop the "all sites" choice, a product change. |
| R4 | **API key stored unencrypted.** FAQ Q9 describes data "stored at rest using a strong encryption method such as RSA or AES"; the index says "Keep authentication information secure." The key sits in `chrome.storage.local` with `TRUSTED_CONTEXTS` (`background.js:60-64`), which keeps content scripts out but is not encryption. | L | M | Disclosed honestly in the policy | Options: accept and disclose; session-only key with re-entry; no real at-rest encryption is possible without a user secret. Ruling needed if a reviewer raises it. |
| R5 | **Google's human review of free-key requests vs Limited Use.** "Do not allow humans to read user data, unless" one of four exceptions applies. Lang Weave's own staff read nothing, but free-key requests may be read by Google's reviewers. | L | H | Disclosed in the welcome page, Settings and policy (`welcome.html:50`; `options.html:65`, `:71`) | A billed-key requirement removes it; a store-only "billed key" acknowledgement is a smaller step. Ruling. |
| R6 | **Gemini terms fit** ("not for consumer use", 18+, minors, EEA/UK/CH Paid-only). Not a Store review rule, but a reviewer or Google could treat a consumer BYOK client as outside the API terms. | L | H | 18+ in product; EEA/UK/CH note in Settings | `store-provider-region-ruling`; US-only distribution; counsel. |
| R7 | **Privacy fields vs policy mismatch** ("If the information listed in your privacy fields contradicts the information provided in your privacy policy", listing-requirements). | L | H | This packet and the policy were refreshed together | Re-diff both before submission; the hosted page must match the repo draft. |
| R8 | **Privacy policy URL not live** at submission. | M | M | tedks/website#53 is a draft | Merge #53 (Ted) before submitting. |
| R9 | **Dead modules in the zip.** `src/content-loader.js` (with a dynamic `import()` of the extension's own `src/content.js`) and the ES-module `src/content.js` ship but are unreferenced in the Store build. MV3 wants "the full functionality of an extension must be easily discernible from its submitted code". Not remote code, but unexplained code invites questions. | L | L | Open (`store-bundle-dead-loader`) | Drop both from the Store zip in `package.mjs`, or explain in test instructions. |
| R10 | **Required key before core function / minimum functionality.** A reviewer without a key could see "Add a Gemini key to start". | L | M | Handled: keyless samples, paragraph practice and review (`welcome.html:31-46`) | Section 5 instructions. |
| R11 | **Trademarks.** "Gemini", "Google", "Duolingo" appear in UI and description. Name is clean. Branding guide: "Give proper attribution for the use of any Google trademarks". The Duolingo Score field has no non-affiliation line in the product. | L | M | Description has attribution lines | Keep the attribution lines; consider a non-affiliation note beside the Duolingo field (code). |
| R12 | **Self-update code in the Store build.** `update.js` still ships. It does nothing when the installed manifest has an `update_url` (`update.js:22`, `:43`, `:84`); the Store build has no `alarms`, and the listener is optional-chained (`background.js:199`). That the Store writes `update_url` into installed manifests is Chrome behavior not stated on any fetched page; the harness simulates it (`store-shots.mjs` sets `update_url`). If it were absent, the worker would fetch its own packaged manifest, find the same version, and do nothing. | L | L | Handled | Verify after the first Store install by reading the installed manifest. |
| R13 | **Single purpose breadth** (weave, review, capture, generated packs, placement, paragraph practice). "Excessive permissions unrelated to your extension's single purpose" (quality FAQ). | L | M | All features are language learning; no unrelated permission | Use section 2 wording. |
| R14 | **Text-heavy images.** Images guide: "Avoid text"; best listing: "Images should not use too much text". Screenshots are real UI, which is text; the promo tile has one line. | L | L | Acceptable | Keep the promo tile minimal. |
| R15 | **Screenshots do not match the build.** | L | M | Refreshed for 0.16.1 on this branch | Rerun the harness at every submitted version. |
| R16 | **Disclosure of later data-practice changes** ("the extension must prominently disclose data practice changes"). | L | M | Future risk | Any new data flow needs a new consent step, not just a policy edit. |
| R17 | **Static X/Twitter injection** (dev manifest). | — | — | Handled: removed in the Store build (`package.mjs:54-75`); welcome offers an explicit "Allow x.com" grant (`welcome.js:11-16`, `:56`) | — |
| R18 | **`web_accessible_resources` exposing 19 modules** (dev manifest). | — | — | Handled: removed in the Store build; content runs as one classic bundle (`package.mjs:85-95`, `:585-601`) | — |
| R19 | **eval / remote script.** | — | — | None in the Store zip (scan above) | — |
| R20 | **`minimum_chrome_version` 140.** | L | L | Not a policy issue; excludes older Chrome only | — |
| R21 | **Localization incomplete.** | L | L | Only `en`; every manifest `__MSG_` key present | — |
| R22 | **Duplicate listing / spam** if a separate "beta" item is created. | L | M | Not planned | One item only. |
| R23 | **Developer account gaps** (2SV, trader declaration, verified email). | M | M | Ted's actions | Section 7. |

## 10. Policy check (fetched November 28, 2026)

| Policy clause (short quote, URL) | How 0.16.1 complies | Evidence | Residual risk |
|---|---|---|---|
| "Extensions may only collect, use, or transmit user data that is necessary for the extension's disclosed single purpose" (<https://developer.chrome.com/docs/webstore/program-policies/limited-use>) | Only passages, candidate words and the key go to Gemini, only for weaving on allowed sites | PRIVACY-POLICY C1, C6, C8, C9 | Low |
| "Only transfer user data to third parties ... If necessary to providing or improving your single purpose" (limited-use) | One third party, Google's Gemini API, under the user's key | `gemini.js:9`, `:24-30` | Low |
| "Do not allow humans to read user data, unless:" (limited-use) | Publisher reads nothing; free-key Google review disclosed | `welcome.html:50` | R5 |
| "must show a Limited Use disclosure on your project's homepage or on a page one click away from the homepage" (<https://developer.chrome.com/docs/webstore/program-policies/user-data-faq>) | Statement in the policy draft and website#53 | PRIVACY-POLICY.md "Limited Use disclosure" | R8 until merged |
| "If your Product handles any user data, then you must post an accurate and up to date privacy policy." "All parties the user data will be shared with." (<https://developer.chrome.com/docs/webstore/program-policies/privacy>) | Policy names Google's Gemini API as the only recipient | PRIVACY-POLICY.md | R8 |
| "The prominent disclosure and consent must occur within the Product's user interface." / "a specific action clearly agreeing to the disclosure" (user-data-faq Q10) | Welcome-page disclosure; every model call blocked until a site-policy click | `welcome.html:47-56`; `background.js:81`; `reading.js:231-236`; `settings-handlers.js:46`, `:59`, `:227`, `:243` | R1 |
| "Extensions must transmit user data over a secure connection (e.g. HTTPS, WSS)" (user-data-faq Q9) | HTTPS only | `gemini.js:9` | Low |
| "stored at rest using a strong encryption method such as RSA or AES" (user-data-faq Q9); "Keep authentication information secure." (<https://developer.chrome.com/docs/webstore/program-policies/policies>) | Key isolated to trusted contexts, not encrypted | `background.js:60-64` | R4 |
| "Request access to the narrowest permissions necessary" (<https://developer.chrome.com/docs/webstore/program-policies/permissions>) | Host access optional and per site; no `tabs`; `alarms` dropped from Store | `manifest.json:9-22`; `package.mjs:76-84` | R3 |
| "the full functionality of an extension must be easily discernible from its submitted code" (<https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements>) | All code packaged and unminified; AGPL source public | Store zip | R9 |
| "Using JavaScript's eval() method or other mechanisms to execute a string fetched from a remote source" is remote code (mv3-requirements) | No eval; model JSON parsed as data | `gemini.js:50-57`; `engine.js:40` | Low |
| "Extensions with broken functionality---such as dead sites or non-functioning features---are not allowed." (<https://developer.chrome.com/docs/webstore/program-policies/minimum-functionality>) | Keyless features work; weaving needs a free key | `welcome.html:31-46` | R10 |
| "Unnatural repetition of the same keyword more than 5 times"; "misleading, inaccurate, incomplete" metadata (<https://developer.chrome.com/docs/webstore/program-policies/listing-requirements>) | Description reviewed against code (1a, 1b) | Section 1 | R7 |
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
- The `update_url` behavior of Store installs (R12) and the treatment of `key` (R2) are not confirmed by any fetched page.
- Gemini terms and regions were fetched once on November 28, 2026; they change.

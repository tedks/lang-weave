# Lang Weave privacy policy (DRAFT for Ted's review)

> **Status: draft. Not published.** Ted Smith is the publisher and must approve every sentence before it goes live.
> Written against Lang Weave 0.12.12, source commit `c4bbd46` (Chrome Web Store build, `node extension/scripts/package.mjs --store`).
> Bracketed `[C1]`-style markers point to the source citations in Appendix A. They are for the reviewer and are stripped from the website copy.
> Items in `[BRACKETS AND CAPITALS]` are placeholders Ted must fill. "Notes for Ted" (before the appendix) lists open decisions and anything not verified. Delete that section and this banner before publishing.

**Effective date:** [EFFECTIVE DATE]
**Publisher:** Ted Smith
**Contact:** [CONTACT METHOD: an email address or issue-tracker URL that Ted monitors]

## The short version

- Lang Weave has no server, no account and no telemetry. I never receive your reading, your key or your progress. [C1] [C2]
- To choose which words to swap, Lang Weave sends text from the pages you allow to **Google's Gemini API**, using **your own Gemini key**. That is the one place your reading leaves your browser. [C1] [C6]
- What Google does with that text depends on your key. With a free-tier key, Google may use it to improve its products and human reviewers may read it. With a paid key, Google says it does not use it that way. [C30]
- Everything else stays in your browser: your key, settings, saved words, review schedule and learning log. [C4] [C15] [C16]
- Lang Weave is for people **18 or older**. [C26]

## What Lang Weave is

Lang Weave is a browser extension for learning a language while you read. On sites you allow, it replaces a few English words with the language you are learning, shows a meaning and pronunciation hint on hover, and schedules those words for review. It is free software under the GNU AGPL v3 or later, so you can read exactly what it does. [C29]

## What data Lang Weave handles

| Data | Where it goes | When |
|---|---|---|
| Readable text from pages you allow (passages of 6 words up to 2,000 characters, up to 8 per request) | Sent to Google's Gemini API with your key | Only when every condition in "When text is sent" is met |
| A list of vocabulary words (target-language form and English meaning, and which are due, new or known) | Sent to Google's Gemini API in the same request | Same as above |
| Your Gemini key | Stored in your browser. Sent to Google in a request header, as the credential for the call | When a request is made. The key never goes to web pages or to me |
| A short test message ("Reply OK.") | Sent to Google when you press **Test key** | Only when you press the button |
| A language code or name, such as `fr` | Sent to Google when you press **Generate vocabulary** | Only when you press the button. No page text is included |
| Settings, site choices, cached word choices, saved personal words, review schedule, learning log | Stored in your browser (`chrome.storage.local`). Not synced, not uploaded | Always, while the extension is installed |

[C1] [C3] [C6] [C8] [C12] [C13] [C15] [C16]

## What is sent to Google's Gemini API, and when

### When text is sent

Lang Weave sends page text to Gemini only when **all** of these are true:

1. Lang Weave is switched on (the popup's **On** switch).
2. You have saved a Gemini key.
3. You have made your site choice on the welcome page. On a new install, Lang Weave refuses to contact Gemini until you do. [C11]
4. The site is switched on for Lang Weave. Webmail, messaging, AI chat, password managers, banking, health portals, government, and local or private-network addresses start **off**, even if you choose "all sites". [C10]
5. Chrome has granted Lang Weave access to that site. You grant access one site at a time from the popup, or all sites if you choose that. Lang Weave does not request site access on its own. [C23]

Lang Weave also skips pages whose title or text looks like a health, legal, financial, emergency or driving topic, and pages whose address looks like a login, checkout, payment, billing, settings or account page. This filter is a short fixed list of words and patterns. It is a safety net, not a guarantee. It cannot recognise every private page, so use "Only sites I turn on" if you want tighter control. [C10]

### What is sent

- **Passages of page text.** Lang Weave looks at paragraph-like blocks of text that are on screen or within about 600 pixels of it. It skips links, buttons, form fields, editable text, code, navigation, headers, footers and pages marked as non-English. Each passage must have at least 6 words and at most 2,000 characters. Up to 8 passages go in one request. [C6] [C7]
- **Vocabulary candidates.** The request lists the words Lang Weave may use: their target-language form and English meaning. When gradual learning is on, the list reflects your progress: which words are due, new, or marked known. It can include words you saved yourself. [C8]
- **Your key**, as the credential Google requires. [C3]
- **Fixed instructions** telling the model how to choose swaps.

### What is not sent

Lang Weave does not send the page address, the site name or the page title to Gemini. The title is read inside your browser only, to decide whether the page is safe to process. The request contains the passages and an opaque identifier, not where they came from. [C9]

Google receives the connection itself, so it sees your IP address and ordinary request details. Those are outside Lang Weave's control and are covered by Google's terms.

### What Google does with it

Lang Weave sends data to Google because your key and Google's service are required for the extension to work. Google's terms for the Gemini API treat free and paid use differently. These are quotes from the [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) (effective March 23, 2026, last updated April 28, 2026; checked October 30, 2026). Read the current terms before relying on them.

**Free ("Unpaid Services") keys:**

> "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services and machine learning technologies"

> "human reviewers may read, annotate, and process your API input and output ... Do not submit sensitive, confidential, or personal information to the Unpaid Services."

**Paid ("Paid Services") keys:**

> "Google doesn't use your prompts ... or responses to improve our products"

Google says paid-service prompts are logged "for a limited period of time, solely for detecting and preventing violations of the Prohibited Use Policy" and for legal disclosures. Google counts access as paid "only when accessing the API through a Cloud Project associated with an active billing account."

[C30]

**What this means for you.** A free key is fine for text you would be comfortable having a company and its reviewers read. For private reading, use a billed key and keep sensitive sites off. Provider quotas and charges apply to your key. Lang Weave caps itself at 1,000 model calls per local day. That is a request cap, not a spending limit. [C18]

I do not control Google, and I cannot see or delete anything Google keeps. Requests are made under your key and your agreement with Google.

### Europe, Switzerland and the United Kingdom

Google's terms say: "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom." If you are in one of those places, use a key from a Google Cloud project with an active billing account. Lang Weave cannot check whether your key is billed. [C27] [C30]

## What stays in your browser

Lang Weave stores the following in your browser profile and nowhere else:

- Your Gemini key, kept separate from settings and hidden from web pages. [C4]
- Settings and the sites you turned on or off. [C4]
- A cache of recent word choices, up to 5,000 entries. A cached entry holds the swap Gemini chose and a few words of the English sentence around it. **Clear cache** in Settings removes it. [C15]
- Your learning data: review schedule, up to 500 recent reading events per language (a word, an event type and a date), and a bounded learning log of word identifiers, times and outcomes. None of these hold page addresses or passages. [C16]
- Words you saved with **Add to Lang Weave**. The selection menu and the save step do not call Gemini. [C14]
- Generated vocabulary packs (up to five). [C13]

None of this is synced to a server or to your Google account. [C4]

A web page you visit can see the changes the extension makes to that page's own text, the way any extension that edits a page can be seen. Web pages cannot read Lang Weave's stored data. [C28] [C4]

## What Lang Weave does not do

- It has no Lang Weave server. The only address it contacts for its function is Google's Gemini API. [C1]
- It has no analytics, tracking, advertising or telemetry. [C2]
- It does not create accounts or ask for a password. [C2]
- It does not sell data or use it for advertising, credit decisions or anything unrelated to learning a language. I have no access to your data to sell. [C2]
- It does not download or run code from anywhere. Model output is treated as data and never inserted as page markup. [C24]

## Your choices and controls

- **Switch it off.** The popup's **On** switch pauses weaving and restores the original text. Turning a site off stops text from that site being sent. [C23]
- **Choose sites.** Choose "Only sites I turn on" for an explicit allowlist. You can revoke any site's access in Chrome's extension settings. [C23]
- **Remove your key.** **Remove key** in Settings deletes it. Revoke or delete the key in Google AI Studio to end its use at Google. [C21]
- **Clear cache.** Removes cached word choices. Learning progress stays. [C15]
- **Remove a generated language.** Removes that pack and its local progress. [C21]
- **Back up or move your progress.** **Learning backup** downloads a JSON file you choose to save. It holds your learning state, saved words and learning preferences. It excludes your key, site grants, site choices, caches and page text. Keep the file private. **Personal entries** exports your saved words separately. Neither file is sent anywhere by Lang Weave. [C19] [C20]
- **Delete everything.** Removing the extension from Chrome deletes its stored data. [C21]

## Age

Lang Weave is for people 18 or older, because Google's terms for the Gemini API require it: "You must be 18 years of age or older to use the APIs." Lang Weave is not directed at children. Do not use it if you are under 18. [C26] [C30]

## Open source and checking my claims

The code is public at <https://github.com/tedks/lang-weave>. Every claim above can be checked in the source. If this policy and the code ever disagree, that is a bug I will fix, and the code is the truth. [C29]

## Changes to this policy

If a change to Lang Weave alters what data it handles or who receives it, I will update this policy and its effective date before that version ships. [CHANGE NOTIFICATION METHOD, e.g. a note in the release notes and the extension's welcome page]

## Contact

[CONTACT METHOD]

## Limited Use disclosure

Lang Weave's use of information received from web pages complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including its Limited Use requirements. In particular:

- Lang Weave uses page text only to provide its single purpose: choosing language-learning word swaps in the pages you read, and scheduling those words for review.
- Page text is transferred only to Google's Gemini API, and only as necessary to provide that single purpose, using your own key. It is not transferred or sold to any other party.
- Page text is not used or transferred to serve advertisements, including personalised or retargeted ads.
- Page text is not used or transferred to determine creditworthiness or for lending.
- No person at Lang Weave can read your data. Lang Weave has no server and the publisher receives none of it. The exception is Google's own handling under your key, described above, which the key's terms govern.

[LIMITED USE WORDING: check against the current Chrome Web Store Limited Use page before submission. See Notes for Ted.]

---

## Notes for Ted (delete before publishing)

1. **Decisions this policy depends on.** `store-provider-region-ruling` (BYOK beta territory, and whether a consumer-facing client fits Gemini's terms) and `store-site-consent-ruling` (whether the Store build offers an explicit per-site allowlist by default). The draft describes the code as it is today: new installs choose between the two policies on the welcome page, with "Only sites I turn on" recommended, and the Store build declares no content script, so every site needs a grant. If either ruling changes the product, change the policy with it.
2. **The "not for consumer use" clause is deliberately not quoted in the policy.** market.md's top risk is Google's line that the API is "for developers building ... for professional or business purposes, not for consumer use." Whether to say so to users is a legal and positioning call. Hiding a known limitation is a different risk from stating it in a public policy. You decide; I would at least have counsel read it.
3. **Limited Use item "humans may not read the data."** The Store policy restricts human reading of user data. Lang Weave's publisher cannot read it. Google's reviewers can read free-tier requests. The draft says so in the open. Whether a reviewer will treat Google as a recipient that must also meet Limited Use is not settled by anything I could check. A billed-key default would remove the question.
4. **18+.** No text in the extension says 18 or older. The policy and listing say it. The product should too (welcome page, one line). That is a code change outside this mission. Recorded as a comment on the ditz issue.
5. **Google quotes** are copied from `docs/research/market.md` (researched October 30, 2026). I did not re-fetch Google's pages. Re-check them before publishing.
6. **Limited Use wording** is written from my knowledge of the Store's four Limited Use rules, not copied from the live page. Check it against <https://developer.chrome.com/docs/webstore/program-policies/limited-use> before the Dashboard submission.
7. **Contact, effective date and change-notification method** are placeholders.
8. The Store build still carries the development `key` (ditz `store-manifest-key-delta` waits on a ruling). That is not a privacy matter but must be settled before the first upload.

## Appendix A: where each claim comes from

Paths are relative to the repository root. Line numbers are for commit `c4bbd46`. "Negative search" means a search of every file in `extension/src/` for the pattern returned no hit other than those cited.

| Ref | Claim | Source |
|---|---|---|
| C1 | Page text and the key go only to Google's Gemini API. The manifest names one fixed host. Reading requests, key tests and language generation all use the Gemini address. | `extension/manifest.json:14-16`; `extension/src/gemini.js:9`, `:25-30`; `extension/src/settings-handlers.js:166-169`; `extension/src/languages.js:62-65`. Negative search for `fetch(`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`: the only other `fetch` is `extension/src/update.js:32`, which reads the extension's own `manifest.json` and is skipped in the Store build (`update.js:23`, `:30`). |
| C2 | No Lang Weave server, account, analytics or telemetry. | Same negative search as C1. No use of `chrome.identity`, `chrome.cookies`, `chrome.history`, `chrome.storage.sync` or `localStorage` (negative search). Project invariant: `docs/ROADMAP.md:22` ("no telemetry"); `docs/research/market.md:53`. |
| C3 | The key is sent to Google in the `x-goog-api-key` request header, not in a URL. | `extension/src/gemini.js:27`; `extension/src/settings-handlers.js:167`; `extension/src/languages.js:63`. |
| C4 | The key is stored in `chrome.storage.local`, apart from settings, and set to be unreadable from content scripts. | `extension/src/settings.js:1-2`; `extension/src/background.js:56-57`; `extension/src/cache.js:62-67`. |
| C5 | The key is excluded from the learning backup. | `extension/src/portability.js:39`, `:455-462` (preferences are an allowlist), `:515`. |
| C6 | What a reading request contains: passages of at least 6 words and at most 2,000 characters, at most 8 per request, as `id` and `text`. | `extension/src/reading.js:90-92`; `extension/src/content.js:403`, `:407`; `extension/src/prompt.js:102-104`. |
| C7 | Which text is eligible: on screen or within 600 px; excludes links, buttons, inputs, forms, editable text, code, nav, header, footer, hidden content and non-English `lang`; excludes login, checkout, payment, billing, settings and account paths. | `extension/src/content.js:482-491`; `extension/src/page.js:8`, `:11-19`. |
| C8 | A vocabulary list (target form, English gloss, and due/new/known status) is part of the request. Personal entries join it when gradual learning is on. | `extension/src/prompt.js:47`, `:66-69`; `extension/src/learning.js:59-73`; `extension/src/adaptive.js:36-75`; `extension/src/worker-context.js:33-48`; `README.md:46`. |
| C9 | The page address, host and title are not in the request. The title goes only to the extension's own worker for a local safety check. | The request body is built only from `system` and `user` in `extension/src/gemini.js:11-21`; the user content is passages plus ids (`prompt.js:102-104`); the title is used at `extension/src/reading.js:21-31`, `:94` and never passed to `requestSwaps` (`reading.js:229-231`). |
| C10 | Sensitive sites start off. High-stakes passages and titles are skipped. | `extension/src/settings.js:47-79` (domain list and `offByDefault`); `extension/src/levels.js:186-202`; `extension/src/page.js:19`; `extension/src/content.js:20`, `:73`; `extension/src/reading.js:25`. `README.md:46`. |
| C11 | Consent gating. A new profile starts with `consentShown: false`. The worker refuses model use, key tests and language generation while it is false. The welcome page sets it only from the user's choice. | `extension/src/background.js:64-65`; `extension/src/reading.js:192-198`; `extension/src/settings-handlers.js:30`, `:78-79`, `:143`, `:156-157`; `extension/src/worker-context.js:12`; `extension/src/welcome.js:70-80`; `extension/src/welcome.html:33-43`. |
| C12 | "Test key" sends the text `Reply OK.` with your key. | `extension/src/settings-handlers.js:166-169`. |
| C13 | Language generation sends a language code or name and a fixed instruction, no page text. Up to five packs are stored locally. | `extension/src/languages.js:56-65`; `README.md:50`. |
| C14 | "Add to Lang Weave" is a selection menu item. Saving does not call Gemini or an online dictionary. | `extension/src/capture-handlers.js:235-241`; `README.md:52`. Negative search: no `fetch` in `capture-handlers.js`, `personal.js`, `personal-capture.js`. |
| C15 | The decision cache holds swaps (`o`, `f`, `g`, `h`, `ctx` fields), up to 5,000 entries, and can be cleared. | `extension/src/cache.js:4`, `:16-23`; `extension/src/prompt.js:6-35`; `extension/src/settings-handlers.js:17-24`; `extension/src/options.js:151`; `README.md:50`. |
| C16 | Reading events (word, kind, day), the last 500 per language; learning log holds word ids, times and outcomes only; nothing leaves the browser. | `extension/src/events.js:1-25`; `extension/src/learning-log.js:3-8`, `:21-22`; `README.md:38`. |
| C17 | Reviews need no key or network. | `README.md:74`. Negative search: no network call in `review*.js`, `words.js`, `progress*.js`. |
| C18 | Local cap of 1,000 model calls per day. | `extension/src/quota.js:4`; `extension/src/options.html:69`. |
| C19 | The learning backup is a user-initiated download. Contents: learning preferences, packs, saved words, per-language learning state. Excluded: key, site settings, caches, quota, consent, page text. | `extension/src/backup-handlers.js:103-106`; `extension/src/backup-page.js:95-101`; `extension/src/portability.js:39`, `:444-470`; `README.md:54`. |
| C20 | Personal-entry export is a separate local file. | `extension/src/capture-handlers.js:222-231`; `README.md:52`. |
| C21 | Remove key; remove a generated language and its progress; removing the extension deletes its storage. | `extension/src/settings-handlers.js:134-137`, `:54-74`; `README.md:50`. The uninstall behavior is Chrome's. |
| C22 | Permissions. Store build: `storage`, `scripting`, `activeTab`, `contextMenus`; host `generativelanguage.googleapis.com`; optional `http://*/*` and `https://*/*`. `alarms`, the X content script and web-accessible resources are removed. | `extension/manifest.json:7-20`; `extension/scripts/package.mjs:52-95`. Generated and checked with `storeManifest()`. |
| C23 | Site access is requested only from a user click, one site at a time or all sites. Content scripts are registered only for granted sites. The Store manifest declares no content script. | `extension/src/popup.js:73`; `extension/src/options.js:149`; `extension/src/welcome.js:72`; `extension/src/sites.js:15-31`; `extension/scripts/package.mjs:54-74`. |
| C24 | Model output is data. It is validated against listed words and inserted as text. | `docs/ROADMAP.md:22` (invariant "no model output ever inserted as HTML"); `docs/research/market.md:186-190`; `extension/src/engine.js:35` (`validateSwaps`). |
| C25 | The welcome page opens on first install only. | `extension/src/update.js:12-17`; `extension/src/background.js:157`. |
| C26 | **Not in the code.** No file under `extension/src/` or `README.md` says 18 or older. The requirement comes from Google's terms (quoted in C30). | Negative search for `18+`, `18 or`, `18 years`, `under 18`: no match. |
| C27 | The extension already tells users that EEA, UK and Swiss users need paid services. | `extension/src/options.html:68`. The welcome page (`extension/src/welcome.html:36`) covers the free-key point but not the EEA, UK and Swiss rule. |
| C28 | Woven words are real elements in the page's DOM. | `extension/src/text.js:256` (`span.${SWAP_CLASS}`). |
| C29 | AGPL-3.0-or-later; MIT portions from French Weave preserved. | `NOTICE:1-12`; `LICENSE`; `LICENSE-MIT`. |
| C30 | Google's terms (verbatim quotes). | `docs/research/market.md:147-151`, quoting <https://ai.google.dev/gemini-api/terms>. Not re-fetched for this draft. |

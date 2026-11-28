# Lang Weave privacy policy (DRAFT for Ted's review)

> **Status: draft. Not published.** Ted Smith is the publisher and must approve every sentence before it goes live.
> Written against Lang Weave **0.16.1**, source commit `39b264a` (tag `v0.16.1-beta.1`), as shipped in the Chrome Web Store build (`node extension/scripts/package.mjs --store`). The extension source on this branch is identical to that commit.
> Bracketed `[C1]`-style markers point to the source citations in Appendix A. They are for the reviewer and are stripped from the website copy.
> Items in `[BRACKETS AND CAPITALS]` are placeholders Ted must fill. "Notes for Ted" (before the appendix) lists open decisions and anything not verified. Delete that section and this banner before publishing.
> The full Store submission packet, including the Dashboard answers that must agree with this policy, is [STORE-SUBMISSION-PACKET.md](STORE-SUBMISSION-PACKET.md).

**Effective date:** [EFFECTIVE DATE]
**Publisher:** [PUBLISHER NAME, as entered in the Chrome Web Store developer account]
**Contact:** [CONTACT METHOD: an email address or issue-tracker URL that Ted monitors]

## The short version

- Lang Weave has no server, no account, no analytics and no telemetry. I never receive your reading, your key or your progress. [C1] [C2]
- You can try Lang Weave without a key. The bundled reading samples, paragraph practice and word review run entirely in your browser. [C31] [C17]
- To choose words in the pages you read, Lang Weave sends text from the sites you allow to **Google's Gemini API**, using **your own Gemini key**. That is the one place your reading leaves your browser. [C1] [C6]
- What Google does with that text depends on your key. With a free key, Google may use it to improve its products and human reviewers may read it. With a billed key, Google says it does not use it that way. [C30]
- Each reading request also carries your key and a list of candidate words with labels derived from your progress (see "What is sent"). Your review history itself (ratings, schedule, reading events, dates and learning log) stays in your browser, and so do your settings and the cache. [C4] [C8] [C15] [C16]
- Lang Weave is for people **18 or older**. [C26]

## What Lang Weave is

Lang Weave is a browser extension for learning a language while you read. On sites you allow, it replaces a few English words with the language you are learning, shows a meaning and pronunciation hint on hover, and schedules those words for review. Spanish and Paraguayan Guaraní are bundled. It is free software under the GNU AGPL v3 or later, so you can read exactly what it does. [C29]

## What data Lang Weave handles

| Data | Where it goes | When |
|---|---|---|
| Readable text from pages you allow (passages of 6 words up to 2,000 characters, up to 8 per request) | Sent to Google's Gemini API with your key | Only when every condition in "When text is sent" is met |
| Instructions for the model: your reading level, density setting and target language; with gradual learning, a per-request swap budget; the candidate words (target-language form and English meaning) with each word's status (due, new, active or known); without gradual learning, the target forms already shown today; and eligible saved personal words | Sent to Google's Gemini API in the same request | Same as above |
| Your Gemini key | Stored in your browser. Sent to Google in a request header, as the credential for the call | When a request is made. The key never goes to web pages or to me |
| A short test message ("Reply OK.") | Sent to Google when you press **Test key** | Only when you press the button, after your site choice |
| A language code and its English name, such as `fr` and "French" | Sent to Google when you add a generated language in Settings | Only when you ask for it, after your site choice. No page text is included |
| Settings, site choices, cached word choices, saved personal words, review schedule, learning log, reading dates | Stored in your browser (`chrome.storage.local`). Not synced, not uploaded. Eligible saved words and the status labels above can appear in a reading request; the review history itself is never sent | While the extension is installed |
| Your own paragraph in **Practice a paragraph**, the bundled samples | Stay in that browser tab | Only while the tab is open |
| A Duolingo Score you type into the optional placement preview | Used in the page to order examples. A valid number is cleared after use; an invalid one stays in the field so you can correct it. Never stored, never sent | Only when you press the button |

[C1] [C3] [C6] [C8] [C12] [C13] [C15] [C16] [C31] [C32]

## What is sent to Google's Gemini API, and when

### When text is sent

Lang Weave sends page text to Gemini only when **all** of these are true:

1. Lang Weave is switched on (the popup's **On** switch).
2. You have saved a Gemini key.
3. You have made your site choice on the welcome page. On a new install, Lang Weave refuses to contact Gemini at all until you do: no page text, no key test, no language generation. [C11]
4. The site is switched on for Lang Weave. Webmail, messaging, AI chat, password managers, banking, health portals, government, and local or private-network addresses start **off**, even if you choose "all sites". [C10]
5. Chrome has granted Lang Weave access to that site. You grant access one site at a time from the popup, or all sites if you choose that. Lang Weave does not request site access on its own. [C23]

Lang Weave also skips any passage, and any page whose title, looks like a health, legal, financial, emergency, crime or violence, or driving topic, and pages whose address looks like a login, checkout, payment, billing, settings or account page. This filter is a short fixed list of words and patterns. It is a safety net, not a guarantee. It cannot recognise every private page, so use "Only sites I turn on" if you want tighter control. [C10]

### What is sent

- **Passages of page text.** Lang Weave looks at paragraph-like blocks of text that are on screen or within about 600 pixels of it. It skips buttons, form fields, editable text, code blocks, navigation, headers, footers, hidden content and pages marked as non-English. A link or inline code inside a sentence is sent as part of that sentence but never changed. Each passage must have at least 6 words and at most 2,000 characters. Up to 8 passages go in one request. [C6] [C7]
- **Vocabulary candidates.** The request lists the words Lang Weave may use: their target-language form and English meaning. When gradual learning is on (the default for new installs), each word carries a status derived from your progress: due, new, active or known. With gradual learning on, eligible single words you saved yourself can join the list. Saving a word sends nothing at the time; it can only reach Google later, as a candidate in a reading request. Without gradual learning, the request lists the target forms already shown today so the model can prefer new ones. [C8]
- **Your settings that shape the request**: reading level, density, target language and, with gradual learning, a per-request swap budget. [C8]
- **Your key**, as the credential Google requires. [C3]
- **Instructions** telling the model how to choose swaps, which include the items above.

If you choose the Gemini 3.8 Flash model and that call fails, Lang Weave retries the same request once with Gemini 3.5 Flash-Lite. Both go to the same Google API. [C33]

### What is not sent

Lang Weave does not send the page address, the site name or the tab title to Gemini as request fields. The tab title is read inside your browser only, to decide whether the page is safe to process. Each passage is identified by a page counter and a hash of its own text, not by where it came from. Passage text can still contain anything the page shows, including on-page headings, names and, if the page prints them, its own address or title. [C9]

Google receives the connection itself, so it sees your IP address and ordinary request details. Those are outside Lang Weave's control and are covered by Google's terms.

### What Google does with it

Lang Weave sends data to Google because your key and Google's service are required for weaving. Google's terms for the Gemini API treat free and paid use differently. These are quotes from the [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) (the page says "Effective March 23, 2026"; checked November 28, 2026, when the address redirected to aistudio.google.com/docs/terms). Read the current terms before relying on them.

**Free ("Unpaid Services") keys:** Google uses the content you submit and the responses "to provide, improve, and develop Google products and services and machine learning technologies", and "human reviewers may read, annotate, and process your API input and output". Google's own advice: "Do not submit sensitive, confidential, or personal information to the Unpaid Services."

**Billed ("Paid Services") keys:** "Google doesn't use your prompts ... or responses to improve our products." Google "logs prompts and responses for a limited period of time, solely for detecting and preventing violations" of its Prohibited Use Policy, and for legal or regulatory disclosures. Google counts Gemini API access as paid "only when accessing the API through a Cloud Project associated with an active billing account."

[C30]

**What this means for you.** Google's own advice for free keys is not to submit sensitive, confidential or personal information, and page text can include information about other people. Use a billed key and keep sensitive sites off for anything private. Provider quotas and charges apply to your key. Lang Weave caps itself at 1,000 model calls per local day, counting every request it sends (reading requests including a fallback retry, key tests and language generation). That is a request cap, not a spending limit. [C18]

I do not control Google, and I cannot see or delete anything Google keeps. Requests are made under your key and your agreement with Google.

### Europe, Switzerland and the United Kingdom

Google's terms say: "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom." If you are in one of those places, use a key from a Google Cloud project with an active billing account. Lang Weave cannot check whether your key is billed. [C27] [C30]

## What stays in your browser

Lang Weave stores the following in your browser profile and nowhere else:

- Your Gemini key, kept separate from settings and hidden from web pages and from Lang Weave's own content scripts. It is stored as Chrome stores any extension data, not separately encrypted. The cache and learning data below are stored the same way. [C4]
- Settings and the sites you turned on or off (host names only). [C4]
- A cache of recent word choices, about 5,000 entries. A cached entry holds the swap Gemini chose and a few words of the English sentence around it. **Clear cache** in Settings removes it. [C15]
- Your learning data: review schedule; up to 500 recent reading events per language (a word, an event type and a date); up to 30 local dates per language on which you saw a woven word; coarse per-word encounter counts; and a bounded learning log of word identifiers, times, outcomes and numbers. None of these hold page addresses or passages. [C16]
- Your Spanish placement choice (Beginner or Expanded), if you save one. [C32]
- Words you saved with **Add to Lang Weave**. The selection menu and the save step do not call Gemini. [C14]
- Generated vocabulary packs (up to five). [C13]
- Short-lived records the extension needs to run: the day's model-call count, the last model status and any cooldown, the welcome-choice flag, and while a guess panel is open, a one-use ticket kept in Chrome's session storage that ends with the browser. [C34]

None of this is synced to a server or to your Google account. [C4]

A web page you visit can see the changes the extension makes to that page's own text, the way any extension that edits a page can be seen. Web pages cannot read Lang Weave's stored data. [C28] [C4]

## What Lang Weave does not do

- It has no Lang Weave server. The only address it contacts is Google's Gemini API. [C1]
- It has no analytics, tracking, advertising or telemetry. [C2]
- It does not create accounts or ask for a password. It does not sign in to Duolingo or any other service. [C2] [C32]
- It does not sell data or use it for advertising, credit decisions or anything unrelated to learning a language. I have no access to your data to sell. [C2]
- It does not download or run code from anywhere. Model output is treated as data and never inserted as page markup. [C24]

## Your choices and controls

- **Switch it off.** The popup's **On** switch pauses weaving and restores the original text. Turning a site off stops new text from that site being sent: every request, including a fallback retry, is checked again just before it leaves, but a request already sent cannot be recalled. Alt+Shift+W pauses or resumes the current site. [C23] [C35] [C36]
- **Choose sites.** Choose "Only sites I turn on" for an explicit allowlist. You can revoke any site's access in Chrome's extension settings. [C23]
- **Remove your key.** **Remove key** in Settings deletes it. Revoke or delete the key in Google AI Studio to end its use at Google. [C21]
- **Clear cache.** Removes cached word choices. Learning progress stays. [C15]
- **Remove a generated language.** Removes that pack and its local progress. [C21]
- **Back up or move your progress.** **Learning backup** downloads a JSON file you choose to save. It holds your learning state, saved words, generated packs and learning preferences. It excludes your key, site grants, site choices, caches, quotas and page text. Keep the file private. **Personal entries** exports your saved words separately. Neither file is sent anywhere by Lang Weave. Importing a backup never grants a site or calls Gemini. [C19] [C20]
- **Delete everything.** Removing the extension from Chrome deletes the data it stored in your browser. It does not delete backup or export files you saved, and it does not delete anything Google keeps from requests made with your key. [C21]

## Age

Lang Weave is for people 18 or older, because Google's terms for the Gemini API require it: "You must be 18 years of age or older to use the APIs." The welcome page and Settings say so. Lang Weave is not directed at children. Do not use it if you are under 18. [C26] [C30]

## Open source and checking my claims

The code is public at <https://github.com/tedks/lang-weave>. Every claim above can be checked in the source. If this policy and the code ever disagree, that is a bug I will fix, and the code is the truth. [C29]

## Changes to this policy

If a change to Lang Weave alters what data it handles or who receives it, I will update this policy and its effective date before that version ships. [CHANGE NOTIFICATION METHOD, e.g. a note in the release notes and the extension's welcome page]

## Contact

[CONTACT METHOD]

## Limited Use disclosure

> **HOLD — pending Ted ruling (DECISIONS D3a).** Do not publish this section, and do not tick the Limited Use certification, until Ted rules. With a free (Unpaid Services) key, Google's terms let Google use the submitted page text to improve its own products and let human reviewers read it. Whether that transfer meets the Limited Use "allowed transfer" rule (necessary for the single purpose) and the "no human reading" rule is unresolved. The options are: (a) the Store build requires a billed key; (b) accept the risk with disclosure; (c) delay submission. The draft text below states only what Lang Weave itself does and must be revised to match the ruling.

The use of information that Lang Weave receives from the web pages you allow, and of the key and learning state it keeps, is intended to comply with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use), including the Limited Use requirements:

- **Allowed use.** Lang Weave uses page text, your key and your learning state only to provide its single purpose: choosing language-learning word swaps in the pages you read, and scheduling those words for review.
- **Allowed transfer.** Page text, candidate words with their status labels, and your key are transferred only to Google's Gemini API, under your own key. Nothing is transferred or sold to anyone else. [D3a: what Google may do with that data under a free key is the open question.]
- **No advertising.** None of this data is used or transferred for advertising, including personalised or retargeted ads, or to determine creditworthiness or for lending.
- **No human reading by Lang Weave.** No person at Lang Weave reads your data; Lang Weave has no server and the publisher receives none of it. [D3a: Google's terms allow its reviewers to read free-key requests.]

---

## Notes for Ted (delete before publishing)

1. **Decisions this policy depends on.** `store-provider-region-ruling` (Store territory and plan; whether a consumer-facing client fits Gemini's terms) and `store-site-consent-ruling` (site opt-in posture). The draft describes 0.16.1 as it is: new installs choose between two site policies on the welcome page, with "Only sites I turn on" recommended, and the Store build declares no content script, so every site, including x.com, needs a Chrome grant. If either ruling changes the product, change the policy with it.
2. **"Not for consumer use."** Google's terms say the APIs are "for professional or business purposes, not for consumer use" (re-fetched November 28, 2026). The README already says so. This public policy still does not quote it. Whether to say so to users here is a legal and positioning call. I would at least have counsel read it.
3. **Limited Use: a submission blocker (packet R5, DECISIONS D3a).** Under the Unpaid terms Google may use free-key requests for its own products and its reviewers may read them. No Limited Use exception covering either was identified. Disclosure does not resolve it, and neither does a user-supplied key. Options: (a) Store build requires a billed key (note that billed requests are still logged for a limited period for abuse and legal purposes, and Lang Weave cannot itself verify billing); (b) accept the risk with disclosure; (c) delay. The Limited Use section and the Dashboard certifications are on HOLD until the ruling.
4. **Data at rest.** The Store's user-data FAQ (Q9) describes data "stored at rest using a strong encryption method such as RSA or AES". The key, cached page fragments, saved words and learning data are all in `chrome.storage.local` with trusted-context isolation, not separately encrypted. Whether Q9 applies to an extension's local storage is not established; disclosure alone would not satisfy it if it does. See packet R4.
5. **Google quotes** were re-fetched on November 28, 2026 from the Gemini API terms page (which now redirects to aistudio.google.com/docs/terms). The page shows "Effective March 23, 2026" and no separate last-updated date. Re-check before publishing.
6. **Limited Use wording** now follows the four requirement names on the live Limited Use page (fetched November 28, 2026): allowed use, allowed transfer, prohibited advertising, prohibited human interaction. The Store wants the statement "on your project's homepage or on a page one click away from the homepage". The website draft puts it on the privacy page, linked from the project page.
7. **Publisher, contact, effective date and change-notification method** are placeholders. The publisher line is a placeholder because the Store shows the developer account's publisher name, which Ted chooses.
8. The Store build still carries the development `key` (ditz `store-manifest-key-delta`, `store-first-upload-key`). Not a privacy matter, but it must be settled before the first upload.

## Appendix A: where each claim comes from

Paths are relative to the repository root. Line numbers are for commit `39b264a` (Lang Weave 0.16.1). "Negative search" means a search of every file in `extension/src/` for the pattern returned no hit other than those cited. "Store zip" means the output of `node extension/scripts/package.mjs --store` at that commit, inspected on November 28, 2026 (91 entries).

| Ref | Claim | Source |
|---|---|---|
| C1 | Page text and the key go only to Google's Gemini API. The manifest names one fixed host. Reading requests, key tests and language generation all use the Gemini address. | `extension/manifest.json:16-18`; `extension/src/gemini.js:9`, `:24-30`; `extension/src/reading.js:255-266` (dispatch); `extension/src/settings-handlers.js:249-255` (key test); `extension/src/languages.js:55-64` (generation). Negative search for `fetch(`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`: the only other `fetch` is `extension/src/update.js:45`, which reads the extension's own `manifest.json` and does nothing in an install that has an `update_url` (`update.js:22`, `:43`). Hard-coded `https://` addresses in `src/` are the Gemini API base, links shown to the user (AI Studio key page, GitHub) and source comments. |
| C2 | No Lang Weave server, account, analytics or telemetry. | Same negative search as C1. No `chrome.identity`, `chrome.cookies`, `chrome.history`, `chrome.storage.sync`, `localStorage` or `indexedDB` in `extension/src/` (negative search). |
| C3 | The key is sent to Google in the `x-goog-api-key` request header, not in a URL. | `extension/src/gemini.js:27`; `extension/src/settings-handlers.js:253`; `extension/src/languages.js:62`. |
| C4 | The key is stored in `chrome.storage.local` under its own `apiKey` entry, apart from settings, and storage is restricted to trusted extension contexts so content scripts cannot read it. | `extension/src/background.js:29`, `:60-64`; `extension/src/cache.js:62-66`; `extension/src/settings-handlers.js:188-191`. |
| C5 | The key is excluded from the learning backup. | `extension/src/portability.js:41-43` (`DIRECT_KEYS`, `NON_LEARNING_KEYS` includes `apiKey`); `extension/_locales/en/messages.json` `backup_excluded`. |
| C6 | What a reading request contains: passages of at least 6 words and at most 2,000 characters, at most 8 per request, as `id` and `text`. | `extension/src/page.js:20`; `extension/src/content.js:705`; `extension/src/reading.js:97-99`; `extension/src/prompt.js:106-108`. |
| C7 | Which text is eligible: on screen or within 600 px; excludes buttons, inputs, forms, editable text, code, nav, header, footer, hidden content and non-English `lang`; a block inside a link is skipped; excludes login, checkout, payment, billing, settings and account paths. | `extension/src/content.js:800`; `extension/src/page.js:7-20`; `extension/src/options.html:65` ("Links and inline code go with their sentence but are never changed"). |
| C8 | The instructions carry reading level, density, target language, a per-request swap budget (gradual), the candidate list (target form, English gloss, status), today's shown forms (non-gradual path) and eligible personal entries (gradual). Gradual learning is on for new installs. | `extension/src/prompt.js:42-103` (`:43` level, `:48` budget, `:55` shown today, `:65-75` statuses); `extension/src/engine.js:14-20`; `extension/src/settings.js:18-22` (`FRESH_INSTALL_SETTINGS`); `extension/src/background.js:81`; `README.md` "Controls and privacy". |
| C9 | The page address, host and tab title are not request fields. The tab title is used only for a local safety check. Passage ids are `revision:hash(text)`. Passage text itself is not filtered for those strings. | Request body built only from `system` and `user` in `extension/src/gemini.js:11-21`; user content is passages plus ids (`prompt.js:106-108`); id built at `extension/src/content.js:688` and checked at `extension/src/reading.js:99`; title checks at `extension/src/reading.js:25-36`, `:101`. |
| C10 | Sensitive sites start off. High-stakes passages (per passage) and titles, including crime and violence words, and sensitive paths are skipped. | `extension/src/settings.js:55-96` (`OFF_DOMAINS`, `offByDefault`, `siteOn`); `extension/src/levels.js:255-266` (`isZeroFrench`, crime/violence at `:261`); `extension/src/page.js:14`, `:20`; `extension/src/reading.js:31-35`, `:99`. |
| C11 | Consent gating. A new profile starts with `consentShown: false`. The worker refuses page-text requests, key tests and language generation while it is false. The welcome page sets it only from the user's site-policy click. | `extension/src/background.js:81`; `extension/src/reading.js:231-236`; `extension/src/settings-handlers.js:46`, `:59`, `:227`, `:243`; `extension/src/welcome.js:28-38`; `extension/src/welcome.html:47-56`. |
| C12 | **Test key** sends the text `Reply OK.` with your key, asking for one output token. | `extension/src/settings-handlers.js:249-255`. |
| C13 | Language generation sends the language code and its English name in a fixed instruction, no page text. Up to five packs are stored locally. | `extension/src/languages.js:11`, `:55-64`. |
| C14 | **Add to Lang Weave** is a selection menu item on HTTP(S) pages. Saving does not call Gemini or an online dictionary. | `extension/src/capture-handlers.js:235-242`. Negative search: no `fetch` in `capture-handlers.js`, `capture-page.js`, `personal.js`, `personal-capture.js`. |
| C15 | The decision cache holds swaps (`o`, `f`, `g`, `h`, `ctx` fields) under `c:` keys, about 5,000 entries, and can be cleared. | `extension/src/cache.js:2-4`; `extension/src/prompt.js:102`; `extension/src/settings-handlers.js:19`. |
| C16 | Reading events (word, kind, day), the last 500 per language; up to 30 reading dates per language; learning log holds word ids, times, enums and numbers only; nothing leaves the browser. | `extension/src/events.js:2-6`; `extension/src/learning-log.js:3-6`; `extension/src/encounters.js:2`; `README.md` "What stays in your browser". |
| C17 | Reviews need no key or network. | Negative search: no `fetch` in `review*.js`, `words.js`, `progress*.js`. `README.md` "Install in Chrome". |
| C18 | Local cap of 1,000 model calls per day; every outbound Gemini request is counted before dispatch: each reading attempt including a fallback (the counting `fetchImpl` wraps every call), key tests and language generation. | `extension/src/quota.js:4`; `extension/src/reading.js:255-266`; `extension/src/engine.js:34-35`; `extension/src/settings-handlers.js:62`, `:247`. |
| C19 | The learning backup is a user-initiated download. Contents: learning preferences, packs, saved words, per-language learning state. Excluded: key, site settings, caches, quota, consent, page text. Import never grants a host or calls Gemini. | `extension/src/backup-handlers.js:103`; `extension/src/backup-page.js:102-110`; `extension/src/portability.js:29-43`; `extension/_locales/en/messages.json` `backup_excluded`. |
| C20 | Personal-entry export is a separate local file. | `extension/src/capture-page.js:174-175`. |
| C21 | Remove key; remove a generated language and its progress; removing the extension deletes its storage. | `extension/src/settings-handlers.js:188-191`, `:95`. Uninstall behavior is Chrome's. |
| C22 | Store build permissions: `storage`, `scripting`, `activeTab`, `contextMenus`; host `generativelanguage.googleapis.com`; optional `http://*/*` and `https://*/*`; `commands`. `alarms`, the X content script and `web_accessible_resources` are removed. | `extension/manifest.json:9-22`, `:27-36`; `extension/scripts/package.mjs:53-96`. Store zip manifest inspected. |
| C23 | Site access is requested only from a user click: one site from the popup, or all sites from the welcome page or Settings. Content scripts are registered only for granted origins. The Store manifest declares no content script. | `extension/src/popup.js:73`; `extension/src/sites.js:24-36`, `:41-60`; `extension/src/welcome.js:6-9`, `:33`; `extension/src/options.js:189-190`; `extension/scripts/package.mjs:54-75`. |
| C24 | Model output is data. Swaps are validated against listed words and written with `textContent`/text nodes. Generated-language packs are validated field by field before storage. | `extension/src/gemini.js:50-57` (JSON parse); `extension/src/engine.js:40` (`validateSwaps`, `capSwaps`); `extension/src/text.js:175`, `:192`, `:205`; `extension/src/languages.js:17-29` (`cleanPack`). Negative search: no `innerHTML` in `extension/src/`; the one `insertAdjacentHTML` (`placement-page.js:6`) is a static template. Store zip scan: no `eval(`, `new Function` or remote script. |
| C25 | The welcome page opens on first install only. | `extension/src/update.js:12-16`; `extension/src/background.js:197`. |
| C26 | The product states the 18+ requirement. | `extension/src/welcome.html:51`; `extension/src/options.html:58`. |
| C27 | The extension tells users that EEA, UK and Swiss users need paid services. | `extension/src/options.html:71`. The welcome page covers the free-key point (`welcome.html:50`) but not the EEA, UK and Swiss rule. |
| C28 | Woven words are real elements in the page's DOM. | `extension/src/text.js:118-123`, `:175`. |
| C29 | AGPL-3.0-or-later; MIT portions from French Weave preserved; both ship in the Store zip. | `NOTICE`; `LICENSE`; `LICENSE-MIT`; `extension/scripts/package.mjs:25`, `:146`. |
| C30 | Google's terms (verbatim quotes). | <https://ai.google.dev/gemini-api/terms>, which redirected to <https://aistudio.google.com/docs/terms>, fetched November 28, 2026. |
| C31 | Bundled reading samples and paragraph practice run without a key, without site access and without network. | `extension/src/welcome.html:31-46`; `extension/src/welcome-demo.js:1-25`; `extension/src/paragraph-page.js:31`, `:73`, `:184` (reads local settings only); negative search: no `fetch` or `sendMessage` in `welcome-demo.js`, `paragraph-page.js`, `paragraph-matches.js`. |
| C32 | The Duolingo Score preview is a local integer check: 0 to 160, split at 30; the field is cleared after valid input and kept, marked invalid, otherwise. Only a saved Beginner/Expanded choice is stored. | `extension/src/placement.js:3-11`; `extension/src/placement-page.js:113-127`; `extension/src/settings-handlers.js:196-214` (`spanishPlacement`). |
| C33 | Gemini 3.8 Flash falls back to Gemini 3.5 Flash-Lite; default model is Flash-Lite. | `extension/src/gemini.js:3-7`; `extension/src/engine.js:22`; `extension/src/settings.js:7`. |
| C34 | Operational keys; guess tickets live in `chrome.storage.session`. | `extension/src/portability.js:42-43`; `extension/src/quota.js:5`; `extension/src/quota-status.js:3-4`; `extension/src/reading.js:401-412`. |
| C35 | The pause shortcut toggles only an active, granted site the user can already control. | `extension/manifest.json:27-36`; `extension/src/commands.js:6-19`. |
| C36 | Site/consent state is rechecked under the settings lock immediately before each dispatch, and again after counting the call. | `extension/src/reading.js:252-266`. |

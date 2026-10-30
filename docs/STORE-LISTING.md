# Chrome Web Store listing (DRAFT for Ted's review)

> **Status: draft. Not submitted.** Ted Smith is the publisher. Nothing here has been entered in the Developer Dashboard.
> Written against Lang Weave 0.12.12, source commit `c4bbd46`, and the Store build produced by `node extension/scripts/package.mjs --store`. Citations are `file:line` in that commit.
> Companion document: [PRIVACY-POLICY.md](PRIVACY-POLICY.md). The two must agree. Any change to one needs a check of the other.
> Screenshots and the promo tiles are a separate task. Only their captions and sizes are drafted here.

## 1. Basics

| Field | Draft |
|---|---|
| Name | Lang Weave |
| Summary (132 characters max) | `Learn Spanish while you read. A few words on pages you choose are swapped in, with a hover hint and spaced review.` (114 characters) |
| Category | Education (Chrome lists it under Productivity at the time of writing; confirm in the Dashboard, because the category tree changes) |
| Language | English. The extension has no `_locales` yet (roadmap `i18n-scaffold`), so list in English only |
| Icon | 128 px, `extension/icons/icon-128.png` (exists) |
| Official URL / homepage | <https://tedks.com/projects/lang-weave/> |
| Privacy policy URL | <https://tedks.com/projects/lang-weave/privacy/> (draft page: tedks/website PR #53, not merged until Ted approves) |
| Support URL | <https://github.com/tedks/lang-weave/issues> [confirm Ted wants public issues as support] |
| Contact email (Dashboard, required) | [CONTACT EMAIL: must be verified by Ted] |
| Visibility | [Ted decides: unlisted or public. The Store ruling `store-provider-region-ruling` bears on territory] |
| Distribution regions | [Ted decides. See `store-provider-region-ruling`: option A is a non-EEA, UK and Swiss territory beta] |
| Mature content | No |

The summary says "Spanish" because Spanish is the only bundled language. Other languages are generated and experimental (see the do-not-claim list).

## 2. Detailed description

Draft text, plain text, no markup (the Store renders none):

```
Learn a language while you read.

Lang Weave swaps a few words on the English pages you choose into Spanish, right where they make sense. Hover a word to see its meaning and how it sounds. Click it to flip it back to English. A word you meet in your reading comes back later in a quick review, so it sticks.

HOW IT WORKS
- Pick the sites where it may run. You grant access one site at a time, or all sites if you prefer. Nothing runs anywhere until you say so.
- New words arrive a few a day (you set how many), taken from what you actually read.
- A local review queue schedules each word with FSRS, an open spaced-repetition method. Practice on the review page or inline.
- Save your own words from any page: select, right-click, Add to Lang Weave.
- Spanish is bundled. You can also generate a starter vocabulary for another language. Those packs are experimental and not checked by a native speaker.

HOW YOUR DATA IS HANDLED
- No account. No Lang Weave server. No analytics or tracking. Your key, settings, saved words and progress live in your browser.
- Lang Weave works by sending text from the pages you allow to Google's Gemini API, using your own Gemini key. That is the one place your reading leaves your browser.
- If your key is on Google's free tier, Google may use that text to improve its products, and human reviewers may read it. A billed key avoids that use. Use a billed key for anything private. Users in the EEA, Switzerland and the UK must use a paid key under Google's terms.
- Banking, health, webmail, messaging, AI chat, government and private-network sites start switched off. This is a safety net and cannot recognise every private page.
- Lang Weave is for people 18 and older, as Google requires for Gemini API use.
- You need a Gemini key from Google AI Studio. Google's quotas and charges apply to your key. Lang Weave limits itself to 1,000 requests per day.

OPEN SOURCE
Free software under the GNU AGPL v3 or later, forked from Jackie Oliver's French Weave. Read the code: https://github.com/tedks/lang-weave

The bundled Spanish vocabulary is a curated starter set, not a certified curriculum. The model can still make a contextual or grammatical mistake. This is mixed-language reading, not full-sentence translation.

Not affiliated with or endorsed by Google. Gemini is a trademark of Google LLC.
```

Where each statement comes from:

- Swaps, hover meaning and hint, click to flip: `README.md:3`.
- Per-site grants, nothing runs until granted, the Store manifest has no content script: `extension/scripts/package.mjs:54-74`, `extension/src/popup.js:73`, `extension/src/sites.js:15-31`.
- A few new words a day: `extension/src/settings.js:10-11` (`newWordsPerDay`, default 5) and `extension/src/options.html:47-48`. Gradual learning is off by default (`settings.js` `gradual: false`), so "arrive a few a day" is true only once gradual learning is on. See open item 2.
- FSRS scheduling: `README.md:38`.
- Add to Lang Weave: `extension/src/capture-handlers.js:235-241`.
- Experimental generated packs: `README.md:16`, `extension/src/options.html:38-43`.
- Privacy statements: see PRIVACY-POLICY.md Appendix A, claims C1 to C23.
- 1,000 requests a day: `extension/src/quota.js:4`.
- Sensitive sites off by default: `extension/src/settings.js:47-79`.

## 3. Single-purpose statement

> Lang Weave helps you learn a language while you read: it replaces a few words in the English web pages you choose with the language you are learning, shows a meaning and pronunciation hint, and schedules those words for review.

Everything in the extension serves that purpose: the page swaps, the review page, My words, Learning backup (moving your own progress), the selection menu for saving words, and generated vocabulary packs. Market.md ("Single purpose") advises framing weaving, review and capture as one learning purpose.

## 4. Permission justifications

The Store build requests exactly the following. The list is generated from `storeManifest()` and matches `extension/manifest.json:7-20` minus the three Store deltas (`extension/scripts/package.mjs:52-95`): `alarms` removed, the x.com content script removed, `web_accessible_resources` removed.

| Permission | Justification to enter in the Dashboard | Evidence |
|---|---|---|
| `storage` | Stores the user's settings, Gemini key, site choices, saved words, review schedule and cached word choices in `chrome.storage.local`. Nothing is synced or uploaded by the extension. | `extension/src/cache.js:62-67`; `extension/src/background.js:57` |
| `scripting` | Registers the page script only for sites the user has granted (`registerContentScripts`), and injects it into the open tab right after the user grants that site from the popup. | `extension/src/sites.js:25-28`; `extension/src/popup.js:58-59` |
| `activeTab` | When the user opens the popup, reads the current tab's address so the popup can show and switch Lang Weave for that site, and ask Chrome for that site's permission. Chrome withholds the address without it. | `extension/src/state.js:11`; `extension/src/popup.js:73` |
| `contextMenus` | Adds one item, "Add to Lang Weave", to the right-click menu when text is selected, so the user can save a word to their own vocabulary. | `extension/src/capture-handlers.js:235-241` |
| Host permission `https://generativelanguage.googleapis.com/*` | The only server Lang Weave talks to. It sends text from user-allowed pages to Google's Gemini API, with the user's own key, to choose which words to swap. No other host is contacted. | `extension/src/gemini.js:9`, `:25-30`; `extension/manifest.json:14-16` |
| Optional host permissions `http://*/*`, `https://*/*` | Requested only when the user clicks to enable a site, or chooses "all sites" on the welcome page or in Settings. This lets the page script read and rewrite text on the sites the user picked. Never requested at install, and sensitive sites stay off by default. | `extension/src/popup.js:73`; `extension/src/welcome.js:72`; `extension/src/options.js:149`; `extension/manifest.json:17-20` |

Notes for the reviewer questionnaire:

- **Remote code:** none. All code is in the package. The package script generates a classic content bundle at build time (`STORE-ENGINEERING-MISSION.md`, "Store-only content bundle"). Model output is parsed as JSON, validated against the listed vocabulary and inserted as text (`extension/src/engine.js:35`). It is never run and never inserted as HTML.
- **`tabs` is not requested.** The extension reads tab titles and addresses through `activeTab` and granted hosts only.
- **`<all_urls>`-like breadth** is optional, user-initiated, and per site by default. The welcome page recommends "Only sites I turn on".

## 5. Privacy practices tab (data-usage form)

The Dashboard asks which user-data types the item "collects" or handles. The Store's own FAQ says disclosure applies "even when data is processed or stored locally" (market.md, "Chrome Web Store user-data policy"). I lean toward over-disclosing: a mismatch between the form and behavior is the penalised case.

| Data type | Check? | Why |
|---|---|---|
| Website content | **Yes** | Text of pages the user allows is sent to Google's Gemini API (`reading.js:91-92`, `prompt.js:102-104`). |
| Authentication information | **Yes** | The user's Gemini API key is stored locally and sent to Google as the call's credential (`gemini.js:27`). A key is a credential. The roadmap already plans `authenticationInfo` for the Firefox listing. |
| User activity | **Yes (judgment call)** | The extension records clicks and hovers on its own woven words, and review outcomes, locally (`events.js`, `learning-log.js:3-22`). Nothing is transmitted. Definition: clicks, mouse position, scroll. If Ted reads "collect" as "leaves the device", this becomes No. Over-disclosure is the safe error. |
| Web history | No | The extension does not record visited pages. Hostnames the user explicitly toggles are stored as settings (`settings.js:33-34`), and the current page's address is held in worker memory only for a capture the user starts (`background.js:39`, `:42`; `capture-handlers.js:77`). Ted should confirm that reading. |
| Personally identifiable information | No | No name, email, address or ID is requested. |
| Health, Financial and payment, Personal communications, Location | No | Not collected by design. Health, banking and messaging sites start off and high-stakes passages are skipped (`levels.js:186-202`). A user can turn such a site on, which is why the policy says the filter is not a guarantee. |

Certifications to tick (all true as the code stands):

- I do not sell or transfer user data to third parties, outside of the approved use cases. (Transfer to Gemini is necessary for the single purpose. This is the "approved use case".)
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Also fill: **Privacy policy URL** (see section 1) and the **Limited Use** wording from PRIVACY-POLICY.md. The Store requires the Limited Use statement on the homepage or one click from it. The website draft puts it on the privacy page, which the project page links to.

## 6. Screenshot captions (screenshots are a separate task)

Five screenshots, 1280x800 each, from the audit's screenshot harness (ux-audit.md, #7): onboarding, gloss, flip, review, progress. A 440x280 small promo tile is also required.

1. **Welcome page.** "Pick where it may read. Only sites you turn on, or all except sensitive ones. You choose before anything is sent."
2. **Hover.** "Hover a word for its meaning and how it sounds."
3. **Flip.** "Click a word to flip it back to English."
4. **Review.** "Words you met while reading come back for a quick recall check, scheduled with FSRS."
5. **Progress.** "See what you have introduced, seen and recalled. All of it stays in your browser."

Constraint: screenshots must show what the Store build does. They must not show the X/Twitter auto-weave (Store has no content script), a "NEW" update badge, or a real person's feed. Caption 5 is accurate only if the progress surface (`words.html`, popup "Today") is what is pictured.

## 7. What the listing must NOT claim

Each line is a claim someone will be tempted to write, with the reason it is false or unsupported today.

1. **"Private", "100% private", "your data never leaves your device", "nothing is sent anywhere".** Page text goes to Google (market.md: "What not to claim: 'private' without qualification"). The honest claim is "no Lang Weave server sees your reading".
2. **"No tracking" or "no data collection" without the Gemini sentence next to it.** Lang Weave collects nothing on its own, but the Dashboard form declares website content and authentication information.
3. **"Free" without the key caveat.** The extension is free. The Gemini key and its quota or charges are the user's. Do not promise "free forever" in the listing either. A hosted tier is unauthorised and unbuilt.
4. **"No sign-up", "no account" without saying a Google account and Gemini key are needed.** True for Lang Weave itself. Misleading about getting started.
5. **"Works offline."** Weaving needs Gemini. Only the review page works without a network (`README.md:74`).
6. **"Works on any website", "any language".** Sensitive sites start off. Only Spanish is bundled. Other languages are model-generated, experimental, and limited to five packs (`README.md:16`).
7. **"Accurate", "native-speaker reviewed", "CEFR-aligned", "certified curriculum", "learn to fluency", "scientifically proven to work".** The README says the Spanish list is not certified. The one controlled study cited in the roadmap found in-page substitution equal to word lists after a few weeks.
8. **"Safe for kids", "family friendly", or any under-18 audience.** Google requires 18+ for the API.
9. **"GDPR compliant", "compliant with Google's terms", or any legal conclusion.** `store-provider-region-ruling` is open. Whether a consumer BYOK client fits Gemini's terms is unresolved (market.md, "Gemini API terms").
10. **"Private on sensitive sites" or "automatically protects banking and health".** The blocklist and filters are heuristic and cannot recognise every private page.
11. **"Powered by Google", "official Gemini extension", any Google, Babbel, Toucan, Duolingo or Anthropic logo or endorsement.** Use "uses Google's Gemini API" and keep the non-affiliation line.
12. **"Works with X/Twitter out of the box" or any X-specific promise.** The Store build drops the x.com content script (`package.mjs:54-74`). X needs a normal per-site grant. Ruling `store-site-consent-ruling` is open.
13. **"Pronunciation audio", "text to speech", "hear the word".** There are written hints only. Speech is on the roadmap, not shipped.
14. **"Syncs across devices", "cloud backup", "Edge, Firefox or mobile support".** None exist. Learning backup is a manual JSON file. Edge and Firefox are roadmap items.
15. **"Unlimited".** A 1,000-call local daily cap applies (`quota.js:4`), and the key's own quota applies.
16. **"Imports your Duolingo progress" or "takeover screen".** Not built (`README.md:74`).
17. **"The only open-source…" or competitor comparisons.** market.md's "no competitor is open source, account-free and BYOK at once" is research, partly unverified. Do not turn it into a superlative.
18. **User counts, ratings, or testimonials.** None exist.

## 8. Open items before submission

1. **Rulings:** `store-provider-region-ruling` and `store-site-consent-ruling` (both Ted). They change the territory field, the description's privacy paragraph and the permission wording.
2. **"A few new words a day" depends on gradual learning,** which is off by default (`settings.js` `gradual: false`; welcome page "recommends" turning it on, `welcome.html:49`). Either the default changes (a pending ruling, `update.js:14`) or the description should say "turn on gradual learning". The draft says "arrive a few a day (you set how many)". Ted to choose.
3. **18+ appears in no in-product text.** Add one line to the welcome page before submission so the listing and product agree (code change, not part of this mission).
4. **Store `key` field.** The Store build still carries the development `key` (`package.mjs:50`, ditz `store-manifest-key-delta`). Unresolved.
5. **Contact email, support URL, visibility, regions, and the privacy-policy URL** are placeholders.
6. **Category and Limited Use wording** are from memory of the Dashboard and policy. Verify both live.
7. **Trademark line** ("Gemini is a trademark of Google LLC") is my suggestion. Ted or counsel decide.

## 9. Not verified

- Nothing here was entered in, or checked against, the Developer Dashboard, which I cannot access. Field names and limits (for example 132 characters for the summary) are from the Store's published rules as I know them.
- No Store upload, no Store install, no live Gemini call was made. The permission list comes from running `storeManifest()` on the manifest, not from a built zip uploaded to Chrome.
- The Google terms quotes in the description are paraphrased from market.md, which quoted them on October 30, 2026. Not re-fetched.
- The screenshots do not exist yet. Captions assume the surfaces named above look as the audit harness captured them.

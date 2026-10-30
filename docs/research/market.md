# Lang Weave: competitive and business landscape

Research date: 2026-10-30. Author: product-research lane (market). Sources are linked inline. Anything marked **[unverified]** came from a third-party aggregator, a search summary, or my own inference and should be checked before it drives a decision.

## Bottom line

- **The inline-swap niche has one incumbent, and it looks parked.** Toucan was bought by Babbel in September 2023. Its Chrome listing shows 200,000 users, 3.5 stars from 1.4K ratings, and a last update of July 15, 2025. Recent reviews complain about out-of-context translations, which is exactly the failure an LLM-chosen swap fixes.
- **No competitor in this niche is open source, account-free and BYOK at once.** That combination, plus a local scheduler, is the defensible position.
- **The biggest risk is not competition but Google's terms.** The Gemini API Additional Terms say the API is "for developers building ... for professional or business purposes, not for consumer use", and free-tier prompts may be read by human reviewers. A consumer pasting a free key to weave their private reading sits awkwardly against both lines.
- **Serving costs are higher than they look, because output and thinking tokens dominate.** A typical active reader costs roughly $2 to $5 a month on Flash-Lite at list price. A heavy reader at the current 1,000-call cap costs $45 to $100 a month. A hosted tier needs a much lower cap and a cheaper configuration.
- **Onboarding is the product's weakest point.** Every successful competitor shows value before asking for anything. Lang Weave currently asks for an API key before it does anything.

## Competitor table

Users and ratings are Chrome Web Store figures unless noted. "OSS" means the client is open source.

| Product | What it does | Model and price | Platforms | Reach and rating | OSS |
|---|---|---|---|---|---|
| **Toucan by Babbel** | Swaps target-language words into English pages, hover for meaning, quizzes | Free now. Premium was about $4.99/mo before the acquisition ([TechCrunch](https://techcrunch.com/2021/04/27/toucan-seed-funding/)); current listing mentions no paid tier | Chrome, Edge; Firefox listing existed **[unverified current]** | 200K users, 3.5★ (1.4K) ([CWS](https://chromewebstore.google.com/detail/toucan-by-babbel-language/lokjgaehpcnlmkebpmjiofccpklbmoci)); 12 learning languages | No |
| **Language Reactor** | Dual subtitles, word lookup and saving on Netflix and YouTube | Free core; Pro about $5/mo **[unverified, regional prices vary]** ([MezzoGuild](https://www.mezzoguild.com/language-reactor-review/)) | Chrome, Edge | 2M users, 3.8★ (4.4K) ([CWS](https://chromewebstore.google.com/detail/language-reactor/hoombieeljmmljlkjmnheibnpciblicm)) | No |
| **Readlang** | Click-to-translate reader with SRS flashcards from context | Free tier capped; Premium $6/mo or $48/yr; Premium Plus $15/mo ([readlang.com](https://readlang.com)) | Web, Chrome extension | 40+ languages **[count unverified]** | No |
| **LingQ** | Import-and-read library, saved-word tracking, SRS | Premium $14.99/mo or about $120/yr; Premium Plus $29.99/mo; free tier capped at 20 saved words ([StoryLearning](https://storylearning.com/lingq-review)) | Web, iOS, Android, importer extension | Large; no CWS figure checked | No |
| **Lingvist** | Adaptive flashcard course, not an extension | About $9.99/mo or $80 to $120/yr **[sources conflict]** ([lingvist.com](https://lingvist.com/pricing/)) | Web, iOS, Android | n/a | No |
| **Immersive Translate** | Bilingual page translation; AI engines; BYOK supported | Free with Google or Bing engines; Pro $9.99/mo or about $80/yr ([App Store](https://apps.apple.com/app/immersive-translate/id6447957425)) | Chrome, Edge, Firefox, Safari, iOS, Android | Claims 20M users (self-reported); Edge 2M+ | No |
| **Relingo** | Highlights words above your level with translations, YouTube subtitles, Anki export | $2.99/mo or $29.99/yr ([Edge listing](https://microsoftedge.microsoft.com/addons/detail/relingo-master-words-fr/fhaefmiaghgdaciliiiflaoiknhibkmo)) | Chrome, Edge, Firefox incl. Android | Not checked | No |
| **Mate Translate** | Translator with phrasebook and Netflix subtitles | Pro about $29.99 to $49.99/yr ([Mate help](https://matetranslate.com/en/help/whats-free-and-whats-in-mate-pro)) | Chrome, Edge, Safari (Mac and iOS app) | Not checked | No |
| **Migaku** | Mining from video and web into SRS cards, CJK focus | Subscription; lifetime $199 on sale from $499 ([migaku.com](https://migaku.com/pricing)) | Chrome extension, iOS, Android | Extension about 3.5★ from about 540 reviews | No |
| **Yomitan** | Popup dictionary for CJK and 20+ languages, Anki integration | Free | Chrome, Firefox incl. Android | Community standard for Japanese | Yes, GPL-3.0 ([GitHub](https://github.com/yomidevs/yomitan)) |
| **Kimchi Reader** | Korean reader with popup dictionary and tracking | Paid subscription, 7-day trial; about $4 to $5/mo **[unverified]** ([AMO](https://addons.mozilla.org/addon/kimchi-reader/)) | Chrome, Firefox, Android, iOS beta | Small | No |
| **Anki and FSRS** | General SRS; FSRS is an open ML scheduler built into Anki | Free desktop and Android; iOS app paid | All | Very large | Yes; Anki is AGPL-3.0 |
| **Fluent (fluent.co)** | Swaps words into English pages, Spanish, French and Italian | Freemium; one review says the trial demands email and card before showing pricing | Chrome | Status in 2026 **[unverified]** ([Daily Hive](https://dailyhive.com/toronto/fluent-language-chrome-extension)) | No |
| **NeonLingo, Word Sponge, Trancy** | Newer AI word-swap or bilingual tools | Freemium, prices not checked | Chrome, Edge | Small **[unverified]** ([NeonLingo](https://www.neonlingo.com/)) | No |
| **Lingua.ly** | 2013 to 2018 extension that saved words from pages into flashcards | Defunct; homepage last updated April 2018 | Chrome, Android | Reason for closure not found **[unverified]** | No |
| **MindSnacks** | Mobile language games | The company became Elevate, a brain-training app ([Dealroom](https://app.dealroom.co/companies/elevate_formerly_mindsnacks_)) | iOS | Language apps abandoned | No |
| **Duolingo** | In-app "immersion" reading exercises. The original crowd-translation Immersion feature was withdrawn in January 2017 | Freemium, Super subscription | Mobile, web | No browser extension | No |
| **Wordela** | English vocabulary app sold through lifetime deals | $9.99 lifetime on deal sites | Web | Not a direct competitor | No |

### What the category teaches

- **Word swapping alone has struggled to sustain a company.** Toucan raised about $7.5M, then sold to Babbel and seems to have stopped shipping. Lingua.ly closed. MindSnacks pivoted away from languages. Standalone subscriptions in this niche have not proven out.
- **Accuracy is the recurring complaint.** Toucan reviewers cite "translating words out of context so the translation makes no sense" (October 8, 2026) and a homonym error where "looked back" got the body-part sense ([Edge listing](https://microsoftedge.microsoft.com/addons/detail/ljbocbkhabkbkedlhmppmpfajejdkoei)). Lang Weave's sense-checked swaps directly address this.
- **Trust and account friction cost ratings.** Toucan users complain they cannot delete their account. Fluent reportedly demands a card before showing a price. Migaku users report billing and cancellation trouble. Having no account is a selling point.
- **Ratings sag over time across the category.** Third-party trackers report recent-review averages well below lifetime averages for Toucan and Language Reactor **[aggregator figures, unverified]**.
- **The money is in study tools, not ambient exposure.** Products that charge successfully (LingQ, Migaku, Readlang, Language Reactor Pro) sell saving, review and export. That maps to Lang Weave's review page and personal capture, not to the weaving itself.

## 1. Defensible position

Recommended one-line positioning: **"Learn a language from the web you already read. Open source, no account, your key, your data stays in your browser."**

The defensible pieces, in order of how hard they are to copy:

1. **Open source under AGPL.** No product in the inline-swap niche is open source. Yomitan and Anki show that learners trust and evangelize open tools. AGPL also prevents a closed fork from offering a hosted version without sharing changes.
2. **No account and no telemetry.** Toucan's account-deletion complaints and the category's data-collection disclosures make this concrete. Lang Weave's Web Store disclosure can honestly say it collects nothing on its own servers.
3. **LLM sense-checking instead of dictionary swaps.** This is the quality gap competitors are criticized for. It is copyable by a funded team, so it is an advantage, not a moat.
4. **Gradual learning tied to the user's actual reading.** New words per day, a local scheduler, inline recall and personal capture make a learning loop. Toucan has quizzes but no visible scheduler.
5. **Any language through generated packs.** This is a reach advantage, but pack quality is uncertified. It should be marketed as experimental until reviewed.

What not to claim: "private" without qualification. With a free-tier Gemini key, Google may use the text and human reviewers may read it (see the risk section). The honest claim is "no Lang Weave server sees your reading".

## 2. Onboarding for the first five minutes

### What the best competitors do

- **Toucan:** pick a language, then words appear on the next page you open. No key, and the account comes later.
- **Language Reactor:** open Netflix or YouTube and dual subtitles are already there.
- **Immersive Translate:** works immediately with free Google or Bing engines. AI engines and BYOK are an advanced setting, not a gate.
- **Readlang and LingQ:** account first, which is heavier, but you see content within a minute.

The pattern is value before commitment. BYOK products that succeed put the key behind a working default.

### Recommendations

1. **Show the effect before asking for a key.** Open a first-run page with a short sample article that is already woven, using bundled precomputed swaps. Hover, click-to-flip and a mini review should all work there with no network call.
2. **Offer a keyless reading mode where possible.** Two candidates:
   - **Chrome's built-in Prompt API (Gemini Nano)**, available to extensions since Chrome 138 ([Chrome docs](https://developer.chrome.com/docs/ai/built-in-apis)). It needs at least 22 GB free disk and either more than 4 GB VRAM or 16 GB RAM with four cores, and it is desktop Chrome only ([Prompt API](https://developer.chrome.com/docs/ai/prompt-api)). Quality for sense-checked swaps is unknown and must be tested. This would be free, private and need no key.
   - **A deterministic bundled mode** that swaps only unambiguous entries such as "and" to "y". It is weaker but works everywhere. Treat this as a product idea, not a tested design.
3. **Make the key flow a guided step, not a text box.** Link directly to the AI Studio key page, detect a pasted key, make one validation call, and confirm success with a woven sentence. Explain in two sentences the trade-off between the free tier and a billed project (see the risk section).
4. **Ask for sites after the demo.** Lead with one suggested site the user already reads, rather than "allow all websites".
5. **Consider OAuth instead of paste.** OpenRouter supports a PKCE OAuth flow that returns a user-controlled key with no client secret ([OpenRouter docs](https://openrouter.ai/docs/use-cases/oauth-pkce)). Upstream French Weave already lists openrouter.ai in its host permissions. Whether an extension redirect URL is accepted as a callback is **[unverified]**.

### Should there be a hosted tier?

Not yet. A hosted tier makes Lang Weave the Gemini API customer, which cleanly resolves the "not for consumer use" problem. It also brings a server that handles page text, a privacy policy with real obligations, billing and abuse handling. Build it only after the free product shows retention. Instrument it with a waitlist button in the key step, which counts demand without collecting anything else.

## 3. Monetization

### Category numbers

| Signal | Figure | Source |
|---|---|---|
| Toucan users and rating | 200K, 3.5★ | CWS listing |
| Language Reactor users and rating | 2M, 3.8★ | CWS listing |
| Immersive Translate users | 20M claimed, 2M+ on Edge | Vendor and Edge listing |
| Extension free-to-paid conversion | about 0.8% overall, 8% of users shown a prompt | One developer's ExtensionPay report ([dev.to](https://dev.to/_350df62777eb55e1/real-numbers-freemium-chrome-extension-monetization-after-6-months-5hga)) |
| Generic freemium benchmark | 2% to 5% | Weakly sourced industry figure |
| Competitor price points | $3/mo (Relingo), $5 (Language Reactor, Toucan was), $6 (Readlang), $10 (Immersive Translate, Lingvist), $15 (LingQ) | Table above |
| Annual plans | $30 to $120/yr; lifetime $199 (Migaku) | Table above |
| Chrome Web Store payments | Deprecated; extensions use ExtensionPay or Stripe. The deprecation page now returns 404 | ExtensionPay charges about 5% plus Stripe fees **[unverified]** |

Use 0.5% to 2% of weekly active users for planning. At 10,000 weekly users, 1% paying $4 net a month is about $400 a month. That is a sustaining contribution, not a business.

### Cost of serving Gemini per active user

**Request size, read from the code.** The Spanish system prompt in `extension/src/prompt.js` is about 2,900 characters at Beginner and 7,000 at Expanded. With gradual learning, the vocabulary block is capped at 3,000 characters and the whole request at 25,000 (`adaptive.js`). Each call carries up to 8 near-viewport passages of at most 2,000 characters each (`background.js`). Responses are compact JSON swaps. The model runs with low thinking, and thinking tokens bill at the output rate. A daily cap of 1,000 calls applies (`quota.js`).

**Assumptions per call, not measured:**

- Typical: 2,500 input tokens, 600 output tokens and 400 thinking tokens.
- Large, near the request cap: 6,500 input and 1,500 output including thinking.
- Prices per million tokens, input then output: 3.5 Flash-Lite $0.30 and $2.50, 3.1 Flash-Lite $0.25 and $1.50, from the [pricing page](https://ai.google.dev/gemini-api/docs/pricing). The 2.5 Flash-Lite price of $0.10 and $0.40 came from a summary of that page and is **[unverified]**.

Monthly cost per user at list price, typical call size:

| Model | 20 calls/day | 50 calls/day | 150 calls/day | 1,000 calls/day (cap) |
|---|---|---|---|---|
| 3.5 Flash-Lite, low thinking | $1.95 | $4.88 | $14.63 | $97.50 |
| 3.1 Flash-Lite, low thinking | $1.28 | $3.19 | $9.56 | $63.75 |
| 3.1 Flash-Lite, no thinking | $0.92 | $2.29 | $6.86 | $45.75 |
| 2.5 Flash-Lite **[price unverified]** | $0.39 | $0.98 | $2.92 | $19.50 |

The call rate is the largest unknown. One hour of scrolling X might produce 40 to 60 calls, and a long article about 4. I'd guess 20 to 50 calls a day for a typical active reader **[estimate]**. Gemini responses include usage metadata with prompt, output and thinking token counts. Logging those counts locally for a week from the author's and friends' installs would replace these guesses.

### Recommendation

1. **Keep BYOK free forever,** with no feature gated. This is the open-source promise and the positioning.
2. **Take donations now** through GitHub Sponsors, Liberapay or Open Collective. These cost nothing to set up and fit an AGPL project.
3. **If retention justifies it, add a hosted "no key" tier at about $4 to $5 a month or $36 to $40 a year.** It should use the cheapest model that passes the swap-quality tests, minimal thinking, and a hosted cap of about 50 calls a day. At 50 calls a day on 3.1 Flash-Lite without thinking, the cost is about $2.30 against about $4.20 net revenue. That margin holds only if the cap holds. At the current 1,000-call cap, it would lose money on every heavy user.
4. **Do not sell vocabulary packs or paywall the review page.** Both cut against the positioning, and review is the stickiest feature.

## 4. Platform reach

- **Edge:** The Chrome build should load as-is. Listing is free. Do it at Chrome launch for near-zero cost.
- **Firefox (desktop and Android):** Upstream French Weave added Firefox in 0.2.14 by cherry-picking a contributor's PR. The manifest change was small:
  - a `background.scripts` entry beside `service_worker`, since Firefox runs the first and Chrome the second;
  - `browser_specific_settings.gecko` with an add-on ID, minimum Firefox 140, and `data_collection_permissions` requiring `websiteContent`.

  Since November 3, 2025, AMO requires new extensions to declare `data_collection_permissions`, and Firefox shows a built-in consent prompt for them ([Extension Workshop](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)). Lang Weave has no native host, so it avoids the bulk of upstream's work. Lang Weave uses context menus, scripting, alarms and optional host permissions, all of which Firefox supports, but this needs a real test. Firefox for Android runs extensions, so this is also the cheapest route to mobile. Gemini Nano is not available on Firefox. **Estimate: small, a few days including tests and the AMO listing.**
- **Safari (macOS and iOS):** Requires converting with Xcode's `safari-web-extension-converter`, shipping inside a Mac or iOS app, and App Store review ([conversion guide](https://evilmartians.com/chronicles/how-to-quickly-and-weightlessly-convert-chrome-extensions-to-safari)). An Apple Developer Program membership is needed **[fee of $99/yr from general knowledge, unverified]**. Safari's per-site permission model differs, so the site consent flow needs rework. **Estimate: medium, one to two weeks plus ongoing app maintenance.** Defer until Chrome and Firefox are stable.
- **Does mobile matter?** Learners do much of their study on phones, but most mobile reading happens in native apps that no extension can reach. Firefox for Android and iOS Safari reach only mobile web reading. The higher-value mobile feature would be doing reviews on the phone. That needs sync, which conflicts with the no-account position. Treat mobile as later, starting with Firefox for Android because it is nearly free.

## 5. Risks: terms and store policy

### Gemini API terms

Source: [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms), effective March 23, 2026, last updated April 28, 2026. Quotes are verbatim.

- **Consumer use.** Under "Use Restrictions": *"Use of Google AI Studio and Gemini API is for developers building with Google AI models for professional or business purposes, not for consumer use."*
- **Region.** Same section: *"You may only access the Services (or make API Clients available to users) within an available region. You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom."*
- **Age.** Under "Age Requirements": *"You must be 18 years of age or older to use the APIs. You also will not use the Services as part of a website, application, or other service (collectively, "API Clients") that is directed towards or is likely to be accessed by individuals under the age of 18."*
- **Free-tier data use.** Under "Unpaid Services": *"Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services and machine learning technologies"*. Also: *"human reviewers may read, annotate, and process your API input and output ... Do not submit sensitive, confidential, or personal information to the Unpaid Services."*
- **Paid-tier data use.** Under "Paid Services": *"Google doesn't use your prompts ... or responses to improve our products"*. Prompts are logged *"for a limited period of time, solely for detecting and preventing violations of the Prohibited Use Policy"* and for legal disclosures. Access counts as paid *"only when accessing the API through a Cloud Project associated with an active billing account."*
- **Credentials.** The [Google APIs Terms](https://developers.google.com/terms), last modified November 9, 2021, say: *"Developer credentials (such as passwords, keys, and client IDs) are intended to be used by you and identify your API Client. You will keep your credentials confidential ... Developer credentials may not be embedded in open source projects."* BYOK complies with this because no project key ships in the code. A hosted tier must never embed one in the extension.
- **Production use of the free tier.** No clause explicitly forbids it. The pricing page describes the free tier as "for developers and small projects getting started".

**Interpretation, not legal advice:**

- Under BYOK, the user accepts Google's terms as the key holder, and Lang Weave is arguably a tool the user runs. The "not for consumer use" line still makes a mass-market pitch of "paste your free key" fragile. Google could also enforce it against users' keys.
- Someone could argue that Lang Weave "makes API Clients available to users" in the EEA, Switzerland and UK. If so, EEA, Swiss and UK users would need billed keys. The extension cannot check a key's billing status.
- The free-tier human-review clause conflicts with weaving private pages. The extension's sensitive-site blocklist helps but cannot be complete.
- A hosted tier on a billed Lang Weave project fits the terms best. Lang Weave would then be a developer offering a business product, on paid services without training use. Lang Weave would also be bound by the under-18 clause, so the store listing and terms should say 18 and over.

**Recommended actions:**

- In onboarding, recommend a billed key and explain why in one sentence. Mention the EEA, Swiss and UK rule.
- State 18+ in the listing.
- File the consumer-use question as an open product and legal question. Who decides is Ted, possibly with counsel. Recommended position: ship BYOK with clear disclosure and treat a hosted tier on a billed project as the long-term compliant path.

### Chrome Web Store user-data policy

Sources: [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use), [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), [Privacy policies](https://developer.chrome.com/docs/webstore/program-policies/privacy).

- **Page text is user data.** The FAQ lists "Website content and resources" and "Clipping or scraping content from a website that the user visits" as handling. Disclosure is required *"even when data is processed or stored locally"*.
- **Prominent disclosure in the extension's own UI.** *"The disclosure, however, must not be located only in a privacy policy, terms of service, or similar document."* Also: *"The prominent disclosure and consent must occur within the Product's user interface."* Also: *"Disclosures in the Chrome Web Store description or inline installation page do not satisfy this requirement."* Lang Weave needs a consent screen before the first Gemini call that says readable text from enabled sites is sent to Google.
- **Third-party transfer.** This is allowed only *"If necessary to providing or improving your single purpose"*. Sending text to Gemini to choose swaps qualifies.
- **Privacy policy.** *"If your Product handles any user data, then you must post an accurate and up to date privacy policy"*, including *"All parties the user data will be shared with."* The link goes in the Dashboard field.
- **Limited Use statement.** It must appear *"on your project's homepage or on a page one click away from the homepage."*
- **Dashboard certification.** Data-type disclosures and a Limited Use certification are required. Mismatches between the Dashboard, the privacy policy and actual behavior can lead to a *"ban of the entire publisher entity (including related accounts)."*
- **Permissions.** *"Request access to the narrowest permissions necessary"*. Lang Weave's per-site optional host permissions fit this well. Keep "allow all websites" as an explicit opt-in.
- **Single purpose.** *"An extension must have a single purpose that is narrow and easy to understand."* Weaving, review and capture together form one learning purpose. Keep the listing framed that way.

### Remote code rule (MV3)

Source: [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements).

- The full functionality *"must be easily discernible from its submitted code"*.
- Prohibited: *"Using JavaScript's eval() method or other mechanisms to execute a string fetched from a remote source"* and *"Building an interpreter to run complex commands fetched from a remote source, even if those commands are fetched as data."*
- Model output that is parsed as JSON and inserted as text is data, not logic, so it falls outside the rule. This is my reading, not a ruling.
- Two design points keep it that way:
  - Never insert model output as HTML.
  - Keep generated language packs as plain word lists, never as rules the extension runs.
- The README mentions Duolingo import and a takeover screen. Neither raises remote-code issues as long as no logic is fetched.

## What I could not verify

- Current Language Reactor, Immersive Translate, Lingvist, Kimchi Reader and Mate prices. Figures came from listings and reviews of mixed age.
- The Gemini 2.5 Flash-Lite price and the current free-tier rate limits. The rate-limits page shows no numbers and points to AI Studio.
- Whether Toucan's premium tier was folded into the free tier, as one search summary said. The current listing simply mentions no paid features.
- Why Lingua.ly closed, and whether Fluent (fluent.co) still operates.
- The Apple Developer Program fee, the ExtensionPay fee and the current Chrome Web Store registration fee. The fee was $5 historically. Google's current page does not state an amount.
- Gemini Nano's swap quality, and whether an OpenRouter OAuth callback accepts an extension URL.
- All serving-cost figures are estimates from code-derived request sizes and assumed call rates. They are not measurements.

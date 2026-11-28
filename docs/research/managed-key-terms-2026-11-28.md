# LW-STORE terms research: managed-key option

Prepared 2026-11-28 by the terms-research worker for the LW-STORE lane. Preparation only:
no accounts, signups, keyed API calls, purchases or outreach were made.

**Method.** Every page below was fetched with `curl` on 2026-11-28 (server `date` header
Sat, 28 Nov 2026 07:51 GMT on the AI Studio fetches). `ai.google.dev/gemini-api/*` now
301-redirects to `aistudio.google.com/docs/*`, which is rendered by JavaScript, so the
Gemini docs were read from the Markdown copies the site advertises
(`<link rel="alternate" type="text/markdown" href="/docs/terms.md">`). The quotes are
verbatim from those copies. "Vertex AI" has been renamed **Gemini Enterprise Agent
Platform** on Google's current pages. The Service Specific Terms read "Generative AI on
Gemini Enterprise Agent Platform (formerly Generative AI on Vertex AI)". This brief says
"Vertex" for short. Anything marked **[inference]** is my reading, not page text.
Nothing here is legal advice.

Pages that failed to load: `developer.chrome.com/docs/webstore/money` (404) and
`.../program-policies/policies-faq` (404). Stripe's support article
`requirements-for-activating-a-stripe-account` also returned 404. The docs pages used in
its place are cited in Q5(e).

> **Note added by the lead:** where this brief discusses `managed-key.md` §6.2 as a
> "validated pass-through", that was the first draft. The spec was revised in response to
> this brief: the proxy now builds the prompt on the server (§6.2 "Server-built prompt").

---

## Q1. Gemini API (AI Studio keys): Additional Terms + Google APIs ToS

Sources:
- Gemini API Additional Terms of Service: https://ai.google.dev/gemini-api/terms, which
  redirects to https://aistudio.google.com/docs/terms (read via `/docs/terms.md`).
  **"Effective March 23, 2026"**
- Google APIs Terms of Service: https://developers.google.com/terms.
  **"Last modified: November 9, 2021"**

### 1a. Sublicensing / "functions substantially the same as the APIs" (the resale clause)

> When using the APIs, you may not (or allow those acting on your behalf to):
> - Sublicense an API for use by a third party. Consequently, you will not
> create an API Client that functions substantially the same as the APIs and
> offer it for use by third parties.

[developers.google.com/terms, Section 4: Prohibitions and Confidentiality, a. API Prohibitions, last modified Nov 9 2021]

> The APIs are designed to help you enhance your websites and applications ("API
> Client(s)").

[developers.google.com/terms, Section 3: Your API Clients, a. API Clients and Monitoring]

> You will not use the
> Services as part of a website, application, or other service (collectively,
> "**API Clients**") that is directed towards or is likely to be accessed by
> individuals under the age of 18.

[aistudio.google.com/docs/terms, Age Requirements, eff. Mar 23 2026]

No clause in either document uses the words "resell" or "as a service" about the Gemini
API itself. The one "resell" in the Additional Terms covers **Grounding with Google
Search** output only ("cache, frame, syndicate, resell, analyze, train on ... Grounded
Results"). Lang Weave does not use grounding.

### 1b. Credentials (sharing or transferring keys)

> Developer credentials (such as passwords, keys, and client IDs) are intended
> to be used by you and identify your API Client. You will keep your
> credentials confidential and make reasonable efforts to prevent and
> discourage other API Clients from using your credentials. Developer
> credentials may not be embedded in open source projects.

[developers.google.com/terms, Section 4, b. Confidential Matters]

> If Google assigns you developer credentials (e.g.
> client IDs), you must use them with the applicable APIs. You will not
> misrepresent or mask either your identity or your API Client's identity when
> using the APIs or developer accounts.

[developers.google.com/terms, Section 2, c. Permitted Access]

Google's own key-security docs recommend the proxy pattern:

> * **Never expose keys client-side in production**: Do not hardcode API keys
>   directly in web or mobile apps. Keys compiled in client-side code can be
>   extracted by users. To secure client-side apps, run a backend proxy
>   server to make the actual API calls.

[https://aistudio.google.com/docs/api-key.md, "Security and secret management" > "Critical security rules", fetched 2026-11-28, no page date]

### 1c. "Not for consumer use", regions, the EEA/UK/CH Paid-only rule

> Use of Google AI Studio and Gemini API is for developers building with Google AI
> models for professional or business purposes, not for consumer use.
>
> You may only access the Services (or make API Clients available to users) within
> an [available region](/docs/available-regions). **You may use
> only Paid Services when making API Clients available to users in the European
> Economic Area, Switzerland, or the United Kingdom.**

[aistudio.google.com/docs/terms, Use Restrictions, eff. Mar 23 2026]

> Your access to Gemini API is a "Paid Service" only when accessing the API
> through a Cloud Project associated with an active billing account.

[aistudio.google.com/docs/terms, Paid Services, eff. Mar 23 2026]

The available-regions page (https://aistudio.google.com/docs/available-regions.md, no
date) lists United States, United Kingdom and Switzerland, among many others. For
countries not on the list it says: "try the [Gemini API in Gemini Enterprise Agent
Platform]".

### 1d. Age 18+

> You must be 18 years of age or older to use the APIs. You also will not use the
> Services as part of a website, application, or other service (collectively,
> "**API Clients**") that is directed towards or is likely to be accessed by
> individuals under the age of 18.

[aistudio.google.com/docs/terms, Age Requirements, eff. Mar 23 2026]

### 1e. Data use: Unpaid vs Paid

> When you use Unpaid Services, including, for example, Google AI Studio and the
> unpaid quota on Gemini API, Google uses the content you submit to the Services
> and any generated responses to provide, improve, and develop Google products and
> services and machine learning technologies [...]
> To help with quality and improve our products, human reviewers may read,
> annotate, and process your API input and output. [...] **Do not submit sensitive, confidential, or personal information to the
> Unpaid Services.**

[aistudio.google.com/docs/terms, Unpaid Services > How Google Uses Your Data]

> When you use Paid Services, including, for example, the paid quota of the Gemini
> API, Google doesn't use your prompts (including associated system instructions,
> cached content, and files such as images, videos, or documents) or responses to
> improve our products, and will process your prompts and responses in accordance
> with the
> [Data Processing Addendum for Products Where Google is a Data Processor](https://business.safety.google/processorterms/).
> For Paid Services, Google logs prompts and responses for a limited period of
> time, solely for detecting and preventing violations of the
> [Prohibited Use Policy] [...]

[aistudio.google.com/docs/terms, Paid Services > How Google Uses Your Data]

### 1f. Rate limits: circumvention, and the project-level caps that constrain a proxy

> Google sets and enforces limits on your use of the APIs (e.g. limiting the
> number of API requests that you may make or the number of users you may serve),
> in our sole discretion. You agree to, and will not attempt to circumvent, such
> limitations documented with each API. If you would like to use any API beyond
> these limits, you must obtain Google's express consent [...]

[developers.google.com/terms, Section 2, d. API Limitations]

> Rate limits are applied per project, not per API key.

[https://aistudio.google.com/docs/rate-limits.md, "How rate limits work", no page date]

> | Usage tier | Qualification | [Billing tier cap] |
> | **Tier 1** | [Set up and link an active billing account] | $250 |
> | **Tier 2** | Paid $100 + 3 days from first successful payment | $2,000 |
> | **Tier 3** | Paid $1,000 + 30 days from first successful payment | $20,000 - $100,000+ |

[rate-limits.md, "Usage tiers"]

> After the cumulative account
> total reaches the tier limit, service is paused for all projects linked to that
> billing account until the start of the next billing cycle (the 1st of each
> month).

[https://aistudio.google.com/docs/billing.md, "Spend caps" > "Billing account tier spend caps"]

> Experimental: The feature is experimental and limited in scope. You are subject
> to overages for around a 10 minute latency period.

[billing.md, "Spend caps" > "Project spend caps"]

The spend-based rate limit is $10 per rolling 10 minutes on Tier 1 and $200 on Tiers 2
and 3 (rate-limits.md, "Spend-based rate limits"). The billing FAQ also says: "Starting
Mar 23, 2026, new users to AI Studio might be required to be on the Prepaid billing
plan."

### 1g. Competing products

> You may not use the Services to develop models that compete with the Services
> (e.g., Gemini API or Google AI Studio). You also may not attempt to reverse
> engineer, extract or replicate any component of the Services [...]

[aistudio.google.com/docs/terms, Use Restrictions]

> The Terms are non-exclusive. You acknowledge that Google may develop products or
> services that may compete with the API Clients or any other products or
> services.

[developers.google.com/terms, Section 2, h. Non-Exclusivity]

The non-compete clause is about **models**, not applications. Lang Weave does not train
models.

### 1h. Content clauses that touch generated output

> Unless expressly permitted by the content owner or by applicable law, you will
> not, and will not permit your end users or others acting on your behalf to, do
> the following with content returned from the APIs:
> [...]
> - Copy, translate, modify, create a derivative work of, sell, lease, lend,
> convey, distribute, publicly display, or sublicense to any third party;

[developers.google.com/terms, Section 5, e. Prohibitions on Content]

> Some of our Services allow you to generate original content. Google won't claim
> ownership over that content.

[aistudio.google.com/docs/terms, Use of Generated Content]

### Plain reading (Q1)

- **Reselling raw API access is forbidden.** That means a general `generateContent`
  endpoint that third parties can point arbitrary prompts at, with Lang Weave keeping a
  margin. Section 4(a) covers exactly an API Client that "functions substantially the
  same as the APIs" and is offered to third parties.
- **An application that calls the API for its own end users is the use the terms
  describe.** This is the "API Client" model ("enhance your websites and applications";
  "make API Clients available to users"). Holding the key on a server is what Google's
  key docs recommend. Charging end users for the application is not addressed anywhere I
  found. **[inference]** It is permitted as long as what users buy is Lang Weave's
  feature, not model access.
- **The live risk for the current spec is the shape of the proxy.** `docs/specs/managed-key.md`
  §6.2 chooses a "validated pass-through" in which the client sends free-text
  `systemInstruction` and `contents`. Schema pinning, a model allowlist and size caps help.
  **[inference]** Even so, an endpoint that runs any client-supplied system prompt under a
  fixed schema is closer to "functions substantially the same as the APIs" than an
  endpoint that takes Lang Weave's structured inputs (passage text, level, target
  language, vocabulary state) and builds the prompt on the server. I'd recommend the lead
  weigh server-side prompt assembly, or at least a server-pinned system prompt, for
  contractual reasons as well as abuse reasons.
- **Paid tier is mandatory for a managed key.** Readers' passages are browsing content.
  Unpaid quota allows human review and training, and it is forbidden for API Clients
  serving users in the EEA, UK or CH.
- **"Not for consumer use" is ambiguous** for a consumer extension. I read it as limiting
  who may *use AI Studio and the API directly* (developers), not who may use an API
  Client, because the same section contemplates "mak[ing] API Clients available to
  users". **[inference]**
- **The 18+ clause is a real product constraint.** A language-learning extension could be
  "likely to be accessed by individuals under the age of 18". The managed-key tier needs
  an 18+ attestation at sign-up and a store listing that does not target minors. The
  clause is not specific to the managed key, so it already applies to BYOK users'
  keys. **[inference]**
- **Rate-limit circumvention.** One project serves every reader, and caps are per project
  and per billing account ($250 per month on Tier 1, with a service-wide pause at the cap).
  Spreading readers over several projects to multiply quota would plausibly be
  "circumvent[ing]" limits. Ask Google for higher limits instead. **[inference]**
- **Section 5(e) of the API ToS** forbids end users "sell[ing]" or "distribut[ing]" content
  returned from the APIs. The Additional Terms then disclaim ownership of generated
  content. The two read awkwardly together for any app that shows output to users. The
  Additional Terms are the more specific text and I'd treat them as controlling.
  **[inference]**
- **No specific agreement is required** by any clause I found for an API Client that
  serves its own users. Raising limits above the tier caps does need "Google's express
  consent", which in practice means the tier-increase forms.

Confidence: **medium**. The clauses are quoted exactly. The permitted/forbidden line
between an "API Client" and a sublicense is my reading, and it depends on the proxy
design.

---

## Q2. Vertex AI / Google Cloud (Gemini Enterprise Agent Platform)

Sources:
- Google Cloud Terms of Service: https://cloud.google.com/terms. The page shows
  "(Last modified November 18, 2026)".
- Service Specific Terms: https://cloud.google.com/terms/service-terms. The page shows
  "(Last modified November 24, 2026)".

> 1.1 Services Use. During the Term, Google will provide the
>  Services in accordance with this Agreement, including the SLAs, and Customer
>  may use the Services, and integrate the GCP Services and Looker (original)
>  Services into any Customer Application that has material value independent
>  of the Services, in accordance with this Agreement.

[cloud.google.com/terms, 1. Provision of the Services, 1.1]

> - "Customer Application" means a software program that Customer
>  creates or hosts using the GCP Services or Looker (original) Services,
>  as applicable.

> - "End Users" means the individuals who are permitted
>  by Customer to use the Services. For clarity, End
>  Users may include employees of Customer Affiliates and
>  other authorized third parties.

[cloud.google.com/terms, Definitions]

> 3.3 Restrictions. Customer will not, and
>  will not allow End Users to, [...] (c) sell, resell,
>  sublicense, transfer, or distribute any or all of the
>  Services; or (d) access or use the Services or any AI Agent [...] (iii) in a
>  manner intended to avoid incurring Fees (including
>  creating multiple Customer Applications, Accounts, or
>  Projects to simulate or act as a single Customer
>  Application, Account, or Project (respectively)) or to
>  circumvent Service-specific usage limits or quotas;

[cloud.google.com/terms, 3. Customer Obligations, 3.3 Restrictions]

> 3.1 Compliance. Customer will (a) ensure
>  that Customer and its End Users' use of the Services
>  complies with this Agreement, (b) use commercially
>  reasonable efforts to prevent and terminate any
>  unauthorized use of, or access to, the Services [...]

[cloud.google.com/terms, 3.1]

> d. Age Restrictions.
>  Customer will not, and will not allow End Users to, use a
>  Generative AI Service as part of a website, Customer
>  Application, or other online service that is directed
>  towards or is likely to be accessed by individuals under
>  the age of 18.

> h.
>  Handling of Prompts and Generated Output.
>  Absent Customer's prior permission or instruction, Google
>  will not store outside Customer's Account (i) Customer
>  Data prompted to a Generative AI Service for longer than
>  is reasonably necessary to create the Generated Output, or
>  (ii) the Generated Output.

> a.
>  Definition. "Generated Output" means the
>  data or content generated by a Generative AI Service
>  prompted by Customer Data. Generated Output is Customer
>  Data. As between Customer and Google, Google does not
>  assert any ownership rights in any new intellectual
>  property created in the Generated Output.

[cloud.google.com/terms/service-terms, 20. Generative AI Services (formerly Section 19), subsections a, d, h; last modified Nov 24 2026]

The Service Specific Terms also add Google indemnification for unmodified Generated
Output from "Generative AI Indemnified Services ... not provided to Customer free of
charge" (20.i). Section 14 "Resold Customers" covers customers who buy *through an
authorized Google Cloud reseller*. That is the formal reseller channel, and it does not
apply to Lang Weave.

**Pricing differences** (https://cloud.google.com/vertex-ai/generative-ai/pricing, now
titled "Agent Platform Pricing | Google Cloud", no page date). Rows are per 1M tokens,
≤200K context:
- Gemini 3.5 Flash-Lite: input "Global | $0.30", output "Text output (response and
  reasoning) | Global | $2.50". Non-global is $0.33 in and $2.75 out.
- Gemini 3.1 Flash-Lite: input "Global | $0.25", output $1.50.
- The banner says: "Gemini 3.8 Flash, Gemini 3.7 Flash, and CodeMender using these models
  are offered with introductory pricing of $0.75 / $3.75 per 1M tokens input / output
  through December 31, 2026. Starting January 1, 2027, standard pricing of $1.5 / $7.5 per
  1M tokens input / output will apply." Non-global from 2027 is $1.65 in and $8.25 out.
- On failed requests: "You're charged only for requests that return a 200 response code."

The global endpoint is priced the same as AI Studio. Regional endpoints cost 10% more.

### Plain reading (Q2)

Vertex gives the clearest express permission for this business. Section 1.1 permits
integrating the services "into any Customer Application that has material value
independent of the Services". Lang Weave has that value: the curriculum, validation,
scheduler and UI. Section 3.3(c) "sell, resell ... the Services" then draws the same line
as Q1: sell the application, not the model. Vertex has a **defined End User** concept,
an explicit no-retention-outside-account clause (20.h), output indemnity on paid use, and
no "not for consumer use" sentence. That makes Vertex **contractually cleaner than AI
Studio keys** for a consumer SaaS. Its costs are operational: a GCP billing account and
service-account auth (no simple key), and no free tier. The 18+ rule and the anti-quota-splitting clause (3.3(d)(iii)) apply to Vertex as well.

Confidence: **medium-high** on the reading that Vertex is cleaner. **High** that the
quotes are current.

---

## Q3. Current Gemini pricing (Developer API)

Source: https://ai.google.dev/gemini-api/docs/pricing, which redirects to
https://aistudio.google.com/docs/pricing (read via `.md`, fetched 2026-11-28). **The page
has no effective or last-updated date.** The terms say price changes take effect "30 days
after they are posted".

Models in the extension (`extension/src/gemini.js` at checkout HEAD 39b264a):
`MODELS = {'gemini-3.5-flash-lite', 'gemini-3.8-flash'}`,
`FALLBACK_MODEL = {'gemini-3.8-flash': 'gemini-3.5-flash-lite'}`, default
`gemini-3.5-flash-lite` (`settings.js:7`), `thinkingConfig: { thinkingLevel: 'low' }`.
No 3.1 or 2.5 ids appear in `extension/src`. They are listed below for comparison only.

Paid Tier, Standard, per 1M tokens USD (text):

| Model | Input | Output (incl. thinking) | Cache read | Batch in / out |
|---|---|---|---|---|
| gemini-3.5-flash-lite | $0.30 | $2.50 | $0.03 (+$1.00/1M tok/hr storage) | $0.15 / $1.25 |
| gemini-3.8-flash | $0.75 to Dec 31 2026, then $1.50 from Jan 1 2027 | $3.75, then $7.50 | $0.075, then $0.15 | $0.375 in (to Dec 31) |
| gemini-3.1-flash-lite | $0.25 | $1.50 | $0.025 | $0.125 in |
| gemini-2.5-flash-lite | $0.10 | $0.40 | $0.01 | $0.05 in |

Verbatim, gemini-3.5-flash-lite Standard tab:

> * Input price
> * Free of charge
> * $0.30 (text / image / video / audio)
> ---
> * Output price (including thinking tokens)
> * Free of charge
> * $2.50

Verbatim, gemini-3.8-flash Standard tab:

> * $0.75 through December 31, 2026.
>   $1.50 starting January 1, 2027.
> * Output price (including thinking tokens)
> * Free of charge
> * $3.75 through December 31, 2026.
>   $7.50 starting January 1, 2027.

Thinking tokens bill as output:

> When thinking is turned on, response pricing is the sum of output
> tokens and thinking tokens.

[https://aistudio.google.com/docs/thinking.md, "Pricing"]

Other tiers exist: **Flex** (3.5 Flash-Lite $0.15 / $1.25, no free tier), **Priority**
($0.54 / $4.50) and an invite-only "Contributor" tier. The paid card advertises "Batch
API (50% cost reduction)". Batch fits poorly with interactive swaps. **[inference]**

Free tier: every listed model shows "Free of charge" in the Free Tier column, with
"Used to improve our products: Yes". The rate-limits page gives **no numeric free-tier
RPM or RPD**. It says limits "can be viewed in Google AI Studio", so the numbers sit
behind login and were not checked.

What gets billed (billing.md, "Am I charged for failed, blocked, or canceled requests?"):

> | HTTP 4xx or 5xx error (request still counts against quota) | Not billed | Not billed |
> | HTTP 200 with `finishReason: SAFETY` | Billed (cached tokens use the cached rate) | Not billed (or only earlier streamed chunks) |

> Note: On HTTP 200 responses with unbilled input, the API can still populate `usageMetadata`, including `promptTokenCount`. The response does not include a field showing that input tokens had no charge.

The note matters for metering. **[inference]** If the proxy debits from `usageMetadata`
alone, it will over-charge readers on unbilled 200s, such as a blocked prompt or a
non-standard `finishReason`. Debit by finishReason class, as in the table.

Also verified: the 2.5 Flash-Lite price of $0.10 / $0.40, which `docs/research/market.md`
marked **[unverified]**, matches today's page.

Confidence: **high** for the listed prices as of today. **Low** for 3.8 Flash after
Jan 1 2027 (announced, not yet in effect).

---

## Q4. Measured per-request token counts in project records

**None exist.** Searches run:
- `grep -rl` for `promptTokenCount|candidatesTokenCount|thoughtsTokenCount|usageMetadata|totalTokenCount`
  over the checkout (md/py/json/js/txt/log, excluding node_modules, .git and bazel-*) and
  over the private lane records.
- a size-limited search of the private QA state directory (md/txt/json/log/jsonl, excluding `*profile*`
  paths) piped to the same grep.

The only hits are design text in `docs/specs/managed-key.md` (§E4, lines 56, 135–136,
188), which describes *future* reading of `usageMetadata`, and a lane note in
the private lane record saying the figures are estimates. The extension itself
never reads `usageMetadata` (no hits in `extension/src`). (Caution: in this environment
the `rg` binary is only a search-guard wrapper, so the first `rg` pass silently found
nothing. The searches above were redone with `grep`.)

**Measured request sizes (bytes, not tokens).**
The private QA record `prompt-headroom.md`, entry "2026-11-23 03:43 UTC",
from PR #63 (merged as 662d889 on main):

> Full request captures show Expanded median 8441 -> 3851 bytes (single) and 11924 -> 8099 (eight passages), maximum 13859 -> 10691 for nine full batches.

Under PR #63, a current Expanded-level single-passage request serializes to a median of
**about 3.9 KB**, eight-passage batches to **about 8.1 KB**, and the worst case to
**about 10.7 KB**. These are serialized JSON bodies including the schema. **[inference]**
At roughly 4 characters per token for English plus JSON, that is about 1,000, 2,000 and
2,700 input tokens. This is a conversion estimate, not a measurement.

**Calls per day.** There are no observations. `docs/research/market.md` line 121 guesses
"20 to 50 calls a day for a typical active reader **[estimate]**". The code caps calls at
`DAILY_MODEL_CALLS = 1000` per day (`extension/src/quota.js:4`). The per-request token
figures in market.md lines 104–119 (2,500 in / 600 out / 400 thinking) are **estimates**
derived from code. Note that the 2,500-token input estimate predates PR #63's reduction.

Confidence: **high** that no token measurements exist in these locations.

---

## Q5. Stripe

### 5a. Restricted Businesses: AI and resale

Source: https://stripe.com/legal/restricted-businesses. **"Last updated: 2026-09-22"**.

The page has no AI-specific category. The only AI mention is under adult content ("Any
artificial-intelligence generated content that meets the above criteria"). Two clauses
are relevant.

Under **Prohibited Businesses** > "Unfair, deceptive, or abusive acts or practices":

> - No-value-added services, including the sale or resale of a service without added benefit to the buyer and resale of government offerings without authorization or added value

> - Negative option marketing, negative option membership clubs, and reduced price trials with unclear or hidden pricing

Under **Restricted Businesses** (needs due diligence) > "Nonfiat currency and stored value":

> - Sale of stored value or credits maintained, accepted, and issued by anyone other than the seller. Seller-maintained stored value or credits may be subject to limits.

> Businesses in these categories require additional due diligence by Stripe in order to confirm our ability to support them. [...] Stripe might not be able to grant approval for your business to use our products.

**Reading:** AI SaaS is not restricted. Bare resale of model access "without added
benefit" is prohibited, which is the same line Google draws. Lang Weave's *own* prepaid
credits are "seller-maintained" credits. They are listed under Restricted with "may be
subject to limits", so expect questions and keep top-ups small and non-transferable.
**[inference]**

Confidence: **medium-high**.

### 5b. Usage-based billing vs prepaid credits

> Billing credits are prepaid or promotional usage credit allocated through credit grants. They aren't the customer invoice balance [...]

> **Prohibited uses**
> - You can't issue billing credits as gift cards or gift certificates. [...]
> - You can't offer billing credits as stored value to your customers. That means you can't grant any billing credits that aren't intended for spending on memberships, pay-as-you-go plans, subscriptions, or specific products or services that you offer.
> - You can't allow your customers to use billing credits for payments to third parties. [...]

> You can only apply credit grants to subscription items that use [metered] prices and report usage through [Meters].

[https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits, fetched 2026-11-28, no date]

> [Metronome] is Stripe's primary usage-based billing platform and the recommended starting point for all new integrations. Basic usage-based billing, built on the [Meters API], is a lower-level primitive that remains fully supported for existing integrations.
>
> Unless you're maintaining an existing Meters integration, use Metronome. This includes:
> [...]
> - Needing prepaid credits or credit burndown

[https://docs.stripe.com/billing/subscriptions/usage-based, fetched 2026-11-28]

> Accept one-time and subscription payments from more than 125 local payment methods.

[https://docs.stripe.com/payments/checkout, "Build a payments page"]

> Create a customer portal so your customers can manage their account, such as updating their billing information, payment methods, and subscription status.

[https://docs.stripe.com/customer-management]

**Reading:** Stripe's documented paths for credits are Billing credit grants, which
apply only to invoices on metered subscriptions, or Metronome. Both expect a subscription
or invoice cycle. **[inference]** For "buy $5 of credit and spend it down with a hard cap",
the simplest pattern is **Checkout in `payment` mode (one-time) plus the proxy's own
ledger, credited from the `checkout.session.completed` webhook**. That keeps Stripe out of
real-time metering, since Stripe meters are not a spend gate. The Customer Portal is
oriented to subscriptions and payment methods, and I found no portal feature for one-time
top-ups. Billing pricing (stripe.com/pricing) is "0.7% of Billing volume" pay-as-you-go,
which "Excludes one-off invoices". Plain Checkout one-time payments avoid that fee.
**[inference, from the excluded-items wording]**

Confidence: **medium**.

### 5c. Testing with no network

Webhook signature, verbatim from https://docs.stripe.com/webhooks ("Verify webhook
signatures manually"):

> The `signed_payload` string is created by concatenating:
> - The timestamp value (as a string)
> - The character `.`
> - The actual JSON payload (that is, the unmodified HTTP request body)

> Compute an HMAC with the SHA-256 hash function. Use an active endpoint signing secret as the key, and use the `signed_payload` string as the message.

> Use a constant-time string comparison to compare the expected signature to every `v1` signature in the header. If any signature matches, compute the difference between the current timestamp and the received timestamp, and reject the request if the difference is outside your tolerance.

> Our libraries have a default tolerance of 5 minutes [...] Don't use a tolerance value of `0`. Using a tolerance value of `0` disables the recency check entirely.

> To prevent [downgrade attacks], ignore signature schemes other than `v1`, and use only the `t` and `v1` entries for verification.
> [...] Your integration must accept unknown entries and must not depend on a fixed entry count or order.

The header format is `t=<unix>,v1=<hex>[,v1=...][,v0=...][,secret=...,destination=...,payload=...]`.
`v0` appears only on sandbox events and must be ignored.

SDK helpers, read from the source on GitHub master on 2026-11-28:
`stripe-node/src/Webhooks.ts` exports `generateTestHeaderString(opts)` and
`generateTestHeaderStringAsync`, with `DEFAULT_TOLERANCE: 300, // 5 minutes`.
`stripe-python/stripe/_webhook.py` has `WebhookSignature.generate_signature_header(...)`,
`verify_header(...)` and `DEFAULT_TOLERANCE = 300`. A test can therefore build a valid
header from a fake `whsec_` secret entirely offline.

stripe-mock (https://github.com/stripe/stripe-mock README):

> stripe-mock is a mock HTTP server based on the real Stripe API. [...] stripe-mock **does not attempt to reproduce the _behavior_ of the real Stripe API
> at all**. [...] its responses are completely
> hardcoded.

> - stripe-mock is stateless.

Test clocks ("Test your Billing integration", https://docs.stripe.com/billing/testing):
"Use test clocks to advance simulated time in a sandbox". They run **in a Stripe sandbox,
so they need the network**. They are not suitable for hermetic tests.

Test cards (https://docs.stripe.com/testing):

> | Visa | 4242424242424242 | Any 3 digits | Any future date |
> | Generic decline | 4000000000000002 | [card_declined] | [generic_decline] |
> | Insufficient funds decline | 4000000000009995 | [card_declined] | [insufficient_funds] |

**Reading:** For hermetic tests, construct `Stripe-Signature` headers with the documented
HMAC (or the SDK helper) and replay recorded event JSON fixtures into the webhook
handler. stripe-mock is useful only to check request shape. Test clocks and test cards
are for a manual sandbox pass, not for the local gate.

Confidence: **high**.

### 5d. US card fees

Source: https://stripe.com/pricing, fetched 2026-11-28 (no date):

> Cards and wallets [...] 2.9% + 30¢
> per successful transaction for domestic cards
> + 0.5% for manually entered cards
> + 1.5% for international cards
> + 1% if currency conversion is required

Disputes: "Dispute received fee $15.00 for each dispute you receive." Stripe Tax: "0.5%
per transaction, where you're registered to collect taxes" (no-code).

**Reading:** The 30¢ fixed fee dominates small top-ups. On a $5 top-up the fee is $0.445
(8.9%), and on $10 it is $0.59 (5.9%). Set a minimum top-up of about $10 or more.
**[inference]**

Confidence: **high**.

### 5e. Account activation (summary)

https://docs.stripe.com/get-started/account/set-up (the `/activate` URL redirects here):

> Verify your business in the Dashboard. Provide information about your business, product, and relationship to the business.

> Our "Know Your Customer" (KYC) obligations require us to collect and maintain this information for all users.

> If you accept payments, your customers see the following details on either their card statements or in [email receipts] sent by Stripe.
> - Business name and website URL
> - Support email address, phone number, and address
> - Support site URL
> - Statement descriptor text

https://docs.stripe.com/get-started/checklist/website:

> - Refund policy: Describe the conditions under which customers can receive a refund.
> [...]
> - Cancellation policy: Describe the conditions under which customers can cancel subscriptions or reservations.

The same checklist also asks for a description of what is sold, the purchase currency,
customer-service contact, a privacy policy, a business address ("If you have a physical
address, listing it on your website adds credibility") and promotion terms.

**Reading:** Activation needs legal identity (KYC for an individual or a business), a
public website describing the product, support contact details including an address and
phone shown to customers, a statement descriptor, a refund policy and a privacy policy.

Confidence: **medium-high**. The support-article 404 means I could not see Stripe's full
field list.

---

## Q6. Chrome Web Store policy

Source: https://developer.chrome.com/docs/webstore/program-policies/policies.
**"Last updated 2025-05-22 UTC"**.

### Payments

> ### Accepting Payment From Users
> If you collect sensitive personal information through your Product for sales, you must follow these requirements:
> - You must securely collect, store, and transmit all credit card and other sensitive personal information in accordance with privacy and data security laws and payment card industry rules.
> - You must avoid misleading users. For example, clearly and honestly describe the products or services that you are selling and conspicuously post your terms of sale (including any refund and return policies).
> - If your Product requires the user to pay to obtain basic functionality, you must make that clear in the description that the user sees when choosing whether to install it.
> - You must clearly identify that you, not Google, are the seller of the products or services.
> - Regardless of the method of payment, you may not process payment transactions that are prohibited for Google Checkout under the Google Checkout Seller Terms of Service. [...]

[policies, "Ensuring Responsible Marketing and Monetization" > "Accepting Payment From Users"]

### Deceptive installation / misleading behaviour

> Extensions must be marketed responsibly. The set of functionalities promised by the extension must be stated clearly and in a transparent manner. The outcome of any user interaction should match the reasonable expectations that were set with the user. [...]
> - Requiring unrelated user action to access advertised functionality.

> Don't misrepresent the functionality of your product or include non-obvious functionality that doesn't serve the primary purpose of the product.

### Physical address

> Physical address (Required in some circumstances)
>
> Only items that offer functionality to purchase items, additional features, or subscriptions must include a physical address.

[https://developer.chrome.com/docs/webstore/set-up-account, "Last updated 2023-10-16 UTC"]

### EU trader status

> On February 17, 2024, the European Union began requiring online marketplaces to identify and verify
> the information of traders operating on their platforms. Pursuant to these changes, Chrome Web
> Store will collect and maintain information about traders on its platform, such as their legal name,
> contact details, and possibly other relevant identification documents. The verified information of
> traders is available to users of the Chrome Web Store.

> Trader
> Any natural person or any legal person, who is acting for purposes relating to his trade,
> business, craft or profession in relation to contracts on this marketplace.

[https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure, "Last updated 2024-02-09 UTC"]

The page cites the EU "New Deal for Consumers" and the Feb 2024 trader-verification
rules. It does not name the DSA. **[inference]** The Feb 17 2024 date matches the DSA's
general application date.

### MV3 remote code vs a JSON proxy

> the full functionality of an extension must be easily discernible from its submitted code [...] The extension may reference and load data and other information sources that are external to the extension, but these external resources must not contain any logic.
> [...]
> - Building an interpreter to run complex commands fetched from a remote source, even if those commands are fetched as data
> [...]
> Communicating with remote servers for certain purposes is still allowed. For instance:
> - Syncing user account data with a remote server
> [...]
> - Performing server-side operations with data (such as for the purposes of encryption with a private key)

[policies, "Technical Requirements" > "Additional Requirements for Manifest V3"]

> Remotely hosted code, or RHC, is what the Chrome Web Store calls anything that
> is executed by the browser that is loaded from someplace other than the
> extension's own files. Things like JavaScript and WASM. It does not include
> data or things like JSON or CSS.

[https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code, "Last updated 2023-12-13 UTC"]

### Limited Use (passage text sent to a Lang Weave server)

> - Extensions may only collect, use, or transmit user data that is necessary for the extension's disclosed single purpose [...]
> - Collection and use of web browsing activity is prohibited, except to the extent required for a user-facing feature described prominently in the Product's Chrome Web Store page and in the Product's user interface.
> [...]
> Only transfer user data to third parties
> If necessary to providing or improving your single purpose; [...]
> Do not allow humans to read user data, unless: [...]

[policies, "Protecting User Privacy" > "Limited Use"]

### Plain reading (Q6)

- No clause I found forbids opening an external Stripe Checkout page. The payment policy
  is method-agnostic ("Regardless of the method of payment"), and no in-store payment
  mechanism is documented on the fetched pages. **[inference]** A tab to
  `checkout.stripe.com` is permitted, provided that the extension:
  1. states that Lang Weave, not Google, is the seller;
  2. posts terms of sale and refunds conspicuously;
  3. keeps BYOK free, so the description need not say "requires payment for basic
     functionality" (that disclosure is required only if basic use needs payment);
  4. adds a **physical address** to the developer account;
  5. declares **trader** status, which publishes legal name and contact to EU users.
- A proxy returning swap JSON is **data, not RHC**, and is fine under MV3. This holds as
  long as the client never treats server output as instructions to execute. The existing
  `validateSwaps` path already fits.
- Sending passage text to Lang Weave's server instead of Google's is a **new data
  recipient**. It needs updates to the privacy policy, the CWS data-use disclosures and
  the UI text. "Do not allow humans to read user data" constrains proxy logging. The
  managed-key spec's "never logged" posture fits.

Confidence: **medium-high**. The policy pages are old but current. The external-Checkout
permission is inferred from silence plus the method-agnostic wording.

---

## Q7. Alternatives

### OpenRouter (OAuth PKCE: readers fund their own credits)

Source: https://openrouter.ai/terms. **"Last Updated: August 31, 2026"**.

> access the Site or Service for purposes of reselling API access to Models or otherwise developing a competing service;

[terms, 7. Prohibited Conduct]

> You acknowledge that the Service enables you, your Authorized Users, and your customers (to the extent you incorporate the Service into your own products and services) access to Models provided by Model Providers. By accessing or using any Model through the Service, you agree, and will ensure that your Authorized Users and customers agree, to comply with the applicable terms for each Model ("Model Terms") [...]

[terms, 5.1 Applicability and Acceptance]

> You must be at least 18 years of age to use the Service.

[terms, 2. Eligibility]

> [...] with a minimum and maximum purchase amount of $5 and $25,000 per transaction, respectively. Once purchased, refunds for unused Credits may be requested within twenty-four (24) hours [...] If no refund request is received within twenty-four (24) hours following the purchase, any unused Credits become non-refundable.

[terms, 4.1 Pre-Paid Credits; Refunds]

> Let users bring their own OpenRouter API key and pay for their own inference
> [...] Each user signs in to OpenRouter and authorizes your app, and your app receives an API key tied to their account. Their requests are billed to their own OpenRouter credits, so you don't pay for their inference or manage keys on their behalf.

> Prefills the credit limit of the new API key, in US dollars. [...] The user can still change the limit.

[https://openrouter.ai/docs/guides/overview/auth/oauth (OAuth PKCE), fetched 2026-11-28]

Public model list (`GET https://openrouter.ai/api/v1/models`, no key, 2026-11-28): there
are `google/gemini-3.5-flash-lite` (prompt $0.0000003/token, completion $0.0000025,
internal_reasoning $0.0000025, matching Google list) and `google/gemini-3.8-flash`
($0.000000825 / $0.000004125, which matches Vertex *non-global*, above AI Studio).

**Reading:** OpenRouter, too, forbids "reselling API access to Models" but explicitly
contemplates "your customers" through your product, with Gemini's Model Terms flowing
down. **OAuth PKCE removes Lang Weave from the money path entirely**: no Stripe, no
ledger, no stored value, no Google resale question. Each reader holds their own key with
a per-key credit limit. It remains a BYOK variant (readers need an OpenRouter account
and an 18+ attestation), but it replaces "get a Gemini key and enable billing" with a
one-click OAuth and card top-up. It adds a provider hop and OpenRouter's purchase fees
(the terms mention "payment processing fees and transaction fees". The fee percentage
was not checked). The extension would need a second provider client for OpenAI-style
chat completions with JSON schema. **[inference]**

Confidence: **medium**.

### Chrome built-in Prompt API (Gemini Nano)

Source: https://developer.chrome.com/docs/ai/prompt-api. "Published: May 20, 2025, Last
updated: October 21, 2026". The status table lists Extensions as Chrome 138 and Web as
Chrome 148.

> - Operating system: Windows 10 or 11; macOS 13+ (Ventura and onwards);
>  Linux; or ChromeOS (from Platform 16389.0.0 and onwards) on
>  Chromebook Plus devices.
> - Storage: At least 22 GB of free space on the volume that contains your
>  Chrome profile.
> - GPU: Strictly more than 4 GB of VRAM.
> - CPU: 16 GB of RAM or more and 4 CPU cores or more.

> The network requirement is only for the initial download of the
> model. Subsequent use of the model does not require a network connection. No data is sent to
> Google or any third party when using the model.

> languages: Array to set the language or languages expected. The Prompt API
> accepts "en", "ja", "es", "de", and "fr". Support for additional
> languages is in development.

**Reading:** The Prompt API involves no key, no cost, no resale and no data leaving the
device. Spanish (`es`) is supported, so it could be a local tier for the Spanish path.
The costs are hardware gating (22 GB free, >4 GB VRAM or 16 GB RAM) and no Guaraní.
Swap quality from Nano versus 3.5 Flash-Lite is unmeasured, and `tests/model_eval.py`
would need a Nano runner to compare. **[inference]** It works as a free fallback or
default, not a replacement for the hosted tier.

Confidence: **medium**.

---

## What resale needs

**Bottom line.**
1. **No clause I found requires a specific written agreement with Google** to run a
   paid Lang Weave service whose server holds a Gemini or Vertex credential and serves
   Lang Weave's own readers. Both contracts permit this as an "API Client" or
   "Customer Application". Both forbid reselling the model itself: API ToS §4(a)
   "functions substantially the same as the APIs"; GCP ToS §3.3(c) "sell, resell,
   sublicense ... the Services". Going above the tier spend caps ($250, $2,000, then
   $20k+ per month) needs Google's consent through the published increase forms, not a
   contract.
2. **The proxy's shape decides which side of the line Lang Weave is on.** An endpoint
   that accepts a client-supplied free-text system prompt is the weak point in the
   current spec (§6.2). A server-built or server-pinned prompt that takes only Lang
   Weave's structured inputs makes the "application, not resale" reading easy to defend.
   **[inference]**
3. **Cleanest route, ranked** **[inference]**:
   - **(a) OpenRouter OAuth PKCE** is cleanest contractually *and* financially, because
     Lang Weave never holds money or a provider key. It is not "managed" in the sense the
     owner described.
   - **(b) Vertex / Gemini Enterprise Agent Platform** is cleanest for a true managed key.
     It has the express "material value independent of the Services" permission, defined
     End Users, no "not for consumer use" sentence, no out-of-account retention, and paid
     output indemnity. Global-endpoint prices equal AI Studio's.
   - **(c) AI Studio paid key** is workable. Its weaker points are the "not for consumer
     use" sentence, prepaid-plan and tier caps that pause service account-wide, and an
     experimental project cap with about 10 minutes of overage latency.
4. On every route: paid tier only, an 18+ gate, **one project with honest quota
   requests** (no splitting across projects), and Stripe one-time Checkout plus your own
   ledger with small non-transferable credits. On the store side: a CWS physical
   address, trader declaration, seller identity and refund terms, and updated
   data-use disclosures for the new server.

**Open questions only a lawyer or Google could answer**
1. Does a fixed-schema endpoint that runs a client-supplied system prompt "function
   substantially the same as the APIs" under API ToS §4(a)? What about a server-pinned
   prompt?
2. Does "not for consumer use" (Gemini Additional Terms) restrict the *end users* of an
   API Client, or only the developer's direct use? Would Google treat a consumer
   subscription app on AI Studio keys as compliant?
3. Is a language-learning extension "likely to be accessed by individuals under the age
   of 18"? Is an 18+ attestation at sign-up enough to satisfy that clause on both AI
   Studio and Vertex?
4. Are Lang Weave's prepaid credits "stored value" under state money-transmitter or EU
   e-money rules? What refund and expiry terms are required (US state gift-card and
   unclaimed-property laws, EU 14-day withdrawal for digital services)?
5. Given API ToS §5(e)'s ban on selling or distributing "content returned from the
   APIs", is showing paid users swapped words built from model output covered by the
   Additional Terms' generated-content clause? Does the Vertex Generated-Output-is-Customer-Data
   clause settle it there?
6. Will Google grant Tier-3 or above caps, or a custom quota, to a sole proprietor running
   a consumer service, and on what terms? Does exceeding them ever require an enterprise
   agreement?
7. Does trader status on CWS, plus selling to EU consumers, trigger VAT OSS registration
   from the first sale? Does Stripe Tax cover it?
8. If OpenRouter is used, do Google's Gemini Model Terms as flowed down by OpenRouter carry
   the same "API Client" permissions, or OpenRouter's narrower "reselling API access"
   ban?

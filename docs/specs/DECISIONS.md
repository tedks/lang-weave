# Decisions for Ted: Chrome Web Store and the managed key

Prepared 2026-11-28 by the LW-STORE lane. Nothing below has been done. The hold in the mission
record stands until you lift it per decision: no account, spend, submission, publication, merge
or outreach.

Each decision gives a recommendation, the exact steps after a yes, and who can do each step.
"Agent" means a browser-driving agent (Claude in Chrome) working in your logged-in browser while
you watch. "You" means a step only you can take: identity checks, 2-Step Verification, payment,
accepting legal terms, and anything published under your name.

The one-line version: **list the free BYOK extension first (D1–D5), and do not build the managed
key until the evidence in D6 exists.** There are no known outside users today.

---

## D1. Chrome Web Store developer account and fee

**Recommendation: yes, when you want the free listing.** Use a Google account you control, with
2-Step Verification on (the store requires it to publish). The fee is a one-time registration fee
shown on the registration page. Its amount was **not verified tonight** (the official page does
not state it).

After yes:
1. You: sign in at <https://chrome.google.com/webstore/devconsole>, accept the developer agreement,
   pay the fee, and confirm 2-Step Verification.
2. Agent: fill the account tab (publisher display name from D2, contact email from D2), then
   start the email verification. You click the link.
3. Agent: create the item by uploading the 0.16.x Store ZIP **as a draft, without submitting**,
   so the dashboard shows the item's public key. A lead then checks the store's item ID against
   the manifest `key` (ID `lkbkmlgogcpcacjmdmoecgacdbfddbnh`). If they differ, stop: a different ID
   strands existing readers' progress (AGENTS.md). Bring it back as a ruling.

## D2. Publisher identity, contact and trader status

**Recommendation:** publisher display name **"Lang Weave"**; a dedicated contact address (an alias
that forwards to you, not your personal address); **non-trader** for a free listing. The store asks
for a physical address only for items that sell something, and EU trader status publishes your
legal name and contact details to EU users. Both become required the day a paid option ships
(D7), so choose now whether you would publish a home address, a PO box or a virtual mailbox then.

After yes:
1. You: create the alias and decide the address question.
2. Agent: enter the name, email and trader declaration in the dashboard. You confirm the
   declaration, which is a legal statement.

## D3. Launch scope: visibility, regions, age and site consent

Open rulings `store-provider-region-ruling` and `store-site-consent-ruling` are still open in ditz.

**Recommendation:**
- **Visibility: unlisted** first. Anyone with the link can install; it is not in search. Same
  review as public. Move to public after a few weeks without problems.
- **Regions: United States only** at first. Free Gemini keys are "Unpaid Services", and the Gemini
  terms say: "You may use only Paid Services when making API Clients available to users in the
  European Economic Area, Switzerland, or the United Kingdom." A BYOK extension cannot tell a free
  key from a paid one, so the conservative reading excludes those regions.
- **Age:** the listing and first-run page say "for adults 18 and over", because the Gemini terms
  bar API clients "likely to be accessed by individuals under the age of 18".
- **Site consent:** keep 0.16.x as shipped: the welcome page asks which sites before anything is
  sent.

After yes: an agent fills the distribution tab (unlisted, US) and the listing from
`docs/STORE-SUBMISSION-PACKET.md` (draft PR #33). You read it before anything is submitted.

## D4. Privacy policy and its URL

**Recommendation: approve the refreshed policy text** in draft PR #33 and tedks/website#53, and host
it on your website.

After yes:
1. You: read both drafts and either edit them or say "approved".
2. A lead marks website#53 ready and you merge it (merging to master deploys the site). The lead
   checks the live URL returns the page.
3. The agent pastes that URL into the dashboard privacy tab.

## D5. Submit for review

**Recommendation: submit with deferred publishing** so an approval does not go live until you press
publish.

After yes:
1. A lead builds the Store ZIP from the exact release tag, checks its digest against the release
   record, and runs the release gates.
2. Agent: upload the ZIP, complete the privacy tab (permission justifications, data-use answers and
   certifications from the packet), and set deferred publishing.
3. You: press **Submit for review**. You are certifying the data-use answers.
4. After approval, you press **Publish**, or you leave it (approval holds for 30 days).

---

## D6. Is the managed key worth building?

**Recommendation: not yet.** Build nothing live until **both** of these are true:
- the free listing shows **at least 200 weekly users for four weeks in a row** (the dashboard
  shows this, so no telemetry is needed); and
- **at least 20 readers** take an explicit "I'd rather pay than get a key" step (a link on the key
  page to a GitHub discussion, counted by hand), or readers tell us they give up at the key step.

The question behind this: **is the goal revenue, or is it removing the key step?** If it is the key
step, OpenRouter's sign-in flow (spec 10.2) lets each reader fund their own key with a spending limit
they set. Lang Weave then holds no money and no provider key, and needs no Stripe account, address or
trader status. That is less work and less risk than the managed key, and it earns nothing.

After "build it anyway": the tracer drafts (default-off flag, stub provider, Stripe test fixtures)
can be finished and councilled with no account. The live steps are D7–D10.

## D7. Provider route

**Recommendation: Vertex AI (Gemini Enterprise Agent Platform), global endpoint**, one project, 3.5
Flash-Lite only. The Google Cloud terms expressly allow a "Customer Application that has material
value independent of the Services". The AI Studio terms say "not for consumer use" and pause the
whole billing account at the tier cap ($250 a month at first). Global-endpoint prices match AI
Studio's. No separate agreement with Google is required by any published clause we found. Raising
quota later goes through Google's increase forms.

After yes:
1. You: create or choose a Google Cloud billing account (card, identity) and a project
   `lang-weave-managed`.
2. Agent: enable the API, create a service account with only the model-invocation role, set a
   budget alert at $20 a month, and turn on the project spend cap if offered. Budget alerts
   warn; they do not stop spend. The proxy's own daily ceiling does.
3. You: create the service-account key and paste it into the host's secret store yourself
   (D9). No agent or chat transcript should ever see it.

## D8. Stripe

**Recommendation: one Stripe account, as an individual or sole proprietor, US cards only, one $10
Payment Link.** Stripe lists "Seller-maintained stored value or credits" as restricted ("may be
subject to limits"), so expect questions. Credits stay small, never expire, cannot be transferred,
and are refundable on request.

After yes:
1. You: open the account and complete identity verification (legal name, address, tax ID, bank
   account). Choose a statement descriptor such as `LANGWEAVE`.
2. Agent: create the product "Lang Weave reading credit, $10", a Payment Link limited to US
   billing addresses, a link to the terms-of-sale and refund page, and a webhook endpoint for
   `checkout.session.completed` on the proxy URL.
3. You: copy the webhook signing secret into the host's secret store.
4. A lead writes the terms-of-sale and refund page (draft PR) for you to approve.

## D9. Host and domain

**Recommendation:** one small serverless host with a transactional SQL store, on a subdomain you
already own (for example `api.` on your existing domain), so no new domain is needed. Current host
prices were **not checked tonight**; a lead checks before you choose.

After yes: you create the host account and add the two secrets; an agent creates the database and the
DNS record; a lead deploys from a reviewed commit and runs the stub-provider tests against the
deployment with the ceiling at $2 a day.

## D10. Price and first sale

**Recommendation: $10 for $10 of reading at a 2× markup over provider cost** (about 1,600 typical
calls, two to three months for a typical reader; margin about $4.41 after Stripe's fee, before
hosting, disputes and tax). US only. The first sale is to one consenting adult tester on the GitHub
beta build with the flag on, before any store listing change.

After yes: a lead turns on the flag in that one build, the tester buys one pack, and the lead checks
the ledger, the Stripe dashboard and the provider bill agree within a cent. Then the store listing and
privacy policy are revised (new data recipient, seller identity, refund terms, physical address,
trader status) and resubmitted. That resubmission is its own decision.

## D11. One measurement (small, worth doing first)

**Recommendation: yes.** Every cost figure tonight is an estimate: nobody has measured tokens per
call or calls per day. Authorize one week of your own reading with your own paid key while the
extension records `usageMetadata` counts locally (counts only, no text). Expected cost: a few
dollars. This replaces the guesses in the margin table before any price is set.

After yes: a lead adds a local-only counter behind a developer setting (draft PR, councilled), you
install it on one machine, and after a week you export the counts.

---

## What an agent cannot do for you

Identity verification (Google, Stripe, cloud billing); 2-Step Verification; paying the store fee or
entering a card; accepting the developer agreement, Stripe terms or cloud terms; the trader declaration;
the data-use certifications; pressing Submit or Publish; handling any secret (service-account key,
webhook secret). Everything else above can be prepared by a lead or filled in by an agent with you
watching.

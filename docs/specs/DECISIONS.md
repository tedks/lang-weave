# Decisions for Ted: Chrome Web Store and the managed key

Prepared 2026-11-28 by the LW-STORE lane. Nothing below has been done. The hold in the mission
record stands until you lift it per decision: no account, spend, submission, publication, merge
or outreach.

Each decision gives a recommendation, the exact steps after a yes, and who can do each step.
"Agent" means a browser-driving agent (Claude in Chrome) working in your logged-in browser while
you watch. "You" means a step only you can take: identity checks, 2-Step Verification, payment,
accepting legal terms, and anything published under your name.

The one-line version: **list the BYOK extension first (D1–D5, with D3a deciding whether the Store
build requires a billed key), and do not build the managed key until the evidence in D6 exists.** There are no known outside users today.

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
3. Agent: create the item by uploading the Store ZIP **as a draft, without submitting**. Which ZIP
   is itself a choice, because the two possible uploads answer different questions:
   - **Key stripped** (the package the store-manifest-key-delta work produces): the upload
     establishes the Store item's ID. It cannot tell you whether the Store would have honoured
     Lang Weave's own key. Expect the ID to differ from the unpacked one
     (`lkbkmlgogcpcacjmdmoecgacdbfddbnh`).
   - **Key kept**: the upload tells you whether the Store accepts or rejects a supplied key, which
     is ditz `store-first-upload-key`. It may simply be refused.
   **Recommendation: key stripped**, and treat the Store item as a new ID. AGENTS.md says the
   manifest `key` may be removed from a package "only with a CEO ruling"; **your yes to this step
   is that ruling**, for the Store package only (the unpacked GitHub build keeps its key and ID).
   Adopting a new Store ID is a decision in its own right, made here before any reader is asked
   to move: existing beta readers then move their learning progress with the backup export and
   import that 0.16.x already has, never a silent migration. A managed-key balance does not move
   that way (the token is excluded from backups on purpose); if D6 ever says yes, a balance moves
   with the ledger's `transfer` (spec C2). The Store ID also goes into the managed proxy's CORS
   list.
   The key-kept upload is **not** part of this procedure. It is an exception only you can choose,
   to answer `store-first-upload-key` directly; D3 otherwise requires the key stripped before any
   upload.

## D2. Publisher identity, contact and trader status

**Recommendation:** publisher display name **"Lang Weave"** and a dedicated contact address (an
alias that forwards to you, not your personal address).

**Trader status is your ruling, not a dashboard formality.** EU trader status turns on whether you
act for purposes of your trade or business, not only on whether the item is free. If the free
listing is a hobby release with no commercial intent, "non-trader" is defensible; if it is the
first step of a paid product (which D6–D10 describe), "trader" is the safer declaration. Trader
status publishes your legal name and contact details to EU users. The store also requires a
physical address once an item sells anything. Decide now whether you would publish a home
address, a PO box or a virtual mailbox. If you want certainty, this is a question for a lawyer.

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
  key from a paid one, so the conservative reading excludes those regions. This is a
  **best-effort** control: store distribution decides where the listing appears, not where a
  reader travels or uses the API. A defensible basis also needs the listing and first-run page to
  say who the extension is for. If you want the terms' meaning settled, ask Google or a lawyer.
- **Age:** the listing and first-run page say "for adults 18 and over", because the Gemini terms
  bar API clients "likely to be accessed by individuals under the age of 18".
- **Site consent:** keep 0.16.x's design (the welcome page asks which sites before anything is
  sent), but **approve one wording change before submission**: the Store user-data FAQ asks for "a
  specific action clearly agreeing to the disclosure", and the 0.16.1 welcome buttons choose a site
  policy without saying "agree". This is the packet's top rejection risk (R1). It needs a small code
  change and a 0.16.2 release, which a lead can prepare as a draft PR.
- **Store package deltas:** before any upload the Store ZIP must drop the development manifest
  `key` (the only exception is a key-kept test you choose under D1, which still applies every
  other delta below) and the dead content loader, and the Duolingo Score field needs a "not affiliated with
  Duolingo" line (ditz `store-manifest-key-delta`, `store-first-upload-key`; packet R2, R11).

After yes: an agent fills the distribution tab (unlisted, US) and the listing from
`docs/STORE-SUBMISSION-PACKET.md` (draft PR #33). You read it before anything is submitted.

## D3a. Free Gemini keys and the store's Limited Use rule

**The problem, found by the council on PR #33.** The Chrome Web Store's Limited Use policy allows
a transfer of user data only when it is necessary for the extension's single purpose, and it bars
humans from reading user data outside narrow exceptions. With a **free** Gemini key, Google's terms
say it uses the page text "to provide, improve, and develop Google products" and that "human
reviewers may read" it. A reviewer who reads the listing and the welcome page will see both.
Nothing in the packet settles this, so the Limited Use statement and the three dashboard
certifications are on hold.

**Options:**
1. **The Store build requires a billing attestation.** Google's paid tier does not use the text to
   improve its products, though it keeps limited logs for abuse and legal purposes. The extension
   cannot verify a key's billing status, so the build can only *require the reader to confirm*
   that billing is on, and show the disclosure. One partial signal exists: a free-tier key's daily
   quota error names a `..._freetier` quota dimension (`extension/src/quota-status.js`), so the
   extension can stop reading and re-prompt when it sees one. An attestation does not establish
   which terms Google applies to a request, so **the Limited Use certifications stay on hold even
   under option 1** until the packet (a) names the policy exception that covers the paid tier's
   abuse review and (b) establishes a basis that covers free-key requests that succeed without ever
   tripping the quota signal, since a false or mistaken attestation still sends page text under the
   free terms. If either cannot be established, the hold stays and the fallback is GitHub-only distribution
   (option 3); D6 then stays on hold unless you separately choose to replace its Store-usage
   condition. This option
   also means basic use requires paying Google, which the Store policy says the description must
   state; the listing changes, and D3's US-only rationale (which rests on not being able to tell
   keys apart, still true under an attestation) is revisited. That is a code change and a release.
2. **Accept the risk with disclosure**, as the packet does today. Possible rejection, and a policy
   statement that may not be true for free-key readers.
3. **Do not list for now; keep GitHub distribution.** This is not a route to the managed key on
   its own: D6 waits for Store usage, so under option 3 D6 stays on hold. Replacing its first
   condition with another signal (GitHub beta readers plus the "I'd rather pay" link, which
   needs a public page) is a separate choice you can make or not.
   Even a later Store build that offers managed reading still has to settle free-key BYOK by
   option 1, by removing BYOK from the Store build, or by accepting option 2.

**Recommendation: option 1** if you want to submit soon, knowing the certifications still need
both conditions (a) and (b) above before signing. If you would rather wait, option 3.
Not option 2.

After a yes to 1: a lead drafts the key-step change (an explicit "my key has billing on"
attestation, the free-tier quota re-prompt, disclosure text, refusal wording) and councils it. The
packet then quotes the Limited Use exception relied on, adds the paid-functionality line to the
description, shows the basis covering undetected free-key requests, and is re-councilled before
any certification is signed. Ditz
`store-provider-region-ruling` records the ruling and revisits the region basis.

After a yes to 3: nothing further is needed. Only if you also choose to replace D6's Store-usage
condition, say with what; a lead then amends D6 and evidence item 1 in `managed-key.md` section 9
to match.

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
   certifications from the packet, only after D3a's hold is cleared), and set deferred publishing.
3. You: press **Submit for review**. You are certifying the data-use answers.
4. After approval, you press **Publish**, or you leave it (approval holds for 30 days).

---

## D6. Is the managed key worth building?

**Recommendation: not yet.** Build nothing live until **both** of these are true:
- the free listing shows **at least 200 weekly users for four weeks in a row** (the dashboard
  shows this, so no telemetry is needed); and
- **at least 20 distinct readers** take an explicit "I'd rather pay than get a key" step (a link on
  the key page to a GitHub discussion, counted by hand). Reports of giving up at the key step are
  supporting evidence, not a substitute (there is no denominator without telemetry). This is the
  same gate as spec section 9.

If you choose D3a option 3 (no listing), this gate stays on hold until you separately approve a
replacement for the first condition.

The question behind this: **is the goal revenue, or is it removing the key step?** If it is the key
step, OpenRouter's sign-in flow (spec 10.2) lets each reader fund their own key with a spending limit
they set. Lang Weave then holds no money and no provider key, and needs no Stripe account or
seller address (trader status still follows D2's test). That is less work and less risk than the managed key, and it earns nothing.

After "build it anyway": the tracer drafts (default-off flag, stub provider, Stripe test fixtures)
can be finished and councilled with no account. The live steps are D7–D10.

## D7. Provider route

**Recommendation: Vertex AI (Gemini Enterprise Agent Platform), global endpoint**, one project, 3.5
Flash-Lite only. The Google Cloud terms expressly allow a "Customer Application that has material
value independent of the Services". The AI Studio terms say "not for consumer use" and pause the
whole billing account at the tier cap ($250 a month at first). Global-endpoint prices match AI
Studio's. No separate agreement with Google is required by any published clause we found. Raising
quota later goes through Google's increase forms. That is our reading of the quoted clauses, not
Google's confirmation. Output rights stay open, separately per route: on AI Studio the APIs Terms
bar selling or distributing "content returned from the APIs" (5(e)), and nobody has checked how
that applies to showing paying readers swaps built from model output; on Vertex the Cloud terms
govern, and whether 5(e) applies there at all is not established by the quoted text. Ask Google
or a lawyer before the first sale if you want either settled (spec section 13, question 6).

After yes:
1. You: create or choose a Google Cloud billing account (card, identity) and a project
   `lang-weave-managed`.
2. Agent: enable the API, create a service account with a **custom role holding only the
   prediction permission** (the predefined Vertex user role is much broader), set a
   budget alert at $20 a month, and look for a hard project quota or spend limit. Budget alerts
   warn; they do not stop spend. The proxy's own daily ceiling stops spend through the proxy, but
   not spend with a leaked credential; if no hard provider-side limit exists on Vertex, say so to
   Ted before going further (spec section 7).
3. You: if the host supports workload identity federation or short-lived credentials, use that
   and skip the long-lived key. Otherwise create the service-account key and paste it into the
   host's secret store yourself (D9). No agent or chat transcript should ever see it.

## D8. Stripe

**Recommendation: one Stripe account, as an individual or sole proprietor, US cards only, one $10
Payment Link.** Stripe lists "Seller-maintained stored value or credits" as restricted ("may be
subject to limits"), so expect questions. Credits stay small, never expire, cannot be transferred
between readers (the operator's token recovery excepted), and are refundable on request.

After yes, in this order (D9's host and the published terms page must exist before the link is
created in step 3):
1. You: open the account and complete identity verification (legal name, address, tax ID, bank
   account). Choose a statement descriptor such as `LANGWEAVE`.
2. A lead writes the terms-of-sale and refund page (draft PR); you approve it and it is
   published. D9's host and proxy URL exist.
3. Agent: create the product "Lang Weave reading credit, $10" and a Payment Link with quantity
   fixed at one, no promotion codes and cards only, created **deactivated**; add a Radar rule that
   blocks non-US cards (a Payment Link setting that limits billing country was **not verified**
   tonight; Radar rules are the documented lever); link the published terms page; and create a
   webhook endpoint for `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed` on the proxy URL.
4. You: copy the webhook signing secret into the host's secret store.
5. The link is activated only at D10 step 2, for the enrolled tester.

## D9. Host and domain

**Recommendation:** one small serverless host with a transactional SQL store, on a subdomain you
already own (for example `api.` on your existing domain), so no new domain is needed. Current host
prices were **not checked tonight**; a lead checks before you choose.

After yes, in two parts around D8:
1. **Before D8 step 3 (provision the URL):** you create the host account and add the provider
   credential unless D7 used workload identity; an agent creates the database and the DNS
   record; a lead deploys from a reviewed commit and runs the stub-provider tests against the
   deployment with the ceiling at $2 a day. The proxy URL now exists.
2. **After D8 step 4 (configure and verify the webhook):** the Stripe webhook signing secret is
   in the host's secret store. Stripe signs test-mode events only for test-mode endpoints, so the
   live secret cannot be checked with a test event. The checks are:
   (a) a separate test-mode endpoint on a separate test deployment and ledger, with its own test
   secret, receives Stripe test events and records them correctly;
   (b) the live endpoint refuses a bad-signature request (the `livemode` rule cannot be exercised
   live, because a real test-mode event fails the live signature first; it is covered by a
   locally signed fixture, spec C4);
   (c) a harmless signed **live** delivery before activation: the lead temporarily adds an
   unhandled event type (for example `product.updated`) to the live endpoint, edits the
   product's description, confirms the proxy logged "verified, unhandled" and changed no
   ledger row, then removes that event type.
   D10 activates the link only after (a), (b) and (c) pass. If the tester's purchase still is not
   credited within one hour, the lead checks Stripe's delivery log, fixes and replays the event,
   or refunds the tester in full the same day; the same-day refund also applies if a replay is
   attempted and still produces no credit.

## D10. Price and first sale

**Recommendation: $10 for $10 of reading at a 2× markup over provider cost** (about 1,600 typical
calls: 32 to 80 days at 50 to 20 calls a day, both estimates; margin about $4.41 after Stripe's fee, before
hosting, disputes and tax). US only. The first sale is to one consenting adult tester on the GitHub
beta build with the flag on, before any store listing change.

After yes, in this order:
1. **Before any sale:** you approve a revised privacy policy and a terms-of-sale and refund page,
   both published, that name the new data recipient (the proxy), what it keeps (ledger rows, not
   passage text or model output), Stripe's role, the seller (you, not Google) and the refund
   terms. The tester reads the in-extension disclosure before the first managed call.
2. A lead turns on the flag in that one build, adds the tester's account id to the proxy's
   `ENROLLED_ACCOUNTS` allowlist (spec C4: any other account gets a refund, not credit), checks
   D9 part 2 passed, activates the Payment Link, the tester buys one pack, and the lead
   deactivates the link straight afterwards. The day after
   (provider billing lags by up to about a day), the lead reconciles two separate pairs:
   Stripe payments and refunds against the ledger's grants and reversals (amounts paid and
   refunded; Stripe's fee is not in the ledger and is checked separately on the Stripe payout);
   and the ledger's **confirmed** provider costs (not provisional holds) against the provider's
   bill for the same calls over the same billing window, within a cent.
3. Only then are the store listing and data disclosures revised (new data recipient, seller
   identity, refund terms, physical address, trader status) and resubmitted. That resubmission is
   its own decision.

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

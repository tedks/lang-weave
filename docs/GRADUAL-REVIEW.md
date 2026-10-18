# Gradual lane review triage

Review scope: upper branch against the published lower checkpoint before the authorized rebase. OpenAI native and Anthropic Opus seats reviewed; Google was quota-limited, so that seat is empty. Locations below point to the upper source at triage time and may move after integration. A disposition marked repaired has focused test evidence but still needs exact-head gates and fix-delta review. This record does not claim acceptance.

## Critical and Important

| Finding | Location | Severity | Disposition |
| --- | --- | --- | --- |
| Page-script clicks could open, reveal, rate, or mark a due word familiar; practice attributes exposed the answer before reveal (Claude I1) | `extension/src/content.js:82`, `extension/src/content.js:292`, `extension/src/text.js:136` | Important | Repaired: require trusted span and button events and omit practice answer attributes. Isolated Chromium proves synthetic click/Enter cannot open a ticket, synthetic reveal/known cannot mutate state, and pre-reveal attributes omit the answer. Re-review pending. |
| Failed rating disabled Dismiss and every rating control despite a retryable worker ticket (native 2, Claude I2) | `extension/src/content.js:125` | Important | Repaired: restore buttons on a live-cue failure; isolated Chromium fails one review write, verifies enabled controls, then retries to exactly one review. Escape and focus behavior remain a separate accessibility nit. |
| Newly introduced card becomes an automatic inline quiz in the next passage or same batch (Claude I3) | `extension/src/learning.js:45`, `extension/src/learning.js:62` | Important, product choice | CTO filed `inline-new-word-delay` under open questions and presented it for ruling. Existing behavior remains; no default approved. |
| Gradual priority wording changed ordinary default reading prompts (Claude I4) | `extension/src/prompt.js:48`, `extension/src/prompt.js:68` | Important | Repaired: default normal-density Spanish and generated-language prompts retain prior priority wording; gradual due/new and explicit density choices retain their intended guidance. Focused prompt test passes; exact lower-base parity remains to verify after rebase. |
| Valid but extreme future saved day blocks automatic new words until that date (Claude I5) | `extension/src/learning.js:22` | Important, product choice | CTO filed `future-budget-date-recovery` under open questions and presented it for ruling. Rollback protection remains; no automatic reset introduced. |
| Monotonic revision in cache identity can orphan entries after settings or permission changes and spend model quota (Claude I6) | `extension/src/background.js:55`, `extension/src/background.js:82` | Important, integration | Lower owns the opaque revision contract. Upper will inspect exact lower head and coordinate semantic cache identity with lower/CTO during rebase; no independent foundation rewrite. |
| Daily introduction is committed on worker delivery before visible placement (Claude I7) | `extension/src/background.js:87`, `extension/src/learning.js:45` | Important, product choice | CTO filed `introduction-visibility-budget` under open questions and presented it for ruling. Existing behavior remains; no acknowledgement protocol approved. |
| Raw cached empty model result persists after day/quota or due-candidate change (native 1) | `extension/src/background.js:73`, `extension/src/learning.js:30` | Important | Repaired: gradual cache identity includes local day, remaining allowance and ordered candidate statuses. Worker test primes an exhausted empty decision, changes saved day, and proves a new model call/new word. Mutation and integrated review pending. |

## Nits and test gaps

| Finding | Location | Severity | Disposition |
| --- | --- | --- | --- |
| Missing `aria-live`, Escape, focus return, and begin-error feedback (Claude N1) | `extension/src/content.js:82` | Nit | Pending accessibility follow-up after core gate; no claim of completion. |
| Cue prompt trusts page-editable `data-en`; page-readable practice answer attributes (Claude N2) | `extension/src/content.js:104`, `extension/src/text.js:136` | Nit | Pre-reveal answer attributes repaired and tested. Source-English tampering remains for follow-up; worker still validates the word via content-owned WeakMap and issued ticket. |
| Rated practice span remains a stale cue until repaint (Claude N3) | `extension/src/content.js:125`, `extension/src/text.js:136` | Nit | Pending follow-up; worker rejects a second rating as not due. |
| Panel buttons inherit hostile page CSS; practice styling keys on English title (Claude N4) | `extension/src/content.css:42` | Nit | Pending style hardening follow-up. |
| Fully cached requests take the global storage lock (Claude N5) | `extension/src/background.js:87` | Nit, performance | Measure after lower rebase; keep serialization for quota and ticket integrity. Follow-up if measurable. |
| Mixed model response rewrites cache hits (Claude N6) | `extension/src/background.js:87`, `extension/src/background.js:130` | Nit | Pending narrow repair after lower rebase; avoid changing cache write ordering without rerunning storage-failure tests. |
| Failed permission epoch write may skip site registration (Claude N7) | `extension/src/background.js:388` | Nit, integration | Lower owns revision and registration path. Verify on the immutable lower head and relay if still present. |
| Introduced-day parser, popup custom budget select, disabled controls and one global inline slot have small consistency gaps (Claude N8) | `extension/src/review.js:19`, `extension/src/popup.js`, `extension/src/background.js:87` | Nit | File bounded follow-ups or repair after core integration; current ticket invalidation is explicit. |
| MV3 worker restart could bypass the synthetic fetch and reach Gemini (Claude N9) | `extension/e2e/gradual.mjs:16` | Nit, test safety | Repaired: Chromium launch blocks the endpoint by DNS and routes all network through an unreachable local proxy. Synthetic flow still passes. |
| Mission current-state header lagged upper branch (Claude N10) | `docs/GRADUAL-MISSION.md:3` | Nit | Repaired in this checkpoint; update again at each branch boundary. |
| Weak repeated-cache assertion; frame/lifecycle/known-router and day-rollover test gaps (Claude test gaps) | `extension/test/learning-worker.test.js` | Test gap | Day rollover now asserts a fresh model call and new word. Other bounded negative checks remain for integration review. |

## Integration checks

- Take the lower lane's opaque, monotonic revision and serialized final fetch guard. Reconcile duplicate upper epoch writes, retain upper inline ticket tests, and prove off/on plus permission round trips cannot revive a ticket.
- Check model dispatch through both primary and fallback paths after upper policy reads, and check cached delivery against current revision/site access.
- Run the full local gates, mutation checks, and council to fixpoint on the exact rebased head before presenting PR #4 for root integration.

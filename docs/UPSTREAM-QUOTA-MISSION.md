# Selective upstream quota and status integration

## Current state

STARTED on `upstream-quota-diagnostics` from merged 0.7.0 baseline. Scope: bounded provider cooldown and allowlisted failure status in the standalone extension; no provider, consent, learning, or local budget expansion. Root retains merge and fleet decisions. This document is the public mission record and excludes private coordination data.

## Assumptions and failure modes before edits

- HTTP 429 alone does not identify a daily limit. A recognized provider code or quota dimension is needed; a short burst limit must not persist as a day limit. Current official Gemini documentation says limits are per project, vary by model and tier, and include RPM, TPM, and RPD. RPD resets at midnight Pacific, but this change will not calculate an assumed reset when a particular response gives no reliable recovery time.
- The existing 1,000-call local daily cap is a protective client budget, not a Google entitlement. Its local calendar and accounting remain unchanged. A failed storage write must stop dispatch when call accounting cannot be recorded.
- Provider responses, headers, and thrown errors are untrusted. Only finite, bounded retry values and allowlisted categories and numbers may enter persisted status or UI. Invalid, huge, or malformed data must neither create an infinite block nor disclose body, key, URL, page text, or prompt.
- A key replacement can occur during a model request. Its old response must not set cooldown or status for the new key. No raw key or derived secret identifier is needed in diagnostics; a change epoch and clearing operational state can provide freshness.
- The worker can restart after a provider limit. A recognized daily wait must survive that restart, expire safely, and not block local review. Wall clock movement can invalidate absolute deadlines; cooldown recovery therefore needs a bounded policy and tests.
- The primary model may fail and the configured fallback may succeed. Status describes the final useful outcome and must not show a stale failure after success. Existing site consent, per-dispatch revision checks, generated-pack scope, gradual introduction and recall state remain authoritative at every new await.

## Acceptance plan

Compare local behavior to frozen upstream evidence, use current official Google documentation for quota semantics, and make a small adaptation. Pair positive/negative and mutation-red tests for classification, retry bounds, restart/clock/key freshness, storage failure, fallback, status redaction, and local review. Run guarded synthetic MV3 browser evidence, full local gates, and a provider-diverse council to convergence. The browser scenario proves extension behavior with synthetic provider responses and a network sink, not live Gemini behavior.

## Provider facts checked 2026-10-20

- [Google Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits): RPM, input TPM and RPD are separate dimensions; limits apply per project, vary with model/tier, and RPD resets at midnight Pacific. No fixed provider request cap is assumed here.
- [Google API errors](https://ai.google.dev/gemini-api/docs/api-errors): `quota_exceeded` is a daily 429; `rate_limit_exceeded` and `too_many_requests` describe short-window 429s. Bare 429 needs conservative treatment.
- [Google troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting): transient 429/503 responses warrant bounded backoff. This does not justify an unbounded client block or repeated immediate dispatch.

## Evidence log

- Baseline inspection: local `callGemini` reads raw HTTP body with a regex for `retryDelay`; `requestSwaps` holds model cooldown only in worker memory; `background` saves raw exception text as `modelStatus.error`; popup renders that text. Existing site, title, fallback, cache and local-review guards already exist. The status badge is reserved for disk update (`NEW`).

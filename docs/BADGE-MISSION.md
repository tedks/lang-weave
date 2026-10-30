# Per-tab badge state

## Current state

In progress on `badge-state`. Issue `badge-state` is started. The badge will explain why reading is idle on the current tab using only worker-held settings, key presence, site grants and sanitized model status. No page text, hostname, provider message or key enters badge copy.

## Assumptions and acceptance

- Chrome action APIs support `tabId` for badge text, background and title; unsupported or internal pages receive fixed local copy. The badge is advisory and never changes consent.
- The popup decision order is global pause, key, site policy, grant, model status, then on. A shared pure predicate will preserve that order. Sensitive sites are a distinct badge explanation while retaining the popup's existing line.
- Model status is already allowlisted. The badge will validate it through the same current-status filter as the popup, including persisted cooldown expiry and local-budget recovery.
- The self-update gate is the running manifest's `update_url` absence, established in `STORE-ENGINEERING-MISSION.md`; only that path may show `NEW`. A pending `NEW` overrides per-tab state.

Acceptance: exhaustive Bun state table and event tests; real Chromium light and dark screenshot plus worker `chrome.action.getBadgeText` assertions; all requested browser, Bun, Python, version, package and diff gates; council review to a clean fixpoint on the exact merge candidate. Browser calls use synthetic Gemini only.

Stop conditions: a required state needs data the worker does not hold (ruling); three failed browser-gate attempts (blocked).

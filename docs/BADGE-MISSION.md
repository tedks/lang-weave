# Per-tab badge state

## Current state

In progress on `badge-state`. Issue `badge-state` is started. The badge explains why reading is idle on the current tab using only worker-held settings, key presence, site grants and sanitized model status. No page text, hostname, provider message or key enters badge copy.

## Assumptions and acceptance

- Chrome action APIs support `tabId` for badge text, background and title; unsupported or internal pages receive fixed local copy. The badge is advisory and never changes consent.
- The popup decision order is global pause, key, site policy, grant, model status, then on. A shared pure predicate will preserve that order. Sensitive sites are a distinct badge explanation while retaining the popup's existing line.
- Model status is already allowlisted. The badge will validate it through the same current-status filter as the popup, including persisted cooldown expiry and local-budget recovery.
- The self-update gate is the running manifest's `update_url` absence, established in `STORE-ENGINEERING-MISSION.md`; only that path may show `NEW`. A pending `NEW` overrides per-tab state.

Acceptance: exhaustive Bun state table and event tests; real Chromium light and dark screenshot plus worker `chrome.action.getBadgeText` assertions; all requested browser, Bun, Python, version, package and diff gates; council review to a clean fixpoint on the exact merge candidate. Browser calls use synthetic Gemini only.

Stop conditions: a required state needs data the worker does not hold (ruling); three failed browser-gate attempts (blocked).

## URL visibility ruling and scope bend

The real Chromium probe showed that a tab on an ungranted origin has an ID and status but no `url` in `chrome.tabs.query` or `chrome.tabs.get`. Its URL-filtered query returns no tab. Without a new permission, the worker cannot distinguish a site needing a grant from a sensitive or explicitly disabled site before a popup gesture. The CTO ruled option B: keep the permission surface and show a muted `–` with fixed title “Open Lang Weave to check this page” whenever Chrome withholds the URL. Exact states appear on tabs whose URLs Chrome provides. This is a bounded deviation from the requested needs-site bullet on every ungranted tab; it avoids falsely implying that a sensitive site should be enabled. The broader `tabs` permission, which would add a Store install warning, is filed as `tabs-permission-ruling` for Ted. The popup already answers the site question in one click.

The tab update listener refreshes on `loading` and `complete` status as well as `change.url`, because Chrome also withholds `change.url` on those ungranted tabs. The badge never infers a URL from page messages or stores one.

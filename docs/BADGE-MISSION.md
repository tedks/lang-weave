# Per-tab badge state

## Current state

Ready for final exact-head gates and normal merge in PR #27 after rebasing on welcome-page PR #29. Issue `badge-state` is started. The badge explains why reading is idle on the current tab using only worker-held settings, key presence, site grants and sanitized model status. No page text, hostname, provider message or key enters badge copy.

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

## Council round 1 and repair

At `8dde635`, OpenAI's native Sol seat and Anthropic's Opus seat both found that a pending `NEW` could be overwritten after an MV3 worker restart. The repair checks the disk update before the first tab refresh on every worker wake, coalesces concurrent checks, and pins a second worker import in the event test. Both seats also identified that an idle tab has no event exactly when a cooldown expires or the local day changes. A durable exact-time refresh would require a new alarm, which this mission explicitly forbids. `badge-expiry-refresh` records that remaining tradeoff; the badge recomputes on the next tab, settings, permission, status, or worker event, and the popup recomputes when opened. This limit is not claimed as live expiry proof.

Anthropic also flagged per-tab repeated context reads; `refreshAll` now shares one worker snapshot across its tabs. The popup's public config was verified to retain `origins`, `paused` and `hasKey`; `paused` is the existing constant `false`, with global pause in `settings.enabled`. Badge fallthrough is now generic fixed copy, site-default cases are pinned separately from the exhaustive override table, and the browser contrast assertion uses actual action colors. Google agy remains EMPTY due to quota and was not backfilled.

The first fix-delta review found that deleting a per-tab generation after a failed refresh could reuse an older token and let stale work write later. Tokens now come from one monotonically increasing worker counter; a three-overlap test pins the regression. The review also raised a startup reload race: a worker wake may be handling a page or review message, so its disk check now detects `NEW` without reloading. Only the existing popup and alarm paths attempt the self-reload after queued work. The update-gate test pins that distinction.

The second fix-delta round (`b7b8141..f956dd5`) was CLEAN from both available seats: no new Critical or Important issues. OpenAI reviewed with native Sol and Anthropic with Opus through ask-agent; agy was EMPTY, not backfilled. The remaining test-timing and pending-navigation nits are filed as `badge-restart-test-timing` and `badge-navigation-commit-test`. `badge-expiry-refresh` holds the no-new-alarm limitation. A mutation changing the no-key branch to `working` made two badge state tests fail, then the source was restored.

## Verification scope

The browser probe reads real `chrome.action` text, title and background colour per tab. Its screenshots compose those observed values beside the shipped 16 px icon on synthetic light and dark toolbar surfaces; headless Playwright cannot capture Chromium's native toolbar. Both badges use white text with calculated contrast above 4.5:1 against the observed action colours. It exercises no live Gemini call or user browser profile. The quota browser gate failed once during the full sequential run because the restarted worker did not process the second page within its attempt window; the isolated retry passed. The final exact-head gates and merge record belong in the PR comment.

## Welcome-page integration at rebase

Main advanced to `8b6a446` (welcome PR #29, version 0.12.9), so this branch takes 0.12.10. A fresh profile now writes `consentShown: false` and blocks Gemini dispatch until the user explicitly chooses site policy. The existing status message exposes `consentShown`; the badge reads the same worker-held marker and shares a `needs_setup` predicate with the popup, ahead of key/site/model state. It shows `!` and fixed title “Finish setup in the welcome page”. The storage event refreshes the badge after the choice. Existing profiles without the marker remain allowed. The badge browser fixture now targets its tab by ID because the install-only welcome tab can become active during the probe. This integration is reviewed and gated on the rebased head.

Both available seats reviewed the rebased PR at `dce734a` and found no Critical or Important issues; agy remained EMPTY. Anthropic's cleanup findings were addressed in a small delta: action refresh failure can no longer turn a waiting update status reply into an empty result; the worker wake no longer double-refreshes; rejected action writes release their per-tab queue entry; the hidden-URL test now includes the first-run consent predicate; and the worker test fires the install event alongside badge listeners. Focused tests pin the changed behavior. The final delta review and exact-head gates follow this record.

# Personal capture UI lane report

State: implementation started. Owner: `personal-word-capture` UI implementer. Branch: `personal-word-capture`.

## Assumptions before implementation

- Worker owns all persistent state, permission/site rechecks, nonce lifetime, matching and save validation. The content script only reports an exact live top-frame selection after conservative DOM checks; it never injects into page content or sends page text beyond the selected text.
- The worker's published message shapes in the lane brief are stable. The page will send only the specified capture, list, archive and export message types and treat all reply fields as untrusted.
- Browser DOMs may change between menu display and challenge response. Recheck Selection equality, connectedness and excluded ancestor state at response time; any ambiguity fails closed.
- Selection may span multiple ranges/text nodes, so validation checks every selected text node's ancestry and selected text against visible, connected prose. Empty, oversized, hidden, editable, link, code, sensitive and high-stakes selections are rejected.
- Candidate suggestions and all worker-provided labels are untrusted strings. UI inserts them with `textContent`/form values, never HTML. Unknown matches require explicit direction and manual source/target entry.
- Tests use the extension's existing Bun/happy-dom setup and can prove DOM logic and rendering safety, but not native Chrome context-menu delivery or real permission state.

## Implementation record

- 2026-10-27: created this lane-owned assumptions/evidence artifact before code changes.
- 2026-10-27: added a challenge listener that requires the existing config's enabled site and granted origin, top-frame HTTP(S), a safe title/path, exact live Selection text, and connected visible prose outside excluded DOM. The verifier caps selections at 80 codepoints/five words and rejects controls, format chars, markup, URL-like text and high-stakes terms. Added `personalCaptureAlive`, which returns only `{ok:true}` while the exact current page remains top-frame, enabled, granted and safe.
- 2026-10-27: added the extension-owned confirmation/management page. It uses text nodes and form values for worker data, requires explicit direction, retains retryable errors, supports manual entry, Save/Cancel, archive, JSON export, and explicit per-item Add to review. Save has no introduction side effect in this UI.
- 2026-10-27: focused tests passed via `npm exec --yes --package=bun -- bun test test/personal-capture.test.js test/capture-page.test.js` from `extension/` (4 tests, 23 assertions). `git diff --check` passed. Bun was not on PATH; invoked Bun through npm exec, then installed the frozen lockfile dependencies into ignored `node_modules` for the run.

## Limits

- These tests exercise the DOM verifier in happy-dom and the extension page against mocked worker responses. They do not prove Chrome's native context-menu event, worker authorization/storage behavior, actual browser selection edge cases, or real page visibility/layout across Chromium. The parent lane owns worker/message integration and browser verification.
- The finite high-stakes keyword and sensitive-path guards are conservative local heuristics; they are not a topic classifier. Sensitive-site domain defaults still come from the existing settings guard.

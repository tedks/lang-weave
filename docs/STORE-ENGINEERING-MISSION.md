# Store readiness: engineering half

State: in progress on `store-engineering` (off `origin/main` `ebf183c`, 0.12.3). Draft PR; not merged. Lead: Claude Opus 5.5 native subagent `lead-store-engineering`. Issues: `icons-and-listing`, `privacy-and-fingerprinting`, `gate-self-update` (engineering halves only); `store-x-content-script-ruling` option A. Item 2 (fingerprinting) awaits a ruling: see below.

## Intent and boundary

Make the extension's own engineering ready for a Chrome Web Store build without changing learning behaviour: icons, web-accessible surface, an inherited log tag, a gated self-update and a table-driven Store manifest delta. No Store upload, no real browser profile, no live Gemini call, no new runtime dependency.

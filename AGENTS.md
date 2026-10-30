# Agent Instructions: Lang Weave

Lang Weave is a standalone Chrome extension fork of jackieoliver/french-weave (MIT, preserved in LICENSE-MIT). Lang Weave itself is licensed AGPL-3.0-or-later (LICENSE, NOTICE); keep both files and the NOTICE attribution in any release payload. Spanish is its bundled default. Global workflow rules apply from the shared agent configuration. AGENTS.md is canonical; other agent instruction files are symlinks.

## Project structure

- `extension/` — shipped MV3 extension, no build step or runtime dependencies; `src/` is code and `test/` holds Bun/happy-dom tests.
- `docs/` — extension design, mission state and acceptance evidence.
- `data/` — inherited lexicons, including the Spanish starter list.
- `scripts/`, `hooks/`, `commands/`, `.claude-plugin/`, `blocks/` — inherited French companion tooling, retained for history/upstream compatibility; outside the Spanish browser product.
- `tests/` — inherited Python gates and browser integration tooling.

## Environment and gates

No Nix flake or Bazel configuration. The extension loads directly from `extension/`.
Run `bun install --frozen-lockfile` and `bun test` inside `extension/`.
For highlight styling changes, run `npm run test:highlights` inside `extension/` for real Chromium light/dark CSS checks.
Run `python3 -m unittest discover -s tests` from the root for inherited Python tooling.
Keep Chrome runtime verification separate from mocked model verification; never imply a live Gemini check without one.

## Repo specifics

The extension must work without a Python/native host. Never read or write the user's French Weave progress. Preserve explicit site permissions, sensitive-site defaults, API-key isolation and stale-result guards. The historical `fr` property in swap/word objects is a compatibility field for target-language text. The manifest `key` fixes the extension ID (`lkbkmlgogcpcacjmdmoecgacdbfddbnh`) on every path; change or remove it only with a CEO ruling, because that moves every user to a new ID, and never commit the private key. Never update a pre-0.12.0 install directory in place: its self-reload would strand that install's progress (see docs/STABLE-ID-MISSION.md).

## Issue tracking

Use installed `ditz` from this worktree. Issues live on `ditz-metadata`; inspect `ditz --help=plain` and the relevant command's help. `ditz sync` delivers metadata separately from source pushes. Canonical recipes: https://github.com/tedks/ditz/blob/master/docs/agent-recipes.md and https://github.com/tedks/ditz/blob/master/docs/json-contracts.md.

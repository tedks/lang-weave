# Agent Instructions: Lang Weave

Lang Weave is a standalone Chrome extension fork of jackieoliver/french-weave (MIT). Spanish is its bundled default. Global workflow rules apply from the shared agent configuration. AGENTS.md is canonical; other agent instruction files are symlinks.

## Project structure

- `extension/` — shipped MV3 extension, no build step or runtime dependencies; `src/` is code and `test/` holds Bun/happy-dom tests.
- `docs/` — extension design, mission state and acceptance evidence.
- `data/` — inherited lexicons, including the Spanish starter list.
- `scripts/`, `hooks/`, `commands/`, `.claude-plugin/`, `blocks/` — inherited French companion tooling, retained for history/upstream compatibility; outside the Spanish browser product.
- `tests/` — inherited Python gates and browser integration tooling.

## Environment and gates

No Nix flake or Bazel configuration. The extension loads directly from `extension/`.
Run `bun install --frozen-lockfile` and `bun test` inside `extension/`.
Run `python3 -m unittest discover -s tests` from the root for inherited Python tooling.
Keep Chrome runtime verification separate from mocked model verification; never imply a live Gemini check without one.

## Repo specifics

The extension must work without a Python/native host. Never read or write the user's French Weave progress. Preserve explicit site permissions, sensitive-site defaults, API-key isolation and stale-result guards. The historical `fr` property in swap/word objects is a compatibility field for target-language text. Preserve the installed `spanish-weave/extension` path for Chrome ID and progress compatibility.

## Issue tracking

Use installed `ditz` from this worktree. Issues live on `ditz-metadata`; inspect `ditz --help=plain` and the relevant command's help. `ditz sync` delivers metadata separately from source pushes. Canonical recipes: https://github.com/tedks/ditz/blob/master/docs/agent-recipes.md and https://github.com/tedks/ditz/blob/master/docs/json-contracts.md.

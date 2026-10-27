# Adaptive working vocabulary mission

State: STARTED, 2026-10-27. Owner: OpenAI gpt-6-sol Lead, branch `adaptive-vocabulary`, baseline `a0d939104756ad8b4e87dc8cb26313a53f61e944`. Root owns acceptance, normal merge, rollout, and the consolidated mission record. This document contains sanitized lane state only.

## Intent and boundaries

In gradual mode, select a small deterministic set of catalog entries relevant to the current eligible passage. Prefer due and difficult review, then active learning, then fresh entries. Replenish within the existing daily visible-introduction allowance and suppress fresh entries while review backlog is high. Gradual-off keeps its existing catalog and placement path. No personal capture, external dictionary, live model call, new permission, telemetry, or history migration is authorized here.

## Assumptions and failure modes

- The current Spanish catalog has 30 Beginner and 226 Expanded entries; their order, bytes, and exact `fr` keys are compatibility data. Generated packs keep their versioned language scopes.
- V1 review state is authoritative. `cleanReview` currently filters cards by its supplied words, so passing a candidate window to it could silently erase omitted cards on write. Unknown but structurally valid historical cards must also survive cleaning.
- Candidate relevance can be decided locally from listed English anchors for already guarded readable text. A shared English anchor with unresolved senses must not create a new sense choice. Existing semantic, article, accent, compound, and generated exact-form guards still validate model output.
- Repeated delivery, tab races, permissions, site settings, sensitive title, or storage errors can make an encounter unsafe or count it twice. Encounter evidence must never spend a slot or mutate a review card; reservations and visible acknowledgements are the sole introduction authority.
- Prompt limits apply to complete serialized entries, and the entire request must be measured. Overlong entries and empty intersections must fail closed without a model request.

Stop and send root a concrete compatibility design before changing the authoritative review ledger. Also stop for changed privacy or learning contract, new data/dependencies/permissions, or an unaccepted lower Again head.

## Published interface, initial

`catalog` is the full immutable set for a scope and level. `historyWords` is the full available set for that scope, independent of the current level or request window. `candidates` is ephemeral and can be recomputed per readable batch. Only `historyWords` may reach `cleanReview`; selection and model prompting receive `candidates`. Existing `fr` remains the V1 history key and target text. A local stable entry ID can be namespaced by scope and exact legacy `fr`, with no rewrite of stored keys. Future personal/sense entries need an ID and collision-aware anchor adapter before joining this path; this slice does not create them.

The selector receives guarded passage text, eligible level catalog, full cleaned review state, current learning policy, scope and optional bounded encounter aggregate. It returns at most 32 complete candidate entries, at most 3,000 serialized vocabulary characters and at most four fresh entries, with stable IDs and reason codes. Ambiguous anchors are omitted. Due/weak ranks precede active and new; stable ties use catalog identity. Backlog threshold starts at five due/weak active items. Daily allowance and reservations further bound fresh candidates. No candidate implies introduction or review.

## Acceptance and repair authority

Required evidence: paired selector tests for emptiness, ties, overflow, ambiguity, scope, bounds, due/Again, throttle and resume; upgrade/history fixtures across windows, toggles and restart; held-await eligibility races; privacy and storage-failure cases; mutation-red guards; isolated synthetic MV3 flow; final exact-head Bun/Python/version/35-block/diff/browser gates and provider-diverse council to fixpoint. Lower Again SHA must be immutable, CLEAN and gated or normally merged before runtime integration and final council. Root alone accepts and merges.

Authority: bounded source, tests, docs, version and harness repairs on this branch; tracker, push and PR; direct peer interface coordination. No more than one implementation helper. If independent work completes before lower acceptance, push it and hold integration, naming the exact remaining work.

## Evidence log

- 2026-10-27: Confirmed assigned worktree and clean `adaptive-vocabulary` branch at baseline. Read role doctrine, design and accepted source audit. Identified `cleanReview` pruning hazard; chose full-catalog bridge rather than an unrequested V2 migration.

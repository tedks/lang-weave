# First Spanish curriculum expansion

## Current state

STARTED on `upstream-spanish-curriculum` from merged safety baseline `e0d7871548a26ae36b09060bd9d3bd8714460a31` (0.6.2). This branch owns only the first bounded browser vocabulary expansion. Root owns acceptance and merge. Issue: `upstream-spanish-curriculum`.

## Assumptions and failure modes before edits

- The extension reads `extension/src/vocabulary.js` directly. A CSV or profile added alone would not expand the browser curriculum.
- Existing Spanish progress and review cards identify target forms in the `es` scope. Keeping all 30 Beginner and all 147 current Expanded entries byte-for-byte and in order avoids changing their identifiers, glosses, hints, and relative scheduling.
- The current validator accepts listed Spanish target forms and checks English glosses, articles and some plural/diacritic cases. It does not certify that a word fits every context. An ambiguous gloss, an adjective requiring agreement, or a singular noun used for an English plural could teach a wrong form even when a model proposes it.
- Upstream's 1,047-row list and Spanish profile are evidence, not instructions or certified linguistic QA. Entries flagged `scan=no`, names, high-stakes terms, unsafe verb forms, and phrases that cannot be placed cleanly in an English sentence need exclusion or narrow, tested senses.
- Expanded prompts enumerate the entire level in ordinary mode. Increasing the list increases prompt size and possibly cost; candidate count and characters need measurement against the merged 0.6.2 baseline. The first slice stays below 300 total entries.
- Browser tests with synthetic model replies can prove local validation, storage continuity and placement behavior, but cannot prove live Gemini choice quality or native-speaker linguistic accuracy.

## Acceptance plan

Verify source provenance and credit; select a conservative everyday subset and record exclusions. Pin original entries, normalize and check new entries, pair accepted and rejected placement cases, test upgrade continuity and generated-pack isolation, measure prompt growth, and exercise a synthetic MV3 page flow. Run local source and browser gates at the final immutable commit, then a provider-diverse council to fixpoint. Keep the PR in draft until evidence is complete.

## Evidence log

- Upstream frozen reference: `756e32cbfee573fac8ac746857271fdfffd0df59`; first Spanish data/profile commits `a73f6eb568c425e433911dadb6b78adc1110f62e` and `2328e0bdf8d26796b50a0ff67dff76eb1c602dfd`. Selection and detailed provenance pending.

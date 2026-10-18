# Lang Weave language mission

## Current state

State: implementation started on the `generic-language` feature branch. The
Spanish 0.4.0 extension is the accepted base. Source, installer, review,
rename, and fleet gates remain open. This record belongs to the language Lead;
the existing mission records belong to other lanes.

## Intent and boundaries

Extend the standalone Chrome extension to teach target languages while reading
English. Spanish remains the default and its bundled vocabulary must work
offline. A user may select another target and explicitly generate a bounded,
experimental local vocabulary pack with their own Gemini key. Progress,
reviews, reading events, cache entries, and asynchronous results must not cross
target-language or pack boundaries.

The product and GitHub repository will be named Lang Weave. The existing
unpacked installation directory remains `spanish-weave/extension` under the
effective XDG data directory because moving it can change Chrome's extension
identity. English remains the source language. Generated packs are not a
linguistic quality guarantee. Adaptive density, in-band recall, takeover,
Duolingo import, and native hosting are outside this mission.

## Assumptions and failure modes

- The extension's browser storage is the only persistent product state. The
  user's API key stays there and is used only on explicit setup or enabled
  reading requests. Development uses synthetic model responses.
- Existing Spanish settings and progress must survive upgrade, restart,
  switching away, and switching back. Migration must be repeatable.
- Generated content and language labels are untrusted data. Invalid identifiers,
  oversized or malformed packs, duplicate words, invalid glosses, or model
  instructions disguised as data must fail without replacing a working pack or
  changing the selected language.
- Site permission, sensitive-content, editable-text, off-switch, and stale
  response guards continue to govern every target. A late response from a
  prior language or pack must not mutate the current page or history.
- One Latin-script and one non-Latin target are verification fixtures, not
  claims that arbitrary languages are grammatically supported.
- Repository rename and installer pinning are coupled: an archive can change
  its prefix or digest after the GitHub rename even if its commit is the same.
  The fleet installer must validate the actual post-rename archive before an
  installed payload is changed.

## Acceptance evidence to collect

Unit and browser tests for Spanish migration, generation validation, restart,
switching, review isolation, and stale responses; local source gates on the
exact reviewed head; council convergence; normal PR merge; verified owned
GitHub rename; checksum-pinned installer tests and archive staging; targeted
host status showing staged payload separately from browser activation.
No live Gemini request is part of development verification.

## Authority and stop conditions

This lane may edit its source and dotfiles feature branches, make reviewed
setup repairs, create PRs, rename the specifically authorized repository, and
perform targeted fleet rollout. Stop for secrets, spending, a changed product
ruling, an unsafe state that cannot be preserved, or an outward act beyond
this named repository and fleet workflow. Record deviations and exact evidence
here as work advances.

# Current state

State: local spaced repetition implementation authorized by the user on 2026-10-17. Root CTO owns cross-repository integration and fleet deployment; one Lead implementation lane owns learning code in this worktree. No takeover or Duolingo credentials authorized by this mission.

Lane: Codex Lead, `/root/learning_impl`, worktree `learning-review` at `ae3809d` on 2026-10-17. Exclusive source edits here; root owns integration. Acceptance evidence is local unit/worker/UI gates plus Chromium MV3 smoke with synthetic Gemini, version and Python gates, and a pushed draft PR. Stop for any product ruling outside voluntary local reviews.

## Work package

Intent: continue Spanish learning functionality after the accepted core. Add a browser-local recall review queue with easy/medium/hard ratings, persistent scheduling, and a usable popup/review surface. Keep sightings distinct from recall mastery. No API call is needed to review cards.

Assumptions: existing profile-local storage; existing 30/147 bundled Spanish words; users choose when to review; no forced navigation. Acceptance: deterministic clock-based scheduling, one rating per revealed due card, worker-owned validation and serialization, persistence, meaningful regression tests, real Chromium smoke with synthetic Gemini, council convergence before merge. Preserve key isolation and site controls.

Boundary: separate repository/worktree from dotfiles fleet integration. The root owns the consolidated delivery record and PR merge decision. Stop for keys, spending, outward publication or takeover product decisions. Setup repairs within this worktree and existing dev dependencies are allowed; no personal-browser modification.

## Implementation assumptions

- A review prompts with the bundled English gloss and asks the learner to recall Spanish. Reveal shows the canonical Spanish word and pronunciation hint before a rating is accepted.
- Reviewing is voluntary and offline. A button explicitly introduces five words from the current reading level; reading sightings, peeks and flips do not introduce cards or affect the recall schedule.
- Cards use absolute browser-clock timestamps and fixed day intervals. Ratings are subjective self-assessment, not a graded answer or a certified proficiency level.
- One persistent active review ticket across extension review tabs is sufficient. The worker serializes transitions; a ticket is consumed by the first rating, so later duplicate or stale submissions fail.

# Guess first (M4 inference-step)

## Current state

State: PR #42 on branch `inference-step` at 0.12.21, rebased on `origin/main` `510650b` (after startup-gap PR #44 took 0.12.20). Source, Bun tests and the new Chromium gate `e2e/guess.mjs` are in. The council reached fixpoint in round 3. Exact-head gates and the normal merge follow. The PR comment carries the final head and gate output. The lead ruled option B on backup export of guesses and accepted the one-guess-a-day bend on 2026-11-01 (see "Storage and compatibility").

## Context and assumptions

- Lead: Claude Opus 5.5 (Anthropic), a native subagent of the session team lead; worktree `/home/tedks/Projects/lang-weave/inference-step`; ditz `inference-step`.
- Intent: turn passive exposure into retrieval on a word's first encounters, opt-in and measurable. Research basis: learning-science.md recommendation 8, evidence section 4 (guessing before feedback, mixed replications) and section 5 (multiple-choice glosses were the most effective gloss type in one meta-analysis).
- Assumption: "new/learning stage" is `progress.js` `wordStage(card) === 'learning'`: a word with a card that is not maintenance, a claim or verified. A word without a card is never swapped as a hover target in gradual mode, because introductions show English until acknowledged.
- Assumption: the correct meaning is the pack gloss `en` that swap validation already puts in `g`. Distractors come from the scope's full pack list (`legacyAllWords`), including for personal words.
- Assumption: the content script cannot be trusted with correctness or latency. The worker keeps the answer index and the prompt time. The page sends only the chosen index.
- Boundaries kept: no FSRS formula change, no new log field, no consent recheck change, no telemetry, no dependency, no live Gemini. `vocabulary.js`, `levels.js` and adaptive ordering are untouched.
- Wiring outside the listed repair authority, minimal and necessary: two message names in `router.js` (the existing page surface, same sender) and in `background.js`; the log allowlist in `learning-log.js` (pre-authorised as additive); the export filter, the `guessFirst` settings field and one message string in `portability.js`, `_locales` and `backup-page.test.js`.

## Rules

1. **Setting.** `guessFirst`, default off. Settings shows a toggle under Inline recall, disabled while gradual learning is off. It is stored only while on, like `desiredRetention`, so a profile that never opts in stores nothing new. Pages receive it in their config, but it is excluded from the reading revision and from the save handler's epoch comparison. Turning it on or off costs no cache entry, model call or repaint. The content script takes a same-revision config whose only change is this flag.
2. **When the panel appears.** Gradual learning and the setting are on, and a hover or focus dwell on a swapped word reaches the existing 700 ms beat. The worker then answers `guessBegin` with choices only when all of these hold:
   - the word's stage is learning;
   - it has fewer than three logged guesses (`GUESS_LIMIT`);
   - no guess was logged for it today;
   - it is not verified;
   - at least two safe distractors exist.

   Otherwise the worker replies `{ plain: true }`. The page then shows the gloss and records the peek as before, and remembers the plain answer for that word for the day.
3. **One guess a day (a bend, accepted by the lead on 2026-11-01).** The brief capped guesses per word at three. Without a daily limit, three hovers within a minute would use up all three on one sighting, and the second and third would measure short-term memory rather than inference. The cap is now three guesses on three different local days.
4. **Distractors** (`guess.js`). They are drawn deterministically from the pack, with two or three per word (three when available).
   - A distractor is never the word's gloss, never the gloss of a homograph (an accent-folded target match), and never shares a whole-word sense anchor with the answer or with another distractor ("too much" against "much").
   - Candidates are ranked by the same leading article or "to" as the answer, then by closest length, then by a hash of the word ID and the gloss.
   - The options are shuffled with a seed of the word ID and the local day, so the order is stable within a day.
   - Every one of the 226 bundled Spanish words gets a safe set, and the answer lands in every position across the pack. Fewer than two safe distractors means the plain gloss; this happens only for tiny generated packs.
5. **Panel behaviour.**
   - Focus returns to the word after a keyboard answer or keyboard Dismiss only; a mouse answer or Dismiss leaves focus alone.
   - It is placed by the cue's `placeTip` and coloured with the ui.css tokens in light and dark mode. Forced colours use system colours. Correctness is stated in words and shown by border style, never by colour alone.
   - Opening never moves focus.
   - Keyboard (trusted events only):
     - Arrows and 1–4 move to a choice, and Enter confirms through the button's own click.
     - Tab returns focus to the word.
     - Escape closes the panel and returns focus. A dismissed word does not reopen until the pointer or focus leaves it.
   - A trusted choice reveals `word · gloss` with "Right:" or "Not quite:". If the worker refused the answer, the meaning is still shown, unjudged and unrecorded.
   - These close it without recording: Escape, a click away, Dismiss, focus moving to another element (a window blur does not), a full dwell on another word, scrolling the word out of view, or the setting turning off.
   - Clicking the word or pressing Enter on it flips the word as before and closes the panel.
   - There is at most one panel per page.
   - It never appears in a form, an input, a button or an editable region, even if a page moves a swap there after painting. It never appears in the welcome demo, which does not load the content script.
6. **The record.** `guessAnswer` writes one retrieval in the existing ten-field tuple: `[word, at, 'guess', 'receptive', 'correct' | 'incorrect', prior reviews, latency, null, null, null]`.
   - Latency is the worker's time from `guessBegin` to the answer, capped by the log's ten-minute maximum. A ticket older than that is refused.
   - Tickets are single-use, one per tab and document, and replaced by the next `guessBegin`. They are held in `chrome.storage.session`, so they survive an idle MV3 worker shutdown while a panel stays open. They are never in local storage or a backup, and they end with the browser. Only where the session API is absent do they live in worker memory. A failed session read or write fails closed: no ticket is offered, and an answer whose ticket cannot be consumed is not recorded, so a ticket is never lost or answered twice.
   - At answer time the worker rechecks the word's stage, the cap and the daily limit under the lock, because another tab may have answered the same word first. The write runs after the same revision, site-access and permission-generation recheck as a peek.
   - An answer whose log write fails counts for nothing: the page gets an error and shows the meaning unjudged, and no peek is applied.
   - Guesses count within the card's current life: guesses from before a Reset (a later introduction day) do not count toward the cap, matching `verifiedWords`. A Reset and reintroduction on the same local day as an old guess keeps that guess, so the word waits until the next day, and that guess keeps one of the three cap slots in the new life; the daily limit would allow no second guess that day anyway.
7. **Scheduling: weak evidence only.** A wrong guess is then applied exactly as a peek, through the same function the `peek` event uses: the reading event, the card's daily peek counter, and the exposure aggregate's peek count. Two peeks in a day on a rated learning card bring its effective due to at most 24 hours ahead (`peekDue`), never later. A wrong guess plus a later plain-gloss peek on the same day is such a pair. A right guess changes no card and no exposure. FSRS state, due, interval and the formulas are untouched.
8. **Measurements stay honest.** A guess is not a review. Every existing measure excludes `source 'guess'`: next-day recall, long retention, calibration, verified known, workload, leeches, the review page summary, My words stages, the activity strip and Today's review count.

## Storage and compatibility

- **Log.** `SOURCES` gains `guess` and `OUTCOMES` gains `correct` and `incorrect`. A tuple is valid only when these values occur together with direction `receptive`. The log version stays 1, with no new field.
- **Downgrade.** Builds up to 0.12.20 drop guess tuples from local storage on their next log write, losing measurement data only. They also refuse a whole schema 2 backup holding one ("invalid retrieval log entry").
- **Export.** That second fact is the stop condition "a log change that would break the schema-2 reader". This build therefore reads, validates and imports guess tuples, but schema 2 export leaves them out and counts them in `state.logOmitted.retrievals`. The flag is `EXPORT_GUESSES = false` in `portability.js`. This follows the existing "Release order" rule: ship a tolerant reader one release before the first writer. A later release can turn export on (`guess-log-export`). Until then, guess history and the three-guess cap do not survive backup and restore. The import preview's "left out" sentence now names guesses as a reason. The other options were A (export now, with an "install 0.12.21 first" warning) and C (schema 3). They were put to the lead as NEEDS RULING. **Ruling (team lead, 2026-11-01): option B**, as built; export is enabled in a later release under `guess-log-export`.
- **Settings.** `guessFirst` joins `SETTINGS_FIELDS` and is not a backup preference, so import keeps the target's value. A downgrade while it is on trips the old build's strict settings check (`startupUnsupportedSettings`), exactly as `desiredRetention` already does.

## What would falsify it

My words "Is this working?" shows two items whenever the setting is on or any guess has been logged:

- **First-guess accuracy:** each word's first guess, right or wrong, over at least 10 words. Near-chance accuracy (about 25–33%) means the options give too little to infer from. Near-perfect accuracy means the distractors are too easy.
- **Next-day recall after guessing:** the next-day recall population (first reviews the day after introduction), split by whether the word was guessed before that review. At least 10 reviews are needed in each group.

Recommendation 8 is falsified if, after enough data, guessed words recall no better the next day than other words, or if users turn the option off. This is a within-learner comparison, not a controlled experiment. Which words get guessed depends on what the reader hovers, and hovered words may differ from the rest. A causal test would randomise words between conditions (research section 9.8), which this release does not do.

## Evidence

- **Bun.** `test/guess.test.js` covers:
  - the distractor constraints over all 226 Spanish words;
  - determinism, the stable set across days and the day reshuffle;
  - shape and length ranking, homograph and sense-overlap refusals, and the null fallback;
  - the log tuple and its value pairing, and the exclusion of guesses from every measure;
  - export omission and import acceptance;
  - the progress measurement and its text.
- **Bun.** `test/guess-worker.test.js` runs the real worker listener and covers:
  - eligibility (maintenance, claim, unknown word and missing card all get the plain gloss);
  - the record shape with worker latency, and a wrong guess as a peek with FSRS and due unchanged;
  - a single-use ticket, the other-document refusal, one guess a day, a right guess changing nothing, the three-guess cap, and stale-ticket refusal;
  - a site turned off between begin and answer recording nothing;
  - the setting off giving a stale plain reply, and the Settings toggle never changing the epoch.
- **Bun.** `test/guess-content.test.js` runs in happy-dom and covers:
  - with the setting off, every DOM snapshot and message of a hover, leave, flip and focus scenario matches the same scenario recorded on the base commit, both with gradual on and with gradual off. A mutation adding one attribute to the gloss path fails it;
  - the panel after the beat, with no peek and no focus theft, and untrusted clicks and keys ignored;
  - right, wrong and failed answers;
  - the keyboard map with focus return;
  - click-away, Dismiss, focus-out and dwell replacement, with at most one panel;
  - plain replies cached and stale ones not;
  - forms and editable regions, the setting turning off, and the welcome demo;
  - CSS tokens pinned to ui.css.
- **Chromium.** `e2e/guess.mjs` uses real MV3 Chromium, synthetic Gemini and network denial. It covers:
  - the hover panel after the beat, placement inside the viewport beside the word, and light, dark and forced colours, with screenshots in `docs/artifacts/guess-*.png`;
  - an untrusted page click, Escape and a click away, none of which record;
  - a wrong mouse guess logged with worker latency, the card's peek count set and its due unchanged;
  - one guess a day, the keyboard path (focus, ArrowDown, 2, Enter, focus returned) and flip unchanged;
  - My words in its not-enough-data state;
  - Settings off without a model call or repaint.

## Not verified

- No live Gemini, real site or real profile was used.
- No screen reader was used. The swap's existing `aria-describedby` description already contains the gloss, so a screen-reader user hears the meaning before guessing. Changing per-word descriptions is in `text.js` and needs a delivery flag from the worker. It is filed as `guess-screen-reader`.
- No learning effect is claimed. The measurement exists to test one.
- Ticket survival across a real MV3 worker restart was not exercised in Chromium. The worker test checks that the ticket is written to session storage and never to local storage.
- A hostile page can restyle the panel, because it is plain light DOM like the inline cue. Filed as `guess-panel-isolation`.

## Council

- **Round 1** at `a68e584`. Seats: Anthropic (native Opus), OpenAI (Sol via ask-agent); Google agy EMPTY on quota.
  - **Consensus (Sol Critical, Opus Important):** another tab's ticket could get around the daily limit and the cap. Fixed: the worker rechecks stage, cap and day under the lock at answer time. A two-tab worker test fails without the fix.
  - **Sol Critical:** a failed log write was reported as a recorded guess and still applied a peek. Fixed: it returns an error and applies nothing. The worker test fails without the fix.
  - **Sol Important:** the off-state and repaint tests claimed more than they showed. The Chromium gate now checks that the toggle keeps the same span node with zero mutations inside the passages, and that forced-colour choices stay readable and outlined.
  - **Sol Important:** backups lose guess history. The lead ruled option B; enabling export later is filed as `guess-log-export`.
  - **Sol Important, Opus nit:** screen readers hear the gloss before guessing. Out of this lane's authority (`text.js`); filed as `guess-screen-reader`.
  - **Opus nits fixed:**
    - tickets moved to session storage, so an idle worker no longer loses them;
    - the cap is scoped to the card's life after a Reset;
    - focus returns to the word only after a keyboard answer;
    - a panel the page detaches is closed;
    - the test comment is fixed and an out-of-range choice is now tested.
  - **Opus nit filed:** page-CSS isolation (`guess-panel-isolation`).
- **Round 2** on the fix delta `a68e584..b5091a3`. Seats: Anthropic (native Opus, resumed), OpenAI (Sol, resumed session); Google agy EMPTY on quota.
  - **Opus: CLEAN.** It re-ran its three-tab repro: one guess logged, the other two stale.
  - **Opus nits.** Fixed: Dismiss now returns focus only from the keyboard. Documented: the same-day Reset edge.
  - **Sol: not clean.**
    - Important: when a session write failed, the code fell back to memory that reads never consulted. Fixed: session failures now fail closed at begin and at answer. Tests cover get and set failures, and both mutations fail them.
    - Important: a same-day Reset keeps that morning's guess. Resolved as a documented day-granularity boundary (the log has no reset marker, as with `verifiedWords`), pinned by a test. The word waits until the next day, which the one-a-day rule requires anyway.
    - Nit fixed: the observer wording now says node and text changes only.
- **Round 3** on `c587295..a1606bc`. Seats: Anthropic (native Opus): CLEAN; OpenAI (Sol): CLEAN with one doc nit, applied. Google agy EMPTY on quota. **Fixpoint reached.**

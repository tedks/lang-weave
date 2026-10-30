# Progress and My words

State: PR #28 on branch `progress-words`. Ditz issues `today-progress` and `my-words`, plus the user-facing half of `learning-event-log`.

Encounter-core update (2026-10-30): [ENCOUNTER-MISSION.md](ENCOUNTER-MISSION.md) supersedes the earlier permanent-familiar behavior below when gradual learning is on. A third Easy is maintenance and remains scheduled under FSRS; an Already know claim is verified only by a later 21+-day retrieval at or after its claim due. In gradual mode Practice now can choose maintenance cards, but cannot bypass a pending claim's verification date. Legacy behavior below remains for gradual-off profiles. The My words claim still has no retrieval-log entry; the card's additive claim fields carry its verification gate.

## Intent

The learner can see their words and whether learning is happening, from local data only. Sources: roadmap M2 `today-progress` and `my-words`; UX audit #11, #12 and #16; learning-science recommendations 1, 5 and 11 and section 9, "What to measure".

## What shipped

- **`progress` message.** It is read-only and available to the popup, options and the words page. It returns:
  - today's counts;
  - the review counts that drive the popup button;
  - words by stage and the verified-known count;
  - a 30-day activity strip and the days practised in the last seven;
  - the section 9 measurements, each with an `enough` flag.

  It reads the scoped review cards, the learning log and the per-scope reading-event stores. It writes nothing.
- **Popup.** The Today line shows only the non-zero counts and reads "nothing yet" otherwise. A second line shows the days practised in the last seven and the verified-known count.
  - The primary button is one of three actions:
    - "Review N due words", which opens the review page;
    - "Add words", which also opens the review page, where the Add button is;
    - "Practice", which opens My words, so the button never promises a review that does not exist.
  - My words opens the new page instead of the capture page. If the progress reply fails, the site controls still work and the button falls back to the status counts.
- **Options.** Your data links My words and shows a one-line summary. The Personal entries link to the capture page stays.
- **My words** (`extension/src/words.html`, `words.js`). This plain-HTML page lists the pack's full word list and the learner's personal entries for the current language. Each row shows the gloss, stage, next due date, exposures and distinct days.
  - **Finding words.** Search ignores accents and case and matches the form, gloss and sense. A stage filter narrows the list.
  - **Keyboard.** Arrow keys, Home and End move between rows with roving focus. Escape returns to search. Tab reaches each row's buttons.
  - **Rendering.** Rows render in batches of 60. Show more adds the next batch, and moving past the last rendered row renders it too.
  - **Actions.** Practice now, Already know, a two-click Reset, and archive or unarchive for personal entries. The page also shows progress and an "Is this working?" section.
  - **Export.** The page links to the capture page, which holds the export.

## Decisions

- **Stages.** One stage per word, from the card, FSRS state and the log (`progress.js`):
  - **New:** no card. The word was never introduced, or it was reset.
  - **Learning:** a card whose FSRS stability is under 21 days. This includes words introduced but not yet rated, and every lapse.
  - **Maintenance:** stability of 21 days or more. A migrated card without stored state has its interval as its stability (`withFsrs`).
  - **Marked known:** an "Already know" claim without verification.
  - **Verified known:** a recall at a gap of 21 days or more within the card's current life, with no Again since. Verification overrides the other stages.

  The brief named four stages. Claims are a fifth because the research says a claim is not evidence (recommendation 5). The boundary is pinned against an `fsrs.js` sequence of Good ratings with stabilities 2.31, 10.96, 46.28 and 162.86.
- **Verified known without a reset marker.** The log has no reset outcome, and adding one is a format change, so Reset logs nothing. A pass verifies a word only if the gap it measured began on or after the card's introduction day, with one day of slack. A reset word is introduced again with a new introduction day. A pass from before the reset began its gap 21 or more days earlier, so it no longer counts. A card with no introduction day, from before 0.8, has no floor. The section 9 measurements remain history: they still include retrievals made before a reset.
- **Today.**
  - **Introduced:** cards whose introduction day is today, including words later marked known, so the count never drops when a word is claimed. Already know on a word never introduced adds a card today and counts too. Reset removes the card and its introduction.
  - **Seen and peeked:** distinct words, from the per-day record in `events.js`.
  - **Flipped:** flip events in the bounded reading-event queue, which keeps the latest 500. It is a lower bound.
  - **Reviewed:** graded ratings logged today. Claims are excluded.
- **Activity and the week.** A day is active when it holds any retrieval, a rating or a claim. Days are dates in the device's current time zone. The log stores instants only, so after travel, past retrievals are counted on the new zone's dates. "Days practised this week" counts active days among the last seven local days, today included. A missed day only lowers that rolling count, and nothing is ever lost.
- **Measurements and thresholds.** Below these thresholds, a measurement reads "Not enough data yet" with its current sample, never a rate:

  | Measurement | Minimum sample |
  |---|---|
  | Next-day recall | 10 |
  | Retention after 21+ days | 10 |
  | Calibration | 50 scheduled reviews |
  | Leeches | 20 rated reviews |

  Calibration uses five buckets. The text says that a fair test of the scheduler needs a few hundred reviews. Exposure coverage and workload are also shown. Peek rate is omitted, because the log keeps no time series for it.
- **Practice now.** The review ticket gains an optional `practice` field: the card's due time when the learner chose it. While the card still has that due time, the due checks (`askable` in `review.js`) accept it before it is due. Any other write to the card voids the grant, because every rating, inline rating or reset moves the due time. Familiar cards are still refused.
  - **Scheduling.** FSRS schedules the rating from the real elapsed time as an early review, and the log records its prediction.
  - **Easy streak.** An early Easy never extends the Easy streak, while an early Hard or Medium still resets it, so automatic familiarity still needs three spaced Easy reviews. Without this, repeated Practice now plus Easy would retire a word in minutes.
  - **New words.** A new word is introduced first. Like the review page's Add button and the capture page's "Add to review", this is an explicit manual introduction. It sits outside the gradual daily budget, which governs automatic introductions while reading.
  - **Latency.** It starts when the review page first fetches the ticket, whether the card was due or not.
  - **Scope order.** `reviewNext` keeps a ticket that is already on offer across the pack and personal scopes. A chosen personal word is therefore not displaced by an earlier-due pack card. This also applies to an ordinary due ticket already on screen, which the old code could switch away from in that rare case.
  - **Refusals.** Words above the current level, archived words and claimed words cannot be practised.
  - **Open review tab.** Practice now replaces any ticket another review tab is showing, and that tab's next rating gets the existing stale reply (`practice-now-review-tab`).
- **Already know.** It sets the existing `familiar` flag. A word that was never introduced gets a familiar card, which does not use the daily introduction budget. The claim is not logged: the log's two sources are the review surfaces, and a third needs a format change (filed as `words-known-claim-log`).
- **Reset.** It deletes the card: its schedule, FSRS memory, review count and familiar flag. Reset requires three things:
  - a second, explicit click;
  - `confirm: true` in the request;
  - the scope the page listed, and the version of the card it showed (due, reviews, familiar).

  If a rating, claim or language change happened in between, the request is refused as stale. Open review and inline tickets for the word are dropped, so a page holding one gets the existing stale reply. A reservation exists only while a word has no card. Practice now or Already know may create the card during a 30-second reservation; the page's acknowledgement is then refused because the card exists, as with the review page's Add button. Reset never deletes a reservation. A replayed introduction receipt fails, because its pending entry was removed when it was first acknowledged. The daily introduction budget is not refunded. The log and exposures are untouched.
- **Stage totals and the list.** Stage totals count the pack and active unlinked personal entries, and the page says so. The list also shows archived entries, so its count can be higher.
- **Clock recovery.** The verified-word floor uses the gate day after a confirmed clock recovery, as inline recall does.
- **Linked personal entries** share their bundled card. They appear as "saved by you" on the bundled row, which offers archive. The worker refuses word actions on the linked ID itself.
- **Router.** The words page is a new surface entry. It may send `progress`, `wordsList`, `wordPractice`, `wordKnown`, `wordReset` and the existing `personalArchive`. The popup and options gain `progress`. No existing entry was widened to reach the new page.
- **Privacy.** The page shows only catalog forms, glosses and the learner's own short personal forms (`validForm` refuses URL-like text). It shows no URL, host, title or passage. Nothing leaves the browser. The browser gate checks that the page text contains no "http".

## Evidence

Tests and gates are recorded in the PR comment for the merge commit.

- `progress.test.js` covers:
  - stages against `fsrs.js`;
  - verified words across a reset;
  - today and activity in Los Angeles and Tokyo, and across a DST change;
  - empty, sparse and 21+ day measurements.
- `progress-worker.test.js` covers the real worker: Practice now, the Reset guard, Already know, archive and progress.
- `review.test.js` covers the practice ticket.
- `words-page.test.js` covers batching, search, keyboard, the stage filter and the two-click Reset.
- `router.test.js` pins the new surface and its near-misses.
- `e2e/words.mjs` runs the page in real Chromium. It seeds cards through the worker, searches, uses Practice now and Reset, and checks the popup link and height.

## Not done, and why

- Peek rate over time needs successive snapshots, which the log does not keep.
- Reading-only days, with exposures but no retrieval, do not count as practice, because exposures keep no per-day series. Counting them needs a log change.
- The words page is not a side panel. That is the later half of UX audit #16.

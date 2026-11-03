# Cross-machine progress sync and the paid-service direction

Research date: 2026-11-02. Author: sync-service-exploration lane (Anthropic Opus 5.5, Lead).
Base: `main` at 72a36e8 (extension 0.12.23). This is a design proposal. Nothing in it is
built, deployed, purchased or published. Where it says "recommend", that is a proposal for
review, not a ruling; Ted's approved direction is quoted as such in [Direction](#direction).

## Bottom line

- **Sync is a merge problem, not a transport problem.** Today the only cross-machine path is
  the learning backup, and its import only accepts a *fresh, keyless* target
  (`targetFresh`, `extension/src/portability.js`); it replaces, it never merges. Any sync
  needs a new merge contract first. That contract, not the server, is the bulk of the work.
- **The scheduler makes a clean merge possible.** FSRS in `fsrs.js` is pure and deterministic
  (no fuzz, no clock reads), and `scheduleCard` in `review.js` is a deterministic mutator: its
  result depends only on the prior card, the rating, the time and three arguments. So a card's state can be rebuilt by replaying
  its rating operations in one agreed order. Recommend an **operation log**: each device
  appends small, idempotent operations; the server assigns a total order; every device folds
  the same ops in the same order and reaches the same cards.
- **Encrypt on the device; the server stores ciphertext and order only.** Records hold word
  IDs, times, ratings and user-typed personal vocabulary, never page text, URLs, hosts or
  keys. End-to-end encryption still matters: the personal entries are the user's own words
  and the timestamps are an activity diary. It also keeps the server trivially small, because
  the server never needs to read or merge anything.
- **The simplest server is small enough to self-host and to sell.** One AGPL process, SQLite,
  four tables, three endpoints (push, pull, snapshot). The hosted paid tier is the same
  binary plus billing at the edge.
- **Browser sync storage (`storage.sync`) should not carry this, even as an interim.** It
  does not cross browser vendors, which breaks the Firefox direction; its quota fits the
  226-card bundled deck but not the 5,000-card limits the backup already supports; and an
  interim would still need the whole merge contract. The file backup already covers one-shot
  moves.
- **Firefox needs the key-isolation prerequisite before any secret ships there.** The real
  Firefox probe found no `storage.local.setAccessLevel`, so content scripts can read
  `storage.local`. A sync token and an encryption key are secrets just like the Gemini key;
  they need a store content scripts cannot reach, or Firefox gets no sync, never a weaker one.
- **Pronunciation and token resale are separate products with separate authorization.**
  They are feasible; whether provider terms permit them is a different question, answered per
  provider in [Pronunciation](#pronunciation) and [Provider resale](#provider-resale).

## Direction

Recorded from the CTO's brief of 2026-11-02, as Ted's direction (approved, not proposals):

- A paid sync service, itself AGPL.
- Bring-your-own-key (BYOK) is preserved.
- A Firefox port.
- Paid AI-synthesized pronunciation (not only OS voices); pronunciation is an explicit user
  action.
- Eventually resell provider tokens (a hosted, no-key tier).
- No donations.
- Public launch deferred.

Everything else in this document (record formats, encryption model, recovery, server shape,
caps, prices) is a proposal.

## 1. What exists today (contract inventory)

All learning state lives in `chrome.storage.local`. Every key below is read from the source
at 72a36e8.

| Storage key | Module | What it holds | Shape and bounds |
|---|---|---|---|
| `settings` | `settings.js` | Preferences and site policy | `enabled, model, levelOverride, language, gradual, newWordsPerDay, density, inlineRecall, newSitesEnabled, siteOverrides{host:bool}`, optional `desiredRetention` (0.85–0.90), `guessFirst` |
| `apiKey` | `settings-handlers.js` | Gemini key | Written only after `setAccessLevel(TRUSTED_CONTEXTS)` succeeds (DESIGN.md) |
| `recallReview` (Spanish) / `lang:<code>:<version>:recallReview` | `review.js`, `scope.js` | Cards per scope | `{version:1, cards:{[wordId]: card}, current, inline, learning:{day,count}}`, ≤5,000 cards |
| `personalVocabularyV1` | `personal.js` | User-typed entries and their histories | `{version:1, revision, entries[≤300], history:{[lang]: review}}`; entry IDs `personal:<lang>:<uuid>` |
| `languagePacks` | `languages.js` | Generated vocabulary packs | `{[code]: {version: 16 hex, words[]}}` |
| `learningRetrievals` (scoped) | `learning-log.js` | One row per rating, claim or guess | Arrays `[word, at, source, direction, outcome, prior, latencyMs, elapsedDays, intervalDays, predicted]`, ≤5,000 |
| `learningExposures` (scoped) | `learning-log.js` | Lifetime per-word exposure aggregates | `[count, peeks, distinctDays, firstDay, lastDay]`, ≤5,000 words |
| `readingEvents`, `seenSent` (scoped) | `events.js` | Pending reading feedback, today's de-dup set | ≤500 |
| `vocabularyEncounters` (scoped) | `encounters.js` | Weekly-decaying encounter counts | ≤256 IDs, counts ≤7 |
| `c:*` | `cache.js` | Model decision cache | ≤5,000; keyed by passage hash |
| `keyEpoch`, `epoch`, `modelCalls`, `modelStatus`, `quotaState`, `consentShown`, `reloadedFor`, import journal/receipt, measurement-skip counter | various | Install-local bookkeeping | `NON_LEARNING_KEYS` in `portability.js` |

A card (`review.js`, validated in `portability.js card()`) is `{due, interval, reviews}` plus
optional `familiar, maintenance, easyStreak, introducedDay, introGateDay, fsrs:{stability,
difficulty, lastReview, lapses}, retiredReturn, claimAt, claimDue, peekDue, seenDay,
seenCount, peekDay, peekCount}`. Measured with Node on this tree: one card serialises to
about 184 bytes of JSON; the 226 bundled cards to about 42 KB; 5,000 cards to about 0.9 MB.

The learning backup (`portability.js`, schema 2, ≤1 MiB, log budget 512 KiB) is the existing
portable format. Its rules carry straight into sync:

- **Read before write.** "A build must read a schema before any build writes it"
  (`BACKUP_SCHEMA`/`READ_SCHEMAS`). Sync record versions follow the same release order.
- **Fail closed on malformed data; omit-and-count unverifiable log rows** (CTO ruling B).
- **Catalog-only IDs.** Every log write requires the scope catalog, so no URL, host or page
  text can enter (`learning-records.js`, `learning-log.js` privacy contract).
- **Install-local state is never exported**: key, consent, quota, epochs, receipts.

What the backup does *not* give sync: import requires a fresh keyless target and replaces
everything. There is no merge, no per-record identity for operations, no tombstone for a
reset card (`wordReset` in `progress-handlers.js` deletes the card outright), and the
retrieval log cannot be replayed exactly for cards migrated from pre-FSRS due/interval state
(`withFsrs` estimates, and the log deliberately does not record a prediction for them).

## 2. What syncs and what stays local

Principle: sync only what makes the *learning* continue on another machine. Everything about
*where* and *what* the user reads stays on the device.

| Syncs (opt-in, encrypted) | Stays local, always |
|---|---|
| Card operations for every scope: introduce, rate, already-know claim, guess, encounter, reset, scope adoption | `apiKey` and any other credential, including the sync token and the account secret at rest |
| Personal vocabulary entries (add, archive/unarchive) | Page text, URLs, hosts, titles: never present in sync records by construction |
| Installed language packs, as content-addressed blobs (`code`, `version`, words) | `siteOverrides` (hostnames are browsing history), `newSitesEnabled`, `enabled`, pause state |
| Learning preferences: `language, levelOverride, gradual, newWordsPerDay, density, inlineRecall, desiredRetention, guessFirst` | Decision cache `c:*` (passage hashes), `readingEvents`, `seenSent`, `vocabularyEncounters` |
| The retrieval log: observed rows carried in ops, plus the snapshot's rows | `model`, quota, model status, consent, epochs, import journal/receipts, measurement-skip counter |
| | Open review/inline tickets (`current`, `inline`): document- and tab-bound |
| | Lifetime `learningExposures` aggregates (stage 3 decision, see below) |

Notes:

- `model` stays local because it is tied to the device's key and quota tier.
- `siteOverrides` could be a later opt-in ("sync my site choices"); by default it is browsing
  history and stays local. Not proposed for v1.
- The retrieval log syncs as the observed rows inside `rate`, `claim` and `guess` ops and as the
  snapshot's rows (3.4), so the "is this working?" view and calibration see every device's
  reviews as each learner actually experienced them. Per-card encounter counters that change
  scheduling (`peekDue`, seen/peek day counters) sync through `encounter` ops.
- Lifetime exposure aggregates cannot be merged exactly (`distinctDays` double-counts days
  seen on two devices). Options: keep them per device (default), or sync per-device rows and
  show the sum as an upper bound. Recommend per device until the progress views actually need
  cross-device exposure totals.

## 3. Sync records

### 3.1 Envelope

Every record the server stores is an opaque envelope:

```
{ account, device, deviceSeq, serverSeq, kind: "ops" | "snapshot-part" | "device-retired", formatVersion,
  snapshot?: { snapshotId, baseSeq, partIndex, partCount },  // snapshot parts only
  lastDeviceSeq?,                                            // device-retired only
  nonce, ciphertext }
```

The server sees only those plaintext fields. Every plaintext field except `serverSeq` is also
the AES-GCM additional data (4.2), so the server cannot alter it undetected. `device` is a
random UUID made when sync is enabled on that install (not the extension ID, not a hardware
ID). `deviceSeq` increases by one per envelope the device writes, snapshot parts included. A
device seals and persists each envelope in its outbox **before** pushing it, never reuses a
`deviceSeq`, and pushes strictly in `deviceSeq` order, one accepted before the next is sent.
`serverSeq` is assigned by the server on accept. `formatVersion` is plaintext so the server can
refuse a client too old to read the account (3.7). `baseSeq` and the part fields are plaintext
for snapshot parts because the server needs them to tell when a snapshot is complete and to
compact (3.4). The fold skips `snapshot-part` envelopes; they are read only when loading a base.
A `device-retired` envelope is the one record the server writes itself: `device` names the
device, a plaintext `lastDeviceSeq` holds its last accepted `deviceSeq`, `deviceSeq`, `nonce`
and `ciphertext` are absent, and it is not authenticated. The fold reads it at its `serverSeq`
(3.4); it is excluded from `deviceMarks` and from the contiguity check. Because the server orders the
record after every envelope it accepted from that device, `lastDeviceSeq` must equal that
device's highest `deviceSeq` seen so far (in the base's `deviceMarks` or the pulled stream
before this record; a device's own unpushed outbox does not count); any other value is a
server fault (a lower one, or a higher one hiding withheld envelopes), and the client reports it
and ignores the record.

### 3.2 Operations (inside the ciphertext)

A batch is a list of operations, applied in order. Each operation has a stable ID
`(device, deviceSeq, index)`.

**Generations.** Every scope has a **scope generation** and every card a **card generation**.
Both start at `"0"`. A `scope.adopt` sets the scope generation to its own ID; a `reset` sets
the card generation to its own ID; so no two generations collide. Every card op names the
`(scopeGen, cardGen)` it was made against and is superseded if either differs from the folded
state. The generation maps live in the sync layer's own state, not in the card, so the stored
card format and every backup schema stay unchanged.

**Normalisation in the fold.** Every card op also carries the `gradual` setting its device had
when the op was made. The fold first checks the op's scope and card generations; only an op
that passes is applied further. For an op that writes the card (`introduce`, `rate`, `claim`,
`encounter`, `reset`; never `guess`) it then builds a candidate copy of the card from exactly
`cleanReview`'s per-card output for the op's `gradual` value (for example, with gradual on a
familiar or claimed card gains `maintenance`, and a familiar card without it gains
`retiredReturn`; with gradual off, `maintenance` and `peekDue` are dropped), as the device did
when it showed the card, checks the precondition against that candidate, and commits the
candidate with the op's effect only if the op applies and has an effect. A no-op (an
`introduce` of a present card, a My Words claim that hits an early return) discards the
candidate, as today's handlers return before saving. A superseded op never changes a card. A rating the device could make is therefore never superseded for a
difference only the device's normalisation created.

**Synced card fields** are exactly `due, interval, reviews, familiar, maintenance, easyStreak,
introducedDay, fsrs, retiredReturn, claimAt, claimDue, peekDue, seenDay, seenCount, peekDay,
peekCount`. `introReceipt` (install-local, already omitted from backups) and `introGateDay`
(device clock recovery, `gradual-budgets.js`) are not synced. Each device still applies its own
`cleanReview` when it builds its view, as it does on stored cards today.

**Observed rows.** Every logged op carries the complete row the learner's device would have
written, `{source, direction, outcome, prior, latencyMs, elapsedDays, intervalDays,
predicted}`. The log takes that row verbatim; the schedule comes from replay. A superseded op
still contributes its observed row, because the retrieval happened.

| Op | Fields (plus `scope, cardId, scopeGen, cardGen, at, gradual` for card ops) | Applied as |
|---|---|---|
| `introduce` | day | Create the card if absent; otherwise no-op |
| `rate` | rating, autoFamiliar, retention, observed row | Requires the card present and not retired (`familiar` without `maintenance`). `scheduleCard(card, rating, at, autoFamiliar, retention, early)`, where standalone keeps today's `early = card.due > at` (`rateReview`), and inline uses `early = dueAt(card) > at`. On one device the inline value is always false, because `finishInline` requires a due card, so equivalence holds; on replay a second same-day inline Easy onto a card that is no longer due counts as early and cannot extend the Easy streak. `autoFamiliar` is `true` for inline (as `finishInline` passes) and the `gradual` setting for standalone |
| `claim` | source, day, observed row (inline and standalone only) | Exactly today's branches; `day` is the device's local day, used only when the claim creates the card (`wordKnown` sets `introducedDay` from it), and a My Words claim on an archived personal entry is superseded, as `wordKnown` refuses it. Inline "Already know": `claimKnown`. Review page (`markFamiliar`): `claimKnown` with gradual, else `familiar = true`. My Words (`wordKnown`, not logged): with gradual, no-op if `claimDue` is already set, else create the card if absent and `claimKnown`; without gradual, no-op if already `familiar`, else create if absent and set `familiar` |
| `guess` | observed row | Appends the guess row; never changes a card (guesses are not reviews, `learning-log.js`) |
| `encounter` | kind (`seen`/`peek`), day | `countCardEncounter`; the per-day caps in `review.js` bound volume |
| `reset` | seen `{due, reviews, familiar, claimAt, claimDue}` | Applies only if the replayed card equals `seen`, the same check `wordReset` makes today; then deletes the card and sets its card generation to this op's ID. Otherwise superseded |
| `adopt.part` | adoptId, partIndex, partCount, cards `{id: card}`, log rows | Buffered; no effect until its commit |
| `scope.adopt` | adoptId, partCount, basis (the `serverSeq` the device had folded) | The user's explicit choice to make this device's history the scope's. Applies if every part is folded and the scope's `adoptSeq` (the `serverSeq` at which its current adopt applied; 0 for generation `"0"`) is ≤ `basis`. It then replaces the scope's cards with the parts' contents, sets the scope generation to this op's ID, `adoptSeq` to this op's `serverSeq`, and every card generation in the scope to `"0"`. Otherwise superseded. Other devices' card ops in the scope between `basis` and the adopt are recorded as "overwritten by adopt", and later ops still naming the old scope generation are superseded; both are shown to their users. `scope.adopt` is the only op in its envelope. Every log row has a stable identity (the op ID that produced it, or for rows recorded before sync, the adopting device and the row's ordinal). The scope's current log, except rows whose identity is present in the parts, moves to its separate **overwritten log** (bounded at 5,000 rows, oldest evicted, appended to by each later adopt), which keeps it for history and calibration but is not read by card-derived views such as `verifiedWords`; the main log becomes the parts' rows, stamped with the commit's `serverSeq`, their order within the parts, and the adopter's device. A `basis` at or above the commit's own `serverSeq` is malformed. Parts are keyed by `(device, adoptId)` and a commit uses only its own device's parts. A device writes an adopt's parts and commit as consecutive `deviceSeq`s, with no other envelope (snapshot parts included) between them; buffered parts are dropped as soon as that device's next envelope is not the next part or the commit, when the commit applies or is superseded, or at that device's `device-retired` envelope (3.4) |
| `personal.add` | entry (the validated `personalVocabularyV1` entry) | Insert by UUID, then fold-time de-duplication (3.6) |
| `personal.archive` | uuid, archived, at | Last-writer-wins register on the survivor (3.6) |
| `pref.set` | field, value, at | Last-writer-wins register per field |
| `pack.install` | code, version, blobId | Reference to a pack blob (3.4) |

Last-writer-wins orders by `(at, device, op ID)`, so even two changes from one device in the
same millisecond resolve.

"Superseded" is a deterministic no-op recorded in the device's sync state, so the UI can say,
for example, "a review on another device was discarded because you reset this word".

Validity is a function of the op and the folded state only. Card IDs are checked by syntax
(`validWordId`) at fold time, not against the device's bundled catalog, because the bundled
list can differ between extension versions; catalog membership is applied when a device builds
its local view, exactly as the backup's omit-and-count rule (ruling B) does today. An op that
is malformed is a recorded no-op on every device, never a reason to stop. Folding stops only on
an op *type* or `formatVersion` the client does not know (3.7). A device pushes `pack.install`
before or in the same batch as any op for that pack's scope.

What is *not* in an op: no page text, no URL, no host, no passage hash, no title, no key, no
model output except pack words the user explicitly generated and installed. No practice-now op:
`wordPractice` only writes the local review ticket.

### 3.3 Order and replay

The server's `serverSeq` is the single total order. Each device keeps:

- a **base**: a complete sync snapshot at some `serverSeq` N (3.4), or empty;
- the envelopes with `serverSeq > N`, in order;
- an **outbox** of its own sealed envelopes. On every pull, and after loading a snapshot, the
  device drops outbox envelopes whose `deviceSeq` is at or below the highest of its own
  `deviceSeq`s seen in the base's `deviceMarks` or in the pulled stream. A push whose
  acknowledgement was lost is therefore never folded twice.

Local state = fold(base, pulled ops in `serverSeq` order, then the remaining outbox in
`deviceSeq` order, as if its `serverSeq` were above every pulled one). After a pull, the device re-folds. Because the fold is deterministic and
every device folds the same sequence, all devices converge once they have pulled the same
`serverSeq`.

Why server order rather than wall-clock order: device clocks disagree and can go backwards;
`elapsedDays` already clamps a backward step to zero (`fsrs.js`), so an op that arrives "late"
is still well defined. Wall-clock ordering would force re-folding history whenever an old op
arrives, and history below a snapshot no longer exists.

### 3.4 Snapshots, de-duplication and compaction

Ops grow without bound (about 176 bytes of JSON per rating op measured here; a 100-review day
is roughly 18 KB before compression). A **sync snapshot** is its own schema, not a backup file:

```
{ formatVersion, baseSeq: N, deviceMarks: { [device]: highest deviceSeq at or below N },
  scopes: { [scope]: { scopeGen, adoptSeq,
                       cards: { [id]: { cardGen, card | null } } } },
  personal: { entries, aliases, archived: { [uuid]: {value, at, device, opId} } },
  prefs: { [field]: {value, at, device, opId} }, packs: { [code]: {version, blobId} },
  log: { [scope]: rows with { serverSeq, opIndex, device } }, overwritten: { [scope]: rows },
  pendingAdopts: { [device]: { [adoptId]: parts } }, retired: { [device]: serverSeq } }
```

- The generation map is **complete**: every card ID whose generation is not `"0"` is present,
  with `card: null` when the card was reset and not reintroduced. Compaction can therefore never
  revert a reset card to generation `"0"`, and a late pre-reset `introduce` stays superseded.
- It holds only synced state: no reading events, `seenSent`, encounter buckets, exposure
  aggregates, ticket state or install-local keys.
- A snapshot is split into `snapshot-part` envelopes under the 256 KiB envelope cap, with its own
  total cap (proposal: 4 MiB, above the 0.9 MB a full 5,000-card deck needs). The last part also
  carries a hash of the whole decoded snapshot. A client accepts it only if every part is present,
  the hash matches, and the sealed `baseSeq` equals the plaintext one.
- The server treats a snapshot as **complete** only when all `partCount` parts of a `snapshotId`
  are stored with matching `baseSeq` and `partCount`. The **latest** snapshot is the complete one
  with the highest `baseSeq`, not the most recently finished. The server keeps a compaction floor
  (the highest `baseSeq` it has compacted against) and never serves or compacts against a
  snapshot below it. It refuses a part whose `baseSeq` exceeds the highest `serverSeq` it had
  assigned before that part. An abandoned upload is ignored and its parts are deleted only by compaction, once
  they are at or below a later complete snapshot's `baseSeq`, so deleting them never opens a
  `deviceSeq` gap.

Any device may write a snapshot of the server prefix it has folded, never including its own
outbox. A new device downloads the latest complete snapshot plus envelopes after its `baseSeq`.

De-duplication survives compaction:

- The server keeps each device's highest accepted `deviceSeq` on the `devices` row. A push at or
  below it is answered "already committed" with no insert, even after the envelope was compacted.
- The outbox rule in 3.3 drops anything the snapshot's `deviceMarks` or the stream already shows.
- `deviceMarks` counts every envelope at or below `baseSeq`, snapshot parts included. Clients check
  that each device's `deviceSeq` values arrive contiguously above its mark; a gap means the server
  is withholding an envelope (3.8).

When a device is revoked or stops being active, the server appends a `device-retired` envelope
(3.1) naming it; the fold drops that device's buffered adopt parts there, and snapshots record
it in `retired` (informational, holding the latest such `serverSeq`, not cleared when the device
returns). The server writes an inactivity record only once per silence: again only after the
device has pulled since its last one (`devices.retired_seq`). The server refuses pushes only from a **revoked** device. An inactive device
that returns reloads from the snapshot and resumes pushing; its later envelopes fold normally.
If its pending adopt lost its parts this way, the commit is superseded and the device offers the
choice again from its kept copy (3.7). The envelope is unauthenticated, but forging one
costs only liveness, which the server can already deny by withholding envelopes.

The server may delete envelopes at or below the latest complete snapshot's `baseSeq` once every
**active** device has pulled past it. A device is active while its token is not revoked and it
has pulled within the retention window (proposal: 90 days). A silent device that returns
reloads from the snapshot, drops what the marks show is committed, and pushes the rest of its
outbox, which gets new, later `serverSeq` values. Nothing is lost or applied twice.

The local retrieval log is the snapshot's rows plus the observed rows of later ops, in fold
order (`serverSeq`, then op index; outbox rows last, by `deviceSeq`). That is the same order the
schedule was replayed in, so `verifiedWords`, which reads "log order is retrieval order", agrees
with the cards. Device clocks are not trusted for order (3.3), so the true cross-device order of
two offline reviews of the same word is unknowable; fold order is the deterministic stand-in. The log is bounded at 5,000 rows as today,
evicting oldest by that order. Rows a device recorded before it enabled sync enter through its
`scope.adopt`.

Packs are blobs addressed by `blobId = HMAC(blobKey, sha256(code, version, words))` (4.2), so
the server cannot match an address against published packs. Each blob is sealed with its
`blobId` as additional data, and the client recomputes the HMAC after decrypting, so the server
cannot swap contents between IDs. It still sees how many blobs an account has and their sizes.

### 3.5 Concurrency cases

| Case | Result | Why it is acceptable |
|---|---|---|
| Two devices rate *different* cards offline | Both apply | Ops commute across cards |
| Two devices rate the *same* card offline | Both apply in server order; the second is scheduled from the first's result, with the early rule of 3.2 and elapsed time clamped to ≥0 | Both reviews happened. Replay cannot create a streak or familiarity that a single device could not reach. Each log row keeps what that learner saw |
| Push acknowledged late, lost, or repeated, including after compaction | Applied once | Server high-water mark, `deviceMarks`, and outbox pruning on every pull |
| Reset on A after B rated, B's rating earlier in server order | Reset is superseded: the card it saw changed | Same rule as today's local guard: a stale reset loses |
| Reset on A, rating on B made before B saw the reset, reset earlier in server order | Reset applies; B's rating names the old card generation and is superseded | Deterministic either way. Both outcomes are states one device could reach. The losing action is shown to the user |
| Two resets of the same card | The first in server order applies; the second no longer matches its `seen` card or generation and is superseded | Generation IDs are op IDs |
| Introduce on two devices | First creates the card; the second is a no-op | Idempotent per generation |
| Op from before a reset or adopt, delivered after it, before or after compaction | Superseded by the card or scope generation | No resurrection; the generation map is complete in snapshots |
| My Words "known" on two devices with gradual on | The first claims; the second sees `claimDue` set and is a no-op | Same early return as `wordKnown`; the verification date is not pushed later |
| Daily new-word budget | Each device counts introductions for its local day, its own and synced ones | Two offline devices can overshoot by at most devices × budget for that day; recorded, not prevented. Preventing it would need the server to allocate budget, which means reading state |
| Preference changed on both | Last writer by `(at, device, op ID)` wins per field | Single-valued choices |
| Personal entry archived on A, unarchived on B | Last writer wins | Same |
| Two devices enable sync on non-empty installs at once | The first complete `scope.adopt` applies; the second sees another adopt after its `basis` and is superseded; that device still has its kept copy (3.7) and asks the user again | One history per scope, never card-by-card mixing |
| Another device keeps reviewing while this device adopts | The adopt applies. The other device's ops between `basis` and the adopt are recorded as overwritten, and its later ops are superseded; both are shown, and their observed log rows are kept | The user explicitly chose this device's history; no livelock, no silent loss |
| A malformed op from a buggy device | Recorded no-op on every device | No device stops; no device disagrees |
| Old-format client | Refused by `formatVersion` (3.7) | Never silently ignores ops it cannot read |

### 3.6 Personal vocabulary

`addPersonal` rejects an exact duplicate today (`exactPersonal`) and flags a shared spelling
with a different meaning for explicit review; the store is capped at 300 entries. Two offline
adds can bypass all three. The fold therefore, in server order:

- keeps the earlier of two entries that match under `exactPersonal` and records the later UUID as
  an **alias**. Card ops and `personal.archive` naming the alias apply to the survivor, so reviews
  on either device count;
- keeps both entries when the spelling is shared but the meaning differs, with the same "shared
  spelling needs explicit review" status the capture page shows today;
- supersedes adds beyond 300 entries. Card ops for a superseded entry are superseded too. The
  adding device shows "not synced and not included in backups: the personal list is full" and
  moves that entry and its card
  to a local-only overflow store that is never pushed; later reviews of it apply there only. The
  current backup format cannot carry it (`personal()` validates at most 300 entries), so it stays
  visible on that device only and is lost if that device is. This only arises from concurrent
  offline adds near the cap, and it is a known limitation until the cap question below is ruled. Today's cap counts
  archived entries and nothing deletes personal entries, so archiving does not free a slot;
  whether it should is a product question for root to file, not decided here.

### 3.7 Versions and migration

- `formatVersion` (plaintext) names the op and snapshot schema. A client reads every version up
  to its own and refuses an account whose `formatVersion` is newer, with "update Lang Weave to
  sync". The release order is the backup's: a reader ships before any client writes.
- Each device records on the server the highest version it reads. A client writes a new version
  only when every active device (3.4) reads it, and otherwise keeps writing the old one. Chrome
  and Firefox listings update on different schedules, so one updated device must not lock out the
  others.
- The server stores the account's highest written `formatVersion` and refuses pushes from clients
  that say they cannot read it. It never transforms ciphertext.
- Op validators reuse the backup's checks, which are private to `portability.js` today: stage 0b
  exports them. The backup's `preferences()` has no `guessFirst` field yet (it is in
  `settings.js` only), so 0b also adds its validation.
- First enable on an existing install needs the server reachable at the start. The device
  keeps a copy of its pre-enable learning state locally until, per scope, its `scope.adopt`
  applies or the user picks the account's history. If the account has nothing for a scope, the
  device pushes its parts and `scope.adopt`. If the account already has that scope, the user
  chooses per language: "keep this device's progress" (push an adopt) or "keep the account's"
  (after offering a learning backup export).
- Nothing is held. The adopt's parts and commit are sealed and queued (their `deviceSeq`s
  assigned) before any later write, so they always reach the fold first. Card writes made after
  the choice go to the outbox naming the pending adopt's scope generation and are also applied
  to the kept copy. If the server becomes unreachable
  mid-adopt, the outbox simply waits, and learning continues on the local view. If the adopt is
  superseded by a competing adopt, the device offers the same choice again from the kept copy,
  which includes those writes. The user can also cancel enabling sync: the device stops pushing,
  waits for any in-flight push to finish or time out, discards every sealed envelope it never
  transmitted, and revokes its own device token; `DELETE /v1/device/<id>` returns
  `max_device_seq` in the same transaction as the revoke. The server checks a push's token and
  inserts its envelope in one write transaction, serialised against the revoke (one SQLite
  writer), so no push can land after the revoke and the returned value is exactly what landed. A
  repeated `DELETE` by the same, now revoked, token returns the same value, so a lost response
  can be retried. It returns the scope to the kept copy. The server's `device-retired` envelope drops
  any adopt parts that landed. A commit that already landed stays applied, and the user is told
  so. If it was the account's only device, re-enabling later needs the
  recovery code. Anything already
  accepted stays in the account. A later re-enable uses a new device ID, so no `deviceSeq` is
  ever reused. Either way a scope has one history, never a card-by-card mix.

### 3.8 What the server is trusted with

The server is trusted for order and availability, not for contents. It cannot read, forge or
alter a device's record (4.2). Its own `device-retired` envelopes are the one unauthenticated
record, and a forged one can only stop a device's adopt or retire a device: liveness, not
contents. It could withhold a batch, show two devices different orders, or serve an
old snapshot. Contiguous `deviceSeq` checks detect withholding of a known device's batches.
Detecting a forked order needs each batch to carry a hash of the `serverSeq` prefix its author
had folded, compared across devices; that is possible later and not proposed for v1.

## 4. Identity, account, recovery and encryption

### 4.1 Trust boundaries

| Party | Can see | Cannot see |
|---|---|---|
| Lang Weave server (self-hosted or hosted) | Account ID, device IDs, sizes and times of pushes/pulls, number and sizes of blobs, snapshot metadata (`baseSeq`, part counts, how often snapshots are written), `formatVersion`, payment status (hosted); for hosted pronunciation only, the requested word (see [Pronunciation](#pronunciation)) | Any card, rating, synced word, personal entry, pack or preference |
| Payment processor (hosted only) | The paying person's billing identity | Anything about learning |
| Content scripts on web pages | Nothing sync-related (requirement: 4.4) | Sync token, account secret, ciphertext |
| Each enrolled device | Everything for that account | Other accounts |

### 4.2 Keys

- **Account secret**: 32 random bytes made on the first device. HKDF derives separate keys
  from it: an AES-GCM **encryption key** and an HMAC **blob key**. Every op batch and snapshot
  part is sealed with a fresh random 96-bit nonce. The additional authenticated data is a
  canonical encoding (fixed field order, with an explicit marker for absent fields) of the
  client-written header: `account, device, deviceSeq, kind, formatVersion` and, for snapshot
  parts, `snapshotId, baseSeq, partIndex, partCount`. The server therefore cannot move an
  envelope to another account, device or `deviceSeq`, or relabel a snapshot part, undetected.
  `serverSeq` is assigned after sealing and is not authenticated (3.8).
- The account secret itself must be kept as bytes, because pairing hands it to a new device. It
  lives only in the secret store (4.4). The derived keys are imported as non-extractable
  `CryptoKey`s for use.
- **Recovery secret**: a second 32 random bytes, shown once in the recovery code and **never
  stored on any device**. The server stores a verifier hash derived from it. It also stores the
  account secret wrapped (AES-KW or AES-GCM) under a key derived from the recovery secret.
- **Device token**: a random bearer secret the server issues at enrolment and stores hashed. It
  authorises push and pull for one device and can be revoked per device.
- No password is needed for sync itself.

### 4.3 Enrolment and recovery

- **First device**: "Turn on sync" creates the account on the chosen server (hosted, or a
  self-hosted URL). It generates both secrets and shows the **recovery code**: the account ID and
  the recovery secret, about 60 characters with a checksum, for writing down or printing. The user
  must confirm they saved it.
- **Another device**: pairing is a commit-then-reveal exchange, relayed by the server, using
  ephemeral ECDH P-256 key pairs (WebCrypto) on both devices.
  1. The new device makes key pair N and registers a pairing ticket with the server, holding only
     the commitment `H(pkN)`. It shows the ticket ID and `H(pkN)` as a QR code, and the ticket ID
     alone as a short typed code.
  2. The enrolled device reads `H(pkN)` (from the QR code if it scanned one, else from the
     server) and pins it **before** it makes key pair E and posts `pkE`. It never accepts a
     different commitment for that ticket.
  3. The new device receives `pkE`, pins it, and only then reveals `pkN`; it never accepts a
     different `pkE`. The enrolled device checks `pkN` against the pinned `H(pkN)`.
  4. Both derive the shared key with HKDF over the ECDH output. The salt is the hash of the
     transcript (server origin, ticket ID, `pkN`, `pkE`).
  5. Both screens show a six-digit comparison code from the same derivation, and the user
     confirms the codes match.
  6. Only then does the enrolled device send the account secret and a one-time enrolment
     authorisation, sealed under the shared key. The new device redeems the authorisation for
     its own device token.

  Because each side pins what it received before the other side's key is revealed, a relay must
  fix any substitute key before it can compute either code, so one substitution attempt passes
  with probability about 10⁻⁶. With a scanned QR code, substituting `pkN` fails outright.
  Impersonating the enrolled device to the new device (which would enrol it into an attacker's
  account) is still stopped only by the code comparison. A ticket is single-use and expires
  after five minutes; a mismatch burns it, and the client stops after three failed tickets in an
  hour. The server never sees the secret. The short code only names the ticket and never carries
  key material.
- **Recovery** (all devices lost): enter the recovery code on a new install. Presenting the
  recovery verifier gets a device token and the wrapped account secret, which the recovery secret
  unwraps. No email or password is needed for sync. A hosted account's billing sign-in stays with
  the payment processor.
- **Revocation is real**: revoking a device's token stops its pulls and pushes. That device cannot
  re-enrol through recovery, because no device holds the recovery secret. It still holds the
  account secret, so it can decrypt ciphertext it already has or could obtain. Shutting that off
  needs key rotation: a new account secret, a fresh snapshot, re-pairing the remaining devices,
  and re-wrapping the new secret under the recovery secret, which means asking for the recovery
  code (or issuing a new one). Rotation is specified for stage 3, not v1.
- **Lost recovery code and all devices**: the encrypted data is unrecoverable by design. Local
  learning backups still work as today. This is the main product trade-off of end-to-end
  encryption and is listed as an [open decision](#open-decisions).

### 4.4 Firefox key-isolation prerequisite

The Firefox probe (ditz `firefox-probe`, 2026-10-30, Firefox 158) found
`storage.local.setAccessLevel` absent and showed a content script reading a value written to
`storage.local`. DESIGN.md already fails closed for the Gemini key on such a browser. The sync
token and account secret get the same rule, with no silent weakening:

- Secrets (Gemini key, device token, account secret) live only in a store content scripts cannot
  read. On Chrome ≥140 that is `storage.local` after `setAccessLevel(TRUSTED_CONTEXTS)`.
- On Firefox, until it has `setAccessLevel`, the candidate store is the extension origin's own
  IndexedDB, opened only from the background page and extension pages. It holds the secrets as
  bytes (the account secret must stay exportable for pairing, 4.2); the derived working keys are
  re-imported as non-extractable `CryptoKey`s, which are structured-cloneable into IndexedDB. Chrome documents that web storage called from a content script "accesses data from
  the host page the content script is injected on and not the extension" [S6], and MDN that a
  `CryptoKey` "is a serializable object" storable with standard web storage APIs [S9]. No
  primary page states the extension-origin IndexedDB case for Firefox outright, so the store
  ships only behind a real-Firefox test that a content script cannot read it (the same harness
  the probe used).
- `storage.session` is not a substitute for the account secret: it is not exposed to content
  scripts by default in either browser [S1, S4], but it is cleared when the browser closes, so
  the user would re-pair every session.
- Firefox private browsing: extension pages' `indexedDB.open` fails in permanent private
  browsing (Bugzilla 1427986, duplicate of 1893821) [S8]. In that mode sync is unavailable, not
  degraded.
- Until that store is implemented and pinned by a test that fails if a content-script-readable
  area holds a secret, Firefox shows sync as unavailable with fixed copy. It never falls back to
  `storage.local`.
- The probe also showed content scripts can read *learning* data on Firefox. Learning data is not
  a secret (no keys, no page text), but plaintext learning data being readable by any content
  script of this extension is a reason to keep the decrypted sync state in the same trusted store
  and to write only the existing learning keys to `storage.local`.

## 5. Server

### 5.1 Simplest self-hostable AGPL server

One process, one SQLite file:

```
accounts(id, created_at, format_version, plan,              -- plan: null when self-hosted
         recovery_verifier, wrapped_secret)
devices(id, account_id, token_hash, created_at, last_pull_seq, max_device_seq, max_read_version,
        revoked_at, retired_seq)
envelopes(server_seq PK, account_id, device_id, device_seq, kind, format_version,
          snapshot_id, base_seq, part_index, part_count,        -- snapshot parts only
          last_device_seq,                                       -- device-retired rows only
          nonce, ciphertext, created_at, UNIQUE(account_id, device_id, device_seq))
          -- device-retired rows: device_seq, nonce, ciphertext NULL (outside the UNIQUE rule)
blobs(account_id, blob_id, ciphertext, PRIMARY KEY(account_id, blob_id))   -- blob_id is an HMAC
```

Endpoints (JSON over HTTPS, device token in `Authorization`):

- `POST /v1/push {deviceSeq, kind, formatVersion, snapshot?: {snapshotId, baseSeq, partIndex,
  partCount}, nonce, ciphertext}` → `{serverSeq}`. A snapshot part whose `baseSeq` exceeds the
  highest `serverSeq` already assigned is refused. A
  `deviceSeq` at or below the device's `max_device_seq` returns "already committed" without an
  insert; one that skips ahead is refused.
- `GET /v1/pull?after=<serverSeq>` → the latest *complete* snapshot's parts if `after` is below its
  `base_seq`, then envelopes in order, paginated; records the device's `last_pull_seq`.
- `PUT/GET /v1/blob/<blobId>` for pack blobs.
- Enrolment: `POST /v1/account`, `POST /v1/pairing` (ticket and public-key relay), `POST /v1/enroll`, `POST /v1/recover`, `DELETE /v1/device/<id>`.

Per-account caps (proposal; Ted's call where they become product limits): envelope ≤256 KiB,
snapshot ≤4 MiB across its parts, blob ≤1 MiB, a storage ceiling, and a push rate limit. Retention: ops below the latest snapshot
are compacted per 3.4.

Language: whatever the extension's test toolchain already uses keeps one toolchain (Bun can run
an HTTP server and SQLite without dependencies), but this is an implementation choice, not a
contract. The contract is the envelope and the endpoints above.

AGPL: the server is AGPL-3.0-or-later like the extension. Section 13 requires that users
interacting with a modified version over a network be offered its source; the server answers
`GET /v1/source` with a link to its exact source revision, and the extension's sync settings
show it. Section 13: a modified version "must prominently offer all users interacting with it
remotely through a computer network ... an opportunity to receive the Corresponding Source"
[S20]. AGPL permits charging for the hosted service.

Prior art checked: Anki's own sync server is AGPL-3.0-or-later, one process, no external
database, multi-user by environment variables, not end-to-end encrypted [S21]; Etebase's server
is AGPL-3.0 and built for end-to-end encryption, but needs Django, uvicorn and nginx [S22];
Automerge's sync server is MIT and describes itself as "an unsecured Express app" [S23]. None
speaks Lang Weave's records, and adopting Etebase's client library would add a dependency to an
extension that has none. The proposal borrows Anki's footprint and Etebase's trust model rather
than either codebase.

The extension must also stay fully usable with sync off: no account appears in onboarding, and
the "no account" positioning in ROADMAP.md stays true for anyone who never turns sync on.

### 5.2 Hosted paid operation

Same binary, plus:

- Billing at the edge: the server stores only `plan` and an opaque customer reference; the
  payment processor holds the billing identity. Stripe lists 2.9% + 30¢ per domestic card charge
  plus 0.7% for Billing, with tax compliance left to the seller [S24]; Paddle and Lemon Squeezy
  list 5% + 50¢ as merchant of record, handling VAT and sales tax [S25, S26]. On a $4 monthly
  charge that is roughly 45¢ against 70¢.
- Hosting: one small VM with the SQLite file on local disk, backed up encrypted off-site. The
  data is ciphertext, so a backup leak exposes only metadata.
- Cost shape: storage per user is tiny (a heavy user's compacted snapshot is under 1 MB; a year
  of ops before compaction is a few MB), so the cost floor is the VM, the processor fee and the
  operator's time, not bandwidth. Fly.io lists a 256 MB shared-CPU machine at $2.19 a month
  and volumes at $0.15/GB-month [S27]; Hetzner lists cloud servers from €5.99 a month [S28].
  The floor is single-digit dollars a month before the first user.
- Policy surfaces that change when a server exists: the Chrome Web Store user-data disclosure and
  privacy policy, and Firefox's `data_collection_permissions`. These are outward acts; the
  proposal prepares text, Ted publishes. The Chrome Web Store requires a prominent in-product
  disclosure and consent before transmitting user data, a secure connection, and Limited Use
  [S11]; turning on sync is that consent screen. Firefox's data categories are
  `personallyIdentifyingInfo`, `healthInfo`, `financialAndPaymentInfo`, `authenticationInfo`,
  `personalCommunications`, `locationInfo`, `browsingActivity`, `websiteContent`,
  `websiteActivity`, `searchTerms`, `bookmarksInfo`, plus optional-only
  `technicalAndInteraction` [S12]. None names learning progress cleanly; which one an opt-in sync
  declares belongs to the existing `firefox-identity-ruling`. AMO also requires that add-ons
  "limit data transmission to what is necessary for functionality" and that reviewers get test
  credentials when an account is needed [S13].

## 6. Browser sync storage as an interim

What `storage.sync` offers, from current docs:

| | Chrome | Firefox |
|---|---|---|
| Quota | 102,400 bytes total, 8,192 per item, 512 items; 1,800 writes/hour, 120/minute [S1] | Same byte and item quotas, enforced since Firefox 79 [S3] |
| When sync is off | "behaves like storage.local" [S1] | Desktop needs "Add-ons" ticked in Sync preferences [S3] |
| Reach | "every Chrome browser that the user is logged into" [S1]; other Chromium browsers unverified | Firefox desktop instances only; "Firefox for Android does not synchronize data with the user's account" [S3] |
| Conflicts | Not documented | Server wins per key; MDN suggests merging in `onChanged` [S3] |
| Who can read it | Google, unless the user set a sync passphrase [S2]; content scripts unless `setAccessLevel` is applied [S1] | Mozilla says Firefox Sync is end-to-end encrypted by default [S10]; whether that covers add-on data is not stated; content scripts can read it (no `setAccessLevel`) [S5] |

Assessment:

- **It cannot be the cross-browser answer.** Chrome data never reaches Firefox and vice versa,
  and Firefox for Android does not sync at all. Ted's Firefox direction rules it out as the
  primary path.
- **It fits only small decks.** The 226 bundled cards are about 42 KB of JSON, which fits after
  sharding into items under 8 KB. A full 5,000-card deck (about 0.9 MB) does not, and neither does
  a log of review operations.
- **It still needs the merge contract.** Per-key "server wins" means two machines that both
  reviewed would overwrite each other unless the records are the same op-based design as above.
  An interim would therefore build most of stage 1 anyway, and then a second transport.
- **It weakens the trust story** relative to the proposal: Google can read it without a sync
  passphrase.

Recommendation: no `storage.sync` interim. If a free, account-free, Chrome-only path is later
wanted, the op log could gain a second transport adapter for small decks; that is a later option,
not part of this plan. Until stage 2 ships, the learning backup remains the supported way to move
progress, as today.

## Pronunciation

Ted's direction: paid AI-synthesized pronunciation, an explicit user action, not only OS voices.
The open ditz `audio-local-voices-ruling` (local Web Speech voices) and `speech-voicefor` remain
useful as the free baseline; this section is about synthesis.

### What a request contains

One word or short phrase, its language, a voice. Never the page sentence, URL or host. The word
comes from the catalog or the user's personal entry, so it is already bounded by the same
validators (`validForm`, pack forms).

### Cost per word is negligible; caching decides the rest

| Option | Price (checked 2026-11-02) | Caching | Disclosure | Data handling | Spanish |
|---|---|---|---|---|---|
| Gemini API TTS, `gemini-3.8-flash-lite-tts` | $0.50 / 1M text tokens and $6.00 / 1M audio tokens through 2026-12-31; $1.00 and $12.00 from 2027-01-01. Free tier: free of charge [S19]. 25 audio tokens per second [S19] | No audio-specific clause found; "You're responsible for your use of generated content, and for the use of that content by anyone you share it with" [S15] | None found [S37] | Free tier: used to improve Google products; paid: not [S19] | Yes [S37] |
| Amazon Polly | $4 Standard, $16 Neural, $30 Generative per 1M characters [S33] | "You can cache and replay Amazon Polly's generated speech at no additional cost" [S32] | None found | May store and use text to improve the service, with an org-level opt-out [S32] | Not verified |
| OpenAI `gpt-4o-mini-tts` | $0.60 / 1M text tokens, $12.00 / 1M audio tokens [S29] | Customer owns Output (OSA 4.1) [S17] | Required: "clear disclosure to end users that the TTS voice they are hearing is AI-generated" [S31] | Not used for training by default (OSA 4.2) [S17] | Yes; voices tuned for English [S31] |
| Google Cloud TTS | About $4–$30 per 1M characters by voice tier (from official localized pages; English table did not load) [S34] | No clause found in the part of the terms read | None found | Generated Output is Customer Data [S40] | Not verified |
| Azure AI Speech | Not verified | No clause found | Required by Microsoft's AI Code of Conduct [S35] | Not verified | Not verified |
| ElevenLabs | About $40–$80 per 1M characters [S36] | Paid users keep rights in Output [S36] | None required | Used to improve, with opt-out [S36] | Not verified |
| Self-hosted open weights: Kokoro | Server CPU only | Apache-2.0 code and weights: no provider terms on reuse [S39] | Proposal: label anyway | Nothing leaves the operator | Yes (one female, two male voices) [S39] |
| Self-hosted open weights: Piper | Server CPU only | Code GPL-3.0 (compatible with an AGPL service); **voice licences vary**: es_ES davefx CC0, es_MX ald Unlicense, es_ES sharvard CC-BY 3.0, es_AR daniela CC-BY-SA 4.0 [S38] | Proposal: label anyway | Nothing leaves the operator | es_ES, es_MX, es_AR [S38] |

Arithmetic, not a price proposal: a one-second word is about 25 audio tokens, so on Gemini
Flash-Lite TTS it costs about $0.00015 now and $0.0003 from 2027. Synthesising 10,000 distinct
words once is about $1.50–$3. Polly Neural at about 8 characters a word is similar. With a cache,
synthesis is a rounding error; storage (a short clip is a few KB) and the operator's time are the
real costs.

### Shapes

- **BYOK (free, no server).** The extension calls Gemini TTS with the user's own key, through the
  existing worker model queue, and caches the clip in the extension's own storage keyed by
  `(model, voice, language, text)`. Same terms position as weaving today (the "not for consumer
  use" and 18+ clauses, free-tier data use) [S15]. No new trust boundary.
- **Hosted (paid).** `POST /v1/speak {language, text, voice}` on the same server, authorised by the
  device token and metered per account. Unlike sync, this request is plaintext to the server: it
  must synthesise. Proposal: a shared server-side cache only for words in a published catalog
  (bundled and published packs), so a popular word is synthesised once for everyone; personal-entry
  text is synthesised, returned, cached on the device, and not retained on the server. No
  account-to-word log beyond the meter count.
- **Pre-generated catalog audio.** The bundled 226 words could be synthesised once and served as
  static files. Whether those files may ship inside an AGPL extension depends on the provider: an
  Apache-2.0 or CC0 voice is clean; a provider's output rights are not established by anything read
  here.

Recommendation for the hosted engine, for Ted to rule on: start from self-hosted open weights
(Kokoro, or Piper with CC0/Unlicense voices only) because they carry no provider terms on caching
or redistribution and keep the requested words on the operator's machine; compare quality against
Gemini Flash-Lite TTS with a native-speaker listen before choosing. Label every synthesised clip
"AI voice" whatever the provider: OpenAI and Microsoft require it, and it costs nothing elsewhere.
This document does not propose a daily cap, a price or a free allowance; those are product limits.

## Provider resale

Ted's direction: eventually resell provider tokens, a hosted no-key tier. Feasibility and
authorization are separate.

**Feasible:** the same server gains `POST /v1/weave`, carrying the passage and catalog the worker
sends to Gemini today, and calls a model on the operator's billed account. The extension's existing
validators (unlisted words, gloss mismatch, no HTML insertion) apply unchanged to the reply.

**Changes the privacy model:** for hosted-tier users, page text then reaches a Lang Weave server.
The current honest claim, "no Lang Weave server ever sees the reading" (ROADMAP positioning), stops
being true for them. It must be a separate, explicit opt-in with its own disclosure, never implied
by turning on sync, and the passage must not be stored or logged beyond the request.

**What the terms say (authorization is Ted's, with counsel where needed):**

| Provider | Building a product for end users | Reselling access |
|---|---|---|
| Gemini API | Services are for "professional or business purposes, not for consumer use"; users must be 18+; only paid services for users in the EEA, UK and Switzerland; paid-tier prompts not used to improve products [S15] | The Additional Terms have no explicit resale clause. Google's general APIs terms bar "Sublicense an API for use by a third party" and an API client "that functions substantially the same as the APIs" offered to third parties [S16]; whether those terms govern the Gemini API was not verified |
| Vertex AI | Explicit "Customer Application" and "End Users" concepts; no generative AI use in services "directed towards or ... likely to be accessed by individuals under the age of 18" [S40] | Not checked beyond that |
| OpenAI | Explicit right "to make Customer Applications available to End Users" (OSA 2.2) [S17] | "Customer may not resell or lease access to its Account or any End User Account" (3.1); no buying, selling or transferring API keys (3.3(g)) [S17] |
| Anthropic | May "power products and services Customer makes available to its own customers and end users" (A.1) [S18] | May not "resell the Services except as expressly approved by Anthropic" (D.4(a)) [S18] |

Reading, not legal advice: OpenAI and Anthropic explicitly allow a product that uses the model to
deliver its own feature to end users, and neither allows selling raw access. Gemini is
unresolved: its terms describe a developer service "not for consumer use", and whether Google's
general sublicensing ban applies was not verified; that needs a ruling, with counsel if Ted wants
it, before a Gemini-backed hosted tier. A `/v1/weave` endpoint that only performs Lang
Weave's own prompt and returns validated swaps is the product shape; a general model proxy is the
resale shape, and is not proposed. "Resell provider tokens" should be understood, and marketed, as
selling the feature with model costs included.

Economics: market.md estimated $2–$5 a month for a typical reader and $45–$100 for a heavy reader
at the current 1,000-call cap on Flash-Lite. Current list prices per 1M tokens: Gemini 3.5
Flash-Lite $0.30 in / $2.50 out [S19]; OpenAI gpt-5-nano $0.05 / $0.40 [S29]; Anthropic Claude
Haiku 5.5 $0.10 / $0.50 (prompts up to 100k tokens) [S30]. A cheaper model only counts once it
passes the swap-quality gates; none has been tested here. The ROADMAP's existing ordering (hosted
tier only after retention is proven) is unchanged.

## 7. Staged plan

Each stage ends with something testable. Stages 0–2 need no account, money or outward act.

| Stage | What | Evidence that it is done | Needs |
|---|---|---|---|
| 0a. Secret store | One worker-only interface for secrets (Gemini key, device token, account secret). Chrome: today's `storage.local` after `setAccessLevel`. Firefox: extension-origin IndexedDB, with derived working keys as non-extractable `CryptoKey`s. Fails closed elsewhere, including Firefox permanent private browsing | Real-Firefox test (probe harness) that a content script cannot read any secret; existing key-isolation tests unchanged | Shared with ditz `firefox-support` |
| 0b. Op reducer | Pure `sync-ops.js`: op validation (exporting the `portability.js` validators, adding `guessFirst`), fold for every card op in 3.2, generations, supersession records | Equivalence test: folding the ops of a recorded single-device session equals the state the current `rateReview`/`finishInline`/`claimKnown`/`wordKnown`/`wordReset` paths wrote. Convergence test: any server order of two devices' batches, with duplicates, converges, including both devices rating the same due card Easy inline. Mutation-checked | Nothing |
| 1. Tracer bullet | Section 8 | Section 8 | Nothing |
| 2. Self-hostable server and opt-in sync, development builds only | Server per 5.1; sync settings page (server URL, turn on, recovery code, pair device, remove device); outbox and pull loop on the existing alarm; snapshots | Two real Chrome profiles (throwaway, never Ted's) converge through a local server: offline review on both, then reconnect; reset-vs-review in both orders; old-format refusal. Automated tests for a lost acknowledgement, compaction with `deviceMarks`, a truncated or abandoned snapshot, a late op after compaction, an inactive device retired mid-adopt that then returns, and a key-substituting pairing relay | E2EE/recovery ruling |
| 3. Full scope | Personal entries with aliases and the cap (3.6), packs, preferences; first-enable `scope.adopt` (3.7); key rotation; Firefox once 0a lands | Merge of two independently used installs shows the per-language choice and loses no card within the 300-entry personal cap (3.6); Firefox profile converges with Chrome profile | Stage 2 |
| 4. Hosted paid sync | Same server operated by Lang Weave; billing at the edge; Chrome and Firefox disclosures; AGPL source link | Ted's go on price, processor, policy text and launch | Money and outward acts |
| P1. BYOK pronunciation | Speaker button on explicit action in review and on the cue; Gemini TTS via the user's key; local clip cache; "AI voice" label | Mocked-model tests; one real check only when authorized | Pronunciation UI ruling |
| P2. Hosted pronunciation | `/v1/speak` with the catalog cache | Native-speaker listen of the chosen engine; cache-hit test | Engine ruling, stage 2 server |
| R. Hosted no-key tier | `/v1/weave`, separate opt-in and disclosure | Swap-quality gates on the chosen model; terms review | Retention evidence, terms ruling, money |

## 8. Tracer bullet (suggested, not built)

The thinnest slice through every new boundary:

- `extension/src/sync-ops.js`: op envelope, `introduce`/`rate`/`reset` with generations for the
  bundled Spanish scope only, and `fold(base, ops)` that calls the existing `scheduleCard` (which
  needs exporting from `review.js`), not a copy of it.
- `extension/src/sync-crypto.js`: AES-GCM seal/open of a batch with the client-written header as
  additional data (WebCrypto only).
- `server/`: an AGPL push/pull server with an in-memory store behind the SQLite schema of 5.1, and
  the per-device `max_device_seq` rule. Not deployed anywhere.
- `extension/test/sync-tracer.test.js`: two simulated devices, each rating offline, pushing through
  the in-process server, pulling, and ending with identical cards. It also covers a duplicated push
  after a lost acknowledgement, a lost acknowledgement followed by a pull with no re-push (outbox
  pruning), a reset racing a stale rating in both server orders, and a tampered envelope header
  that decryption rejects.

Acceptance for the tracer: the convergence test goes red in three mutation checks: when the fold
orders by wall clock instead of `serverSeq`, when the `max_device_seq` de-duplication is removed,
and when the generation check is removed. Nothing ships in the extension zip, and there is no UI.

Necessity check: what fails if we skip the tracer and build stage 2 directly? The merge semantics
would be discovered inside UI and network code, where a convergence bug looks like flaky sync.
The tracer is the cheapest place for those three bugs to show up.

## Open decisions

Only the ones that block a stage. Root files the rulings; recommendations are this lane's.

1. **Encryption and recovery (blocks stage 2).** End-to-end encryption, where losing every device
   and the recovery code loses the synced copy, versus server-readable storage with
   operator-assisted recovery. Recommendation: end-to-end, with the recovery code shown at
   enable time and local backups still available.
2. **Hosted pronunciation engine (blocks P2).** Self-hosted open weights versus a provider API.
   Recommendation: open weights first, chosen by a native-speaker listen against Gemini Flash-Lite
   TTS.
3. **Payment processor and price (blocks stage 4).** Merchant of record (about 5% + 50¢) versus
   Stripe with self-managed tax. No recommendation on price; this is money.
4. **Hosted no-key tier (blocks R).** The page-text privacy change and the terms reading in
   [Provider resale](#provider-resale). Recommendation: only the product-shaped endpoint, separate
   opt-in, after retention is proven.

Already open elsewhere and affected: `firefox-identity-ruling` (data categories once sync
exists), `audio-local-voices-ruling` (free local-voice baseline beside paid synthesis), and
`hosted-tier-and-donations-ruling` (Ted has now directed no donations).

## Sources

All checked 2026-11-02. Research workers read most pages through a summarising fetch tool, so
short quotes are as that tool returned them; the Gemini TTS prices, the Polly caching sentence
and the Bugzilla 1724754 status were re-fetched and confirmed verbatim. The OpenAI agreement and
the AGPL text were read in full with curl.

- [S1] Chrome `chrome.storage` reference: https://developer.chrome.com/docs/extensions/reference/api/storage
- [S2] Chrome Help, sync and passphrase: https://support.google.com/chrome/answer/165139
- [S3] MDN `storage.sync`: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync
- [S4] MDN `storage.session`: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session
- [S5] Bugzilla 1724754 (setAccessLevel; NEW, no target): https://bugzilla.mozilla.org/show_bug.cgi?id=1724754 ; browser-compat-data `webextensions/api/storage.json`: https://github.com/mdn/browser-compat-data
- [S6] Chrome storage and cookies: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- [S7] MDN `background` manifest key: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
- [S8] Bugzilla 1427986 (extension IndexedDB in private browsing): https://bugzilla.mozilla.org/show_bug.cgi?id=1427986
- [S9] MDN `CryptoKey`: https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey
- [S10] Mozilla Hacks, Firefox Sync privacy (2018): https://hacks.mozilla.org/2018/11/firefox-sync-privacy/
- [S11] Chrome Web Store user data FAQ: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- [S12] Firefox built-in data consent: https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- [S13] AMO add-on policies: https://extensionworkshop.com/documentation/publish/add-on-policies/
- [S14] Identity APIs: https://developer.chrome.com/docs/extensions/reference/api/identity ; https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity (Firefox for Android lacks `launchWebAuthFlow`; the pairing design does not need it)
- [S15] Gemini API Additional Terms: https://aistudio.google.com/docs/terms
- [S16] Google APIs Terms of Service: https://developers.google.com/terms
- [S17] OpenAI Services Agreement (ONLINE v.010126): https://cdn.openai.com/osa/openai-services-agreement.pdf
- [S18] Anthropic Commercial Terms: https://www.anthropic.com/legal/commercial-terms
- [S19] Gemini API pricing: https://aistudio.google.com/docs/pricing
- [S20] GNU AGPL-3.0 text: https://www.gnu.org/licenses/agpl-3.0.txt
- [S21] Anki sync server: https://docs.ankiweb.net/sync-server.html
- [S22] Etebase server: https://github.com/etesync/server
- [S23] automerge-repo-sync-server: https://github.com/automerge/automerge-repo-sync-server
- [S24] Stripe pricing: https://stripe.com/pricing
- [S25] Paddle pricing: https://www.paddle.com/pricing
- [S26] Lemon Squeezy pricing: https://www.lemonsqueezy.com/pricing
- [S27] Fly.io pricing: https://docs.fly.io/about/pricing
- [S28] Hetzner Cloud: https://www.hetzner.com/cloud/
- [S29] OpenAI API pricing: https://developers.openai.com/api/docs/pricing
- [S30] Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing
- [S31] OpenAI text-to-speech guide: https://developers.openai.com/api/docs/guides/text-to-speech
- [S32] Amazon Polly FAQ: https://aws.amazon.com/polly/faqs/
- [S33] Amazon Polly pricing: https://aws.amazon.com/polly/pricing/
- [S34] Google Cloud Text-to-Speech pricing: https://cloud.google.com/text-to-speech/pricing
- [S35] Microsoft AI Code of Conduct: https://learn.microsoft.com/en-us/legal/ai-code-of-conduct
- [S36] ElevenLabs API pricing and terms: https://elevenlabs.io/pricing/api ; https://elevenlabs.io/terms-of-use
- [S37] Gemini speech generation: https://aistudio.google.com/docs/speech-generation
- [S38] Piper voices: https://huggingface.co/rhasspy/piper-voices ; code https://github.com/OHF-Voice/piper1-gpl
- [S39] Kokoro: https://github.com/hexgrad/kokoro ; https://huggingface.co/hexgrad/Kokoro-82M
- [S40] Google Cloud Service Specific Terms: https://cloud.google.com/terms/service-terms

### Not verified

`storage.sync` behaviour in Edge, Brave, Vivaldi and Opera; whether Chrome's sync passphrase or
Firefox Sync's encryption covers extension data; a primary statement on extension-origin
IndexedDB versus content scripts in Firefox; a non-extractable `CryptoKey` in IndexedDB inside a
Chrome extension service worker, end to end; whether the Google APIs terms govern the Gemini API;
OpenAI usage policies (fetch refused) and API retention defaults; Spanish locale lists for Polly,
Azure, Google Cloud TTS and ElevenLabs; Azure prices; Google Cloud TTS caching terms (only part
of the terms read); output-rights terms for shipping provider-generated audio in the extension.

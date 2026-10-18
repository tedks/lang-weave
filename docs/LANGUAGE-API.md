# Target-language boundary for stacked learning work

This document describes the generic-language branch interface. The extension
still reads English source text. `fr` remains the inherited target-text field
in vocabulary and swaps for wire compatibility; it does not mean French.

- `settings.language` is the selected canonical language code (`es` by
  default). The bundled Spanish vocabulary uses `es` and needs no pack.
- `languagePacks` in `chrome.storage.local` maps other codes to `{version,
  words}`. Each word has `{fr, en, hint, level}` and the pack validator in
  `src/languages.js` is the only entrance for generated or saved packs.
- The service worker's `context()` computes `language`, `scope`, `words`,
  `level`, and `revision`. `scope` is `es` for the legacy bundled pack, or
  `<language>:<pack version>` otherwise. `revision` changes when selection,
  pack, level, site settings, permissions or model settings change.
- `src/scope.js` maps event and review storage through `scopedStorage`.
  Spanish retains the original `readingEvents`, `seenSent`, and
  `recallReview` keys. Other packs use namespaced keys. The decision cache
  already includes `revision` in each key. Reading events include revision
  so a late page event is rejected after a switch.
- Review operations (`reviewStatus`, `reviewIntroduce`, `reviewNext`,
  `reviewReveal`, `reviewRate`) operate on the currently selected language
  in the worker. Tickets and cards are stored under that scope. The UI
  should reacquire status or queue after selection changes; a stale ticket
  fails rather than rating a card in another scope.
- `validateSwaps(level, swaps, words, language)` and
  `requestSwaps({... language, words})` use exact target forms for generated
  packs. Spanish retains its article and accent adapter. Do not apply those
  Spanish rules to a different target.

The generated pack's linguistic quality is experimental. Adaptive density
and in-band recall may use these boundaries without changing the saved pack
format or reusing another language's progress.

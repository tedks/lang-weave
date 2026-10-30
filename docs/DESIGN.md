# Lang Weave

## Intent

Learn a selected target language through small, contextual replacements in English web reading. Spanish is the bundled default. The Chrome extension is the product. It must load unpacked and work with a user-supplied Gemini key, without a terminal plugin or native host.

## Assumptions and boundaries

English source passages; neutral Spanish with accents and approximate pronunciation hints in the bundled pack; beginner and expanded vocabulary levels. Other targets use explicitly generated, bounded, locally persisted experimental vocabulary. This is mixed-language reading, not a grammatical translation of a full sentence. Level controls vocabulary and density, not a CEFR certification. A model chooses a suitable sense; deterministic validation rejects unlisted words and mismatched glosses. Spanish-specific diacritic and article handling remains specific to Spanish; other targets require exact listed forms.

Keep sensitive sites off by default and preserve exclusions for forms, editable text, code and high-stakes topics. Page text goes to Gemini only on enabled, permitted sites with a configured key. Browser storage is independent of French Weave. Language histories and asynchronous results are isolated by target and pack version. The manifest key fixes the extension identity on every path since 0.12.0; earlier path-derived installs move once through the Learning backup, and their directories are never updated in place. Do not install a browser extension or use the user's credentials as part of development verification.

A new Gemini key is written to `storage.local` only after the worker successfully restricts that area to trusted contexts with `setAccessLevel`. Chrome 140 is the manifest minimum. If the API is absent or rejects the restriction, the worker keeps isolation unavailable in memory, refuses new keys and model calls, and shows fixed guidance in Settings and the popup. A previously stored key remains until the user explicitly removes it; it is not migrated or used while isolation is unavailable. On a browser without this API, an already stored key may still be readable by content scripts; the minimum version prevents this build from loading there, and the worker cannot erase that key without the user's Remove key action.

Message authorization is the declarative surface table in `extension/src/router.js`: each sender surface may send only its listed messages. A new page is a new table entry; never widen an existing entry to reach it.

Content scripts target the top frame. Non-top-frame swap requests fail closed because the worker cannot refresh that frame's title at each asynchronous dispatch boundary. The local title and high-stakes checks are finite conservative guards; ambiguous text stays English.

## Acceptance

Spanish identity, bundled vocabulary, model instructions and interaction labels; no French companion dependency; unpacked installation instructions; automated regression gates, browser smoke evidence and council review to fixpoint before merge. Report mocked and real-service evidence distinctly.

## Stretch backlog

Local spaced repetition and easy/medium/hard ratings; opt-in review takeover for selected sites; Duolingo level import only through a supported integration or user-provided export. These follow the core and must not silently collect credentials or interrupt browsing.

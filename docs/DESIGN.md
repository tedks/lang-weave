# Spanish Weave

## Intent

Learn Spanish through small, contextual replacements in English web reading. The Chrome extension is the product. It must load unpacked and work with a user-supplied Gemini key, without a terminal plugin or native host.

## Assumptions and boundaries

English source passages; neutral Spanish with accents and approximate pronunciation hints; beginner and expanded vocabulary levels. This is mixed-language reading, not a grammatical translation of a full sentence. Level controls vocabulary and density, not a CEFR certification. A model chooses a suitable sense; deterministic validation rejects unlisted words and mismatched glosses. Skip Spanish diacritic folding where it conflates distinct words such as si/sí or el/él; ñ is a distinct letter.

Keep sensitive sites off by default and preserve exclusions for forms, editable text, code and high-stakes topics. Page text goes to Gemini only on enabled, permitted sites with a configured key. Browser storage is independent of French Weave. Do not install a browser extension or use the user's credentials as part of development verification.

## Acceptance

Spanish identity, bundled vocabulary, model instructions and interaction labels; no French companion dependency; unpacked installation instructions; automated regression gates, browser smoke evidence and council review to fixpoint before merge. Report mocked and real-service evidence distinctly.

## Stretch backlog

Local spaced repetition and easy/medium/hard ratings; opt-in review takeover for selected sites; Duolingo level import only through a supported integration or user-provided export. These follow the core and must not silently collect credentials or interrupt browsing.

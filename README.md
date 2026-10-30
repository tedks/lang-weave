# Lang Weave

Learn a language through the English you already read. This Chrome extension replaces a few words in web pages with your selected target language, with a meaning and pronunciation hint on hover. Click a word, or press Enter while it is focused, to flip it back to English. Spanish is the bundled default.

> The build passed **ahora**, **pero** the old cache still needs work.
> ahora = now; pero = but

A browser-focused fork of [French Weave](https://github.com/jackieoliver/french-weave) by Jackie Oliver. Lang Weave is free software under the [GNU AGPL v3 or later](LICENSE); the upstream history and its [MIT license](LICENSE-MIT) are preserved (see [NOTICE](NOTICE)). No terminal plugin, Python setup or native messaging host is required. There is no Chrome Web Store release yet.

## Install in Chrome

1. Clone this fork: `git clone https://github.com/tedks/lang-weave.git`.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the repository's `extension` folder. No build or dependency installation is needed to use it.
3. Open the Lang Weave toolbar popup and paste your own [Gemini API key](https://aistudio.google.com/apikey). The key is stored in your browser profile and never sent to web pages.
4. X/Twitter is included in the extension's site permissions. For another site, open its page and turn on the site's checkbox in the popup, accepting Chrome's permission prompt. Alternatively, choose **Allow all websites**. Refresh an already-open page if needed.
5. Spanish works immediately with **Beginner** (30 words) or **Expanded** (226 words, including the Beginner words). You can also enter another target's language code and explicitly generate a local experimental vocabulary pack. Select any available target from the language dropdown. Generated packs have separate progress and reviews; their quality is not certified. **Remove this generated language** frees a slot and deletes that pack's local reading and review progress. Personally saved entries and their history remain local under the target language when a generated pack is removed.

In this checkout, the unpacked extension directory is `extension/` in whichever worktree contains the accepted branch. Keep that directory in place after loading it. Existing fleet installations stay at `${XDG_DATA_HOME:-$HOME/.local/share}/spanish-weave/extension`; this historical path preserves the unpacked Chrome extension ID and existing browser progress after the product rename. Lang Weave and the inherited French companion do not share browser storage.

## Controls and privacy

The popup's **On** switch pauses weaving and restores the original text in open pages. The site checkbox controls the current hostname; **Other sites → Only sites I turn on** gives an explicit allowlist. Site exceptions can be reset individually. **Clear cache** requests fresh choices.

Readable text from enabled, permitted sites, including eligible personal vocabulary as candidate forms, is sent to Google's Gemini API with your key. Links and inline code may be included as sentence context but are never changed. Forms, editable text and code blocks are skipped. Sensitive sites, including webmail, messaging, AI chat, banking, health, government and local addresses, start off. The heuristic blocklist cannot recognize every private page; use the allowlist for tighter control. Obvious health, legal, financial, emergency and driving passages are also excluded.

[Google's API terms](https://ai.google.dev/gemini-api/terms) distinguish unpaid and paid services; review the terms for your account and region before enabling the extension on private reading. The extension limits itself to 1,000 model calls per local day, which is a request cap rather than a spending limit. Provider quotas and pricing still apply. Its default model is Gemini 3.5 Flash-Lite, with Gemini 3.8 Flash available in the popup.

Settings, cached replacement choices, and up to 500 local word events per target (seen/peek/flip, with a date) stay in this extension's browser storage. Events contain no URLs or reading passages and are never sent to the inherited French companion. Cached choices do contain short English fragments; removing the extension clears its local storage. Up to five generated packs are stored locally. No Duolingo login, account sync or tab takeover occurs.

To save your own vocabulary, select a word or short phrase in readable text on an enabled, permitted site and choose **Add to Lang Weave** from Chrome's selection menu. Confirm whether the selection is English or the target language, check any local suggestion or enter both forms yourself, then press **Save personal entry**. The selection menu and Save do not call Gemini or an online dictionary. The confirmation page also lets you find entries, add one explicitly to manual review, archive or unarchive it without losing history, and export your personal entries and history as local JSON. A saved entry does not spend a daily introduction or count as practice; with gradual learning on, an unambiguous single-word entry may enter the normal budgeted reading flow on the next ordinary reading request or page load when it appears in a passage. Phrases and unresolved spelling or meaning collisions stay available for manual review only. The bundled suggestions have not been independently checked against a dictionary.

**Learning backup:** In version 0.11.0 or later, open **Learning backup** from the popup in the old installation and download its JSON file. The separate personal-only export above keeps its original format and cannot be used for full learning import. Keep the old installed directory and browser profile intact. Open **Learning backup** in a distinct, keyless installation, choose the downloaded file, review its counts and learning preferences, then explicitly confirm import. This first import supports only a target with initialized defaults and no meaningful learned cards, personal entries, pack history, or installed generated packs; it refuses conflicts instead of merging or replacing them. Check the restored review queue before changing the old installation. The file excludes keys, host grants, site consent, caches, quotas, page text and one-use tickets. Re-enter your key and choose sites separately after import. An unverified old card from a removed pack blocks the entire export rather than risking page text in the file; its history stays intact in the old installation. [The backup contract](docs/STORE-PORTABILITY-MISSION.md) lists the supported keys, exclusions and this limit. Version 0.10.0 does not contain this feature.

The bundled Spanish vocabulary is a curated starter set, not a certified curriculum or native-speaker review. The first Expanded addition selects 79 everyday nouns from an upstream AI-drafted list; [selection, credits and limits](docs/UPSTREAM-CURRICULUM-MISSION.md) are documented. The selection and approximate sound hints lean Latin American. Spanish accents and ñ are preserved. Generated target forms are matched exactly; a model chooses meanings in context and deterministic validation rejects unlisted words and mismatched glosses, but a model can still make a contextual or grammatical mistake. This is mixed-language reading, not full-sentence translation.

## Development

Runtime dependencies: none. Tests use Bun and happy-dom; the browser smoke test uses Playwright Chromium and a synthetic Gemini response, with no API key or paid calls.

```sh
cd extension
bun install --frozen-lockfile
bun test
bunx playwright install chromium
bun run test:browser
```

The inherited Python companion tests run from the repository root with `python3 -m unittest discover -s tests`. See [AGENTS.md](AGENTS.md), [design boundaries](docs/DESIGN.md) and [mission evidence](docs/MISSION.md).

## Next

The popup opens a voluntary recall review page. Choose **Add 5 new words** to introduce bundled vocabulary from your current reading level, recall the Spanish from its English meaning, reveal the answer, then rate it Hard, Medium or Easy. Reviews and due dates stay in this browser; sightings, hints and flips while reading never count as recall. No Gemini call or key is needed for reviews. A site takeover screen and Duolingo level import remain follow-up features. Duolingo integration needs a supported method or an export; it must not collect a password or browser session token.

The original CLI hooks, slash commands, ready-made French blocks and native-host scripts are retained for upstream comparison. They remain French-oriented and are outside this fork's Spanish extension product; see the [upstream reference](docs/UPSTREAM.md).

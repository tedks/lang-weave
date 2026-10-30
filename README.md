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

In this checkout, the unpacked extension directory is `extension/` in whichever worktree contains the accepted branch. Keep that directory in place after loading it. Since 0.12.0 the manifest carries a public key, so Chrome gives Lang Weave the same extension ID, `lkbkmlgogcpcacjmdmoecgacdbfddbnh`, from any directory on any machine. Fleet installations live at `${XDG_DATA_HOME:-$HOME/.local/share}/lang-weave/extension`. Two copies with this ID cannot run in one Chrome profile, so use a separate profile for a development checkout. Lang Weave and the inherited French companion do not share browser storage.

## Move to the stable ID (0.12.0)

Every install loaded before 0.12.0 has an ID derived from its directory, so 0.12.0 arrives as a new extension with empty storage. Your progress moves across once, with a Learning backup. Skip this section if you have never loaded an earlier version.

**Do not update the old directory to 0.12.0.** Version 0.11 reloads itself when its files change on disk. If the old directory receives 0.12.0, Chrome switches it to the new ID and turns the old entry off, with its progress still stored under the old ID. To recover, put the 0.11 files back in that directory and turn the old entry on again in `chrome://extensions`. Never remove that turned-off entry, because removing it deletes its progress. The fleet installer writes 0.12.0 to the new `lang-weave` path and leaves the old `spanish-weave` payload untouched. If you load Lang Weave from a git checkout, export before you pull.

1. Check the old installation's version in `chrome://extensions`. Export needs 0.11.0 or later. If it is older, first update the old directory to 0.11.1, the last release without the key, for example with `git checkout ac71cb7` in a checkout. A keyless update keeps the old ID and its progress.
2. Turn off the **On** switch at the top of the old installation's popup, not its `chrome://extensions` toggle, so the two installs do not both weave pages. Then open **Learning backup** from its popup and download the JSON file. The switch is not part of the backup.
3. Open `chrome://extensions`, choose **Load unpacked**, and select the new directory, for example `~/.local/share/lang-weave/extension`. It appears as a second Lang Weave entry with ID `lkbkmlgogcpcacjmdmoecgacdbfddbnh`.
4. Do not enter a Gemini key in the new installation yet, because import only accepts a target without a key or progress of its own. If you already entered a key or read with the new entry, remove the new entry in `chrome://extensions` and load the same directory again. That resets only the new entry.
5. In the new installation, open **Learning backup**, choose the file, review the counts and preferences, and confirm the import.
6. Check the restored review queue. Then enter your Gemini key and choose your sites again, because the backup excludes keys and site permissions.
7. Only now remove the old entry in `chrome://extensions`. Removing it deletes its browser storage. The old directory stays on disk until you delete it yourself.

[Stable ID mission record](docs/STABLE-ID-MISSION.md) has the verification, what the Chrome docs do and do not promise about a later Chrome Web Store release, and what remains untested.

## Review scheduling and backups (0.12.4)

Since 0.12.4, reviews are scheduled with FSRS-6 on the actual time since each review, aiming for 90% recall by default. A lapse no longer erases a word's history. Existing cards keep their due dates and switch over at their next rating. Each review and each in-page sighting or hover of a learning word is counted in a local learning log. The log holds word IDs, times and outcomes only, never pages, URLs or text, and it never leaves your browser.

Learning backups from 0.12.4 use format 2. Lang Weave 0.12.3 and later can import them; 0.12.2 and earlier refuse them. Once 0.12.4 has logged anything, 0.12.2 can no longer export a backup. If you ever need to go back, go back to 0.12.3, which reads everything 0.12.4 stores.

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

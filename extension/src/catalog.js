// Ephemeral catalog adapter. V1 review still keys exact target forms (`fr`).
// A future sense-aware overlay must supply distinct IDs and resolve target collisions
// before its entries can enter the existing spelling-indexed swap validator.
export const entryId = (scope, word) => `${scope}:legacy:${encodeURIComponent(word.fr)}`;

export function catalogEntries(words, scope) {
  return words.map((word) => ({ id: entryId(scope, word), word }));
}

export function englishAnchors(word) {
  const anchors = new Set();
  for (const alternative of word.en.split(/\s*[/;,]\s*/)) {
    const plain = alternative.normalize('NFC').toLocaleLowerCase('en')
      .replace(/\([^)]*\)/g, ' ').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
    if (!plain) continue;
    anchors.add(plain);
    const bare = plain.replace(/^(?:the|a|an|to)\s+/, '');
    if (bare && bare !== plain) anchors.add(bare);
  }
  return [...anchors];
}

export function matchingEntries(batch, entries) {
  const texts = batch.map(({ text }) => text.normalize('NFC').toLocaleLowerCase('en').replace(/[’‘`]/g, "'"));
  const byAnchor = new Map();
  for (const entry of entries) for (const anchor of englishAnchors(entry.word)) {
    if (!byAnchor.has(anchor)) byAnchor.set(anchor, []);
    byAnchor.get(anchor).push(entry);
  }
  const matched = new Map();
  for (const [anchor, owners] of byAnchor) {
    // A shared English anchor cannot choose a sense. Every owner waits for
    // explicit sense-aware context, including already reviewed entries.
    if (owners.length !== 1) continue;
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u');
    if (texts.some((text) => pattern.test(text))) {
      const prior = matched.get(owners[0].id);
      if (!prior || anchor.length > prior.matchLength) matched.set(owners[0].id,
        { ...owners[0], matchLength: anchor.length });
    }
  }
  return [...matched.values()];
}

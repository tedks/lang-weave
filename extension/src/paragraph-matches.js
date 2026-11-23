import { englishAnchors, packWords } from './catalog.js';
import { GUARANI_PACK } from './guarani.js';
import { GUARANI_STARTER, bundledLanguage } from './language-name.js';
import { resolveLevel, validateSwaps, wordsForLevel } from './levels.js';
import { sourceIssue } from './semantic.js';

export const MAX_PARAGRAPH_LENGTH = 2000;
export const PARAGRAPH_EXAMPLES = {
  es: 'Today I opened the window before breakfast. I could see a tree beside the river. The soup was ready, but I stayed by the window to listen to a song.',
  [GUARANI_STARTER]: 'At school I opened a book while my teacher handed out paper. Back at the house, I pulled a chair into my room and drank some water.',
};

export function paragraphLevel(settings, spanishPlacement, language) {
  return language === 'es' && [1, 2].includes(spanishPlacement) ? spanishPlacement : resolveLevel(settings).effective;
}

const DEFINITE_SPANISH = /^(?:el|la|los|las) /;
const WORD = '[\\p{L}\\p{M}\\p{N}_]';
const JOINER = "['\\-\\u2010\\u2011]";
function anchorPattern(anchor) {
  const literal = anchor.split(' ').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\S\\r\\n\\u2028\\u2029]+');
  return new RegExp(`(?<!${WORD})(?<!${WORD}${JOINER})${literal}(?!${WORD}|${JOINER}${WORD})`, 'giu');
}

// These are choices of catalog senses, with no contextual sense inference.
// Keep offsets in the original paragraph, including its original whitespace and apostrophes.
export function paragraphMatches(text, language, level) {
  if (text.length > MAX_PARAGRAPH_LENGTH || !bundledLanguage(language)) return [];
  const words = language === 'es' ? wordsForLevel(level) : packWords(GUARANI_PACK, level);
  const searchable = text.replace(/[’‘`]/g, "'");
  const occurrences = new Map();
  const blocked = new Map();
  for (const word of words) {
    const definite = language === 'es' && DEFINITE_SPANISH.test(word.fr);
    for (const sense of word.en.split(/\s*[/;,]\s*/)) {
      const anchors = englishAnchors({ en: sense }, { bare: definite });
      if (definite && anchors.length === 1) anchors.unshift(`the ${anchors[0]}`);
      const ends = new Set();
      for (const anchor of anchors) {
        for (const match of searchable.matchAll(anchorPattern(anchor))) {
          const start = match.index;
          const end = start + match[0].length;
          // For this sense, "the window" takes precedence over the same occurrence of "window".
          if (ends.has(end)) continue;
          const source = text.slice(start, end);
          const key = `${start}:${end}`;
          // The learner picks the exact words and sense, including in dialogue.
          if (!blocked.has(key)) blocked.set(key, sourceIssue(text, start, end, source, { allowQuoted: true }));
          if (blocked.get(key)) continue;
          const [swap] = validateSwaps(level, [{ o: source, f: word.fr }], [{ ...word, en: sense }], language);
          if (!swap) continue;
          ends.add(end);
          if (!occurrences.has(key)) occurrences.set(key, { start, end, senses: [] });
          occurrences.get(key).senses.push(swap);
        }
      }
    }
  }
  return [...occurrences.values()].sort((a, b) => a.start - b.start || b.end - a.end);
}

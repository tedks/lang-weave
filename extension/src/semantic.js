// English-source checks shared by model validation and final DOM placement. The passage, not model ctx, decides.
const DOUBLE = { '"': '"', '“': '”', '„': '“”', '«': '»', '「': '」', '『': '』' };
const SINGLE = { "'": "'", '‘': '’' };
const BEFORE_SINGLE = /[\s([{“"«„—–\-/]/u;
const LETTER = /\p{L}/u;
const WORDISH = /[\p{L}\p{N}]/u;
const ELISION = /^(?:tis|twas|cause|em|round|bout)\b/iu;
const PROPER_POSSESSIVE = /(?:^|[^\p{L}])\p{Lu}[\p{L}]*[sS]$/u;

function sentenceEnd(text, from) {
  const end = /[.!?…](?=[\s"”»’']|$)|\n/u.exec(text.slice(from));
  return end ? from + end.index + end[0].length : text.length;
}

export function quotedRanges(text) {
  const s = String(text || '');
  const ranges = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (DOUBLE[ch] && !(ch === '"' && /\p{N}/u.test(s[i - 1] || ''))) {
      let close = i + 1;
      while (close < s.length && !(DOUBLE[ch].includes(s[close]) &&
        !(ch === '"' && /\p{N}/u.test(s[close - 1])))) close++;
      const end = close < s.length ? close + 1 : (s.slice(0, i).trim() ? sentenceEnd(s, i + 1) : s.length);
      ranges.push([i, end]);
      i = end - 1;
    } else if (SINGLE[ch] && (i === 0 || BEFORE_SINGLE.test(s[i - 1])) && LETTER.test(s[i + 1] || '')) {
      const elision = ch === "'" && ELISION.test(s.slice(i + 1));
      let close = i + 1;
      let nextQuote = false;
      while (close < s.length && s[close] !== '\n') {
        if (elision && s[close] === "'" && BEFORE_SINGLE.test(s[close - 1] || '') &&
          LETTER.test(s[close + 1] || '')) {
          nextQuote = true;
          break;
        }
        // A clear name possessive is not a close; lowercase s-words are ambiguous, so protect the quote.
        if (elision && s[close] === "'" && PROPER_POSSESSIVE.test(s.slice(0, close)) &&
          /^\s+\p{L}/u.test(s.slice(close + 1))) {
          close++;
          continue;
        }
        if (SINGLE[ch].includes(s[close]) && !WORDISH.test(s[close + 1] || '')) break;
        close++;
      }
      if (nextQuote) {
        i = close - 1;
        continue;
      }
      if (close < s.length && s[close] !== '\n') {
        ranges.push([i, close + 1]);
        i = close;
      } else if (!elision) {
        const end = sentenceEnd(s, i + 1);
        ranges.push([i, end]);
        i = end - 1;
      }
    }
  }
  return ranges;
}

export function sentenceStart(text, index) {
  const before = String(text).slice(0, index);
  if (/\b(?:Mr|Mrs|Ms|Dr|Prof|St|Rev|Gen|Sen|e\.g|i\.e)\.\s*$/iu.test(before)) return false;
  return /(?:^|[\n.!?…]["'”’)\]»]*)[\s"'“‘(\[«]*$/u.test(before);
}

const ALL_CAPS = /\p{Lu}.*\p{Lu}/su;
export const allCaps = (s) => ALL_CAPS.test(s) && !/\p{Ll}/u.test(s) && !/^O\.?K\.?$/u.test(s);
const FIXED = [
  'right now', 'just now', 'now and then', 'as well', 'as well as', 'might as well',
  'at all', 'after all', 'all right', 'as long as', 'so far', 'so that',
  'never mind', 'look for', 'looks for', 'looking for', 'looked for',
  'find out', 'finds out', 'finding out', 'found out', 'depend on', 'depends on',
  'depending on', 'in mind',
];
// The listed head nouns can be ordinary words elsewhere, but not a partial swap
// inside these common compounds. Match regular plural heads as well.
const NOUN_COMPOUNDS = [
  'movie theater', 'movie theatre', 'window frame', 'door handle', 'garden path',
  'book review', 'computer program', 'page number', 'kitchen table',
  'bathroom door', 'office chair', 'box office', 'gift card', 'lunch break',
  'night shift', 'keyboard shortcut', 'star rating', 'bike lane', 'shoe store',
];
const tokens = (s) => [...String(s).matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu)]
  .map((m) => ({ value: m[0].replace(/[’‘`]/g, "'").toLowerCase(), raw: m[0], start: m.index, end: m.index + m[0].length }));
const fixedTokens = FIXED.map((phrase) => tokens(phrase).map((t) => t.value));
const compoundTokens = NOUN_COMPOUNDS.map((phrase) => tokens(phrase).map((t) => t.value));
const regularPlural = (word) => word.endsWith('y') && !/[aeiou]y$/u.test(word)
  ? `${word.slice(0, -1)}ies` : /(?:s|x|z|ch|sh)$/u.test(word) ? `${word}es` : `${word}s`;
const FUNCTION_WORDS = new Set(['and', 'or', 'but', 'with', 'for', 'in', 'on', 'at', 'to', 'of', 'from',
  'by', 'as', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'will', 'would', 'can', 'could',
  'not', 'also', 'too', 'then', 'now', 'here', 'there', 'when', 'if', 'because', 'since',
  'before', 'after', 'that', 'this', 'who', 'where', 'why', 'how']);
const CLAUSE_STARTS = new Set(['i', 'you', 'he', 'she', 'we', 'they', 'it', 'there', 'someone', 'everyone', 'people']);
const HAS_PARTICIPLES = new Set(['been', 'got', 'gotten', 'had', 'done', 'gone', 'become',
  'come', 'taken', 'seen', 'made', 'happened', 'given']);
const HAS_MODIFIERS = new Set(['finally', 'already', 'just', 'never', 'ever', 'really',
  'actually', 'not', 'still', 'also', 'now']);
const nameToken = (t, text) => !!t && /^\p{Lu}/u.test(t.raw) && !/^I(?:['’]|$)/u.test(t.raw) &&
  !/^O\.?K\.?$/u.test(t.raw) && !sentenceStart(text, t.start);

// Returns a reason or ''. Character offsets must be the actual located anchor in the passage.
export function sourceIssue(text, from, to, original) {
  if (allCaps(original) || allCaps(String(text).slice(from, to))) return 'allCaps';
  if (quotedRanges(text).some(([start, end]) => from < end && start < to)) return 'quoted';
  const ts = tokens(text);
  const first = ts.findIndex((t) => t.start === from);
  const last = ts.findIndex((t) => t.end === to);
  if (first < 0 || last < first) return ''; // DOM locator will reject an inexact anchor.
  const prev = ts[first - 1], next = ts[last + 1];
  const o = ts.slice(first, last + 1).map((t) => t.value).join(' ');
  if (nameToken(ts[first], text) || (first === last && nameToken(prev, text) &&
    /^\s*$/u.test(text.slice(prev.end, from)) && !FUNCTION_WORDS.has(o))) return 'name';
  for (const phrase of [...fixedTokens, ...compoundTokens]) {
    for (let at = 0; at + phrase.length <= ts.length; at++) {
      if (!phrase.every((word, n) => ts[at + n].value === word ||
        (compoundTokens.includes(phrase) && n === phrase.length - 1 &&
          ts[at + n].value === regularPlural(word)))) continue;
      const end = at + phrase.length - 1;
      if (first <= end && at <= last && !(first <= at && last >= end)) return 'phrase';
    }
  }
  if (next?.value === 'of') return 'danglingOf';
  if (['before', 'after', 'since'].includes(o) && next &&
    (CLAUSE_STARTS.has(next.value) || /\p{L}ing$/u.test(next.value))) return 'clause';
  if (["it's", "that's", "there's"].includes(o)) {
    let at = last + 1;
    while (HAS_MODIFIERS.has(ts[at]?.value)) at++;
    if (HAS_PARTICIPLES.has(ts[at]?.value)) return 'has';
  }
  if (o === 'like' && (/^\p{N}/u.test(next?.value || '') || [',', '"', '“', 'really', 'totally', 'literally',
      'so', 'very', 'just', 'actually', 'basically', 'super'].includes(next?.value))) return 'like';
  if (['in', 'on'].includes(o) && ['.', ',', '!', '?', ';', ':', 'with', 'and', 'at'].includes(next?.value)) return 'context';
  return '';
}

// English-source checks shared by model validation and final DOM placement. The passage, not model ctx, decides.
import { GUARANI_STARTER } from './language-name.js';

const DOUBLE = { '"': '"', '“': '”', '„': '“”', '«': '»', '「': '」', '『': '』' };
const SINGLE = { "'": "'", '‘': '’' };
const BEFORE_SINGLE = /[\s([{“"«„—–\-/]/u;
const LETTER = /\p{L}/u;
const WORDISH = /[\p{L}\p{N}]/u;
const UNICODE_HYPHEN_BEFORE = /[\p{L}\p{M}\p{N}_][\u2010\u2011]$/u;
const UNICODE_HYPHEN_AFTER = /^[\u2010\u2011][\p{L}\p{M}\p{N}_]/u;
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

export function sentenceStart(text, index, { allowDialogue = false } = {}) {
  const before = String(text).slice(0, index);
  // An attributed quotation can start its own sentence in manual practice.
  if (allowDialogue) {
    const opener = /(?:[,:]|\b(?:said|asked|replied|answered|wrote|whispered|shouted))\s*(["'“‘„«]\s*)$/iu.exec(before);
    if (opener && quotedRanges(text).some(([start, end]) => start === index - opener[1].length && index < end)) return true;
  }
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
  'breakfast cereal', 'tree diagram', 'family tree', 'shop window', 'car window',
  'soup kitchen', 'river bank', 'theme song',
];
// Compounds found in installed Spanish practice and the fixed reading sample.
const SPANISH_COMPOUNDS = [
  'garden center', 'garden centre', 'door hinge', 'window pane',
  'river mouth', 'river valley', 'song title', 'life jacket', 'night sky',
];
const POSSIBLE_PREDICATES = new Map([
  ['garden centers', ['on', 'around']], ['garden centres', ['on', 'around']], ['door hinges', ['on']],
]);
const SUBJECT_DETERMINERS = new Set(['the', 'a', 'this', 'that', 'my', 'your', 'his', 'her', 'its', 'our', 'their']);
// Other compounds of the Beginner prose promotions retain their tier scope.
const BEGINNER_SPANISH_COMPOUNDS = [
  'back door', 'entrance door', 'front door', 'garden door', 'revolving door', 'screen door', 'side door', 'trap door',
  'door frame', 'door knob', 'door lock', 'door to door', 'next door', 'flower garden', 'vegetable garden',
  'garden book', 'garden fence', 'garden gate', 'garden hose', 'garden party', 'garden shed', 'garden wall',
  'sky blue', 'pie in the sky', 'blue moon', 'moon base', 'moon landing', 'moon phase', 'moon rock', 'over the moon',
];
const tokens = (s) => [...String(s).matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu)]
  .map((m) => ({ value: m[0].replace(/[’‘`]/g, "'").toLowerCase(), raw: m[0], start: m.index, end: m.index + m[0].length }));
const fixedTokens = FIXED.map((phrase) => tokens(phrase).map((t) => t.value));
const compoundTokens = NOUN_COMPOUNDS.map((phrase) => tokens(phrase).map((t) => t.value));
const spanishCompoundTokens = SPANISH_COMPOUNDS.map((phrase) => tokens(phrase).map((t) => t.value));
const spanishCompounds = [...compoundTokens, ...spanishCompoundTokens];
const beginnerSpanishCompounds = [...spanishCompounds,
  ...BEGINNER_SPANISH_COMPOUNDS.map((phrase) => tokens(phrase).map((t) => t.value))];
export const regularPlural = (word) => word.endsWith('y') && !/[aeiou]y$/u.test(word)
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
// These bundled targets name only the noun sense. Other targets can have different senses.
const GUARANI_NOUN_ANCHORS = new Map([
  ['aranduka', 'book'], ['apyka', 'chair'], ['y', 'water'], ['yvytu', 'wind'], ['tata', 'fire'],
]);
const MODALS = new Set(['can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would',
  'cannot', "can't", "couldn't", "won't", "wouldn't", "shouldn't", "mustn't", "mightn't", "shan't"]);
const CONTRACTED_MODAL = /^(?:i|you|he|she|it|we|they)'(?:ll|d)$/u;
const INFINITIVE_MARKERS = new Set(['how', 'when', 'where', 'what', 'whether', 'have', 'has', 'had']);
const INFINITIVE_VERBS = new Set(['need', 'needs', 'needed', 'hope', 'hopes', 'hoped', 'want', 'wants', 'wanted',
  'plan', 'plans', 'planned', 'try', 'tries', 'tried', 'decide', 'decides', 'decided']);
const QUESTION_AUXILIARIES = new Set(['do', 'does', 'did']);
const LINE_BREAK = /[\r\n\u2028\u2029]/u;
const nameToken = (t, text, allowDialogue) => !!t && /^\p{Lu}/u.test(t.raw) && !/^I(?:['’]|$)/u.test(t.raw) &&
  !/^O\.?K\.?$/u.test(t.raw) && !sentenceStart(text, t.start, { allowDialogue });

function tokenBefore(text, ts, at) {
  const previous = ts[at - 1];
  return previous && !LINE_BREAK.test(text.slice(previous.end, ts[at].start)) ? previous : undefined;
}

const modal = (value) => !!value && (MODALS.has(value) || CONTRACTED_MODAL.test(value));

function clearVerbContext(text, ts, at, allowDialogue) {
  const cue = tokenBefore(text, ts, at);
  if (!cue) return false;
  const head = tokenBefore(text, ts, at - 1);
  const subject = head && tokenBefore(text, ts, at - 2);
  if (modal(cue.value)) return !SUBJECT_DETERMINERS.has(head?.value);
  if (cue.value === 'not' && modal(head?.value)) return !SUBJECT_DETERMINERS.has(subject?.value);
  if (cue.value === 'to') {
    // Bare prepositional "to" leaves a noun sense possible, as in "access to water".
    return INFINITIVE_MARKERS.has(head?.value) || INFINITIVE_VERBS.has(head?.value) &&
      (CLAUSE_STARTS.has(subject?.value) || modal(subject?.value));
  }
  const please = cue.value === ',' ? head : cue;
  if (please?.value === 'please') return sentenceStart(text, please.start, { allowDialogue });
  return (MODALS.has(head?.value) || QUESTION_AUXILIARIES.has(head?.value)) &&
    CLAUSE_STARTS.has(cue.value) && sentenceStart(text, head.start, { allowDialogue });
}

// Preserve a possible subject and verb in sentence-initial uses like “The door hinges on one pin.”
function possiblePredicate(text, ts, at, end, allowDialogue) {
  const prepositions = POSSIBLE_PREDICATES.get(`${ts[at].value} ${ts[end].value}`);
  if (!prepositions?.includes(ts[end + 1]?.value)) return false;
  const start = SUBJECT_DETERMINERS.has(ts[at - 1]?.value) ? ts[at - 1].start : ts[at].start;
  return sentenceStart(text, start, { allowDialogue });
}

// Returns a reason or ''. Character offsets must be the actual located anchor in the passage.
export function sourceIssue(text, from, to, original, { allowQuoted = false, language, level = 2, target } = {}) {
  const beginnerSpanish = language === 'es' && level <= 1;
  if (allCaps(original) || allCaps(String(text).slice(from, to))) return 'allCaps';
  if (!allowQuoted && quotedRanges(text).some(([start, end]) => from < end && start < to)) return 'quoted';
  // Keep the same joined-word boundaries as the Beginner paragraph matcher.
  if (beginnerSpanish && (UNICODE_HYPHEN_BEFORE.test(text.slice(0, from)) ||
      UNICODE_HYPHEN_AFTER.test(text.slice(to)))) return 'joined';
  const ts = tokens(text);
  const first = ts.findIndex((t) => t.start === from);
  const last = ts.findIndex((t) => t.end === to);
  if (first < 0 || last < first) return ''; // DOM locator will reject an inexact anchor.
  const prev = ts[first - 1], next = ts[last + 1];
  const o = ts.slice(first, last + 1).map((t) => t.value).join(' ');
  if (nameToken(ts[first], text, allowQuoted) || (first === last && nameToken(prev, text, allowQuoted) &&
    /^\s*$/u.test(text.slice(prev.end, from)) && !FUNCTION_WORDS.has(o))) return 'name';
  if (language === GUARANI_STARTER && first === last && typeof target === 'string' &&
    GUARANI_NOUN_ANCHORS.get(target.toLowerCase()) === o && clearVerbContext(text, ts, first, allowQuoted)) return 'verbContext';
  const compounds = beginnerSpanish ? beginnerSpanishCompounds : language === 'es' ? spanishCompounds : compoundTokens;
  for (const phrase of [...fixedTokens, ...compounds]) {
    const isCompound = compounds.includes(phrase);
    const isSpanishCompound = spanishCompoundTokens.includes(phrase);
    // A span can only cut phrases that overlap it, including phrases starting before the span.
    const earliest = Math.max(0, first - phrase.length + 1);
    const latest = Math.min(last, ts.length - phrase.length);
    for (let at = earliest; at <= latest; at++) {
      const end = at + phrase.length - 1;
      if (first <= at && last >= end) continue;
      if (!phrase.every((word, n) => {
        const actual = ts[at + n].value;
        if (!isCompound || n !== phrase.length - 1) return actual === word;
        const head = isSpanishCompound ? actual.replace(/'s$/u, '') : actual;
        return head === word || head === regularPlural(word);
      })) continue;
      if (isSpanishCompound && possiblePredicate(text, ts, at, end, allowQuoted)) continue;
      return 'phrase';
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

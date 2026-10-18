// Level schedule, word lists, and guards. Pure: no DOM, no chrome APIs.

// L3/L4 prompts are not built yet; anything above this uses L2 rules.
export const MAX_BUILT_LEVEL = 2;

// stage: optional legacy stage; chosen: after the popup override;
// effective: what the prompt uses.
export function resolveLevel(settings = {}, stage = 0) {
  const override = Number(settings.levelOverride) || 0;
  const synced = Number(stage) >= 1 && Number(stage) <= 4 ? Number(stage) : 0;
  const chosen = override >= 1 && override <= 4 ? override : synced || 1;
  return { stage: synced, chosen, effective: Math.min(chosen, MAX_BUILT_LEVEL) };
}

export { L1_WORDS, L2_EXTRA, L2_WORDS, wordsForLevel } from './vocabulary.js';
import { wordsForLevel } from './vocabulary.js';

// Legacy function names and fr fields mean target-language text. Keep ñ distinct from n.
export function normalizeFr(s) {
  return String(s)
    .normalize('NFD').replace(/n\u0303/gi, (s) => s[0] === 'N' ? 'Ñ' : 'ñ')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const ARTICLE_RE = /^(?:el|la|los|las|un|una|unos|unas)\s+/i;
const DEFINITE_RE = /^(?:el|la|los|las)\s+/i;
export const exactFr = (s) => String(s).normalize('NFC').toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
const exactTarget = (s, language) => language === 'es' ? exactFr(s) : String(s).normalize('NFC').toLocaleLowerCase(language).replace(/\s+/g, ' ').trim();
// An omitted accent here spells a different Spanish word, not a harmless typo.
const AMBIGUOUS_FOLDS = new Set(['si', 'el', 'tu', 'mi', 'te', 'se', 'de', 'mas', 'aun', 'como', 'cuando', 'donde', 'que', 'quien']);

const indexCache = new Map();
function indexFor(level, sharedWords, language = 'es') {
  const lvl = level <= 1 ? 1 : 2;
  if (!sharedWords && indexCache.has(lvl)) return indexCache.get(lvl);
  const idx = new Map();
  for (const w of sharedWords || wordsForLevel(lvl)) {
    const full = exactTarget(w.fr, language);
    idx.set(full, { canon: w.fr, en: w.en, hint: w.hint, word: w.fr, status: w.status });
    const stripped = language === 'es' ? full.replace(ARTICLE_RE, '') : full;
    if (stripped !== full && !idx.has(stripped)) {
      // Accept a bare noun ("problema" for "problem") and keep the accents from the list.
      const canon = w.fr.replace(ARTICLE_RE, '');
      idx.set(stripped, { canon, en: w.en.replace(/^the /, ''), hint: w.hint.replace(/^(el|lah|lohs|lahs|oon|OO-nah) /i, ''), word: w.fr, status: w.status });
    }
  }
  const folded = new Map();
  for (const [key, value] of idx) {
    const fold = normalizeFr(key);
    folded.set(fold, folded.has(fold) ? null : value);
  }
  const result = { exact: idx, folded };
  if (!sharedWords) indexCache.set(lvl, result);
  return result;
}

export function matchCase(fr, original, language = 'es') {
  if (/^\p{Lu}/u.test(original) && !/^\p{Lu}{2}/u.test(original)) {
    return fr.charAt(0).toLocaleUpperCase(language) + fr.slice(1);
  }
  return fr;
}

// The English a swap replaces must be one of the word's glosses, or a plain inflection of one, so a model
// slip like "to start" -> entonces is dropped instead of shown.
const EN_LEAD_RE = /^(?:the|a|an|to)\s+/;
const cleanEn = (s) => String(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/\(.*?\)/g, ' ')
  .replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

// Everyday English variants of a gloss, including the synonyms the prompt itself asks the model to use
// ("big"/"large"/"huge" -> grande, "other"/"another"/"else" -> otro, "I think" -> creo que, ...).
const SYNONYMS = {
  big: ['large', 'huge'],
  only: ['single'],
  other: ['another', 'else'],
  'i think that': ['i think'],
  okay: ['ok'],
  'thank you': ['thanks'],
  'a little': ['a bit', 'a little bit'],
  'a lot': ['lots', 'a lot of', 'lots of', 'much', 'so much'],
  maybe: ['perhaps', 'possibly'],
  also: ['too', 'as well'],
  'too much': ['too', 'too many'],
  difficult: ['hard'],
  actually: ['in fact'],
  but: ['however'],
  'there is': ["there's", 'there are'],
  'there are': ["there's", 'there is'],
  "it's": ['it is', 'this is', "that's", 'that is'],
  'this is': ["it's", 'it is', "that's", 'that is'],
  hello: ['hi'],
};

export function glossMatches(original, en, { inflections = true } = {}) {
  const forms = new Set();
  for (const alt of String(en).split(/\s*[/;,]\s*/)) {
    const g = cleanEn(alt);
    if (!g) continue;
    for (const f of [g, g.replace(EN_LEAD_RE, '')]) {
      forms.add(f);
      for (const syn of SYNONYMS[f] || []) forms.add(syn);
    }
  }
  const t = cleanEn(original);
  if (!t) return false;
  for (const c of new Set([t, t.replace(EN_LEAD_RE, '')])) {
    if (forms.has(c)) return true;
    if (!inflections) continue;
    for (const [suffix, stem] of [['ies', 'y'], ['es', ''], ['s', ''], ['ed', ''], ['ed', 'e'], ['ing', ''], ['ing', 'e']]) {
      if (c.endsWith(suffix) && forms.has(c.slice(0, -suffix.length) + stem)) return true;
    }
  }
  return false;
}

// Fail closed: keep only swaps whose Spanish is on the supplied or bundled vocabulary list
// and whose English matches that word's gloss.
// Canonicalizes accents, fills gloss and hint from the list, matches capitalization of the original.
export function validateSwaps(level, swaps, sharedWords, language = 'es') {
  if (!Array.isArray(swaps)) return [];
  const idx = indexFor(level, sharedWords, language);
  const out = [];
  for (const s of swaps) {
    if (!s || typeof s.o !== 'string' || typeof s.f !== 'string') continue;
    const o = s.o.trim();
    if (!o || !s.f.trim()) continue;
    const exact = exactTarget(s.f, language);
    let hit = idx.exact.get(exact) || (language === 'es' && !AMBIGUOUS_FOLDS.has(exact) && idx.folded.get(normalizeFr(s.f)));
    // Listed nouns carry articles. Never turn a plural English anchor into a singular Spanish noun
    // by stemming its gloss; explicit plural entries remain valid. Keep generic verb inflections.
    if (!hit || !glossMatches(o, hit.en, { inflections: language === 'es' && !ARTICLE_RE.test(hit.word) })) continue;
    // "my problem" -> "my el problema", "the answer" -> "the la respuesta": when the English article (or a
    // possessive) stays outside the swap, use the bare noun.
    const bare = language === 'es' ? exactFr(hit.canon).replace(DEFINITE_RE, '') : exactFr(hit.canon);
    if (bare !== exactFr(hit.canon) && !/^the\s/i.test(o) && idx.exact.has(bare)) hit = idx.exact.get(bare);
    out.push({
      o,
      f: language === 'es' ? matchCase(hit.canon, o) : matchCase(hit.canon, o, language),
      g: hit.en,
      h: hit.hint,
      ctx: typeof s.ctx === 'string' ? s.ctx.trim() : '',
      ...(sharedWords ? { word: hit.word, ...(hit.status ? { status: hit.status } : {}) } : {}),
    });
  }
  return out;
}

export function sentenceCount(text) {
  return Math.max(1, String(text).split(/[.!?…]+(?:\s|$)|\n+/).filter((s) => wordCount(s) >= 3).length);
}

// Density ceiling per passage, one use per Spanish word, learning words (active/shaky) kept before known ones.
export function capSwaps(level, swaps, text, sharedWords) {
  const max = (level <= 1 ? 1 : 2) * sentenceCount(text);
  const status = new Map((sharedWords || []).map((w) => [w.fr, w.status]));
  const rank = (s) => (status.get(s.word) && status.get(s.word) !== 'known' ? 0 : 1);
  const used = new Set();
  const unique = swaps.filter((s) => { const k = exactFr(s.word || s.f); if (used.has(k)) return false; used.add(k); return true; });
  const keep = new Set([...unique].sort((a, b) => rank(a) - rank(b)).slice(0, max));
  return unique.filter((s) => keep.has(s));
}

export function wordCount(text) {
  const t = String(text).trim();
  return t ? t.split(/\s+/).length : 0;
}

// Small, conservative client-side guard for the zero-Spanish topics. The model rule does the real work;
// this just guarantees the obvious cases never leave the page.
const ZERO_FRENCH = [
  /\b(doctor|hospital|diagnos\w*|symptoms?|medication|meds|ibuprofen|tylenol|prescription|overdose|vaccine|cancer|surgery|pregnan\w*|therapist|antidepressants?|ssri|adderall|stimulants?|chemo)\b/i,
  /\b(lawsuit|attorney|lawyer|sued|indict\w*|court order|legal advice|subpoena)\b/i,
  /\b(invest\w*|stock market|crypto|bitcoin|mortgage|loan|taxes|salary|bank account|financial advice)\b/i,
  /\b(911|emergency|evacuat\w*|shooting|wildfire|earthquake|hurricane|tornado|active shooter)\b/i,
  /\b(driving|drunk driv\w*|car crash|dui|speed limit|seat ?belt)\b/i,
];

export function isZeroSpanish(text) {
  return ZERO_FRENCH.some((re) => re.test(text));
}

// Compatibility for inherited modules; the guard excludes target-language swaps, not just French.
export const isZeroFrench = isZeroSpanish;

// Guess first (opt-in, gradual mode): on a learning word's first encounters the hover offers the
// correct English meaning among distractors before the gloss. Pure: no clock, storage or Chrome.
//
// Distractor rules (docs/INFERENCE-MISSION.md):
// - Drawn only from the scope's pack word list (`pack`), never invented or fetched.
// - Never the word's own gloss, and never a gloss that could also be correct for it: an entry is
//   refused when its target folds to the same form as the word (a homograph's gloss), or when any
//   of its English anchors shares a whole-word subset with an anchor of the word or of such a
//   homograph ("too much" against "much", "the problem" against "problem").
// - Distractors also refuse each other by the same rule, so no two options share a sense anchor.
// - Ranked by matching shape (a leading "the"/"a"/"an"/"to" agrees with the answer's), then by
//   closest length, then by a hash of the word ID and the gloss: deterministic for a word.
// - Order: the answer and its distractors are shuffled with a seed of the word ID and the local
//   day, so the order is stable within a day and changes across days.
// - Fewer than MIN_DISTRACTORS safe distractors: no choices (null); the caller shows the plain gloss.
import { englishAnchors } from './catalog.js';
import { normalizeFr } from './levels.js';

export const GUESS_LIMIT = 3; // logged guess attempts per word; afterwards the plain gloss
export const MAX_DISTRACTORS = 3;
export const MIN_DISTRACTORS = 2;
export const MAX_CHOICE_LENGTH = 120;

// 32-bit FNV-1a over UTF-16 code units: stable across engines, never Math.random.
export function seedHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// A small deterministic generator (mulberry32) for the day's shuffle.
function generator(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const plainGloss = (en) => String(en).normalize('NFC').replace(/\s+/g, ' ').trim();
const foldedTarget = (fr) => normalizeFr(fr);
const shape = (en) => (/^(the|an?|to)\s/i.exec(plainGloss(en))?.[1] || '').toLowerCase();
const tokens = (anchor) => anchor.replace(/^(?:the|a|an|to)\s+/, '').split(/[\s'-]+/).filter(Boolean);
function overlaps(anchorsA, anchorsB) {
  for (const a of anchorsA) {
    const ta = tokens(a);
    if (!ta.length) continue;
    for (const b of anchorsB) {
      const tb = tokens(b);
      if (!tb.length) continue;
      const [small, large] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
      if (small.every((token) => large.has(token))) return true;
    }
  }
  return false;
}

// `word`: { fr, en } (the swapped word); `pack`: the scope's full word list [{ fr, en }].
// Returns { choices: [string], answer: index } or null when no safe set exists.
export function guessChoices(word, pack, { wordId, day }) {
  if (!word || typeof word.en !== 'string' || typeof word.fr !== 'string' || !Array.isArray(pack) ||
      typeof wordId !== 'string' || typeof day !== 'string') return null;
  const answer = plainGloss(word.en);
  if (!answer || answer.length > MAX_CHOICE_LENGTH) return null;
  const form = foldedTarget(word.fr);
  const forbidden = englishAnchors({ en: answer });
  for (const entry of pack) {
    if (entry && typeof entry.en === 'string' && typeof entry.fr === 'string' && foldedTarget(entry.fr) === form)
      forbidden.push(...englishAnchors(entry));
  }
  const seen = new Set([answer.toLocaleLowerCase('en')]);
  const candidates = [];
  for (const entry of pack) {
    if (!entry || typeof entry.en !== 'string' || typeof entry.fr !== 'string') continue;
    const gloss = plainGloss(entry.en);
    const key = gloss.toLocaleLowerCase('en');
    if (!gloss || gloss.length > MAX_CHOICE_LENGTH || seen.has(key) || foldedTarget(entry.fr) === form) continue;
    const anchors = englishAnchors({ en: gloss });
    if (!anchors.length || overlaps(anchors, forbidden)) continue;
    seen.add(key);
    candidates.push({ gloss, anchors, rank: [shape(gloss) === shape(answer) ? 0 : 1,
      Math.abs(gloss.length - answer.length), seedHash(`${wordId}\u0000${gloss}`)] });
  }
  candidates.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2] ||
    (a.gloss < b.gloss ? -1 : a.gloss > b.gloss ? 1 : 0));
  const picked = [];
  for (const candidate of candidates) {
    if (picked.length >= MAX_DISTRACTORS) break;
    if (picked.some((other) => overlaps(candidate.anchors, other.anchors))) continue;
    picked.push(candidate);
  }
  if (picked.length < MIN_DISTRACTORS) return null;
  const choices = [answer, ...picked.map((candidate) => candidate.gloss)];
  const random = generator(seedHash(`${wordId}\u0000${day}`));
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { choices, answer: choices.indexOf(answer) };
}

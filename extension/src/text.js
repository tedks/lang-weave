// DOM side of a swap: flatten a tweet's text, locate the model's anchor, wrap one text-node slice.
// Pure DOM functions (use node.ownerDocument), so they run under happy-dom in tests.
import { sentenceStart, sourceIssue } from './semantic.js';
import { t } from './i18n.js';
export { quotedRanges, sentenceStart } from './semantic.js';

const SKIP_TAGS = new Set(['A', 'CODE', 'PRE', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SCRIPT', 'STYLE', 'KBD', 'SAMP']);
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
export const SWAP_CLASS = 'fw-word';
// Remember synthetic siblings so a framework replacing its original text node wins.
const splitGroups = new WeakMap();
const spanGroups = new WeakMap();
// Spans this extension made -> their learning word ('' if none). Kept out of the DOM, so a page can neither read the
// word list from attributes nor pass off its own span as a swap.
const owned = new WeakMap();
const sourceEnglish = new WeakMap();
const displaySwap = new WeakMap();
const practice = new WeakSet();
const cuedPractice = new WeakSet();
const introductions = new WeakMap();
// The target-language face of a span carries its BCP-47 code, so a screen reader voices "y" as Spanish.
// The accessible name is the shown word alone; the English gloss and action live in a hidden description.
const targetLang = new WeakMap();
const descriptions = new WeakMap(); // span -> its description element
const described = new Set(); // spans with a description, pruned once the page drops them
const descriptionHosts = new WeakMap(); // document -> hidden English container
// A page may strip foreign children of <html>; re-attach a few times a minute, never fight it.
const HOST_REATTACH = { max: 3, windowMs: 60000 };
const hostReattached = new WeakMap(); // document -> [ms]
const hostRetry = new WeakMap(); // document -> one timer for when the budget window reopens
let descriptionPrefix = '';
let descriptionCount = 0;
export const isSwap = (span) => owned.has(span);
export const swapWord = (span) => owned.get(span) || '';
export const swapEnglish = (span) => sourceEnglish.get(span) || '';
export const isPractice = (span) => practice.has(span);
export const isPracticeCue = (span) => cuedPractice.has(span);
// A due word can wait for a viewport cue slot without changing its review ticket.
export function setPracticeCue(span, active) {
  if (!practice.has(span) || !owned.has(span) || !span.isConnected) return false;
  if (cuedPractice.has(span) === active && span.classList.contains('fw-practice-cue') === active) return false;
  if (active) cuedPractice.add(span);
  else cuedPractice.delete(span);
  span.classList.toggle('fw-practice-cue', active);
  span.textContent = sourceEnglish.get(span);
  if (active) {
    const mark = span.ownerDocument.createElement('sup');
    mark.textContent = '?';
    mark.setAttribute('aria-hidden', 'true');
    span.append(mark);
    span.tabIndex = 0;
    span.setAttribute('role', 'button');
    span.setAttribute('title', t('practice_cue_title'));
    span.setAttribute('aria-label', t('practice_cue_label', sourceEnglish.get(span)));
  } else {
    span.removeAttribute('tabindex');
    span.removeAttribute('role');
    span.removeAttribute('title');
    span.removeAttribute('aria-label');
  }
  return true;
}
function bcp47(language) {
  try { return Intl.getCanonicalLocales(language)[0] || ''; } catch { return ''; }
}
// One hidden container per document, outside every passage: a hidden or aria-hidden element inside a
// passage would make the scanner treat that passage as unreadable on its next pass.
function descriptionHost(doc) {
  let host = descriptionHosts.get(doc);
  if (!host) {
    host = doc.createElement('div');
    host.className = 'fw-descriptions';
    host.hidden = true;
    host.setAttribute('lang', 'en');
    host.style.setProperty('display', 'none', 'important');
    descriptionHosts.set(doc, host);
  }
  if (!host.isConnected) doc.documentElement.append(host);
  return host;
}
function describe(span, text) {
  const doc = span.ownerDocument;
  let el = descriptions.get(span);
  if (!el) {
    if (!descriptionPrefix) {
      const bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      descriptionPrefix = `fw-d${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    }
    el = doc.createElement('span');
    el.id = `${descriptionPrefix}-${++descriptionCount}`;
    descriptions.set(span, el);
  }
  described.add(span);
  el.textContent = text;
  const host = descriptionHost(doc);
  if (el.parentNode !== host) host.append(el);
  span.setAttribute('aria-describedby', el.id);
}
function undescribe(span) {
  descriptions.get(span)?.remove();
  descriptions.delete(span);
  described.delete(span);
  span.removeAttribute('aria-describedby');
}
// Take the descriptions of spans the page has removed out of the container. The span keeps its
// description and aria-describedby, so a page that puts the same span back can restore it.
export function pruneDescriptions() {
  let live = null;
  for (const span of described) {
    if (span.isConnected) { live = span; continue; }
    descriptions.get(span)?.remove();
    described.delete(span);
  }
  // A page that removed the container while keeping swaps gets it back, so no reference dangles,
  // but only within a small budget: a page that keeps removing it must not start a loop.
  const doc = live?.ownerDocument;
  const host = doc && descriptionHosts.get(doc);
  if (host && !host.isConnected) {
    const now = Date.now();
    const times = (hostReattached.get(doc) || []).filter((at) => now - at < HOST_REATTACH.windowMs);
    if (times.length < HOST_REATTACH.max) { times.push(now); descriptionHost(doc); }
    else if (!hostRetry.has(doc)) {
      // One retry when the window reopens, so a quiet page does not keep dangling references.
      hostRetry.set(doc, setTimeout(() => { hostRetry.delete(doc); pruneDescriptions(); },
        HOST_REATTACH.windowMs - (now - times[0]) + 1));
    }
    hostReattached.set(doc, times);
  }
}
// Put back the descriptions of this extension's spans in a subtree the page has (re)attached.
export function restoreDescriptions(root) {
  if (root?.nodeType !== ELEMENT_NODE) return;
  const spans = root.matches(`span.${SWAP_CLASS}`) ? [root] : [];
  spans.push(...root.querySelectorAll(`span.${SWAP_CLASS}`));
  for (const span of spans) {
    const el = descriptions.get(span);
    if (!el || described.has(span) || !span.isConnected) continue;
    descriptionHost(span.ownerDocument).append(el);
    described.add(span);
  }
}
export const swapDescription = (span) => descriptions.get(span)?.textContent || '';
// Show the validated target word, voiced in the target language, with its gloss as the description.
function showTarget(span, text, display) {
  span.textContent = text;
  const lang = targetLang.get(span);
  if (lang) span.setAttribute('lang', lang);
  span.removeAttribute('aria-label');
  describe(span, t('swap_description', display ? tipFor(display) : span.getAttribute('data-tip')));
}
// Show English: the page's own language, so no lang of our own.
function showEnglish(span, text) {
  span.textContent = text;
  span.removeAttribute('lang');
}
export const introductionTicket = (span) => introductions.get(span) || '';
export function replaceIntroductionTicket(span, oldTicket, nextTicket) {
  if (!owned.has(span) || !span.isConnected || introductions.get(span) !== oldTicket || !nextTicket) return false;
  introductions.set(span, nextTicket);
  return true;
}
export function dropIntroduction(span) {
  if (!owned.has(span) || !span.isConnected || !introductions.has(span)) return false;
  const en = sourceEnglish.get(span);
  if (!en || !span.parentNode) return false;
  const node = span.ownerDocument.createTextNode(en);
  const group = spanGroups.get(span);
  if (group) { group.pieces.delete(span); group.pieces.add(node); }
  span.parentNode.replaceChild(node, span);
  undescribe(span);
  introductions.delete(span);
  return true;
}
export function finishIntroduction(span) {
  if (!owned.has(span) || !span.isConnected || !introductions.has(span)) return false;
  const display = displaySwap.get(span);
  if (!display?.f) return false;
  introductions.delete(span);
  span.setAttribute('data-fr', display.f);
  span.setAttribute('data-tip', tipFor(display));
  span.dataset.fwStatus = 'new';
  span.tabIndex = 0;
  span.setAttribute('role', 'button');
  showTarget(span, display.f, display);
  return true;
}

// After a saved inline rating, keep the existing woven word in place. A full
// page repaint would force a new model request under the changed card policy.
export function finishPractice(span, answer, familiar = false) {
  if (!practice.has(span) || !owned.has(span) || !span.isConnected ||
      !answer || answer.fr !== owned.get(span) || typeof answer.en !== 'string') return false;
  const en = sourceEnglish.get(span);
  const display = displaySwap.get(span);
  if (!en || !display?.f) return false;
  practice.delete(span);
  cuedPractice.delete(span);
  span.classList.remove('fw-practice', 'fw-practice-cue');
  span.removeAttribute('title');
  span.tabIndex = 0;
  span.setAttribute('role', 'button');
  span.setAttribute('data-en', en);
  span.setAttribute('data-fr', display.f);
  span.setAttribute('data-tip', tipFor(display));
  span.dataset.fwStatus = familiar ? 'known' : 'active';
  showTarget(span, display.f, display);
  return true;
}

// Returns { text, map, segs, raw }:
//   raw   = every text node's data in order (plus emoji alt text), untouched
//   text  = raw with whitespace runs collapsed to one space and ends trimmed (what the model sees)
//   map   = text index -> raw index
//   segs  = [{ node, start, end, ok }] raw ranges; ok=false inside links/code/etc or for virtual text
export function flatten(root) {
  const segs = [];
  let raw = '';
  const push = (node, data, ok) => {
    if (!data) return;
    segs.push({ node, start: raw.length, end: raw.length + data.length, ok });
    raw += data;
  };
  const walk = (node, blocked) => {
    for (const child of node.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        push(child, child.data, !blocked);
      } else if (child.nodeType === ELEMENT_NODE) {
        const tag = child.tagName;
        if (tag === 'IMG') {
          push(null, child.getAttribute('alt') || '', false);
        } else if (tag === 'BR') {
          push(null, '\n', false);
        } else if (owned.has(child)) {
          push(null, child.getAttribute('data-en') || child.textContent, false);
        } else {
          walk(child, blocked || SKIP_TAGS.has(tag) || child.matches('[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="button"],[hidden],[aria-hidden="true"],[translate="no"],.notranslate'));
        }
      }
    }
  };
  walk(root, false);

  let text = '';
  const map = [];
  let inWs = true; // trims leading whitespace
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (!inWs) {
        text += ' ';
        map.push(i);
        inWs = true;
      }
    } else {
      text += ch;
      map.push(i);
      inWs = false;
    }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map, segs, raw };
}

function findAll(text, needle, from, to) {
  const out = [];
  if (!needle) return out;
  let i = text.indexOf(needle, from);
  while (i !== -1 && i + needle.length <= to) {
    out.push(i);
    i = text.indexOf(needle, i + 1);
  }
  return out;
}

function wordMatches(text, needle, from, to) {
  return findAll(text, needle, from, to)
    .filter((i) => {
      const before = i === 0 ? '' : text[i - 1];
      const after = text[i + needle.length] ?? '';
      // A contraction or hyphenated compound is one word to the reader: never swap "Here" in "Here's"
      // ("Ici's") or "now" in "now-frozen".
      const joinedAfter = /['’-]/.test(after) && WORD_CHAR.test(text[i + needle.length + 1] ?? '');
      const joinedBefore = /['’-]/.test(before) && i > 1 && WORD_CHAR.test(text[i - 2]);
      return (!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after)) && !joinedAfter && !joinedBefore;
    })
    .map((i) => ({ start: i, end: i + needle.length }));
}

// Position of the swap in flat.text, or null. ctx narrows the search; a unique whole-text match is the fallback.
export function locate(flat, o, ctx) {
  const { text } = flat;
  if (!o) return null;
  if (ctx && ctx.length >= o.length) {
    const c = findAll(text, ctx, 0, text.length);
    if (c.length === 1) {
      const m = wordMatches(text, o, c[0], c[0] + ctx.length);
      if (m.length === 1) return m[0];
    }
  }
  const m = wordMatches(text, o, 0, text.length);
  return m.length === 1 ? m[0] : null;
}

// Map a flat.text range to one touchable text node. Null when it straddles nodes, sits in a link, etc.
export function toNode(flat, m, o) {
  const rs = flat.map[m.start];
  const re = flat.map[m.end - 1] + 1;
  if (rs === undefined || re === undefined) return null;
  if (flat.raw.slice(rs, re) !== o) return null;
  for (let i = 0; i < flat.segs.length; i++) {
    const s = flat.segs[i];
    if (s.node && s.ok && s.start <= rs && re <= s.end) {
      return { node: s.node, offset: rs - s.start, length: re - rs, seg: i };
    }
  }
  return null;
}

export function tipFor(swap) {
  return swap.h ? `${swap.g} · "${swap.h}"` : swap.g;
}

function wrap(place, swap, language) {
  const { node, offset, length } = place;
  const doc = node.ownerDocument;
  const mid = node.splitText(offset);
  const suffix = mid.splitText(length);
  const span = doc.createElement('span');
  span.className = SWAP_CLASS;
  span.setAttribute('data-en', mid.data);
  // A practice span shows the English cue until a trusted reveal. Do not put
  // its answer in page-readable attributes before that reveal.
  if (!swap.practice && !swap.introTicket) {
    span.setAttribute('data-fr', swap.f);
    span.setAttribute('data-tip', tipFor(swap));
  }
  span.setAttribute('data-fw-split', '1');
  if (swap.status && !swap.practice && !swap.introTicket) span.dataset.fwStatus = swap.status;
  if (!swap.introTicket && !swap.practice) { span.tabIndex = 0; span.setAttribute('role', 'button'); }
  const lang = bcp47(language);
  if (lang) targetLang.set(span, lang);
  if (swap.practice || swap.introTicket) {
    if (swap.introTicket) span.setAttribute('aria-label', mid.data);
    span.textContent = mid.data;
  } else showTarget(span, swap.f, swap);
  mid.parentNode.replaceChild(span, mid);
  owned.set(span, swap.word || '');
  sourceEnglish.set(span, mid.data);
  displaySwap.set(span, { f: swap.f, g: swap.g, h: swap.h });
  if (swap.introTicket) introductions.set(span, swap.introTicket);
  if (swap.practice) {
    practice.add(span);
    span.classList.add('fw-practice');
  }
  const group = splitGroups.get(node) || { node, pieces: new Set() };
  group.prefix = node.data;
  group.pieces.add(span); group.pieces.add(suffix);
  splitGroups.set(node, group); spanGroups.set(span, group);
  return span;
}

// Applies validated swaps [{o, f, g, h, ctx}] to root. Returns the number placed.
export function applySwaps(root, swaps, onPlaced = () => {}, language = 'es') {
  const flat = flatten(root);
  const placed = [];
  const used = [];
  for (const swap of swaps) {
    const m = locate(flat, swap.o, swap.ctx);
    if (!m) continue;
    if (sourceIssue(flat.text, m.start, m.end, swap.o)) continue;
    if (used.some((u) => m.start < u.end && u.start < m.end)) continue;
    const place = toNode(flat, m, swap.o);
    if (!place) continue;
    used.push(m);
    // I is capitalized everywhere in English; capitalize its target only at this located sentence start.
    const display = /^I(?!\p{L})/u.test(swap.o) && sentenceStart(flat.text, m.start)
      ? { ...swap, f: swap.f.charAt(0).toLocaleUpperCase(language) + swap.f.slice(1) } : swap;
    placed.push({ place, swap: display });
  }
  // Later positions first, so earlier offsets in the same text node stay valid.
  placed.sort((a, b) => b.place.seg - a.place.seg || b.place.offset - a.place.offset);
  for (const { place, swap } of placed) onPlaced(wrap(place, swap, language), swap);
  return placed.length;
}

// Removes every swap under root and merges the split text nodes back, restoring the original node.
export function revert(root) {
  const spans = Array.from(root.querySelectorAll(`span.${SWAP_CLASS}`)).filter(isSwap);
  const groups = new Set(spans.map((span) => spanGroups.get(span)).filter(Boolean));
  for (const group of groups) {
    if (group.node.data !== group.prefix && group.node.parentNode) {
      for (const piece of group.pieces) if (piece.parentNode === group.node.parentNode) piece.remove();
    }
    splitGroups.delete(group.node);
  }
  for (const span of spans) {
    undescribe(span);
    const parent = span.parentNode;
    if (!parent) continue;
    const en = sourceEnglish.get(span) ?? span.getAttribute('data-en') ?? span.textContent;
    const prev = span.previousSibling;
    const next = span.nextSibling;
    if (
      span.getAttribute('data-fw-split') === '1' &&
      prev && prev.nodeType === TEXT_NODE &&
      next && next.nodeType === TEXT_NODE
    ) {
      prev.data = prev.data + en + next.data;
      parent.removeChild(span);
      parent.removeChild(next);
    } else {
      parent.replaceChild(span.ownerDocument.createTextNode(en), span);
    }
  }
  return spans.length;
}

// Click: flip one swap between the selected target language and English.
export function toggle(span, language = 'Spanish') {
  const showEn = !span.classList.contains('fw-en');
  span.classList.toggle('fw-en', showEn);
  if (showEn) {
    showEnglish(span, sourceEnglish.get(span) ?? span.getAttribute('data-en'));
    span.removeAttribute('aria-label');
    describe(span, t('swap_show_language', language));
  } else showTarget(span, span.getAttribute('data-fr'), displaySwap.get(span));
  return showEn;
}

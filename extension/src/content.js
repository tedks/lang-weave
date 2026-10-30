// Content script: watch readable text (tweets on X, prose elsewhere), ask the background for swaps, paint them,
// handle the delayed gloss, click/Enter flip and seen/peek/flip events. Every async reply belongs to one config generation.
import { flatten, applySwaps, revert, toggle, isSwap, isPractice, swapWord,
  finishPractice, setPracticeCue, introductionTicket, replaceIntroductionTicket, dropIntroduction,
  finishIntroduction, SWAP_CLASS } from './text.js';
import { hashKey } from './hash.js';
import { siteEnabled, hasSiteAccess } from './settings.js';
import { selector, readable } from './page.js';
import { isZeroFrench } from './levels.js';
import { localDay } from './events.js';
import { languageName } from './language-name.js';
import { capturePageAllowed, verifyCaptureSelection } from './personal-capture.js';

let config = null;
let observer = null;
let near = null;
let visible = null;
let timer = null;
let generation = 0;
let titleSensitive = isZeroFrench(document.title);
const memo = new Map();
const keys = new WeakMap(); // element -> revision:text hash, kept off the DOM so pages can't read it
const pending = new Map();
const inflight = new Set();
const tracked = new Set();
const visibleWords = new Set();
const introInflight = new Set();
let introRetries = new WeakMap(); // an expired visible reservation gets a bounded fresh attempt
const introErrors = new Map();
const seen = new Set();
const failures = new Map(); // text key -> failed model attempts; retried with backoff
const MAX_RETRIES = 3;
// Live text (countdowns, tickers, "updated 5s ago") would cost a model call per change, and a page that undoes
// swaps would be repainted forever. Such an element stays English until the next page view.
const CHURN = { asks: 3, paints: 6 }; // new texts needing a model call / repaints, per element per window
const CHURN_WINDOW_MS = 60000;
let churn = new WeakMap(); // element -> { text, asks: [ms], paints: [ms], live }
const TIP_DELAY_MS = 700; // a beat to recall the word before the meaning appears
let tipTimer = null;
let tipTarget = null;
let tipBox = null;
let tipHovered = false;
let tipFocused = false;
let focusedTip = null;
let focusedAt = 0;
let focusScrollUntil = 0;
const TIP_GAP = 8;
const FOCUS_SCROLL_MS = 250; // focus() may scroll its word just after focusin
let cue = null;
let cueWord = null;
// After the extension reloads itself for an update, this copy is cut off from the worker. It then goes quiet:
// no more requests or errors, woven words stay as they are, and a page reload brings in the new copy.
let orphaned = false;
const alive = () => { try { return !orphaned && !!chrome.runtime?.id; } catch { return false; } };
function orphan() {
  if (orphaned) return;
  orphaned = true;
  generation++;
  observer?.disconnect(); observer = null;
  near?.disconnect(); visible?.disconnect();
  clearTimeout(timer); timer = null; clearInterval(navTimer); hideTip();
  closeCue();
  pending.clear(); inflight.clear();
}
const send = (msg) => {
  if (!alive()) { orphan(); return Promise.reject(new Error('Lang Weave was reloaded')); }
  try {
    return chrome.runtime.sendMessage(msg).catch((e) => { if (!alive()) orphan(); throw e; });
  } catch (e) {
    orphan();
    return Promise.reject(e);
  }
};
const on = () => !orphaned && window.top === window && config?.hasKey && !config.paused && !isZeroFrench(document.title) &&
  siteEnabled(config.settings, location.href) && hasSiteAccess(location.href, config.origins);
const targets = () => selector(location.href);
// Only real user input on spans this extension made; pages can't forge flips, peeks or seen events.
const swapFor = (e) => {
  const span = e.isTrusted && e.target?.closest?.(`span.${SWAP_CLASS}`);
  return span && isSwap(span) ? span : null;
};

function record(span, event) {
  const word = swapWord(span);
  if (!word || !on()) return;
  const revision = config.revision;
  const id = revision + ':' + localDay() + ':' + event + ':' + word;
  const daily = event === 'seen' || event === 'peek';
  if (daily && seen.has(id)) return;
  if (daily) seen.add(id);
  void send({ type: 'event', word, event, revision }).then((r) => {
    if (!r?.ok && daily) seen.delete(id);
  }).catch(() => { if (daily) seen.delete(id); });
}
// Keep the box outside readable passages and clipping ancestors. It contains only validated swap display text.
function showTip(span) {
  const gloss = span.getAttribute('data-tip');
  const word = span.getAttribute('data-fr');
  if (!word || !gloss) return false;
  const box = document.createElement('div');
  box.className = 'fw-gloss fw-gloss-on';
  box.setAttribute('aria-hidden', 'true'); // the word's existing label describes its meaning to screen readers
  box.textContent = `${word} · ${gloss}`;
  document.documentElement.append(box);
  tipBox = box;
  placeTip(span, box);
  return true;
}
export function placeTip(span, box) {
  const rect = span.getBoundingClientRect();
  const size = box.getBoundingClientRect();
  const width = document.documentElement.clientWidth || window.innerWidth;
  const height = document.documentElement.clientHeight || window.innerHeight;
  const left = Math.max(TIP_GAP, Math.min(rect.left, width - size.width - TIP_GAP));
  const above = rect.top - size.height - TIP_GAP;
  const below = rect.bottom + TIP_GAP;
  const top = above >= TIP_GAP ? above : Math.min(below, height - size.height - TIP_GAP);
  box.style.setProperty('left', `${left}px`, 'important');
  box.style.setProperty('top', `${Math.max(TIP_GAP, top)}px`, 'important');
}
// The gloss appears only after a short dwell; reaching it counts as a peek (the reader needed the meaning).
function hideTip(keepFocus = false) {
  clearTimeout(tipTimer); tipTimer = null;
  tipTarget?.classList.remove('fw-tip');
  tipTarget = null;
  tipHovered = false;
  tipFocused = false;
  tipBox?.remove(); tipBox = null;
  if (!keepFocus) { focusedTip = null; focusedAt = 0; focusScrollUntil = 0; }
}
function closeCue() { cue?.remove(); cue = null; cueWord = null; updatePracticeCues(); }

// The worker has already selected due words. This only chooses which two visible
// English words show an invitation; waiting words keep their existing card state.
function updatePracticeCues() {
  if (!on()) return;
  const height = document.documentElement.clientHeight || window.innerHeight;
  const width = document.documentElement.clientWidth || window.innerWidth;
  const spans = [...document.querySelectorAll(`span.${SWAP_CLASS}.fw-practice`)].filter(isPractice);
  const visible = spans.filter((span) => {
    const rect = span.getBoundingClientRect();
    return span.isConnected && rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width;
  });
  const chosen = new Set(visible.slice(0, 2));
  if (cueWord && visible.includes(cueWord) && !chosen.has(cueWord)) {
    chosen.delete(visible[1]);
    chosen.add(cueWord);
  }
  for (const span of spans) setPracticeCue(span, chosen.has(span));
  observer?.takeRecords();
}

async function openCue(span) {
  closeCue(); hideTip();
  cueWord = span;
  const gen = generation;
  const revision = config.revision;
  const panel = document.createElement('div');
  panel.className = 'fw-recall';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Inline recall');
  const prompt = document.createElement('div');
  prompt.textContent = 'Recall the translation before revealing.';
  const status = document.createElement('div');
  status.className = 'fw-recall-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div');
  actions.className = 'fw-recall-actions';
  const button = (parent, label, fn) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); if (e.isTrusted) void fn(); });
    parent.append(b); return b;
  };
  panel.append(prompt, status, actions);
  panel.addEventListener('keydown', (e) => {
    if (e.isTrusted && e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); closeCue();
      if (span.isConnected) span.focus();
    }
  });
  document.documentElement.append(panel); cue = panel;
  button(actions, 'Dismiss', () => { closeCue(); if (span.isConnected) span.focus(); });
  placeTip(span, panel);
  const liveCue = () => gen === generation && cue === panel && on() && span.isConnected && isPractice(span);
  let ticket;
  let answer;
  try {
    const started = await send({ type: 'inlineBegin', word: swapWord(span), revision });
    if (!started?.ticket) throw new Error(started?.error || 'Cue unavailable');
    if (!liveCue()) { closeCue(); return; }
    ticket = started.ticket;
  } catch {
    if (!liveCue()) closeCue();
    else status.textContent = 'Cue unavailable. Dismiss and try again.';
    return;
  }
  const revealButton = button(actions, 'Reveal answer', async () => {
    if (!liveCue()) { closeCue(); return; }
    revealButton.disabled = true;
    try {
      const r = await send({ type: 'inlineReveal', ticket, revision });
      if (!r?.answer) throw new Error(r?.error || 'Cue expired');
      if (!liveCue()) { closeCue(); return; }
      answer = r.answer;
      status.textContent = `${r.answer.fr}${r.answer.hint ? ` · ${r.answer.hint}` : ''}`;
      revealButton.remove();
      const ratings = document.createElement('div');
      ratings.className = 'fw-recall-ratings';
      const secondary = document.createElement('div');
      secondary.className = 'fw-recall-secondary';
      panel.append(ratings, secondary);
      let firstRating;
      for (const [label, rating] of [['Again', 'again'], ['Hard', 'hard'], ['Medium', 'medium'], ['Easy', 'easy'], ['Already know', 'known']]) {
        const rated = button(rating === 'known' ? secondary : ratings, label, async () => {
          if (!liveCue()) { closeCue(); return; }
          for (const b of panel.querySelectorAll('button')) b.disabled = true;
          try {
            const result = await send({ type: 'inlineRate', ticket, rating, revision });
            if (!result?.ok) throw new Error(result?.error || 'Cue expired');
            const ownCue = cue === panel;
            if (ownCue) closeCue();
            if (gen === generation && on()) {
              const word = swapWord(span);
              let changed = false;
              for (const related of document.querySelectorAll(`.${SWAP_CLASS}.fw-practice`)) {
                if (isPractice(related) && swapWord(related) === word)
                  changed = finishPractice(related, answer, result.familiar) || changed;
              }
              if (changed) observer?.takeRecords();
              updatePracticeCues();
              if (ownCue && span.isConnected && !isPractice(span)) span.focus();
            }
          } catch {
            if (!liveCue()) { closeCue(); return; }
            for (const b of panel.querySelectorAll('button')) b.disabled = false;
            status.textContent = 'Rating was not saved. Try again or dismiss.';
          }
        });
        if (rating === 'hard') firstRating = rated; // preserve the prior keyboard focus
      }
      placeTip(span, panel);
      firstRating?.focus();
    } catch {
      if (!liveCue()) { closeCue(); return; }
      revealButton.disabled = false;
      status.textContent = 'Answer unavailable. Try again or dismiss.';
    }
  });
  actions.prepend(revealButton);
  placeTip(span, panel);
  revealButton.focus();
}
function tipEligible(span) {
  return span?.isConnected && isSwap(span) && on() && alive() && !isPractice(span) &&
    !introductionTicket(span) && !span.classList.contains('fw-en') && !!span.getAttribute('data-tip');
}
function startTip(span, peek, delay = TIP_DELAY_MS) {
  const gen = generation;
  tipTimer = setTimeout(() => {
    tipTimer = null;
    if (tipTarget !== span || gen !== generation || !tipEligible(span)) {
      hideTip(); return;
    }
    if (!showTip(span)) { hideTip(); return; }
    span.classList.add('fw-tip');
    if (peek && tipHovered) record(span, 'peek'); // focus alone never counts
  }, delay);
}
function restoreFocusedTip() {
  const span = focusedTip;
  if (!tipEligible(span)) { hideTip(); return; }
  hideTip(true);
  tipTarget = span;
  tipFocused = true;
  startTip(span, false, Math.max(0, TIP_DELAY_MS - (Date.now() - focusedAt)));
}
function armTip(e) {
  const span = swapFor(e);
  if (!tipEligible(span)) return;
  if (e.type === 'focusin') {
    focusedTip = span;
    focusedAt = Date.now();
    focusScrollUntil = focusedAt + FOCUS_SCROLL_MS;
    if (span === tipTarget) { tipFocused = true; return; } // preserve an active hover dwell and its peek
  } else if (span === tipTarget) {
    if (tipHovered) return;
    if (tipFocused && tipBox) {
      tipHovered = true;
      // A visible focus gloss stays put; hovering still needs its own full dwell before a peek.
      tipTimer = setTimeout(() => {
        tipTimer = null;
        if (tipTarget === span && tipHovered && tipEligible(span)) record(span, 'peek');
      }, TIP_DELAY_MS);
      return;
    }
  }
  hideTip(true);
  tipTarget = span;
  tipHovered = e.type === 'mouseover';
  tipFocused = focusedTip === span;
  startTip(span, e.type === 'mouseover');
}
// Exported for a direct happy-dom regression: that DOM swallows listener exceptions.
export function disarmTip(e) {
  const span = swapFor(e);
  if (!span || span.contains(e.relatedTarget)) return;
  if (e.type === 'focusout' && span === focusedTip) { focusedTip = null; focusedAt = 0; focusScrollUntil = 0; }
  if (span !== tipTarget) return;
  if (e.type === 'mouseout') {
    tipHovered = false;
    // The pending reveal also serves focus; only a pending hover peek ends here.
    if (tipBox || !tipFocused) { clearTimeout(tipTimer); tipTimer = null; }
  }
  else tipFocused = false;
  if (!tipHovered && !tipFocused) {
    if (e.type === 'mouseout' && focusedTip && focusedTip !== span) restoreFocusedTip();
    else hideTip();
  }
}
function introSpans(ticket) {
  return [...document.querySelectorAll(`span.${SWAP_CLASS}`)]
    .filter((span) => isSwap(span) && introductionTicket(span) === ticket);
}
function abandonIntro(ticket, word, revision) {
  for (const span of introSpans(ticket)) {
    visibleWords.delete(span);
    visible?.unobserve(span);
    dropIntroduction(span);
  }
  introErrors.delete(ticket);
  observer?.takeRecords();
  void send({ type: 'introRelease', ticket, word, revision }).catch(() => {});
}
function retryIntro(ticket, word, revision, gen) {
  if (!introSpans(ticket).length) { introErrors.delete(ticket); return; }
  const attempts = (introErrors.get(ticket) || 0) + 1;
  introErrors.set(ticket, attempts);
  if (attempts > 3) { abandonIntro(ticket, word, revision); return; }
  setTimeout(() => { if (gen === generation && alive()) seenVisible(); }, attempts * 1000);
}
function seenVisible() {
  if (document.visibilityState === 'hidden') return;
  for (const span of visibleWords) {
    if (!span.isConnected || isPractice(span)) continue;
    const ticket = introductionTicket(span);
    if (ticket) {
      if (!introInflight.has(ticket) && on()) {
        introInflight.add(ticket);
        const gen = generation, revision = config.revision, word = swapWord(span);
        void send({ type: 'introAck', ticket, word, revision }).then(async (result) => {
          if (gen !== generation || !on()) return;
          if (result?.ok) {
            introErrors.delete(ticket);
            for (const related of introSpans(ticket)) {
              if (finishIntroduction(related) && visibleWords.has(related)) record(related, 'seen');
            }
            observer?.takeRecords();
          } else if (result?.error || !result?.stale) {
            retryIntro(ticket, word, revision, gen);
          } else {
            const related = introSpans(ticket);
            const roots = new Set(related.map((s) => s.closest(targets())).filter(Boolean));
            if (!related.length || [...roots].some((root) => (introRetries.get(root) || 0) >= 2)) {
              abandonIntro(ticket, word, revision);
              return;
            }
            try {
              const renewed = await send({ type: 'introRenew', ticket, word, revision });
              if (gen !== generation || !on()) return;
              if (renewed?.ticket) {
                for (const root of roots) introRetries.set(root, (introRetries.get(root) || 0) + 1);
                const moved = related.filter((item) => replaceIntroductionTicket(item, ticket, renewed.ticket));
                if (!moved.length) {
                  void send({ type: 'introRelease', ticket: renewed.ticket, word, revision }).catch(() => {});
                  return;
                }
                introErrors.delete(ticket);
                seenVisible();
              } else if (renewed?.error) retryIntro(ticket, word, revision, gen);
              else abandonIntro(ticket, word, revision);
            } catch { if (gen === generation && alive()) retryIntro(ticket, word, revision, gen); }
          }
        }).catch(() => { if (gen === generation && alive()) retryIntro(ticket, word, revision, gen); })
          .finally(() => { introInflight.delete(ticket); });
      }
    } else record(span, 'seen');
  }
}
function paint(el, key, placedTickets = new Set()) {
  if (!on() || keys.get(el) !== key || !readable(el, location.href)) return;
  const swaps = memo.get(key);
  if (!swaps?.length || busy(el, 'paints')) return;
  applySwaps(el, swaps, (_span, swap) => { if (swap.introTicket) placedTickets.add(swap.introTicket); }, config.language);
  for (const span of el.querySelectorAll(`.${SWAP_CLASS}`)) if (isSwap(span)) visible.observe(span);
  updatePracticeCues();
  observer?.takeRecords();
}
// True when this element churns; same-text retries never count as a new ask.
function busy(el, kind, text = '') {
  const c = churn.get(el) || { text: '', asks: [], paints: [], live: false };
  churn.set(el, c);
  if (c.live || (kind === 'asks' && c.text === text)) return c.live;
  const now = Date.now();
  c[kind] = c[kind].filter((t) => now - t < CHURN_WINDOW_MS);
  if (c[kind].length >= CHURN[kind]) return (c.live = true);
  c[kind].push(now);
  if (kind === 'asks') c.text = text;
  return false;
}
function consider(el) {
  if (!on() || !el.isConnected) return;
  if (el.querySelector(`.${SWAP_CLASS}`)) revert(el);
  observer?.takeRecords();
  if (!readable(el, location.href)) { keys.delete(el); return; }
  const text = flatten(el).text;
  const key = `${config.revision}:${hashKey(text)}`;
  keys.set(el, key);
  // Gradual choices depend on a changing daily allowance and review cards.
  // Revisit the worker on a same-text rerender; its policy-keyed cache avoids
  // another model call when those inputs have not changed.
  if (!config.settings.gradual && memo.has(key)) { paint(el, key); return; }
  if (busy(el, 'asks', text)) return;
  let p = pending.get(key);
  if (!p) { p = { text, els: new Set() }; pending.set(key, p); }
  p.els.add(el);
  if (!timer) timer = setTimeout(flush, 250);
}
async function flush() {
  timer = null;
  if (!on()) return;
  if (config.settings.gradual && document.visibilityState === 'hidden') return;
  const gen = generation;
  const items = [...pending].filter(([key]) => !inflight.has(key)).slice(0, 8).map(([key, p]) => ({ key, text: p.text }));
  if (!items.length) return;
  for (const i of items) inflight.add(i.key);
  let result;
  try { result = await send({ type: 'swaps', revision: config.revision, items, title: document.title }); }
  catch { result = { error: 'Extension unavailable' }; }
  if (gen !== generation || !on()) return;
  if (config.settings.gradual && document.visibilityState === 'hidden') {
    for (const i of items) inflight.delete(i.key);
    for (const swaps of Object.values(result?.results || {})) for (const swap of Array.isArray(swaps) ? swaps : [])
      if (swap.introTicket) void send({ type: 'introRelease', ticket: swap.introTicket,
        word: swap.word, revision: config.revision }).catch(() => {});
    return; // pending text is reconsidered when this document becomes visible
  }
  const deliveredTickets = new Map(), placedTickets = new Set();
  for (const i of items) {
    inflight.delete(i.key);
    const p = pending.get(i.key);
    pending.delete(i.key);
    const swaps = result?.results?.[i.key];
    if (!Array.isArray(swaps)) {
      // A failed model call (usually the free tier's rate limit) is retried instead of leaving the passage English.
      const tries = (failures.get(i.key) || 0) + 1;
      failures.set(i.key, tries);
      if (p && tries <= MAX_RETRIES) {
        const wait = Math.max(result?.retryAfterMs || 0, 5000 * tries);
        setTimeout(() => { if (gen === generation) for (const el of p.els) if (keys.get(el) === i.key) { keys.delete(el); consider(el); } }, wait);
      }
      continue;
    }
    failures.delete(i.key);
    memo.set(i.key, swaps);
    if (p) for (const el of p.els) paint(el, i.key, placedTickets);
    for (const swap of swaps) if (swap.introTicket) deliveredTickets.set(swap.introTicket, swap.word);
    if (config.settings.gradual) memo.delete(i.key);
  }
  for (const [ticket, word] of deliveredTickets) if (!placedTickets.has(ticket))
    void send({ type: 'introRelease', ticket, word, revision: config.revision }).catch(() => {});
  if (result?.stale) { try { update(await send({ type: 'config' })); } catch { /* reloaded or gone */ } return; }
  if ([...pending.keys()].some((k) => !inflight.has(k))) timer = setTimeout(flush, 50);
}
function track(root) {
  if (root.nodeType !== 1) return;
  const elements = root.matches(targets()) ? [root, ...root.querySelectorAll(targets())] : root.querySelectorAll(targets());
  for (const el of elements) {
    if (tracked.has(el) || !readable(el, location.href)) continue;
    tracked.add(el);
    near.observe(el);
  }
}
function mutations(records) {
  const sensitive = isZeroFrench(document.title);
  if (titleSensitive !== sensitive) {
    titleSensitive = sensitive;
    if (config) update(config, true);
    return;
  }
  if (tipTarget && (!tipTarget.isConnected || !on() || isPractice(tipTarget) ||
      introductionTicket(tipTarget) || tipTarget.classList.contains('fw-en'))) hideTip();
  const changed = new Set();
  for (const r of records) {
    for (const n of r.addedNodes || []) if (n.nodeType === 1) track(n);
    const base = r.target.nodeType === 1 ? r.target : r.target.parentElement;
    const el = base?.closest(targets());
    if (el && tracked.has(el)) changed.add(el);
    else if (el) track(el);
  }
  for (const el of changed) {
    if (tipTarget && el.contains(tipTarget)) hideTip();
    if (el.querySelector(`.${SWAP_CLASS}`)) revert(el);
    keys.delete(el);
    if (readable(el, location.href)) { near.unobserve(el); near.observe(el); }
  }
  observer?.takeRecords();
  for (const el of tracked) if (!el.isConnected) { tracked.delete(el); near.unobserve(el); }
  for (const span of visibleWords) if (!span.isConnected) { visibleWords.delete(span); visible.unobserve(span); }
  updatePracticeCues();
}
function start() {
  if (observer || !on()) return;
  visible = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio >= 0.5) visibleWords.add(e.target);
      else visibleWords.delete(e.target);
    }
    seenVisible();
  }, { threshold: [0, 0.5] });
  near = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting && !keys.has(e.target)) consider(e.target);
  }, { rootMargin: '600px' });
  observer = new MutationObserver(mutations);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  track(document.documentElement);
}
function stop() {
  if (config?.settings.gradual && alive()) {
    const tickets = new Map();
    for (const root of tracked) for (const span of root.querySelectorAll(`span.${SWAP_CLASS}`)) {
      const ticket = introductionTicket(span);
      if (ticket) tickets.set(ticket, swapWord(span));
    }
    for (const [ticket, word] of tickets)
      void send({ type: 'introRelease', ticket, word, revision: config.revision }).catch(() => {});
  }
  generation++;
  observer?.disconnect(); observer = null;
  near?.disconnect(); visible?.disconnect();
  clearTimeout(timer); timer = null;
  pending.clear(); inflight.clear(); memo.clear(); failures.clear(); hideTip();
  introInflight.clear();
  introErrors.clear();
  closeCue();
  churn = new WeakMap();
  introRetries = new WeakMap();
  for (const el of tracked) { revert(el); keys.delete(el); }
  tracked.clear(); visibleWords.clear();
}
function update(next, retry = false) {
  if (!next?.settings || !next.revision) return;
  if (!retry && next.revision === config?.revision) return;
  stop(); config = next; start();
}
function reveal(e) {
  if (!e.isTrusted) return;
  const span = swapFor(e);
  if (!span || !on() || introductionTicket(span)) return;
  if (e.type === 'keydown' && !['Enter', ' '].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  hideTip();
  if (isPractice(span)) { if (span.classList.contains('fw-practice-cue')) void openCue(span); return; }
  if (toggle(span, languageName(config.language))) record(span, 'flip');
  observer?.takeRecords();
}
chrome.runtime.onMessage.addListener((msg) => {
  if (['config', 'retry'].includes(msg?.type)) update(msg.config, msg.type === 'retry');
});
// A context-menu gesture wakes an idle MV3 worker and re-announces this exact
// document through Chrome's sender metadata before the native menu is chosen.
document.addEventListener('contextmenu', () => {
  if (capturePageAllowed({ url: location.href, title: document.title,
    settings: config?.settings, origins: config?.origins }))
    void send({ type: 'captureReady' }).catch(() => {});
}, true);
// The worker targets the exact top-frame document. Recheck consent/title and the live selection here;
// menu selectionText alone is stale, untrusted input and is never sufficient to authorize capture.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'personalCaptureAlive') {
    const ok = sender.id === chrome.runtime.id && capturePageAllowed({
      url: location.href, title: document.title, settings: config?.settings, origins: config?.origins,
    });
    reply(ok ? { ok: true } : { ok: false });
    return false;
  }
  if (msg?.type !== 'personalCaptureChallenge') return false;
  const result = sender.id === chrome.runtime.id && typeof msg.nonce === 'string' && msg.nonce.length >= 16 &&
    verifyCaptureSelection(window.getSelection(), msg.text, {
      url: location.href, title: document.title, settings: config?.settings, origins: config?.origins,
    });
  reply(result?.ok ? { ok: true, text: result.text } : { ok: false });
  return false;
});
document.addEventListener('click', reveal, true);
document.addEventListener('keydown', reveal, true);
document.addEventListener('mouseover', armTip, true);
document.addEventListener('focusin', armTip, true);
document.addEventListener('mouseout', disarmTip, true);
document.addEventListener('focusout', disarmTip, true);
window.addEventListener('scroll', () => {
  updatePracticeCues();
  if (cue && cueWord?.isConnected) placeTip(cueWord, cue);
  if (focusedTip && document.activeElement === focusedTip && Date.now() <= focusScrollUntil && tipEligible(focusedTip)) {
    if (tipTarget === focusedTip && tipBox) placeTip(focusedTip, tipBox);
    else if (tipTarget !== focusedTip) restoreFocusedTip();
    return;
  }
  hideTip();
}, { passive: true, capture: true });
window.addEventListener('resize', () => { hideTip(); updatePracticeCues(); if (cue && cueWord?.isConnected) placeTip(cueWord, cue); }, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hideTip();
  if (document.visibilityState !== 'hidden' && pending.size && !timer) timer = setTimeout(flush, 0);
  seenVisible();
});
window.addEventListener('online', () => { void send({ type: 'config' }).then((c) => update(c, true)).catch(() => {}); });
// SPA navigation can reuse DOM nodes without changing their text.
let page = location.href;
let day = localDay();
const navTimer = setInterval(() => {
  const today = localDay();
  const sensitive = isZeroFrench(document.title);
  if (page !== location.href || titleSensitive !== sensitive || config?.settings.gradual && day !== today) {
    page = location.href;
    titleSensitive = sensitive;
    if (config) update(config, true);
  }
  day = today;
}, 1000);
void send({ type: 'config' }).then(update).catch(() => {});

import { describe, test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { flatten, locate, applySwaps, revert, toggle, tipFor, finishPractice, setPracticeCue,
  introductionTicket, finishIntroduction, dropIntroduction, pruneDescriptions, restoreDescriptions,
  swapDescription } from '../src/text.js';
import { readable, selector, TWEET, PROSE } from '../src/page.js';

const win = new Window();
const document = win.document;

// Markup shapes copied from x.com on 2026-09-20.
function tweet(inner) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div dir="auto" lang="en" data-testid="tweetText">${inner}</div>`;
  return wrap.firstElementChild;
}
const S = (swap) => ({ g: swap.g || 'and', h: swap.h || 'ay', ctx: '', ...swap });
// Description ids are opaque per-span references; compare markup without them.
const ID = /fw-d[0-9a-f]{12}-\d+/g;
const stable = (html) => html.replace(ID, 'ID');
const descriptionOf = (span) => span.ownerDocument.getElementById(span.getAttribute('aria-describedby'))?.textContent;

test('reserved introduction stays English and private until a saved visible acknowledgement', () => {
  const el = tweet('We discussed the idea with friends.');
  document.body.append(el);
  const ticket = 'a'.repeat(36);
  const placed = [];
  expect(applySwaps(el, [S({ o: 'the idea', f: 'la idea', word: 'la idea', introTicket: ticket })],
    (span) => placed.push(span))).toBe(1);
  const span = placed[0];
  expect(span.textContent).toBe('the idea');
  expect(span.getAttribute('data-fr')).toBeNull();
  expect(span.outerHTML).not.toContain(ticket);
  expect(introductionTicket(span)).toBe(ticket);
  expect(finishIntroduction(span)).toBe(true);
  expect(span.textContent).toBe('la idea');
  expect(span.getAttribute('data-fr')).toBe('la idea');
  expect(introductionTicket(span)).toBe('');
  el.remove();
});

test('dropping one rejected introduction keeps neighboring woven words', () => {
  const el = tweet('The book and the idea are here.');
  document.body.append(el);
  const spans = [];
  applySwaps(el, [S({ o: 'book', f: 'libro', word: 'libro' }),
    S({ o: 'the idea', f: 'la idea', word: 'la idea', introTicket: 'b'.repeat(36) })],
  (span) => spans.push(span));
  const pending = spans.find((span) => introductionTicket(span));
  expect(dropIntroduction(pending)).toBe(true);
  expect(el.textContent).toBe('The libro and the idea are here.');
  expect(el.querySelectorAll('.fw-word')).toHaveLength(1);
  revert(el);
  expect(el.textContent).toBe('The book and the idea are here.');
  el.remove();
});

describe('contractions and compounds', () => {
  test('never swaps part of a contraction or hyphenated word', () => {
    const el = tweet("<span>Here's the plan: the now-frozen dough waits here and well-known cooks agree.</span>");
    const f = flatten(el);
    expect(locate(f, 'Here', '')).toBeNull();
    expect(locate(f, 'now', '')).toBeNull();
    expect(locate(f, 'well', '')).toBeNull();
    expect(locate(f, 'here', '')).not.toBeNull();
    expect(locate(f, 'and', '')).not.toBeNull();
  });
});

describe('flatten', () => {
  test('collapses whitespace and keeps a map back to raw offsets', () => {
    const el = tweet('<span>one\n\ntwo  three</span>');
    const f = flatten(el);
    expect(f.text).toBe('one two three');
    expect(f.raw).toBe('one\n\ntwo  three');
    expect(f.raw.slice(f.map[4], f.map[6] + 1)).toBe('two');
  });
  test('emoji alt text and link text are in the text but not touchable', () => {
    const el = tweet('<span>fire </span><img alt="🔥"><span> and </span><a href="https://t.co/x"><span>https://</span>bit.ly/abc</a>');
    const f = flatten(el);
    expect(f.text).toBe('fire 🔥 and https://bit.ly/abc');
    expect(f.segs.filter((s) => s.ok).length).toBe(2);
    expect(f.segs.filter((s) => !s.ok).length).toBe(3);
  });
  test('trims ends', () => {
    expect(flatten(tweet('<span>  hi there  </span>')).text).toBe('hi there');
  });
});

describe('locate', () => {
  test('ctx disambiguates repeated words', () => {
    const f = flatten(tweet('<span>cats and dogs and birds</span>'));
    expect(locate(f, 'and', 'cats and dogs')).toEqual({ start: 5, end: 8 });
    expect(locate(f, 'and', 'dogs and birds')).toEqual({ start: 14, end: 17 });
    expect(locate(f, 'and', '')).toBeNull();
    expect(locate(f, 'and', 'no such context')).toBeNull();
  });
  test('word boundaries: "and" never matches inside "brand"', () => {
    const f = flatten(tweet('<span>brand new and shiny</span>'));
    expect(locate(f, 'and', '')).toEqual({ start: 10, end: 13 });
    expect(locate(f, 'and', 'brand new')).toEqual({ start: 10, end: 13 }); // ctx has no whole-word "and" -> whole-text fallback
    expect(locate(flatten(tweet('<span>brand new</span>')), 'and', '')).toBeNull();
  });
  test('phrases and punctuation neighbours', () => {
    const f = flatten(tweet('<span>late, because I slept.</span>'));
    expect(locate(f, 'because', 'late, because I')).toEqual({ start: 6, end: 13 });
    const g = flatten(tweet('<span>this is a little odd</span>'));
    expect(locate(g, 'a little', '')).toEqual({ start: 8, end: 16 });
  });
});

describe('applySwaps', () => {
  test('wraps exactly the word, leaves the rest untouched', () => {
    const el = tweet('<span>cats and dogs and birds</span>');
    const n = applySwaps(el, [S({ o: 'and', f: 'et', ctx: 'dogs and birds' })]);
    expect(n).toBe(1);
    expect(stable(el.innerHTML)).toBe('<span>cats and dogs <span class="fw-word" data-en="and" data-fr="et" data-tip="and · &quot;ay&quot;" data-fw-split="1" tabindex="0" role="button" lang="es" aria-describedby="ID">et</span> birds</span>');
    expect(swapDescription(el.querySelector('.fw-word'))).toBe('and · "ay". Show English');
    expect(el.textContent).toBe('cats and dogs et birds');
  });
  test('two swaps in one text node, applied in any order', () => {
    const el = tweet('<span>cats and dogs and birds</span>');
    const n = applySwaps(el, [
      S({ o: 'and', f: 'et', ctx: 'cats and dogs' }),
      S({ o: 'and', f: 'et', ctx: 'dogs and birds' }),
    ]);
    expect(n).toBe(2);
    expect(el.textContent).toBe('cats et dogs et birds');
    expect(el.querySelectorAll('.fw-word').length).toBe(2);
  });
  test('mentions: ctx may straddle the link, the swap lands in plain text, handles are never touched', () => {
    const el = tweet('<span>thanks </span><div><span><a href="/foo">@foo</a></span></div><span> and you too friend</span>');
    const n = applySwaps(el, [
      S({ o: 'and', f: 'et', ctx: '@foo and you' }),
      S({ o: '@foo', f: 'et', ctx: 'thanks @foo and' }),
    ]);
    expect(n).toBe(1);
    expect(el.querySelector('a').textContent).toBe('@foo');
    expect(el.textContent).toBe('thanks @foo et you too friend');
  });
  test('emoji alt in ctx, link text never swapped', () => {
    const el = tweet('<span>fire </span><img alt="🔥"><span> and ice </span><a href="https://t.co/x"><span>https://</span>bit.ly/and</a>');
    const n = applySwaps(el, [
      S({ o: 'and', f: 'et', ctx: '🔥 and ice' }),
      S({ o: 'bit.ly/and', f: 'et', ctx: 'https://bit.ly/and' }),
    ]);
    expect(n).toBe(1);
    expect(el.querySelector('a').textContent).toBe('https://bit.ly/and');
    expect(el.textContent).toBe('fire  et ice https://bit.ly/and');
  });
  test('code is never touched', () => {
    const el = tweet('<span>run </span><code>git rebase and squash</code><span> and ship</span>');
    const n = applySwaps(el, [S({ o: 'and', f: 'et', ctx: 'and ship' })]);
    expect(n).toBe(1);
    expect(el.querySelector('code').textContent).toBe('git rebase and squash');
  });
  test('swap spanning two nodes is dropped; newline inside the phrase is dropped', () => {
    const el = tweet('<span>a </span><span>little</span><span> odd and fun</span>');
    expect(applySwaps(el, [S({ o: 'a little', f: 'un peu', ctx: 'a little odd' })])).toBe(0);
    const el2 = tweet('<span>this is a\nlittle odd and fun</span>');
    expect(applySwaps(el2, [S({ o: 'a little', f: 'un peu', ctx: 'a little odd' })])).toBe(0);
    expect(el2.textContent).toBe('this is a\nlittle odd and fun');
  });
  test('newlines in the node survive a swap elsewhere in it', () => {
    const el = tweet('<span>one\n\ntwo and three</span>');
    applySwaps(el, [S({ o: 'and', f: 'et', ctx: 'two and three' })]);
    expect(el.textContent).toBe('one\n\ntwo et three');
  });
  test('overlapping swaps: first wins', () => {
    const el = tweet('<span>not because it rained, honestly</span>');
    const n = applySwaps(el, [
      S({ o: 'because', f: 'parce que', ctx: 'not because it' }),
      S({ o: 'because it', f: 'parce que', ctx: 'because it rained' }),
    ]);
    expect(n).toBe(1);
    expect(el.textContent).toBe('not parce que it rained, honestly');
  });
  test('missing or ambiguous anchors are dropped, nothing else changes', () => {
    const el = tweet('<span>cats and dogs and birds</span>');
    const before = el.innerHTML;
    expect(applySwaps(el, [S({ o: 'and', f: 'et', ctx: '' }), S({ o: 'zebra', f: 'et', ctx: 'zebra' })])).toBe(0);
    expect(el.innerHTML).toBe(before);
  });
  test('tip without hint is just the gloss', () => {
    expect(tipFor({ g: 'and', h: '' })).toBe('and');
    expect(tipFor({ g: 'and', h: 'ay' })).toBe('and · "ay"');
  });
});

describe('revert and toggle', () => {
  test('a framework replacing its original text node does not regain stale split suffixes', () => {
    const el = tweet('<span>cats and dogs and birds</span>');
    const original = el.querySelector('span').firstChild;
    applySwaps(el, [S({ o: 'and', f: 'et', ctx: 'cats and dogs' }), S({ o: 'and', f: 'et', ctx: 'dogs and birds' })]);
    original.data = 'A newly edited sentence with completely different words.';
    revert(el);
    expect(el.textContent).toBe('A newly edited sentence with completely different words.');
    expect(el.querySelector('span').firstChild).toBe(original);
    expect(el.querySelector('span').childNodes.length).toBe(1);
  });
  test('revert restores the original DOM and the same text node object', () => {
    const el = tweet('<span>cats and dogs and birds</span>');
    const original = el.querySelector('span').firstChild;
    const before = el.innerHTML;
    applySwaps(el, [
      S({ o: 'and', f: 'et', ctx: 'cats and dogs' }),
      S({ o: 'and', f: 'et', ctx: 'dogs and birds' }),
    ]);
    expect(el.querySelectorAll('.fw-word').length).toBe(2);
    expect(revert(el)).toBe(2);
    expect(el.innerHTML).toBe(before);
    expect(el.querySelector('span').firstChild).toBe(original);
    expect(el.querySelector('span').childNodes.length).toBe(1);
    expect(revert(el)).toBe(0);
  });
  test('revert after a swap at offset 0 and at the very end', () => {
    const el = tweet('<span>and then and</span>');
    const before = el.innerHTML;
    applySwaps(el, [S({ o: 'and', f: 'et', ctx: 'and then' }), S({ o: 'and', f: 'et', ctx: 'then and' })]);
    expect(el.textContent).toBe('et then et');
    revert(el);
    expect(el.innerHTML).toBe(before);
  });
  test('apply again after revert gives the same result', () => {
    const el = tweet('<span>cats and dogs</span>');
    const swaps = [S({ o: 'and', f: 'et', ctx: 'cats and dogs' })];
    applySwaps(el, swaps);
    const first = el.innerHTML;
    revert(el);
    applySwaps(el, swaps);
    expect(stable(el.innerHTML)).toBe(stable(first));
  });
  test('toggle flips between French and English, underline span stays', () => {
    const el = tweet('<span>cats and dogs</span>');
    applySwaps(el, [S({ o: 'And', f: 'Et', ctx: 'cats And' }), S({ o: 'and', f: 'et', ctx: 'cats and dogs' })]);
    const span = el.querySelector('.fw-word');
    expect(span.textContent).toBe('et');
    expect(toggle(span)).toBe(true);
    expect(span.textContent).toBe('and');
    expect(span.classList.contains('fw-en')).toBe(true);
    expect(toggle(span)).toBe(false);
    expect(span.textContent).toBe('et');
    expect(el.querySelectorAll('.fw-word').length).toBe(1);
  });
});

describe('what leaves the page', () => {
  test('link and inline code text go to the model as context but are never touched, and the privacy note says so', async () => {
    const el = tweet('<span>Run </span><code>git commit and push</code><span> and then read </span><a href="/x">the docs and notes</a><span> now.</span>');
    const f = flatten(el);
    expect(f.text).toBe('Run git commit and push and then read the docs and notes now.');
    expect(f.segs.filter((s) => s.node && s.ok).map((s) => s.node.data)).toEqual(['Run ', ' and then read ', ' now.']);
    expect(applySwaps(el, [S({ o: 'and', f: 'et', ctx: 'push and then' })])).toBe(1);
    expect(el.querySelector('code').textContent).toBe('git commit and push');
    expect(el.querySelector('a').textContent).toBe('the docs and notes');
    const note = await Bun.file(new URL('../src/options.html', import.meta.url)).text();
    expect(note).not.toMatch(/links, code[^.]*skipped/i);
    expect(note).toContain('Links and inline code go with their sentence but are never changed');
  });
});

test('a saved practice rating changes only its span and restores trusted source English', () => {
  const el = tweet('<span>We discussed the idea with friends.</span>');
  document.body.append(el);
  try {
    applySwaps(el, [S({ o: 'the idea', f: 'la idea', word: 'la idea', practice: true })]);
    const span = el.querySelector('.fw-word');
    expect(span.getAttribute('data-fr')).toBeNull();
    expect(span.getAttribute('data-tip')).toBeNull();
    expect(span.getAttribute('aria-label')).toBeNull(); // waiting for a viewport slot
    expect(span.textContent).toBe('the idea');
    expect(setPracticeCue(span, true)).toBe(true);
    expect(span.getAttribute('aria-label')).toBe('the idea. Open inline recall');
    expect(span.getAttribute('title')).toBe('Open inline recall');
    expect(span.textContent).toBe('the idea?');
    expect(el.textContent).not.toContain('la idea');
    span.setAttribute('data-en', 'forged');
    expect(finishPractice(span, { fr: 'la idea', en: 'the idea', hint: '' })).toBe(true);
    expect(span.textContent).toBe('la idea');
    expect(span.classList.contains('fw-practice-cue')).toBe(false);
    expect(span.getAttribute('role')).toBe('button');
    expect(span.tabIndex).toBe(0);
    expect(span.getAttribute('title')).toBeNull();
    expect(toggle(span)).toBe(true);
    expect(span.textContent).toBe('the idea');
    expect(revert(el)).toBe(1);
    expect(el.textContent).toBe('We discussed the idea with friends.');
  } finally { el.remove(); }
});

test('a waiting practice word gains normal keyboard access after its shared card is rated', () => {
  const el = tweet('We discussed the idea with friends.');
  document.body.append(el);
  try {
    applySwaps(el, [S({ o: 'the idea', f: 'la idea', word: 'la idea', practice: true })]);
    const span = el.querySelector('.fw-practice');
    expect(span.hasAttribute('tabindex')).toBe(false);
    expect(finishPractice(span, { fr: 'la idea', en: 'the idea' })).toBe(true);
    expect(span.classList.contains('fw-practice')).toBe(false);
    expect(span.getAttribute('role')).toBe('button');
    expect(span.tabIndex).toBe(0);
  } finally { el.remove(); }
});

test('rated practice keeps the validated bare and capitalized display forms', () => {
  for (const { source, original, display, card } of [
    { source: 'We discussed my world today.', original: 'world', display: 'mundo', card: 'el mundo' },
    { source: 'The idea matters to us.', original: 'The idea', display: 'La idea', card: 'la idea' },
  ]) {
    const el = tweet(`<span>${source}</span>`);
    document.body.append(el);
    try {
      expect(applySwaps(el, [S({ o: original, f: display, g: original, h: 'context', word: card, practice: true })])).toBe(1);
      const span = el.querySelector('.fw-word');
      expect(finishPractice(span, { fr: card, en: original, hint: '' })).toBe(true);
      expect(span.textContent).toBe(display);
      expect(span.getAttribute('data-fr')).toBe(display);
      expect(span.getAttribute('data-tip')).toBe(`${original} · "context"`);
      expect(toggle(span)).toBe(true);
      expect(span.textContent).toBe(original);
      revert(el);
      expect(el.textContent).toBe(source);
    } finally { el.remove(); }
  }
});

describe('lang and description on swapped words', () => {
  const page = 'https://example.com/article';
  const passage = (text, attrs = '') => {
    const p = document.createElement('p');
    if (attrs) p.setAttribute('lang', attrs);
    p.textContent = text;
    document.body.append(p);
    return p;
  };
  const hosts = () => [...document.querySelectorAll('.fw-descriptions')];

  test('a target word carries the target code and its name is the word alone; the gloss is the description', () => {
    const p = passage('cats and dogs walk home together tonight');
    try {
      expect(applySwaps(p, [S({ o: 'and', f: 'e', g: 'and', h: 'ee', ctx: 'cats and dogs' })], undefined, 'pt-br')).toBe(1);
      const span = p.querySelector('.fw-word');
      expect(span.getAttribute('lang')).toBe('pt-BR'); // canonical BCP-47
      expect(span.hasAttribute('aria-label')).toBe(false); // name from content: the target word alone
      expect(span.textContent).toBe('e');
      expect(descriptionOf(span)).toBe('and · "ee". Show English');
      const target = document.getElementById(span.getAttribute('aria-describedby'));
      expect(p.contains(target)).toBe(false); // never inside a passage
      const host = target.parentElement;
      expect(host.className).toBe('fw-descriptions');
      expect(host.hidden).toBe(true);
      expect(host.getAttribute('lang')).toBe('en');
      expect(host.getAttribute('aria-hidden')).toBeNull(); // a hidden describedby target is still read; aria-hidden is not needed
      expect(hosts()).toHaveLength(1);
      // Flipped to English: no lang of our own; the action is the description.
      expect(toggle(span, 'Portuguese')).toBe(true);
      expect(span.textContent).toBe('and');
      expect(span.hasAttribute('lang')).toBe(false);
      expect(span.hasAttribute('aria-label')).toBe(false);
      expect(descriptionOf(span)).toBe('Show Portuguese');
      expect(toggle(span, 'Portuguese')).toBe(false);
      expect(span.getAttribute('lang')).toBe('pt-BR');
      expect(descriptionOf(span)).toBe('and · "ee". Show English');
      // Reverting removes the description with the span.
      const id = span.getAttribute('aria-describedby');
      expect(revert(p)).toBe(1);
      expect(document.getElementById(id)).toBeNull();
    } finally { p.remove(); }
  });

  test('the default target is Spanish and an unusable code leaves lang off but keeps the description', () => {
    const p = passage('cats and dogs walk home together tonight');
    try {
      applySwaps(p, [S({ o: 'and', f: 'y', g: 'and', h: 'ee' })]);
      expect(p.querySelector('.fw-word').getAttribute('lang')).toBe('es');
      revert(p);
      applySwaps(p, [S({ o: 'and', f: 'y', g: 'and', h: 'ee' })], undefined, 'not a tag!');
      const span = p.querySelector('.fw-word');
      expect(span.hasAttribute('lang')).toBe(false);
      expect(descriptionOf(span)).toBe('and · "ee". Show English');
      expect(toggle(span)).toBe(true);
      expect(toggle(span)).toBe(false);
      expect(span.hasAttribute('lang')).toBe(false);
      revert(p);
    } finally { p.remove(); }
  });

  test('English faces have no lang: waiting practice, a cue and a reserved introduction; each gains it when shown', () => {
    const p = passage('We discussed the idea with friends at home.');
    try {
      applySwaps(p, [S({ o: 'the idea', f: 'la idea', g: 'the idea', h: 'lah ee-DEH-ah', word: 'la idea', practice: true })]);
      const span = p.querySelector('.fw-word');
      expect(span.hasAttribute('lang')).toBe(false);
      expect(span.hasAttribute('aria-describedby')).toBe(false); // no answer before a trusted reveal
      setPracticeCue(span, true);
      expect(span.hasAttribute('lang')).toBe(false);
      expect(span.hasAttribute('aria-describedby')).toBe(false);
      expect(finishPractice(span, { fr: 'la idea', en: 'the idea' })).toBe(true);
      expect(span.getAttribute('lang')).toBe('es');
      expect(span.hasAttribute('aria-label')).toBe(false);
      expect(descriptionOf(span)).toBe('the idea · "lah ee-DEH-ah". Show English');
      revert(p);
      const ticket = 'b'.repeat(36);
      applySwaps(p, [S({ o: 'the idea', f: 'la idea', g: 'the idea', h: '', word: 'la idea', introTicket: ticket })]);
      const intro = p.querySelector('.fw-word');
      expect(intro.hasAttribute('lang')).toBe(false);
      expect(intro.getAttribute('aria-label')).toBe('the idea');
      expect(intro.hasAttribute('aria-describedby')).toBe(false);
      expect(finishIntroduction(intro)).toBe(true);
      expect(intro.getAttribute('lang')).toBe('es');
      expect(intro.hasAttribute('aria-label')).toBe(false);
      expect(descriptionOf(intro)).toBe('the idea. Show English');
      revert(p);
      applySwaps(p, [S({ o: 'the idea', f: 'la idea', word: 'la idea', introTicket: ticket })]);
      expect(dropIntroduction(p.querySelector('.fw-word'))).toBe(true);
      expect(p.textContent).toBe('We discussed the idea with friends at home.');
    } finally { p.remove(); }
  });

  test('the scanner still reads a passage holding its own lang spans, and a rescan repaints identically', () => {
    for (const lang of ['', 'en', 'en-GB']) {
      const p = passage('Our team walks home and talks about the long week.', lang);
      try {
        const swaps = [S({ o: 'and', f: 'y', g: 'and', h: 'ee' }), S({ o: 'home', f: 'casa', g: 'home', h: 'KAH-sah' })];
        expect(applySwaps(p, swaps)).toBe(2);
        expect([...p.querySelectorAll('.fw-word')].map((s) => s.getAttribute('lang'))).toEqual(['es', 'es']);
        // The passage stays readable with its swaps in place: page.js looks up from the passage, never into it.
        expect(readable(p, page)).toBe(true);
        expect(flatten(p).text).toBe('Our team walks home and talks about the long week.');
        // A content-script rescan reverts, rechecks and repaints the same spans.
        const first = stable(p.innerHTML);
        expect(revert(p)).toBe(2);
        expect(readable(p, page)).toBe(true);
        expect(applySwaps(p, swaps)).toBe(2);
        expect(stable(p.innerHTML)).toBe(first);
        revert(p);
      } finally { p.remove(); }
    }
    // The existing rule is unchanged: a passage inside a non-English subtree is still skipped.
    const wrap = document.createElement('div');
    wrap.setAttribute('lang', 'es');
    wrap.innerHTML = '<p>Our team walks home and talks about the long week.</p>';
    document.body.append(wrap);
    try { expect(readable(wrap.firstElementChild, page)).toBe(false); } finally { wrap.remove(); }
  });

  test('the description host is never a passage, and pruning drops descriptions of removed spans', () => {
    const p = passage('cats and dogs walk home together tonight');
    const kept = passage('birds and bees sing in the garden today');
    try {
      applySwaps(p, [S({ o: 'and', f: 'y' })]);
      applySwaps(kept, [S({ o: 'and', f: 'y' })]);
      const [host] = hosts();
      for (const url of [page, 'https://x.com/someone/status/1']) {
        expect(host.matches(selector(url))).toBe(false);
        expect(host.querySelector(selector(url))).toBeNull();
      }
      expect(host.querySelector(`${TWEET},${PROSE}`)).toBeNull();
      const dropped = p.querySelector('.fw-word');
      const id = dropped.getAttribute('aria-describedby');
      p.textContent = 'cats and dogs walk home together tonight'; // a page re-render drops the span
      pruneDescriptions();
      expect(document.getElementById(id)).toBeNull();
      expect(descriptionOf(kept.querySelector('.fw-word'))).toBe('and · "ay". Show English');
      // A page that detaches a passage and later puts the same span back gets its description back.
      const parent = kept.parentNode;
      kept.remove();
      pruneDescriptions();
      const keptSpan = kept.querySelector('.fw-word');
      expect(document.getElementById(keptSpan.getAttribute('aria-describedby'))).toBeNull();
      parent.append(kept);
      restoreDescriptions(kept);
      expect(descriptionOf(keptSpan)).toBe('and · "ay". Show English');
      restoreDescriptions(kept); // idempotent
      expect(document.querySelectorAll(`[id="${keptSpan.getAttribute('aria-describedby')}"]`)).toHaveLength(1);
      // A page that removes the host gets it back on the next prune, not a dangling reference,
      // but a page that keeps removing it wins after a small budget instead of starting a loop.
      let reattached = 0;
      for (let i = 0; i < 10; i++) {
        host.remove();
        pruneDescriptions();
        if (host.isConnected) reattached++;
      }
      expect(reattached).toBe(3);
      expect(descriptionOf(keptSpan)).toBeUndefined();
      toggle(kept.querySelector('.fw-word'));
      expect(hosts()).toHaveLength(1);
      expect(descriptionOf(kept.querySelector('.fw-word'))).toBe('Show Spanish');
      revert(kept);
    } finally { p.remove(); kept.remove(); }
  });
});

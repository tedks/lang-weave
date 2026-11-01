// UI copy goes through chrome.i18n. The English source of truth is _locales/en/messages.json;
// messages-en.js mirrors it (scripts/messages.mjs writes it, a test checks it) so a context
// without chrome.i18n, such as a happy-dom test, reads the same English. Nothing here translates.
import { EN } from './messages-en.js';

// Chrome resolves named placeholders to $1..$9 when it loads a bundle; EN holds that resolved form.
// Like getMessage, a $n without a substitution is blank and $$ is a literal $.
const substitute = (text, subs) => text.replace(/\$(\$|[1-9])/g, (_, c) => c === '$' ? '$' : subs[c - 1] ?? '');

// t('key', ...subs): Chrome's message for the UI locale, else the bundled English, else ''.
// A missing key returns '' exactly as chrome.i18n does; a test checks every key used in source.
export function t(key, ...subs) {
  const values = subs.map(String);
  let text = '';
  try { text = globalThis.chrome?.i18n?.getMessage?.(key, values) || ''; } catch { text = ''; }
  return text || substitute(EN[key] ?? '', values);
}

// The language the served messages are written in. Each locale's messages.json sets it.
export const messageLanguage = () => t('locale_lang') || 'en';

// tn('key', count, ...subs): picks key_one, key_other (or another CLDR form the locale defines)
// by the plural rules of the messages' own language, falling back to key_other. $1 is the count.
export function tn(key, count, ...subs) {
  let form = 'other';
  try { form = new Intl.PluralRules(messageLanguage()).select(count); } catch { form = 'other'; }
  return (form !== 'other' && t(`${key}_${form}`, count, ...subs)) || t(`${key}_other`, count, ...subs);
}

const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt'];
// chrome.i18n blanks a $n it has no substitution for, so each child's $n is substituted with a
// private-use sentinel no rendered text contains (a literal $$1 renders as "$1", so "$1" cannot
// be the sentinel). Chrome and substitute() insert substitutions verbatim, never re-reading them.
const SENTINEL = 0xE000;
const CHILD_MARKERS = Array.from({ length: 9 }, (_, i) => String.fromCharCode(SENTINEL + i + 1));
// Fill a page from its data-i18n keys. An element with child elements keeps them: its message
// names them $1..$9 in document order, so a translation can reorder text around a link without
// any markup in messages. A message that does not name every child is skipped, never applied.
export function localize(root = document) {
  const doc = root.ownerDocument || root;
  if (doc.documentElement?.hasAttribute('lang')) doc.documentElement.setAttribute('lang', messageLanguage());
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const text = t(el.getAttribute('data-i18n'), ...CHILD_MARKERS);
    if (!text) continue;
    const children = [...el.children];
    if (!children.length) { el.textContent = text; continue; }
    const parts = text.split(/([\uE001-\uE009])/);
    const named = parts.filter((_, i) => i % 2).map((mark) => mark.charCodeAt(0) - SENTINEL);
    if (named.length !== children.length || named.some((n) => n > children.length) ||
        new Set(named).size !== named.length) continue;
    const nodes = parts.map((part, i) => i % 2 ? children[part.charCodeAt(0) - SENTINEL - 1] : doc.createTextNode(part))
      .filter((node) => node.nodeType !== 3 || node.data);
    el.replaceChildren(...nodes);
  }
  for (const attr of ATTRIBUTES) {
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) {
      const text = t(el.getAttribute(`data-i18n-${attr}`));
      if (text) el.setAttribute(attr, text);
    }
  }
}

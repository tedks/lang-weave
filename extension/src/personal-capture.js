// Conservative, local-only validation for personal capture. No page text leaves this module.
import { siteEnabled, hasSiteAccess, offByDefault } from './settings.js';
import { isZeroFrench, wordCount } from './levels.js';
import { validForm } from './personal.js';

const MAX_CAPTURE = 80;
const MAX_WORDS = 5;
const BLOCKED = 'a,button,input,textarea,select,option,form,label,nav,header,footer,code,pre,kbd,samp,script,style,noscript,iframe,object,embed,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="button"],[hidden],[aria-hidden="true"],[inert],[translate="no"],.notranslate,dialog:not([open])';
const PROSE = 'p,li,blockquote,h1,h2,h3,h4,article,main,[data-testid="tweetText"]';
const HIGH_STAKES = /\b(?:medical|medicine|healthcare|doctor|hospital|diagnos(?:e|is|ed|ing)|prescri(?:be|ption|bed|bing)|dosage|suicid(?:e|al)|self[ -]?harm|attorney|lawyer|legal|lawsuit|court|immigration status|financial|bank account|credit card|routing number|mortgage|loan|password|social security|medical record|tax return|investment advice|emergency room)\b/i;
const SENSITIVE_PATH = /\/(?:login|signin|sign-in|checkout|payment|billing|settings|account|medical|patient|portal|banking)(?:\/|$)/i;

export function capturePageAllowed({ url, title, settings, origins } = {}) {
  try {
    const parsed = new URL(url);
    return window.top === window && /^https?:$/.test(parsed.protocol) &&
      !offByDefault(parsed.hostname) && !SENSITIVE_PATH.test(parsed.pathname) &&
      !HIGH_STAKES.test(String(title || '')) && !isZeroFrench(String(title || '')) &&
      siteEnabled(settings || {}, url) && hasSiteAccess(url, origins || []);
  } catch { return false; }
}

function forbiddenAncestor(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  if (!element) return true;
  const view = element.ownerDocument?.defaultView || globalThis;
  for (let current = element; current; current = current.parentElement) {
    if (current.matches?.(BLOCKED)) return true;
    if (current.closest?.('details:not([open])') && !current.closest('details:not([open]) > summary')) return true;
    const style = view.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden') return true;
    if (style.opacity !== '' && Number(style.opacity) === 0) return true;
  }
  return false;
}

function rangeHasSafeText(range) {
  try { if (range.cloneContents().querySelector?.(BLOCKED)) return false; }
  catch { return false; }
  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument || root;
  const walker = doc.createTreeWalker(root, doc.defaultView.NodeFilter.SHOW_TEXT);
  let found = false;
  const nodes = root.nodeType === 3 ? [root] : [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    try {
      if (!range.intersectsNode(node)) continue;
    } catch { return false; }
    const prose = node.parentElement?.closest(PROSE);
    if (!node.isConnected || forbiddenAncestor(node) || !prose) return false;
    if (!node.data.trim()) continue;
    found = true;
    const passage = prose.textContent || '';
    if (passage.length > 2000 || wordCount(passage) < 6 ||
        HIGH_STAKES.test(passage) || isZeroFrench(passage)) return false;
  }
  return found;
}

export function verifyCaptureSelection(selection, expectedText, { url, title, settings, origins } = {}) {
  if (!capturePageAllowed({ url, title, settings, origins }) || !selection || selection.isCollapsed || selection.rangeCount < 1) return { ok: false };
  const text = String(selection.toString());
  if (validForm(text, { selection: true }) !== expectedText || !text.trim() || [...text].length > MAX_CAPTURE ||
      (text.match(/\S+/gu) || []).length > MAX_WORDS || /[\p{Cc}\p{Cf}<>]/u.test(text) ||
      /(?:https?:\/\/|www\.|\b\w+@\w+\.)/i.test(text) || HIGH_STAKES.test(text) ||
      isZeroFrench(text)) return { ok: false };
  for (let i = 0; i < selection.rangeCount; i++) if (!rangeHasSafeText(selection.getRangeAt(i))) return { ok: false };
  return { ok: true, text: expectedText };
}

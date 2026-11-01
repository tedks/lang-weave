import { test, expect, describe } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { mirrorSource, resolveMessage } from '../scripts/messages.mjs';
import { t, tn, localize } from '../src/i18n.js';
import { EN } from '../src/messages-en.js';
import { statusLabel } from '../src/quota-status.js';
import { badgeAppearance } from '../src/badge.js';

const EXT = resolve(import.meta.dir, '..');
const read = (path) => readFileSync(resolve(EXT, path), 'utf8');
const MESSAGES = JSON.parse(read('_locales/en/messages.json'));
const english = (name) => resolveMessage(name, MESSAGES[name]);
const collapse = (text) => text.replace(/\s+/g, ' ').trim();
const sources = readdirSync(resolve(EXT, 'src')).filter((f) => f.endsWith('.js'));
const pages = readdirSync(resolve(EXT, 'src')).filter((f) => f.endsWith('.html'));

const withChrome = (chrome, fn) => {
  const saved = globalThis.chrome;
  globalThis.chrome = chrome;
  try { return fn(); } finally { globalThis.chrome = saved; }
};

describe('the English messages file', () => {
  test('every entry is a described message with a valid, case-insensitively unique name', () => {
    const seen = new Set();
    for (const [name, entry] of Object.entries(MESSAGES)) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(seen.has(name.toLowerCase())).toBe(false);
      seen.add(name.toLowerCase());
      expect(Object.keys(entry).every((k) => ['message', 'description', 'placeholders'].includes(k))).toBe(true);
      expect(typeof entry.message).toBe('string');
      expect(entry.message.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe('string');
      for (const [key, value] of Object.entries(entry.placeholders ?? {})) {
        expect(key).toMatch(/^[A-Za-z0-9_]+$/);
        expect(value.content).toMatch(/^\$[1-9]$/);
        expect(typeof value.example).toBe('string');
      }
      // After Chrome's placeholder pass only $1..$9 remain; a literal $ would need Chrome's $$ escape.
      expect(english(name).replace(/\$[1-9]/g, '')).not.toContain('$');
    }
  });

  test('src/messages-en.js is the current mirror (node scripts/messages.mjs rewrites it)', () => {
    expect(read('src/messages-en.js')).toBe(mirrorSource(MESSAGES));
    expect(Object.keys(EN)).toEqual(Object.keys(MESSAGES));
  });

  test('every key used in source, pages and the manifest exists, and every message is used', () => {
    const used = new Set();
    const need = (name) => { used.add(name); expect(MESSAGES[name] ? name : `missing ${name}`).toBe(name); };
    for (const file of sources) {
      if (file === 'messages-en.js') continue;
      const src = read(`src/${file}`).split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
      for (const [, name] of src.matchAll(/\bt\(\s*'([a-z0-9_]+)'/g)) need(name);
      for (const [, name] of src.matchAll(/\btn\(\s*'([a-z0-9_]+)'/g)) {
        need(`${name}_other`);
        for (const form of ['zero', 'one', 'two', 'few', 'many']) if (MESSAGES[`${name}_${form}`]) used.add(`${name}_${form}`);
      }
      // A computed key cannot be checked here; spell every key out. Only the helper itself computes keys.
      if (file === 'i18n.js') continue;
      expect([file, src.match(/\bt\(\s*[^'\s)]/g) ?? []]).toEqual([file, []]);
      expect([file, src.match(/\btn\(\s*[^'\s)]/g) ?? []]).toEqual([file, []]);
    }
    for (const file of pages) {
      for (const [, name] of read(`src/${file}`).matchAll(/data-i18n(?:-[a-z-]+)?="([^"]*)"/g)) need(name);
    }
    for (const [, name] of read('manifest.json').matchAll(/__MSG_(\w+)__/g)) need(name);
    expect(Object.keys(MESSAGES).filter((name) => !used.has(name))).toEqual([]);
  });

  test('each page keeps its English in the markup, identical to the message', () => {
    for (const file of pages) {
      const win = new Window();
      win.document.write(read(`src/${file}`));
      for (const el of win.document.querySelectorAll('[data-i18n]')) {
        let n = 0;
        const text = [...el.childNodes].map((node) => node.nodeType === 1 ? `$${++n}` : node.textContent).join('');
        expect(`${file} ${el.getAttribute('data-i18n')}: ${collapse(text)}`)
          .toBe(`${file} ${el.getAttribute('data-i18n')}: ${collapse(english(el.getAttribute('data-i18n')))}`);
      }
      for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
        for (const el of win.document.querySelectorAll(`[data-i18n-${attr}]`)) {
          expect(`${file} ${attr}: ${el.getAttribute(attr)}`)
            .toBe(`${file} ${attr}: ${english(el.getAttribute(`data-i18n-${attr}`))}`);
        }
      }
      win.close();
    }
  });
});

describe('the helper', () => {
  test('t prefers chrome.i18n and falls back to the bundled English', () => {
    expect(withChrome(undefined, () => t('recall_dismiss'))).toBe('Dismiss');
    expect(withChrome({}, () => t('swap_show_language', 'Spanish'))).toBe('Show Spanish');
    expect(withChrome({ i18n: { getMessage: () => '' } }, () => t('swap_description', 'and · "ee"')))
      .toBe('and · "ee". Show English');
    expect(withChrome({ i18n: { getMessage: () => { throw new Error('gone'); } } }, () => t('recall_dismiss'))).toBe('Dismiss');
    const calls = [];
    expect(withChrome({ i18n: { getMessage: (key, subs) => { calls.push([key, subs]); return 'Descartar'; } } },
      () => t('recall_dismiss', 3))).toBe('Descartar');
    expect(calls).toEqual([['recall_dismiss', ['3']]]);
    expect(withChrome(undefined, () => t('no_such_message'))).toBe('');
    expect(withChrome(undefined, () => t('badge_paused_until', '$2 $1'))).toBe('Paused until $2 $1; review still works');
  });

  test('tn picks the plural form by the messages language and falls back to other', () => {
    const forms = { thing_one: '$1 thing', thing_other: '$1 things', only_other: '$1 items', locale_lang: 'en' };
    const chrome = { i18n: { getMessage: (key, subs) => (forms[key] ?? '').replace(/\$1/g, subs[0]) } };
    withChrome(chrome, () => {
      expect([0, 1, 2].map((n) => tn('thing', n))).toEqual(['0 things', '1 thing', '2 things']);
      expect(tn('only', 1)).toBe('1 items');
    });
    forms.locale_lang = 'fr'; // French uses "one" for 0 too
    withChrome(chrome, () => expect(tn('thing', 0)).toBe('0 thing'));
    forms.locale_lang = 'not a tag!';
    withChrome(chrome, () => expect(tn('thing', 1)).toBe('1 things'));
  });

  test('localize fills text and attributes, keeps child elements, and refuses a message that drops one', () => {
    const win = new Window();
    const doc = win.document;
    doc.write(`<html lang="en"><body><p data-i18n="a">old</p><button data-i18n-aria-label="b" data-i18n-title="b">x</button>
      <p id="mixed" data-i18n="c">Read <a href="#">the guide</a> and <strong>stay</strong>.</p>
      <p id="short" data-i18n="d">Keep <a href="#">this</a>.</p></body></html>`);
    const link = doc.querySelector('#mixed a');
    let clicks = 0;
    link.addEventListener('click', () => clicks++);
    const messages = { a: 'New text', b: 'Label', c: 'Puis $2, lire $1.', d: 'Without its link', locale_lang: 'fr' };
    withChrome({ i18n: { getMessage: (key) => messages[key] ?? '' } }, () => localize(doc));
    expect(doc.querySelector('[data-i18n="a"]').textContent).toBe('New text');
    expect(doc.querySelector('button').getAttribute('aria-label')).toBe('Label');
    expect(doc.querySelector('button').getAttribute('title')).toBe('Label');
    expect(doc.querySelector('button').textContent).toBe('x');
    expect(doc.querySelector('#mixed').textContent).toBe('Puis stay, lire the guide.');
    expect(doc.querySelector('#mixed a')).toBe(link);
    link.click();
    expect(clicks).toBe(1);
    expect(doc.querySelector('#short').innerHTML).toBe('Keep <a href="#">this</a>.');
    expect(doc.documentElement.getAttribute('lang')).toBe('fr');
    win.close();
  });
});

describe('fixed copy stays allowlisted against the messages file', () => {
  const pattern = (name) => new RegExp(`^${english(name).replace(/[.*+?^{}()|[\]\\]/g, '\\$&').replace(/\$1/g, '([^$]+)')}$`);

  test('every status label is one status message; the only substitution is a local retry time', () => {
    const allowed = Object.keys(MESSAGES).filter((name) => name.startsWith('status_'));
    const labels = [];
    for (const category of ['daily_quota', 'rate_limit', 'overloaded', 'key_rejected', 'request_failed',
      'storage_failed', 'local_budget', 'key_isolation_unavailable']) {
      labels.push(statusLabel({ category, error: 'secret key response' }));
      labels.push(statusLabel({ category, retryAt: 60000, raw: 'secret.example' }, 0));
    }
    for (const label of labels) {
      const match = allowed.find((name) => pattern(name).test(label));
      expect(match ? label : `unlisted: ${label}`).toBe(label);
      const time = pattern(match).exec(label)[1];
      if (time) expect(time).toBe(new Date(60000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
      expect(label).not.toContain('secret');
    }
    expect(statusLabel({ category: 'ok' })).toBe('');
  });

  test('every badge title and word is one badge message', () => {
    const allowed = Object.keys(MESSAGES).filter((name) => name.startsWith('badge_'));
    const now = Date.now();
    const quota = { keyEpoch: 'e', cooldowns: { 'gemini-3.5-flash-lite': { kind: 'daily', setAt: now, until: now + 60000, durationMs: 60000 } } };
    for (const state of ['new', 'working', 'needs_setup', 'needs_key', 'key_rejected', 'needs_site', 'paused', 'sensitive',
      'site_off', 'unavailable', 'unsupported', 'local_budget', 'model_error', 'cooldown', 'unknown']) {
      for (const badge of [badgeAppearance(state, { category: 'daily_quota', raw: 'secret.example' }, quota, 'e', now),
        badgeAppearance(state, { category: 'daily_quota' })]) {
        expect(allowed.some((name) => pattern(name).test(badge.title)) ? badge.title : `unlisted: ${badge.title}`).toBe(badge.title);
        expect(['', '!', '•', '–', english('badge_new_text')]).toContain(badge.text);
        expect(badge.title).not.toContain('secret');
      }
    }
  });
});

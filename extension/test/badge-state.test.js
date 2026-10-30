import { test, expect } from 'bun:test';
import { readingState } from '../src/state.js';
import { badgeAppearance, BADGE_ATTENTION, BADGE_MUTED } from '../src/badge.js';

const statuses = [null, 'ok', 'daily_quota', 'rate_limit', 'overloaded', 'key_rejected',
  'request_failed', 'storage_failed', 'local_budget'];
const states = new Set(['paused', 'needs_key', 'site_off', 'sensitive', 'needs_site',
  'cooldown', 'key_rejected', 'model_error', 'local_budget', 'working', 'unavailable']);

test('every reading predicate combination has exactly one pinned state', () => {
  let checked = 0;
  for (const enabled of [false, true]) for (const paused of [false, true])
    for (const hasKey of [false, true]) for (const siteOn of [false, true])
      for (const access of [false, true]) for (const sensitive of [false, true])
        for (const category of statuses) {
          const host = sensitive ? 'mail.google.com' : 'example.com';
          const config = { settings: { enabled, newSitesEnabled: true,
            siteOverrides: { [host]: siteOn } }, paused, hasKey,
          origins: access ? [`https://${host}/*`] : [] };
          const actual = readingState(config, `https://${host}/article`, category && { category });
          const expected = !enabled || paused ? 'paused' : !hasKey ? 'needs_key'
            : !siteOn ? 'site_off' : !access ? 'needs_site'
            : category === 'key_rejected' ? 'key_rejected'
            : ['daily_quota', 'rate_limit', 'overloaded'].includes(category) ? 'cooldown'
            : category === 'local_budget' ? 'local_budget'
            : ['request_failed', 'storage_failed'].includes(category) ? 'model_error' : 'working';
          expect(actual).toBe(expected);
          expect(states.has(actual)).toBe(true);
          checked++;
        }
  expect(checked).toBe(576);
});

test('sensitive default, internal page and malformed status stay in fixed states', () => {
  const config = { settings: { enabled: true, newSitesEnabled: true, siteOverrides: {} },
    hasKey: true, paused: false, origins: ['<all_urls>'] };
  expect(readingState(config, 'https://mail.google.com/', null)).toBe('sensitive');
  expect(readingState(config, 'chrome://extensions', null)).toBe('unsupported');
  for (const enabled of [false, true]) for (const paused of [false, true])
    for (const hasKey of [false, true]) for (const category of statuses) {
      const unknown = { ...config, settings: { ...config.settings, enabled }, paused, hasKey };
      expect(readingState(unknown, undefined, category && { category })).toBe(!enabled || paused
        ? 'paused' : !hasKey ? 'needs_key' : 'unavailable');
    }
  expect(readingState(config, 'https://example.com/', { category: 'provider says key=secret' })).toBe('working');
  expect(readingState(config, 'https://example.com/', { category: 'daily_quota' })).toBe('cooldown');
});

test('badge text, colors and titles are allowlisted; NEW wins as its own state', () => {
  const cases = [
    ['new', 'NEW', BADGE_ATTENTION], ['working', '', BADGE_MUTED],
    ['needs_key', '!', BADGE_ATTENTION], ['needs_site', '•', BADGE_ATTENTION],
    ['paused', '–', BADGE_MUTED], ['site_off', '–', BADGE_MUTED],
    ['sensitive', '–', BADGE_MUTED], ['unsupported', '–', BADGE_MUTED],
    ['unavailable', '–', BADGE_MUTED],
    ['key_rejected', '!', BADGE_ATTENTION], ['local_budget', '–', BADGE_MUTED],
    ['model_error', '–', BADGE_MUTED],
  ];
  for (const [state, text, color] of cases) {
    const badge = badgeAppearance(state, { category: 'request_failed', raw: 'secret.example' });
    expect([badge.text, badge.color]).toEqual([text, color]);
    expect(badge.title).not.toContain('secret.example');
  }
  const now = Date.now();
  const keyEpoch = 'epoch';
  const quota = { keyEpoch, cooldowns: { 'gemini-3.5-flash-lite': {
    kind: 'daily', setAt: now, until: now + 60000, durationMs: 60000,
  } } };
  const cooling = badgeAppearance('cooldown', { category: 'daily_quota', raw: 'secret.example' },
    quota, keyEpoch, now);
  expect(cooling.title).toMatch(/^Paused until .+; review still works$/);
  expect(cooling.title).not.toContain('secret.example');
});

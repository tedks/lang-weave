import { describe, test, expect } from 'bun:test';
import { classifyProviderFailure, cleanQuotaState, newCooldownEntry, parseRetryAfter, readBoundedBody, retainedRetryAt, safeModelStatus, statusLabel } from '../src/quota-status.js';

describe('quota status', () => {
  test('classifies nested daily quota dimension, and rejects bare or conflicting short-window 429s', () => {
    const body = JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [
        { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' },
      ] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3600s' },
    ] } });
    expect(classifyProviderFailure({ status: 429, body })).toMatchObject({ category: 'daily_quota', retryAfterMs: 3600000 });
    expect(classifyProviderFailure({ status: 429, body: '' }).category).toBe('rate_limit');
    expect(classifyProviderFailure({ status: 500, body: JSON.stringify({ error: { status: 'quota_exceeded' } }) }).category).toBe('request_failed');
    expect(classifyProviderFailure({ status: 429, body: JSON.stringify({ error: { status: 'rate_limit_exceeded', details: [
      { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' },
    ] } }) }).category).toBe('rate_limit');
    expect(classifyProviderFailure({ status: 429, body: JSON.stringify({ error: { details: [
      { reason: 'quota_exceeded' },
    ] } }) }).category).toBe('daily_quota');
    expect(classifyProviderFailure({ status: 429, body: JSON.stringify({ error: { details: [
      { violations: [{ quotaId: 'InputTokensPerModelPerDay-FreeTier' }] },
    ] } }) }).category).toBe('daily_quota');
  });

  test('bounds retry values, accepts Retry-After seconds/date, and ignores oversized bodies', async () => {
    expect(classifyProviderFailure({ status: 429, body: '{bad', retryAfter: '999999999' }).retryAfterMs).toBe(3600000);
    expect(classifyProviderFailure({ status: 429, body: JSON.stringify({ error: { status: 'quota_exceeded' } }), retryAfter: '999999999' }).retryAfterMs).toBe(86400000);
    const oversizedShort = classifyProviderFailure({ status: 429, body: '', retryAfter: '86400' });
    expect(oversizedShort).toMatchObject({ category: 'rate_limit', retryAfterMs: 3600000 });
    expect(oversizedShort.retryGuidanceMs).toBeUndefined(); // popup cannot promise a different retry time
    expect(parseRetryAfter('3.5')).toBe(3500);
    expect(parseRetryAfter('invalid')).toBeUndefined();
    expect(classifyProviderFailure({ status: 429, body: JSON.stringify({ error: { status: 'quota_exceeded',
      details: [{ retryDelay: '7200s' }] } }) }).retryGuidanceMs).toBeUndefined();
    const response = { headers: { get: () => null }, body: { getReader: () => ({
      read: async () => ({ value: new Uint8Array(17000), done: false }), cancel: async () => {},
    }) } };
    expect(await readBoundedBody(response)).toBe('');
  });

  test('cleans persisted cooldown to configured models, current epoch and finite horizon', () => {
    const state = cleanQuotaState({ keyEpoch: 'new', cooldowns: {
      'gemini-3.8-flash': { until: 5000, kind: 'daily', setAt: 1000, durationMs: 4000 },
      'not-a-model': { until: 5000, kind: 'daily', setAt: 1000, durationMs: 4000 },
      'gemini-3.5-flash-lite': { until: Infinity, kind: 'short' },
    } }, 'new', 1000);
    expect(state).toEqual({ keyEpoch: 'new', cooldowns: { 'gemini-3.8-flash':
      { until: 5000, kind: 'daily', setAt: 1000, durationMs: 4000 } } });
    expect(cleanQuotaState({ keyEpoch: 'old', cooldowns: { 'gemini-3.8-flash': { until: 5000, kind: 'daily' } } }, 'new', 1000).cooldowns).toEqual({});
  });

  test('second model persistence retains first model clock metadata and original deadline', () => {
    const start = 100000000;
    const flash = newCooldownEntry('daily', 3600000, start, start);
    const lite = newCooldownEntry('short', 60000, start, start);
    const raw = { keyEpoch: 'k', cooldowns: { 'gemini-3.8-flash': flash } };
    const cleaned = cleanQuotaState(raw, 'k', start);
    cleaned.cooldowns['gemini-3.5-flash-lite'] = lite; // persistCooldown's second read-modify-write
    const persisted = structuredClone(cleaned);
    expect(persisted.cooldowns['gemini-3.8-flash']).toEqual(flash);
    expect(cleanQuotaState(persisted, 'k', start).cooldowns).toEqual(persisted.cooldowns);
    expect(cleanQuotaState(persisted, 'k', start - 120000).cooldowns).toEqual(persisted.cooldowns);
    expect(cleanQuotaState(persisted, 'k', start - 300000).cooldowns).toEqual(persisted.cooldowns);
    expect(cleanQuotaState(persisted, 'k', start - 300001).cooldowns).toEqual({});
    expect(cleanQuotaState(raw, 'k', start - 72000000).cooldowns).toEqual({});
    expect(cleanQuotaState(persisted, 'k', start - 72000000).cooldowns).toEqual({});
    expect(cleanQuotaState(persisted, 'k', start + 60001).cooldowns['gemini-3.8-flash']).toEqual(flash);
    expect(cleanQuotaState(cleanQuotaState(persisted, 'k', start + 60001), 'k', start + 60002)
      .cooldowns['gemini-3.8-flash']).toEqual(flash);
    expect(cleanQuotaState(persisted, 'k', start + 3600000).cooldowns).toEqual({});
  });

  test('a small rollback during the request keeps consistent saved timing; a large one drops it', () => {
    const start = 100000000;
    const short = newCooldownEntry('short', 3600000, start, start - 120000);
    expect(short).toEqual({ until: start + 3600000, kind: 'short', setAt: start, durationMs: 3600000 });
    expect(cleanQuotaState({ keyEpoch: 'k', cooldowns: { 'gemini-3.5-flash-lite': short } },
      'k', start - 120000).cooldowns['gemini-3.5-flash-lite']).toEqual(short);
    expect(newCooldownEntry('short', 3600000, start, start - 300000)).toEqual(short);
    expect(cleanQuotaState({ keyEpoch: 'k', cooldowns: { 'gemini-3.5-flash-lite': short } },
      'k', start - 300000).cooldowns['gemini-3.5-flash-lite']).toEqual(short);
    expect(newCooldownEntry('short', 3600000, start, start - 300001)).toBeNull();
    expect(newCooldownEntry('short', 3600000, start, start + 3600000)).toBeNull();
    expect(newCooldownEntry('short', 999999999, start, start).durationMs).toBe(3600000);
    expect(newCooldownEntry('short', Infinity, start, start)).toBeNull();
  });

  test('missing, inconsistent or oversized timing metadata cannot preserve a cooldown', () => {
    const start = 100000000;
    const entries = [
      { until: start + 60000, kind: 'short' },
      { until: start + 60000, kind: 'short', setAt: start, durationMs: Infinity },
      { until: start + 60000, kind: 'short', setAt: start, durationMs: 3600001 },
      { until: start + 60000, kind: 'short', setAt: start, durationMs: -1 },
      { until: start + 60000, kind: 'short', setAt: start, durationMs: 30000 },
      { until: start + 60000, kind: 'short', setAt: start + 360000, durationMs: 60000 },
    ];
    for (const entry of entries) expect(cleanQuotaState({ keyEpoch: 'k', cooldowns:
      { 'gemini-3.5-flash-lite': entry } }, 'k', start).cooldowns).toEqual({});
  });

  test('backward wall-clock movement never extends daily or short cooldown on repeated reads', () => {
    const rollback = { keyEpoch: 'k', cooldowns: {
      'gemini-3.8-flash': { until: 186400000, kind: 'daily', setAt: 100000000, durationMs: 86400000 },
      'gemini-3.5-flash-lite': { until: 103600000, kind: 'short', setAt: 100000000, durationMs: 3600000 },
    } };
    expect(cleanQuotaState(rollback, 'k', 0).cooldowns).toEqual({});
    expect(cleanQuotaState(rollback, 'k', 86400000).cooldowns).toEqual({});
    expect(cleanQuotaState(rollback, 'k', 100000000).cooldowns['gemini-3.5-flash-lite'].kind).toBe('short');
  });

  test('persisted status and UI label expose only allowlisted fields', () => {
    expect(safeModelStatus({ category: 'daily_quota', error: 'secret key response', model: 'unknown', retryAt: Infinity }))
      .toEqual({ category: 'daily_quota' });
    expect(statusLabel({ category: 'daily_quota' })).toBe('Daily model quota reached. Try again later.');
    expect(statusLabel({ category: 'rate_limit', retryAt: 60000 }, 0)).toMatch(/^Model rate limit reached\. Retry after /);
    expect(statusLabel({ category: 'storage_failed' })).toBe('Local reading storage failed. Try again.');
    expect(statusLabel({ category: 'daily_quota', retryAt: 90000000 }, 0)).toBe('Daily model quota reached. Try again later.');
    const prior = { category: 'rate_limit', retryAt: 3600000 };
    expect(retainedRetryAt(prior, 'rate_limit', 60000, 3540000)).toBe(3600000);
    expect(retainedRetryAt(prior, 'rate_limit', 60000, 60000)).toBeUndefined();
    expect(retainedRetryAt(prior, 'daily_quota', 60000, 3540000)).toBeUndefined();
  });
});

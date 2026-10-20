import { describe, test, expect } from 'bun:test';
import { classifyProviderFailure, cleanQuotaState, parseRetryAfter, readBoundedBody, safeModelStatus, statusLabel } from '../src/quota-status.js';

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
      'gemini-3.8-flash': { until: 5000, kind: 'daily' },
      'not-a-model': { until: 5000, kind: 'daily' },
      'gemini-3.5-flash-lite': { until: Infinity, kind: 'short' },
    } }, 'new', 1000);
    expect(state).toEqual({ keyEpoch: 'new', cooldowns: { 'gemini-3.8-flash': { until: 5000, kind: 'daily' } } });
    expect(cleanQuotaState({ keyEpoch: 'old', cooldowns: { 'gemini-3.8-flash': { until: 5000, kind: 'daily' } } }, 'new', 1000).cooldowns).toEqual({});
  });

  test('backward wall-clock movement never extends daily or short cooldown on repeated reads', () => {
    const rollback = { keyEpoch: 'k', cooldowns: {
      'gemini-3.8-flash': { until: 200000000, kind: 'daily', setAt: 100000000, durationMs: 86400000 },
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
  });
});

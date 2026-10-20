import { describe, test, expect } from 'bun:test';
import { buildRequest, callGemini, parseSwapsResponse, API_BASE } from '../src/gemini.js';
import { requestSwaps, timeoutFor } from '../src/engine.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { createCache, memoryStorage } from '../src/cache.js';
import { hashKey } from '../src/hash.js';

const geminiReply = (tweets) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ tweets }) }] } }] }),
});

describe('gemini', () => {
  test('request shape: system instruction, json schema, low thinking', () => {
    const body = buildRequest({ system: 'S', user: 'U', schema: { type: 'object' } });
    expect(body.systemInstruction.parts[0].text).toBe('S');
    expect(body.contents[0].parts[0].text).toBe('U');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });
  test('callGemini posts with the key in a header and parses ids', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init }); return geminiReply([{ id: 'a', swaps: [{ o: 'and', f: 'y', g: 'and', h: 'ay', ctx: 'x and y' }] }]); };
    const out = await callGemini({ fetchImpl, apiKey: 'K', model: 'gemini-3.8-flash', body: { x: 1 } });
    expect(calls[0].url).toBe(`${API_BASE}gemini-3.8-flash:generateContent`);
    expect(calls[0].init.headers['x-goog-api-key']).toBe('K');
    expect(calls[0].url).not.toContain('K');
    expect(out.get('a')[0].f).toBe('y');
  });
  test('HTTP error and bad JSON throw', async () => {
    await expect(callGemini({ fetchImpl: async () => ({ ok: false, status: 503 }), apiKey: 'K', model: 'm', body: {} })).rejects.toThrow('Model service is busy');
    expect(() => parseSwapsResponse('not json')).toThrow();
    expect(parseSwapsResponse('{"tweets":[{"id":"a"},{"id":5,"swaps":[]}]}').get('a')).toEqual([]);
  });
});

describe('engine', () => {
  test('QA 2026-10-15: Flash-Lite is the default, and a model with a fallback waits 8 s, not 20', () => {
    expect(DEFAULT_SETTINGS.model).toBe('gemini-3.5-flash-lite');
    const both = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
    expect(timeoutFor('gemini-3.8-flash', both, undefined)).toBe(8000);
    expect(timeoutFor('gemini-3.5-flash-lite', both, undefined)).toBeUndefined();
    expect(timeoutFor('gemini-3.5-flash-lite', ['gemini-3.5-flash-lite'], 20000)).toBe(20000);
    expect(timeoutFor('gemini-3.8-flash', both, 5000)).toBe(5000);
  });
  test('validates swaps per level and falls back to Lite once when 3.8 fails', async () => {
    const models = [];
    const fetchImpl = async (url) => {
      models.push(url.split('/').pop().split(':')[0]);
      if (models.length === 1) return { ok: false, status: 503 };
      return geminiReply([{ id: 'a', swaps: [{ o: 'and', f: 'y', g: 'and', h: 'ay', ctx: 'x and y' }, { o: 'in', f: 'en', g: 'in', h: 'dahn', ctx: 'in y' }] }]);
    };
    const r = await requestSwaps({ apiKey: 'K', model: 'gemini-3.8-flash', level: 1, batch: [{ id: 'a', text: 'x and y in y' }], fetchImpl });
    expect(models).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(r.model).toBe('gemini-3.5-flash-lite');
    expect(r.results.a.map((s) => s.f)).toEqual(['y']);
  });
  test('throws when both models fail; Lite has no fallback', async () => {
    let n = 0;
    const fetchImpl = async () => { n++; return { ok: false, status: 429 }; };
    await expect(requestSwaps({ apiKey: 'K', model: 'gemini-3.8-flash', level: 1, batch: [], fetchImpl })).rejects.toThrow('Model rate limit reached');
    expect(n).toBe(2);
    n = 0;
    await expect(requestSwaps({ apiKey: 'K', model: 'gemini-3.5-flash-lite', level: 1, batch: [], fetchImpl })).rejects.toThrow();
    expect(n).toBe(1);
  });
  test('rate-limited models cool down: the next batch skips them, and an all-cooling batch fails fast with a retry time', async () => {
    let clock = 1000;
    const now = () => clock;
    const cooldown = new Map();
    const models = [];
    const fetchImpl = async (url) => {
      const m = url.split('/').pop().split(':')[0];
      models.push(m);
      if (m === 'gemini-3.8-flash') return { ok: false, status: 429, text: async () => '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"36s"}]}}' };
      return geminiReply([{ id: 'a', swaps: [] }]);
    };
    const args = { apiKey: 'K', model: 'gemini-3.8-flash', level: 2, batch: [{ id: 'a', text: 'x' }], fetchImpl, cooldown, now };
    await requestSwaps(args);
    expect(models).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(cooldown.get('gemini-3.8-flash')).toBe(1000 + 36000);
    await requestSwaps(args);
    expect(models.slice(2)).toEqual(['gemini-3.5-flash-lite']);
    cooldown.set('gemini-3.5-flash-lite', 1000 + 5000);
    const error = await requestSwaps(args).catch((e) => e);
    expect(error.message).toContain('cooling down');
    expect(error.retryAfterMs).toBe(5000);
    expect(models).toHaveLength(3);
    clock = 1000 + 36001;
    await requestSwaps(args);
    expect(models.slice(3)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  });
  test('does not dispatch fallback when cooldown persistence fails', async () => {
    const models = [];
    const fetchImpl = async (url) => { models.push(url.split('/').pop().split(':')[0]); return { ok: false, status: 429 }; };
    await expect(requestSwaps({ apiKey: 'K', model: 'gemini-3.8-flash', level: 1, batch: [], fetchImpl,
      onFailure: async () => { throw new Error('quota storage failed'); } })).rejects.toThrow('quota storage failed');
    expect(models).toEqual(['gemini-3.8-flash']);
  });
  test('a daily-quota 429 (retry in hours) keeps that model off for the whole delay, not just 10 minutes', async () => {
    let clock = 0;
    const cooldown = new Map();
    const models = [];
    const fetchImpl = async (url) => {
      const m = url.split('/').pop().split(':')[0];
      models.push(m);
      if (m === 'gemini-3.8-flash') return { ok: false, status: 429, text: async () => '{"error":{"status":"quota_exceeded","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"24281s"}]}}' };
      return geminiReply([{ id: 'a', swaps: [] }]);
    };
    const args = { apiKey: 'K', model: 'gemini-3.8-flash', level: 1, batch: [{ id: 'a', text: 'x' }], fetchImpl, cooldown, now: () => clock };
    await requestSwaps(args);
    expect(cooldown.get('gemini-3.8-flash')).toBe(24281000);
    clock = 3600000; // an hour later the quota is still spent: no wasted request
    await requestSwaps(args);
    expect(models).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash-lite']);
  });
  test('caps density per sentence, one use per word, learning words kept before known filler', async () => {
    const words = [
      { fr: 'grande', en: 'big', hint: 'grahn', status: 'active' },
      { fr: 'y', en: 'and', hint: 'ay', status: 'known' },
      { fr: 'pero', en: 'but', hint: 'meh', status: 'known' },
      { fr: 'muy', en: 'very', hint: 'mwee', status: 'known' },
    ];
    const swaps = [
      { o: 'and', f: 'y', ctx: 'x and' }, { o: 'very', f: 'muy', ctx: 'very' }, { o: 'and', f: 'y', ctx: 'y and' },
      { o: 'but', f: 'pero', ctx: 'but' }, { o: 'big', f: 'grande', ctx: 'a big' },
    ];
    const fetchImpl = async () => geminiReply([{ id: 'a', swaps }]);
    const text = 'It was a big day and a very long one, but fine.';
    const r = await requestSwaps({ apiKey: 'K', model: 'gemini-3.5-flash-lite', level: 1, batch: [{ id: 'a', text }], words, fetchImpl });
    expect(r.results.a.map((s) => s.f)).toEqual(['grande']);
    const two = await requestSwaps({ apiKey: 'K', model: 'gemini-3.5-flash-lite', level: 2, batch: [{ id: 'a', text }], words, fetchImpl });
    expect(two.results.a.map((s) => s.f)).toEqual(['y', 'grande']);
  });
});

describe('cache', () => {
  test('get/set/clear round trip, empty swaps are cached too', async () => {
    const c = createCache(memoryStorage());
    await c.setMany({ a: [{ o: 'and', f: 'y' }], b: [] });
    expect(await c.getMany(['a', 'b', 'c'])).toEqual({ a: [{ o: 'and', f: 'y' }], b: [] });
    expect(await c.clear()).toBe(2);
    expect(await c.getMany(['a'])).toEqual({});
  });
  test('prunes the oldest entries past the cap', async () => {
    const store = memoryStorage({ other: 1 });
    const c = createCache(store, { max: 5, pruneBy: 2, pruneEvery: 100 });
    for (let i = 0; i < 7; i++) {
      await c.setMany({ ['k' + i]: [] });
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(await c.prune()).toBe(4);
    const left = Object.keys(await store.getAll());
    expect(left).toContain('other');
    expect(left.filter((k) => k.startsWith('c:'))).toEqual(['c:k4', 'c:k5', 'c:k6']);
  });
  test('hashKey is stable and distinct', () => {
    expect(hashKey('hello')).toBe(hashKey('hello'));
    expect(hashKey('hello')).not.toBe(hashKey('hello '));
    expect(hashKey('')).toMatch(/^[0-9a-f]{16}$/);
  });
});

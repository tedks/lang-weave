import { expect, test } from 'bun:test';
import { createPricing, PRICES, serializedRequestBytes } from '../src/pricing.js';

const model = 'gemini-3.5-flash-lite';
const laterModel = 'gemini-3.8-flash';
const day = 24 * 60 * 60 * 1000;

test('price evidence must be refreshed after 30 days', () => {
  const age = Math.floor(Date.now() / day) - Date.parse(PRICES.checkedOn) / day;
  expect(age).toBeGreaterThanOrEqual(0);
  expect(age).toBeLessThanOrEqual(30);
  expect(PRICES.source).toBe('https://ai.google.dev/gemini-api/docs/pricing');
});

test('uses UTF-8 bytes, includes thinking, and rounds each amount once', () => {
  const pricing = createPricing();
  expect(serializedRequestBytes(JSON.stringify({ text: 'áñ😀' })))
    .toBe(JSON.stringify({ text: 'áñ😀' }).length + 4);
  expect(pricing.worst(model, 1, 0)).toEqual({ providerMicros: 1, readerMicros: 1 });
  expect(pricing.actual(model, { usage: { promptTokenCount: 1, candidatesTokenCount: 1, thoughtsTokenCount: 1 } }))
    .toEqual({ providerMicros: 6, readerMicros: 11 });
  expect(pricing.worst(model, 100_000, 2048)).toEqual({ providerMicros: 35_120, readerMicros: 70_240 });
  expect(pricing.maxPerCallOverage(model, 2048)).toBe(158_720);
  expect(PRICES.modelMaxOutputTokens).toBe(65_536);
  expect(PRICES.modelMaxOutputTokensVerified).toBeFalse();
});

test('the later 3.8 rate takes effect at UTC midnight and prices at the call date', () => {
  const pricing = createPricing();
  const last = Date.parse('2026-12-31T23:59:59Z');
  const first = Date.parse('2027-01-01T00:00:00Z');
  expect(pricing.worst(laterModel, 100, 100, last)).toEqual({ providerMicros: 450, readerMicros: 900 });
  expect(pricing.worst(laterModel, 100, 100, first)).toEqual({ providerMicros: 900, readerMicros: 1800 });
  expect(() => pricing.worst('toString', 1, 1)).toThrow(RangeError);
});

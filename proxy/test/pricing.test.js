import { expect, test } from 'bun:test';
import { createPricing, PRICE_ROWS, PRICES, serializedRequestBytes } from '../src/pricing.js';

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
  expect(pricing.worst(model, 1, 0)).toMatchObject({ providerMicros: 1, readerMicros: 1 });
  expect(pricing.actual(PRICE_ROWS[0].id, { usage: { promptTokenCount: 1, candidatesTokenCount: 1, thoughtsTokenCount: 1 } }))
    .toEqual({ providerMicros: 6, readerMicros: 11 });
  expect(pricing.worst(model, 100_000, 2048)).toMatchObject({ providerMicros: 35_120, readerMicros: 70_240 });
  expect(pricing.maxPerCallOverage(PRICE_ROWS[0].id, 2048)).toBe(158_720);
  expect(PRICES.modelMaxOutputTokens).toBe(65_536);
  expect(PRICES.modelMaxOutputTokensVerified).toBeFalse();
});

test('expiration fails closed and old rows still settle after the freshness cutoff', () => {
  const last = Date.parse('2026-12-28T23:59:59Z');
  const first = Date.parse('2026-12-29T00:00:00Z');
  const pricing = createPricing();
  const quoted = pricing.worst(model, 100, 100, last);
  expect(quoted.priceRowId).toBe(PRICE_ROWS[0].id);
  expect(pricing.worst(model, 100, 100, first)).toBe('NO_PRICE');
  expect(pricing.actual(quoted.priceRowId, { usage: { promptTokenCount: 100 } }).providerMicros).toBe(30);
  expect(pricing.worst('toString', 1, 1)).toBe('NO_PRICE');
});

test('the announced 3.8 rate takes effect at UTC midnight after a hypothetical source refresh', () => {
  const last = Date.parse('2026-12-31T23:59:59Z');
  const first = Date.parse('2027-01-01T00:00:00Z');
  const pricing = createPricing({ rows: PRICE_ROWS.map((row) => ({
    ...row, id: `${row.id}-fixture-refresh`, checkedOn: '2026-12-31',
  })) });
  expect(pricing.worst(laterModel, 100, 100, last)).toMatchObject({ providerMicros: 450, readerMicros: 900 });
  expect(pricing.worst(laterModel, 100, 100, first)).toMatchObject({ providerMicros: 900, readerMicros: 1800 });
});

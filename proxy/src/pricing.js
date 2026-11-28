// Rates are integer USD cents per million tokens. Dividing by 100 converts
// their product with token counts to micro-dollars.
const checkedOn = '2026-11-28';
const lite = 'gemini-3.5-flash-lite';
const flash = 'gemini-3.8-flash';
export const PRICE_ROWS = Object.freeze([
  { id: 'flash-lite-2026-11-28', model: lite, checkedOn, input: 30, output: 250 },
  { id: 'flash-intro-2026-11-28', model: flash, checkedOn, until: '2027-01-01', input: 75, output: 375 },
  { id: 'flash-standard-2026-11-28', model: flash, checkedOn, from: '2027-01-01', input: 150, output: 750 },
].map(Object.freeze));

export const PRICES = Object.freeze({
  checkedOn,
  source: 'https://ai.google.dev/gemini-api/docs/pricing',
  modelMaxOutputTokens: 65_536,
  modelMaxOutputTokensVerified: false,
});

export const utcDay = (at) => new Date(at).toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

export function priceRowIsCurrent(row, day) {
  if (!row || row.from && day < row.from || row.until && day >= row.until) return false;
  const age = Date.parse(day) - Date.parse(row.checkedOn);
  return age >= 0 && age <= 30 * DAY_MS;
}

function tokenCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid token count');
  return BigInt(value);
}

function micros(numerator) {
  const amount = Number((numerator + 99n) / 100n);
  if (!Number.isSafeInteger(amount)) throw new RangeError('Price exceeds integer range');
  return amount;
}

export function serializedRequestBytes(serialized) {
  return new TextEncoder().encode(serialized).byteLength;
}

export function createPricing({ markup = 2, now = Date.now, rows = PRICE_ROWS } = {}) {
  if (!Number.isSafeInteger(markup) || markup < 1) throw new RangeError('Invalid markup');
  const rowsById = new Map(rows.map((row) => [row.id, Object.freeze({ ...row })]));
  if (rowsById.size !== rows.length) throw new RangeError('Duplicate price row');

  function byId(id) {
    const row = rowsById.get(id);
    if (!row) throw new RangeError('Unknown price row');
    return row;
  }

  function cost({ input, output }, promptTokens, outputTokens, thoughtTokens = 0) {
    const amount = BigInt(input) * tokenCount(promptTokens) +
      BigInt(output) * (tokenCount(outputTokens) + tokenCount(thoughtTokens));
    return { readerMicros: micros(amount * BigInt(markup)), providerMicros: micros(amount) };
  }

  return {
    worst(model, requestBytes, maxOutputTokens, date = now()) {
      const day = utcDay(date);
      const row = [...rowsById.values()].findLast((entry) => entry.model === model && priceRowIsCurrent(entry, day));
      return row ? { ...cost(row, requestBytes, maxOutputTokens), priceRowId: row.id } : 'NO_PRICE';
    },
    actual(priceRowId, outcome) {
      const { promptTokenCount, candidatesTokenCount = 0, thoughtsTokenCount = 0 } = outcome.usage;
      return cost(byId(priceRowId), promptTokenCount, candidatesTokenCount, thoughtsTokenCount);
    },
    maxPerCallOverage(priceRowId, maxOutputTokens) {
      return cost(byId(priceRowId), 0, PRICES.modelMaxOutputTokens - maxOutputTokens).providerMicros;
    },
  };
}

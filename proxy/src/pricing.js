// Rates are integer USD cents per million tokens. Dividing by 100 converts
// their product with token counts to micro-dollars.
const checkedOn = '2026-11-28';
const lite = 'gemini-3.5-flash-lite';
const flash = 'gemini-3.8-flash';
const modelMaxOutputTokens = 65_536;
const readerMarkup = 2;
export const PRICE_ROWS = Object.freeze([
  { id: 'flash-lite-2026-11-28', model: lite, checkedOn, input: 30, output: 250 },
  { id: 'flash-intro-2026-11-28', model: flash, checkedOn, until: '2027-01-01', input: 75, output: 375 },
  { id: 'flash-standard-2026-11-28', model: flash, checkedOn, from: '2027-01-01', input: 150, output: 750 },
].map((row) => Object.freeze({ ...row, modelMaxOutputTokens, readerMarkup })));

export const PRICES = Object.freeze({
  checkedOn,
  source: 'https://ai.google.dev/gemini-api/docs/pricing',
  modelMaxOutputTokens,
  modelMaxOutputTokensVerified: false,
});

export const utcDay = (at) => new Date(at).toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SAFE_MICROS = BigInt(Number.MAX_SAFE_INTEGER);

export function priceRowIsCurrent(row, day) {
  if (!row || row.from && day < row.from || row.until && day >= row.until) return false;
  const age = Date.parse(day) - Date.parse(row.checkedOn);
  return age >= 0 && age <= 30 * DAY_MS;
}

export function activePriceRow(rows, model, day) {
  return rows.filter((row) => row.model === model && priceRowIsCurrent(row, day))
    .sort((a, b) => b.checkedOn.localeCompare(a.checkedOn) ||
      (b.from ?? '').localeCompare(a.from ?? '') || b.id.localeCompare(a.id))[0] ?? null;
}

function tokens(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid token count');
  return BigInt(value);
}

const rounded = (numerator) => (numerator + 99n) / 100n;
const micros = (amount) => amount <= MAX_SAFE_MICROS ? Number(amount) : amount;

function cost(row, prompt, output, thinking = 0, readerLimit) {
  const numerator = BigInt(row.input) * tokens(prompt) + BigInt(row.output) * (tokens(output) + tokens(thinking));
  const provider = rounded(numerator);
  const reader = rounded(numerator * BigInt(row.readerMarkup));
  const cap = readerLimit === undefined ? reader : tokens(readerLimit);
  return { providerMicros: micros(provider), readerMicros: micros(reader > cap ? cap : reader) };
}

export function serializedRequestBytes(serialized) {
  return new TextEncoder().encode(serialized).byteLength;
}

export function actualFromPriceRow(row, outcome, readerLimit) {
  const { promptTokenCount, candidatesTokenCount = 0, thoughtsTokenCount = 0 } = outcome.usage;
  return cost(row, promptTokenCount, candidatesTokenCount, thoughtsTokenCount, readerLimit);
}

function overageMicros(row, maxOutputTokens) {
  const extra = tokens(Math.max(0, row.modelMaxOutputTokens - maxOutputTokens));
  return rounded(BigInt(row.output) * extra);
}

export function quotePriceRow(row, requestBytes, maxOutputTokens) {
  if (!row) return 'NO_PRICE';
  const { readerMicros, providerMicros } = cost(row, requestBytes, maxOutputTokens);
  const providerMax = BigInt(providerMicros) + overageMicros(row, maxOutputTokens);
  if (typeof readerMicros === 'bigint' || providerMax > MAX_SAFE_MICROS) return 'NO_PRICE';
  return { readerMicros, providerMicros, providerMax: Number(providerMax), priceRowId: row.id };
}

export function createPricing({ now = Date.now, rows = PRICE_ROWS } = {}) {
  const rowsById = new Map(rows.map((row) => [row.id, Object.freeze({ ...row })]));
  if (rowsById.size !== rows.length) throw new RangeError('Duplicate price row');

  function byId(id) {
    const row = rowsById.get(id);
    if (!row) throw new RangeError('Unknown price row');
    return row;
  }

  function priceRowHint(model, date = now()) {
    return activePriceRow([...rowsById.values()], model, utcDay(date));
  }

  return {
    priceRowHint,
    worst(model, requestBytes, maxOutputTokens, date = now()) {
      const quote = quotePriceRow(priceRowHint(model, date), requestBytes, maxOutputTokens);
      if (quote === 'NO_PRICE') return quote;
      const { readerMicros, providerMicros, priceRowId } = quote;
      return { readerMicros, providerMicros, priceRowId };
    },
    actual(priceRowId, outcome, readerLimit) {
      return actualFromPriceRow(byId(priceRowId), outcome, readerLimit);
    },
    maxPerCallOverage(priceRowId, maxOutputTokens) {
      return micros(overageMicros(byId(priceRowId), maxOutputTokens));
    },
  };
}

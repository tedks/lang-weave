// Rates are integer USD cents per million tokens. Dividing by 100 converts
// their product with token counts to micro-dollars.
export const PRICES = Object.freeze({
  checkedOn: '2026-11-28',
  source: 'https://ai.google.dev/gemini-api/docs/pricing',
  modelMaxOutputTokens: 65_536,
  modelMaxOutputTokensVerified: false,
  models: Object.freeze({
    'gemini-3.5-flash-lite': Object.freeze([
      Object.freeze({ input: 30, output: 250 }),
    ]),
    'gemini-3.8-flash': Object.freeze([
      Object.freeze({ input: 75, output: 375 }),
      Object.freeze({ effectiveOn: '2027-01-01', input: 150, output: 750 }),
    ]),
  }),
});

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

export function createPricing({ markup = 2, now = Date.now } = {}) {
  if (!Number.isSafeInteger(markup) || markup < 1) throw new RangeError('Invalid markup');

  function rates(model, timestamp) {
    const entries = Object.hasOwn(PRICES.models, model) && PRICES.models[model];
    if (!entries) throw new RangeError('Unknown pricing model');
    const date = new Date(timestamp).toISOString().slice(0, 10);
    return entries.findLast(({ effectiveOn }) => !effectiveOn || effectiveOn <= date);
  }

  function cost({ input, output }, promptTokens, outputTokens, thoughtTokens = 0) {
    const amount = BigInt(input) * tokenCount(promptTokens) +
      BigInt(output) * (tokenCount(outputTokens) + tokenCount(thoughtTokens));
    return { readerMicros: micros(amount * BigInt(markup)), providerMicros: micros(amount) };
  }

  return {
    worst(model, requestBytes, maxOutputTokens, timestamp = now()) {
      return cost(rates(model, timestamp), requestBytes, maxOutputTokens);
    },
    actual(model, outcome, timestamp = now()) {
      const { promptTokenCount, candidatesTokenCount = 0, thoughtsTokenCount = 0 } = outcome.usage;
      return cost(rates(model, timestamp), promptTokenCount, candidatesTokenCount, thoughtsTokenCount);
    },
    maxPerCallOverage(model, maxOutputTokens, timestamp = now()) {
      return cost(rates(model, timestamp), 0, PRICES.modelMaxOutputTokens - maxOutputTokens).providerMicros;
    },
  };
}

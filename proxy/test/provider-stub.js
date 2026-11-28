export const USAGE = Object.freeze({
  promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 10,
});
export const VALID_TEXT = '{"passages":[{"id":"p1","swaps":[]}]}';

const ok = (finishReason, options = {}) => ({
  kind: 'ok', finishReason, blockReason: null, text: VALID_TEXT, usage: USAGE,
  providerRequestId: 'stub-request', ...options,
});

export const OUTCOMES = Object.freeze({
  stop: ok('STOP'),
  maxTokens: ok('MAX_TOKENS', { text: '{"passages":[' }),
  safety: ok('SAFETY'),
  blocked: ok(null, { blockReason: 'SAFETY', text: null }),
  other: ok('RECITATION'),
  noUsage: ok('STOP', { usage: null }),
  rateLimit: { kind: 'http_error', status: 429, category: 'rate_limit', retryAfterMs: 2000 },
  overloaded: { kind: 'http_error', status: 503, category: 'overloaded' },
  httpError: { kind: 'http_error', status: 403, category: 'request_failed' },
  timeout: { kind: 'no_response', sent: true },
  beforeSend: { kind: 'http_error', status: 0, category: 'request_failed' },
});

export function stubProvider(outcome = OUTCOMES.stop) {
  const calls = [];
  return {
    calls,
    async call(args) {
      calls.push(args);
      return typeof outcome === 'function' ? outcome(args) : outcome;
    },
  };
}

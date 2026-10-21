import { classifyProviderFailure, readBoundedBody } from './quota-status.js';
// Gemini generateContent call. No chrome APIs; fetch is injectable for tests.
export const MODELS = {
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
};
export const FALLBACK_MODEL = { 'gemini-3.8-flash': 'gemini-3.5-flash-lite' };
export const THINKING_LEVEL = 'low';
export const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

export function buildRequest({ system, user, schema, thinkingLevel = THINKING_LEVEL }) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      thinkingConfig: { thinkingLevel },
    },
  };
}

// Returns Map<id, swaps[]> from the model's JSON. Throws on HTTP error, timeout, or unparseable output.
export async function callGemini({ fetchImpl = globalThis.fetch, apiKey, model, body, timeoutMs = 20000 }) {
  const res = await fetchImpl(`${API_BASE}${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await readBoundedBody(res);
    const failure = classifyProviderFailure({ status: res.status, body: detail,
      retryAfter: res.headers?.get?.('retry-after') });
    const error = new Error(failure.category === 'daily_quota' ? 'Daily model quota reached'
      : failure.category === 'rate_limit' ? 'Model rate limit reached'
      : failure.category === 'overloaded' ? 'Model service is busy' : 'Model request failed');
    error.status = res.status;
    error.category = failure.category;
    if (failure.retryAfterMs) error.retryAfterMs = failure.retryAfterMs;
    if (failure.retryGuidanceMs) error.retryGuidanceMs = failure.retryGuidanceMs;
    throw error;
  }
  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return parseSwapsResponse(text);
}

export function parseSwapsResponse(text) {
  const data = JSON.parse(text);
  const out = new Map();
  for (const t of data?.passages || data?.tweets || []) {
    if (t && typeof t.id === 'string') out.set(t.id, Array.isArray(t.swaps) ? t.swaps : []);
  }
  return out;
}

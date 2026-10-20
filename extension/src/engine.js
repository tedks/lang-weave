// One batch, one model call (fallback model once on failure), validated swaps out.
import { buildSystemPrompt, buildUserContent, RESPONSE_SCHEMA } from './prompt.js';
import { buildRequest, callGemini, FALLBACK_MODEL } from './gemini.js';
import { validateSwaps, capSwaps } from './levels.js';

// cooldown: Map<model, until ms>. Rate-limited or overloaded models are skipped until then, so the
// free tier's per-minute limit does not cost every batch a failed request before the fallback.
export const COOLDOWN_MS = { 429: 60000, 503: 30000, timeout: 30000 };
// A model with a fallback gets a short wait, so an overloaded model costs seconds before the fallback, not 20.
export const PRIMARY_TIMEOUT_MS = 8000;
export const timeoutFor = (m, models, timeoutMs) =>
  models.length > 1 && m === models[0] ? Math.min(timeoutMs || 20000, PRIMARY_TIMEOUT_MS) : timeoutMs;

export async function requestSwaps({ apiKey, model, level, batch, words, language, density = 'normal', shownToday, fetchImpl, timeoutMs, cooldown = new Map(), cooldownKinds = new Map(), now = Date.now, onFailure }) {
  const body = buildRequest({ system: buildSystemPrompt(level, words, shownToday, language, density), user: buildUserContent(batch), schema: RESPONSE_SCHEMA });
  const candidates = [model];
  if (FALLBACK_MODEL[model]) candidates.push(FALLBACK_MODEL[model]);
  const models = candidates.filter((m) => !(cooldown.get(m) > now()));
  const errors = [];
  if (!models.length) {
    const error = new Error('Model cooling down; retry later');
    error.category = candidates.some((m) => cooldownKinds.get(m) === 'daily') ? 'daily_quota'
      : candidates.some((m) => cooldownKinds.get(m) === 'overloaded') ? 'overloaded'
      : candidates.some((m) => cooldownKinds.get(m) === 'short') ? 'rate_limit' : 'request_failed';
    error.retryAfterMs = Math.max(1000, Math.min(...candidates.map((m) => cooldown.get(m))) - now());
    throw error;
  }
  for (const m of models) {
    try {
      const byId = await callGemini({ fetchImpl, apiKey, model: m, body, timeoutMs: timeoutFor(m, models, timeoutMs) });
      const results = {};
      for (const { id, text } of batch) {
        if (!byId.has(id)) throw new Error('Incomplete model response');
        results[id] = capSwaps(level, validateSwaps(level, byId.get(id), words, language, { text }), text, words, density);
      }
      return { results, model: m, errors };
    } catch (e) {
      if (e?.stale) throw e;
      if (e?.category === 'storage_failed') throw e; // no fallback after failed local call accounting
      const timeout = e?.name === 'TimeoutError';
      const category = e?.category || (timeout ? 'request_failed' : e?.status === 429 ? 'rate_limit' : e?.status === 503 ? 'overloaded' : 'request_failed');
      const wait = e?.retryAfterMs || COOLDOWN_MS[timeout ? 'timeout' : e?.status];
      if (wait) cooldown.set(m, now() + wait);
      cooldownKinds.set(m, category === 'daily_quota' ? 'daily' : category === 'overloaded' ? 'overloaded'
        : category === 'rate_limit' ? 'short' : 'transient');
      errors.push({ model: m, category, retryAfterMs: wait, retryGuidanceMs: e?.retryGuidanceMs });
      if (onFailure) await onFailure(m, category, wait, now());
    }
  }
  const categories = errors.map((e) => e.category);
  const category = categories.includes('daily_quota') ? 'daily_quota' : categories.includes('rate_limit') ? 'rate_limit'
    : categories.includes('overloaded') ? 'overloaded' : 'request_failed';
  const error = new Error(category === 'daily_quota' ? 'Daily model quota reached' : category === 'rate_limit'
    ? 'Model rate limit reached' : category === 'overloaded' ? 'Model service is busy' : 'Model request failed');
  error.category = category;
  const guidance = errors.find((e) => e.category === category && e.retryGuidanceMs)?.retryGuidanceMs;
  if (guidance) error.retryGuidanceMs = guidance;
  const until = candidates.map((m) => cooldown.get(m) || 0).filter((t) => t > now());
  if (until.length === candidates.length) error.retryAfterMs = Math.max(1000, Math.min(...until) - now());
  throw error;
}

// Provider quota diagnostics are deliberately small, allowlisted, and secret-free.
export const STATUS_KEY = 'modelStatus';
export const QUOTA_STATE_KEY = 'quotaState';
export const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const MAX_SHORT_COOLDOWN_MS = 60 * 60 * 1000;
export const MAX_RETRY_MS = 24 * 60 * 60 * 1000;
export const MODEL_IDS = new Set(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
export const STATUS_CATEGORIES = new Set(['daily_quota', 'rate_limit', 'overloaded', 'request_failed', 'local_budget', 'ok']);

const finite = (n) => Number.isFinite(n) && n >= 0;
const boundedRetry = (n) => finite(n) && n > 0 ? Math.min(n, MAX_RETRY_MS) : undefined;

function retryInfo(data) {
  const details = data?.error?.details;
  if (!Array.isArray(details) || details.length > 32) return undefined;
  for (const detail of details) {
    if (!detail || detail['@type'] !== 'type.googleapis.com/google.rpc.RetryInfo') continue;
    const value = detail.retryDelay;
    if (typeof value === 'string' && value.length <= 32) {
      const match = /^(\d+(?:\.\d{1,3})?)s$/.exec(value);
      if (match) return boundedRetry(Number(match[1]) * 1000);
    }
  }
}

export function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 128) return undefined;
  const seconds = /^(\d+(?:\.\d{1,3})?)$/.exec(value.trim());
  if (seconds) return boundedRetry(Number(seconds[1]) * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? boundedRetry(date - now) : undefined;
}

export async function readBoundedBody(response, maxBytes = 16384) {
  const size = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(size) && size > maxBytes) return '';
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (total <= maxBytes) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel(); return ''; }
        chunks.push(value);
      }
    } catch { return ''; }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  }
  try { const text = await response.text(); return typeof text === 'string' && text.length <= maxBytes ? text : ''; }
  catch { return ''; }
}

export function classifyProviderFailure({ status, body, retryAfter, now = Date.now() }) {
  let data;
  if (typeof body === 'string' && body.length <= 16384) {
    try { data = JSON.parse(body); } catch { /* malformed provider body is not diagnostic data */ }
  }
  const error = data?.error;
  const details = Array.isArray(error?.details) && error.details.length <= 32 ? error.details : [];
  const codes = [error?.status, error?.code]
    .filter((v) => typeof v === 'string' && v.length <= 128).map((v) => v.toLowerCase());
  const dimensions = details.flatMap((d) => d && typeof d === 'object' ? [d.metadata?.quotaMetric, d.quotaId,
    ...(Array.isArray(d.violations) ? d.violations.slice(0, 16).map((v) => v?.quotaId) : [])] : [])
    .filter((v) => typeof v === 'string' && v.length <= 128).map((v) => v.toLowerCase());
  const structured = [...codes, ...details.flatMap((d) => d && typeof d === 'object' ? [d.reason] : [])]
    .filter((v) => typeof v === 'string' && v.length <= 128).map((v) => v.toLowerCase());
  const dailyCode = codes.includes('quota_exceeded');
  const dailyDimension = dimensions.some((v) => v === 'generate_requests_per_day_per_project_per_model_freetier' ||
    v.includes('requestsperday') || v === 'rpd');
  const daily = status === 429 && (dailyCode || dailyDimension);
  const short = structured.some((v) => v === 'rate_limit_exceeded' || v === 'too_many_requests');
  const category = daily && !short ? 'daily_quota' : short || status === 429 ? 'rate_limit'
    : status === 503 ? 'overloaded' : 'request_failed';
  const providerRetry = retryInfo(data);
  const headerRetry = parseRetryAfter(retryAfter, now);
  let retryAfterMs;
  if (category === 'daily_quota') retryAfterMs = boundedRetry(providerRetry ?? headerRetry) ?? DAILY_COOLDOWN_MS;
  else if (category === 'rate_limit' || category === 'overloaded') retryAfterMs =
    Math.min(providerRetry ?? headerRetry ?? (category === 'overloaded' ? 30000 : 60000), MAX_SHORT_COOLDOWN_MS);
  return { category, retryAfterMs, retryGuidanceMs: boundedRetry(providerRetry ?? headerRetry) };
}

export function cleanQuotaState(value, keyEpoch, now = Date.now()) {
  const out = { keyEpoch: typeof keyEpoch === 'string' ? keyEpoch.slice(0, 64) : '', cooldowns: {} };
  if (!value || value.keyEpoch !== out.keyEpoch || !value.cooldowns || typeof value.cooldowns !== 'object') return out;
  for (const model of MODEL_IDS) {
    const entry = value.cooldowns[model];
    if (!entry || !['daily', 'short', 'overloaded'].includes(entry.kind) || !finite(entry.until)) continue;
    let until = entry.until;
    if (until > now + MAX_RETRY_MS) {
      const durationCap = entry.kind === 'daily' ? MAX_RETRY_MS : MAX_SHORT_COOLDOWN_MS;
      if (!finite(entry.setAt) || !finite(entry.durationMs) || now >= entry.setAt || entry.durationMs > durationCap) continue;
      until = Math.min(now + entry.durationMs, now + durationCap); // bounded recovery from a backward wall-clock jump
    }
    if (until <= now) continue;
    out.cooldowns[model] = { until, kind: entry.kind };
  }
  return out;
}

export function safeModelStatus(value) {
  if (!value || !STATUS_CATEGORIES.has(value.category)) return null;
  const out = { category: value.category };
  if (finite(value.at)) out.at = value.at;
  if (finite(value.retryAt)) out.retryAt = value.retryAt;
  if (MODEL_IDS.has(value.model)) out.model = value.model;
  return out;
}

export function statusLabel(status, now = Date.now()) {
  const safe = safeModelStatus(status);
  if (!safe || safe.category === 'ok') return '';
  if (safe.category === 'local_budget') return 'Daily local model-call budget reached.';
  const guided = Number.isFinite(now) && safe.retryAt > now && safe.retryAt <= now + MAX_RETRY_MS;
  const retry = guided ? ` Retry after ${new Date(safe.retryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : '';
  if (safe.category === 'daily_quota') return `Daily model quota reached.${retry || ' Try again later.'}`;
  if (safe.category === 'rate_limit') return `Model rate limit reached.${retry || ' Try again shortly.'}`;
  if (safe.category === 'overloaded') return `Model service is busy.${retry || ' Try again shortly.'}`;
  return 'Model request failed. Try again later.';
}

// Provider quota diagnostics are deliberately small, allowlisted, and secret-free.
export const STATUS_KEY = 'modelStatus';
export const QUOTA_STATE_KEY = 'quotaState';
export const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const MAX_SHORT_COOLDOWN_MS = 60 * 60 * 1000;
export const MAX_RETRY_MS = 24 * 60 * 60 * 1000;
export const MODEL_IDS = new Set(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
export const STATUS_CATEGORIES = new Set(['daily_quota', 'rate_limit', 'overloaded', 'request_failed', 'storage_failed', 'local_budget', 'ok']);
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
const COOLDOWN_KINDS = new Set(['daily', 'short', 'overloaded', 'transient']);

const finite = (n) => Number.isFinite(n) && n >= 0;
const boundedRetry = (n) => finite(n) && n > 0 ? Math.min(n, MAX_RETRY_MS) : undefined;
const cooldownCap = (kind) => kind === 'daily' ? MAX_RETRY_MS : MAX_SHORT_COOLDOWN_MS;

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
  if (Number.isFinite(size) && size > maxBytes) {
    try { await response.body?.cancel?.(); } catch { /* parsing an error is optional */ }
    return '';
  }
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
  const dailyCode = structured.includes('quota_exceeded');
  const dailyDimension = dimensions.some((v) => v === 'generate_requests_per_day_per_project_per_model_freetier' ||
    v.includes('perday') || v === 'rpd');
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
  const guidance = boundedRetry(providerRetry ?? headerRetry);
  return { category, retryAfterMs, retryGuidanceMs: guidance && guidance <= retryAfterMs ? guidance : undefined };
}

export function cleanQuotaState(value, keyEpoch, now = Date.now()) {
  const out = { keyEpoch: typeof keyEpoch === 'string' ? keyEpoch.slice(0, 64) : '', cooldowns: {} };
  if (!finite(now) || !value || value.keyEpoch !== out.keyEpoch || !value.cooldowns ||
      typeof value.cooldowns !== 'object') return out;
  for (const model of MODEL_IDS) {
    const entry = value.cooldowns[model];
    if (!entry || !COOLDOWN_KINDS.has(entry.kind) || !finite(entry.until)) continue;
    const cap = cooldownCap(entry.kind);
    // Every persisted entry needs its original timing evidence. A second model's
    // read-modify-write must preserve it so rollback cannot revive the first.
    if (!finite(entry.setAt) || !finite(entry.durationMs) || entry.durationMs <= 0 ||
        entry.durationMs > cap || entry.until <= entry.setAt ||
        entry.until > entry.setAt + entry.durationMs) continue;
    // A large rollback cannot be timed against wall-clock storage. Drop the
    // stale block and let the next provider reply establish a fresh bound.
    if (now + CLOCK_ROLLBACK_TOLERANCE_MS < entry.setAt) continue;
    if (entry.until <= now || entry.until > now + cap + CLOCK_ROLLBACK_TOLERANCE_MS) continue;
    out.cooldowns[model] = { until: entry.until, kind: entry.kind,
      setAt: entry.setAt, durationMs: entry.durationMs };
  }
  return out;
}

export function newCooldownEntry(kind, wait, startedAt, now = Date.now()) {
  if (!COOLDOWN_KINDS.has(kind) || !finite(wait) || wait <= 0 ||
      !finite(startedAt) || !finite(now)) return null;
  const cap = cooldownCap(kind);
  const durationMs = Math.min(wait, cap);
  const until = startedAt + durationMs;
  // The error's clock sample anchors every field. A small in-flight rollback
  // retains the original deadline; a larger one cannot justify a saved wait.
  if (!finite(until) || until <= now || startedAt > now + CLOCK_ROLLBACK_TOLERANCE_MS) return null;
  return { until, kind, setAt: startedAt, durationMs };
}

export function safeModelStatus(value) {
  if (!value || !STATUS_CATEGORIES.has(value.category)) return null;
  const out = { category: value.category };
  if (finite(value.at)) out.at = value.at;
  if (finite(value.retryAt)) out.retryAt = value.retryAt;
  if (MODEL_IDS.has(value.model)) out.model = value.model;
  return out;
}

export function retainedRetryAt(previous, category, now, remainingMs) {
  const safe = safeModelStatus(previous);
  if (!safe || safe.category !== category || !finite(remainingMs) || remainingMs <= 0 ||
      !finite(now) || !finite(safe.retryAt) || safe.retryAt <= now) return undefined;
  // A changed fallback outcome can make another model retry much sooner.
  // Only retain guidance when it still describes this same fast-fail wait.
  return Math.abs(safe.retryAt - now - remainingMs) <= 1000 ? safe.retryAt : undefined;
}

export function statusLabel(status, now = Date.now()) {
  const safe = safeModelStatus(status);
  if (!safe || safe.category === 'ok') return '';
  if (safe.category === 'local_budget') return 'Daily local model-call budget reached.';
  const guided = Number.isFinite(now) && safe.retryAt > now && safe.retryAt <= now + MAX_RETRY_MS;
  const retry = guided ? ` Retry after ${new Date(safe.retryAt).toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })}.` : '';
  if (safe.category === 'daily_quota') return `Daily model quota reached.${retry || ' Try again later.'}`;
  if (safe.category === 'rate_limit') return `Model rate limit reached.${retry || ' Try again shortly.'}`;
  if (safe.category === 'overloaded') return `Model service is busy.${retry || ' Try again shortly.'}`;
  if (safe.category === 'storage_failed') return 'Local reading storage failed. Try again.';
  return 'Model request failed. Try again later.';
}

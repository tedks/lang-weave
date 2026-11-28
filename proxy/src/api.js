import { createHmac } from 'node:crypto';
import { MAX_REQUEST_CHARS } from '../../extension/src/adaptive.js';
import { GUARANI_PACK } from '../../extension/src/guarani.js';
import { GUARANI_STARTER, languageCode } from '../../extension/src/language-name.js';
import { validField } from '../../extension/src/languages.js';
import { validForm } from '../../extension/src/personal.js';
import { RESPONSE_SCHEMA } from '../../extension/src/prompt.js';
import { MAX_RETRY_MS } from '../../extension/src/quota-status.js';
import { buildSwapRequest, canonicalSwapBody } from '../../extension/src/swap-request.js';
import { wordsForLevel } from '../../extension/src/vocabulary.js';
import { validPackForm } from '../../extension/src/word-form.js';
import { IDEMPOTENCY_MS, newToken, sha256 } from './ledger.js';
import { createPricing, serializedRequestBytes } from './pricing.js';

export const PROMPT_VERSION = '0.16';
export const MANAGED_MODEL = 'gemini-3.5-flash-lite';
export const MAX_INBOUND_BYTES = 192 * 1024;
export const MAX_OUTPUT_TOKENS = 2_048;
export const PROVIDER_TIMEOUT_MS = 20_000;
export const BETA_EXTENSION_ID = 'lkbkmlgogcpcacjmdmoecgacdbfddbnh';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const RETRY_BUSY_MS = 1_000;
const STATUSES = new Set(['active', 'known', 'due', 'new']);
const DENSITIES = new Set(['light', 'normal', 'heavy']);
const MAX_WORDS = 400;
const MAX_PASSAGES = 8;
const catalogKey = (fr, en) => JSON.stringify([fr, en]);
const catalogByLanguage = new Map([
  ['es', new Map(wordsForLevel(2).map((word) => [catalogKey(word.fr, word.en), word]))],
  [GUARANI_STARTER, new Map(GUARANI_PACK.words.map((word) => [catalogKey(word.fr, word.en), word]))],
]);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const dayOf = (at) => new Date(at).toISOString().slice(0, 10);

export function validatedSwapWord(word, language) {
  if (!record(word) || !Object.keys(word).every((key) => ['source', 'fr', 'en', 'status'].includes(key)) ||
      !STATUSES.has(word.status) || typeof word.fr !== 'string' || typeof word.en !== 'string') return null;
  const { fr, en, source, status } = word;
  if (source === 'bundled') {
    const row = catalogByLanguage.get(language)?.get(catalogKey(fr, en));
    return row ? { ...row, status } : null;
  }
  if (source === 'pack') {
    return validPackForm(fr) && en.length <= 60 && validField(en) && /\p{L}/u.test(en)
      ? { fr, en, hint: '', status } : null;
  }
  if (source === 'personal') {
    const target = validForm(fr);
    const gloss = validForm(en);
    return target && gloss ? { fr: target, en: gloss, hint: '', status } : null;
  }
  return null;
}

function validateSwap(input) {
  const { model, level, language, density, gradual, words, shownToday, passages } = input;
  if (!Object.keys(input).every((key) =>
    ['promptVersion', 'model', 'level', 'language', 'density', 'gradual', 'words', 'shownToday', 'passages'].includes(key)) ||
      model !== MANAGED_MODEL || ![1, 2].includes(level) ||
      typeof language !== 'string' || !(catalogByLanguage.has(language) || languageCode(language) === language) ||
      !DENSITIES.has(density) || typeof gradual !== 'boolean' ||
      !Array.isArray(words) || words.length > MAX_WORDS ||
      !Array.isArray(shownToday) || shownToday.length > MAX_WORDS ||
      !Array.isArray(passages) || !passages.length || passages.length > MAX_PASSAGES) return null;
  if (!passages.every((passage) => record(passage) && Object.keys(passage).length === 2 &&
      typeof passage.id === 'string' && passage.id.length <= 64 &&
      typeof passage.text === 'string' && passage.text.length <= 2_000)) return null;

  const promptWords = words.map((word) => validatedSwapWord(word, language));
  if (promptWords.some((word) => !word)) return null;
  const listedForms = new Set(words.map((word) => word.fr));
  if (shownToday.some((form) => !listedForms.has(form))) return null;
  return { level, language, density, unknownLimit: gradual, words: promptWords, shownToday, batch: passages };
}

function aheadOfCurrent(version) {
  if (typeof version !== 'string' || !/^\d{1,12}\.\d{1,12}(?:\.\d{1,12})?$/.test(version)) return false;
  const parts = version.split('.').map(Number);
  const current = PROMPT_VERSION.split('.').map(Number);
  const different = parts.findIndex((part, index) => part !== (current[index] ?? 0));
  return different !== -1 && parts[different] > (current[different] ?? 0);
}

async function readJson(request) {
  if (Number(request.headers.get('content-length')) > MAX_INBOUND_BYTES) return { tooLarge: true };
  const mime = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (mime !== 'application/json' || !request.body) return {};

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let json = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INBOUND_BYTES) {
        void reader.cancel().catch(() => {});
        return { tooLarge: true };
      }
      json += decoder.decode(value, { stream: true });
    }
    return { value: JSON.parse(json + decoder.decode()) };
  } catch {
    void reader.cancel().catch(() => {});
    return {};
  } finally {
    reader.releaseLock();
  }
}

function schemaMatches(schema, value) {
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'array') return Array.isArray(value) && value.every((item) => schemaMatches(schema.items, item));
  return schema.type === 'object' && record(value) &&
    schema.required.every((key) => Object.hasOwn(value, key) && schemaMatches(schema.properties[key], value[key]));
}

function validProviderText(text, passages) {
  if (typeof text !== 'string') return false;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return false;
  }
  const ids = new Set(passages.map((passage) => passage.id));
  return schemaMatches(RESPONSE_SCHEMA, data) && data.passages.every((passage) => ids.has(passage.id));
}

function accountRateLimiter(secret) {
  const entries = new Map();
  const digest = (ip, at) => {
    const key = createHmac('sha256', secret).update(dayOf(at)).digest();
    return createHmac('sha256', key).update(ip).digest('hex');
  };

  return (ip, at) => {
    const today = digest(ip, at);
    const yesterday = digest(ip, at - DAY);
    const recent = (key) => (entries.get(key)?.times ?? []).filter((time) => time > at - HOUR);
    const todayTimes = recent(today);
    const times = [...recent(yesterday), ...todayTimes];
    if (times.length >= 5) return Math.max(1, Math.min(...times) + HOUR - at);
    clearTimeout(entries.get(today)?.timer);
    // Keep a daily hash only while it can affect an hourly decision.
    const timer = setTimeout(() => entries.delete(today), HOUR);
    timer.unref();
    entries.set(today, { times: [...todayTimes, at], timer });
    return 0;
  };
}

function meter(pricing, model, at, outcome, bytes, readerWorst) {
  const details = { providerRequestId: outcome.providerRequestId, usage: outcome.usage };
  const provisional = (reader, reason, status, error = {}) =>
    ({ reader, provider: null, reason, status, error, details });
  const blocked = { blocked: true };

  if (outcome.kind === 'no_response') return provisional(readerWorst, 'timeout', 504);
  if (outcome.blockReason) return provisional(0, 'prompt_blocked', 502, blocked);

  const { finishReason, usage } = outcome;
  if (finishReason === 'SAFETY') {
    if (!usage) return provisional(pricing.worst(model, bytes, 0, at).readerMicros, 'safety', 502, blocked);
    const inputOnly = { usage: { promptTokenCount: usage.promptTokenCount } };
    const cost = pricing.actual(model, inputOnly, at);
    return { reader: cost.readerMicros, provider: cost.providerMicros, reason: 'safety', status: 502,
      error: blocked, details };
  }
  if (finishReason !== 'MAX_TOKENS' && finishReason !== 'STOP') {
    return { ...provisional(0, 'unclassified', 502, blocked), alert: 'unclassified' };
  }

  const truncated = finishReason === 'MAX_TOKENS';
  const actual = usage ? pricing.actual(model, outcome, at) : null;
  return {
    reader: actual?.readerMicros ?? readerWorst,
    provider: actual?.providerMicros ?? null,
    reason: truncated ? 'max_tokens' : usage ? 'stop' : 'no_usage',
    status: truncated ? 502 : 200,
    details,
    alert: truncated ? 'max_tokens' : undefined,
  };
}

const ok = (status, body) => ({ status, body });
const failure = (status, category = 'request_failed', extra) => ok(status, { error: { category, ...extra } });
const ledgerFailure = {
  UNAUTHORIZED: failure(401, 'managed_unauthorized'),
  BALANCE: failure(402, 'managed_balance'),
  DAILY_CAP: failure(402, 'managed_balance', { dailyCap: true }),
  FROZEN: failure(402, 'managed_balance'),
  CEILING: failure(503, 'managed_unavailable'),
  BUSY: failure(429, 'rate_limit', { retryAfterMs: RETRY_BUSY_MS }),
  KEY_REUSE: failure(422, 'request_failed', { keyReuse: true }),
};

export function createApi({
  ledger, provider, pricing = createPricing(), stripeWebhook, now = Date.now,
  clientIp, ipHashSecret, extensionIds = [], ceilingMicros = 2_000_000,
  isInMaintenance = () => false, alert = console.warn,
}) {
  if (typeof clientIp !== 'function' || typeof ipHashSecret !== 'string' || !ipHashSecret) {
    throw new TypeError('A trusted client IP resolver and hash secret are required');
  }
  const origins = new Set([BETA_EXTENSION_ID, ...extensionIds].map((id) => {
    if (!/^[a-p]{32}$/.test(id)) throw new TypeError('Invalid extension ID');
    return `chrome-extension://${id}`;
  }));
  const rateLimit = accountRateLimiter(ipHashSecret);
  const replays = new Map();

  function bearerHash(request) {
    const match = /^Bearer (lwk_[A-Za-z0-9_-]{43})$/i.exec(request.headers.get('authorization') ?? '');
    return match ? sha256(match[1]) : null;
  }

  function createAccount(request) {
    if (request.body) return failure(400);
    const ip = clientIp(request);
    if (typeof ip !== 'string' || !ip) return failure(503, 'managed_unavailable');
    const retry = rateLimit(ip, now());
    if (retry) return failure(429, 'rate_limit', { retryAfterMs: retry });
    const token = newToken();
    const accountId = ledger.createAccount(sha256(token));
    return ok(201, { accountId, token });
  }

  function duplicate(accountId, keyHash) {
    const prior = ledger.getIdempotency(accountId, keyHash);
    return replays.get(prior?.reservationId) ??
      failure(409, 'request_failed', { duplicate: true, charged: (prior?.costMicros ?? 0) > 0 });
  }

  async function swap(request) {
    const json = await readJson(request);
    if (json.tooLarge) return failure(413, 'request_failed', { tooLarge: 'body' });
    const tokenHash = bearerHash(request);
    const accountId = tokenHash && ledger.authenticate(tokenHash);
    if (!accountId) return failure(401, 'managed_unauthorized');
    const input = json.value;
    if (!record(input)) return failure(400);
    if (input.promptVersion !== PROMPT_VERSION) {
      return failure(409, 'managed_update_required', { ahead: aheadOfCurrent(input.promptVersion) });
    }
    const key = request.headers.get('idempotency-key');
    const args = validateSwap(input);
    if (!key || !/^[a-fA-F0-9]{32}$/.test(key) || !args) return failure(400);

    const built = buildSwapRequest(args);
    if (JSON.stringify(built).length > MAX_REQUEST_CHARS) {
      return failure(400, 'request_failed', { tooLarge: input.passages.length > 1 ? 'passages' : 'words' });
    }
    if (isInMaintenance()) return failure(503, 'managed_unavailable');
    built.generationConfig.maxOutputTokens = MAX_OUTPUT_TOKENS;
    const bytes = serializedRequestBytes(JSON.stringify(built));
    const at = now();
    const model = input.model;
    const worst = pricing.worst(model, bytes, MAX_OUTPUT_TOKENS, at);
    const providerMax = worst.providerMicros + pricing.maxPerCallOverage(model, MAX_OUTPUT_TOKENS, at);
    const keyHash = sha256(key);
    const id = ledger.reserve(accountId, worst.readerMicros, providerMax, dayOf(at), ceilingMicros,
      keyHash, sha256(canonicalSwapBody(input)), { model, tokenHash });
    if (id === 'DUPLICATE') return duplicate(accountId, keyHash);
    if (Object.hasOwn(ledgerFailure, id)) return ledgerFailure[id];

    let outcome;
    try {
      outcome = await provider.call({ model, request: built, timeoutMs: PROVIDER_TIMEOUT_MS });
      if (!outcome) outcome = { kind: 'no_response', sent: true };
    } catch {
      outcome = { kind: 'no_response', sent: true };
    }
    let response;
    let winner;
    if (outcome.kind === 'http_error' || outcome.kind === 'no_response' && outcome.sent === false) {
      const category = outcome.status === 429 ? 'rate_limit' : outcome.status === 503 ? 'overloaded' : 'request_failed';
      winner = ledger.release(id, { providerRequestId: outcome.providerRequestId, reason: category });
      const retryAfterMs = outcome.retryAfterMs;
      const extras = Number.isSafeInteger(retryAfterMs) && retryAfterMs > 0 && retryAfterMs <= MAX_RETRY_MS
        ? { retryAfterMs } : undefined;
      response = failure(outcome.status === 429 || outcome.status === 503 ? outcome.status : 502, category, extras);
      if (winner.state !== 'released') {
        // A completed HTTP failure establishes zero provider cost even when
        // expiry won the reader's compare-and-set.
        ledger.reconcile(id, 0);
        return duplicate(accountId, keyHash);
      }
    } else {
      const charge = meter(pricing, model, at, outcome, bytes, worst.readerMicros);
      winner = ledger.settle(id, charge.reader, charge.provider, charge.reason, charge.details);
      if (winner.reason !== charge.reason || winner.state !== (charge.provider === null ? 'provisional' : 'settled')) {
        if (charge.provider !== null) {
          const reconciled = ledger.reconcile(id, charge.provider);
          if (reconciled.overage) alert({ reason: 'overage', reservationId: id });
        }
        return duplicate(accountId, keyHash);
      }
      if (winner.overage || charge.alert) {
        if (winner.overage) alert({ reason: 'overage', reservationId: id });
        if (charge.alert) alert({ reason: charge.alert, reservationId: id });
      }

      if (charge.status === 200 && validProviderText(outcome.text, input.passages)) {
        const usage = outcome.usage ? {
          promptTokens: outcome.usage.promptTokenCount,
          outputTokens: outcome.usage.candidatesTokenCount ?? 0,
          thoughtTokens: outcome.usage.thoughtsTokenCount ?? 0,
        } : null;
        response = ok(200, { text: outcome.text, usage, costMicros: winner.costMicros, balanceMicros: winner.balanceMicros });
      } else {
        response = failure(charge.status === 200 ? 502 : charge.status, 'request_failed', charge.error);
      }
    }

    const remaining = winner.settledAt + IDEMPOTENCY_MS - now();
    if (remaining > 0) {
      replays.set(id, response);
      const timer = setTimeout(() => replays.delete(id), Math.min(remaining, IDEMPOTENCY_MS));
      timer.unref();
    }
    return response;
  }

  return async function handle(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    if (origins.has(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    let result;
    try {
      if (url.protocol !== 'https:') result = failure(400);
      else if (request.method === 'OPTIONS' && ['/v0/accounts', '/v0/balance', '/v0/swaps'].includes(url.pathname)) {
        return new Response(null, { status: 204, headers });
      } else if (request.method === 'POST' && url.pathname === '/v0/accounts') {
        result = createAccount(request);
      } else if (request.method === 'GET' && url.pathname === '/v0/balance') {
        const tokenHash = bearerHash(request);
        const accountId = tokenHash && ledger.authenticate(tokenHash);
        if (!accountId) result = failure(401, 'managed_unauthorized');
        else {
          const { balanceMicros, reservedMicros } = ledger.getAccount(accountId);
          result = ok(200, { balanceMicros, reservedMicros });
        }
      } else if (request.method === 'POST' && url.pathname === '/v0/swaps') {
        result = await swap(request);
      } else if (request.method === 'POST' && url.pathname === '/v0/stripe/webhook' && stripeWebhook) {
        return await stripeWebhook(request);
      } else {
        result = failure(404);
      }
    } catch {
      result = failure(503, 'managed_unavailable');
    }
    return Response.json(result.body, { status: result.status, headers });
  };
}

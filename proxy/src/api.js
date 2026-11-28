import { createHmac } from 'node:crypto';
import { MAX_REQUEST_CHARS } from '../../extension/src/adaptive.js';
import { GUARANI_PACK } from '../../extension/src/guarani.js';
import { GUARANI_STARTER, languageCode } from '../../extension/src/language-name.js';
import { validPackGloss } from '../../extension/src/languages.js';
import { validForm } from '../../extension/src/personal.js';
import { RESPONSE_SCHEMA } from '../../extension/src/prompt.js';
import { MAX_RETRY_MS } from '../../extension/src/quota-status.js';
import { buildSwapRequest, canonicalSwapBody } from '../../extension/src/swap-request.js';
import { wordsForLevel } from '../../extension/src/vocabulary.js';
import { validPackForm } from '../../extension/src/word-form.js';
import { IDEMPOTENCY_MS, newToken, sha256 } from './ledger.js';
import { actualFromPriceRow, createPricing, serializedRequestBytes } from './pricing.js';
import { bodyTooLarge, hasJsonMediaType, readBoundedBytes } from './request-body.js';

export { MAX_INBOUND_BYTES } from './request-body.js';
export const PROMPT_VERSION = '0.16';
export const MANAGED_MODEL = 'gemini-3.5-flash-lite';
export const MAX_OUTPUT_TOKENS = 2_048;
export const PROVIDER_TIMEOUT_MS = 20_000;
export const BETA_EXTENSION_ID = 'lkbkmlgogcpcacjmdmoecgacdbfddbnh';

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

export function validatedSwapWord(word, language) {
  if (!record(word) || !Object.keys(word).every((key) => ['source', 'fr', 'en', 'status'].includes(key)) ||
      !STATUSES.has(word.status) || typeof word.fr !== 'string' || typeof word.en !== 'string') return null;
  const { fr, en, source, status } = word;
  if (source === 'bundled') {
    const row = catalogByLanguage.get(language)?.get(catalogKey(fr, en));
    return row ? { ...row, status } : null;
  }
  if (source === 'pack') {
    return validPackForm(fr) && validPackGloss(en)
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
  const raw = await readBoundedBytes(request);
  if (raw.tooLarge) return raw;
  if (!hasJsonMediaType(request) || !raw.bytes?.length) return {};
  try {
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw.bytes)) };
  } catch {
    return {};
  }
}

function schemaMatches(schema, value) {
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'array') return Array.isArray(value) && value.every((item) => schemaMatches(schema.items, item));
  return schema.type === 'object' && record(value) &&
    schema.required.every((key) => Object.hasOwn(value, key) && schemaMatches(schema.properties[key], value[key]));
}

function projectSchema(schema, value) {
  if (schema.type === 'string') return value;
  if (schema.type === 'array') return value.map((item) => projectSchema(schema.items, item));
  return Object.fromEntries(schema.required.map((key) => [key, projectSchema(schema.properties[key], value[key])]));
}

function safeProviderText(text, passages) {
  if (typeof text !== 'string') return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const ids = new Set(passages.map((passage) => passage.id));
  if (!schemaMatches(RESPONSE_SCHEMA, data) || !data.passages.every((passage) => ids.has(passage.id))) return null;
  return JSON.stringify(projectSchema(RESPONSE_SCHEMA, data));
}

function meter(priceRow, outcome, bytes, readerWorst) {
  const details = { providerRequestId: outcome.providerRequestId, usage: outcome.usage };
  const provisional = (reader, reason, status, error = {}) =>
    ({ reader, provider: null, reason, status, error, details });
  const blocked = { blocked: true };

  if (outcome.kind === 'no_response') return provisional(readerWorst, 'timeout', 504);
  if (outcome.blockReason) return provisional(0, 'prompt_blocked', 502, blocked);

  const { finishReason, usage } = outcome;
  if (finishReason === 'SAFETY') {
    if (!usage) return provisional(actualFromPriceRow(priceRow, { usage: { promptTokenCount: bytes } }, readerWorst).readerMicros, 'safety', 502, blocked);
    const inputOnly = { usage: { promptTokenCount: usage.promptTokenCount } };
    const cost = actualFromPriceRow(priceRow, inputOnly, readerWorst);
    return { reader: cost.readerMicros, provider: cost.providerMicros, reason: 'safety', status: 502,
      error: blocked, details };
  }
  if (finishReason !== 'MAX_TOKENS' && finishReason !== 'STOP') {
    return { ...provisional(0, 'unclassified', 502, blocked), alert: 'unclassified' };
  }

  const truncated = finishReason === 'MAX_TOKENS';
  const actual = usage ? actualFromPriceRow(priceRow, outcome, readerWorst) : null;
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
  STOPPED: failure(503, 'managed_unavailable'),
  STALE_PRICE: failure(503, 'managed_unavailable'),
  NO_PRICE: failure(503, 'managed_unavailable'),
  BUSY: failure(429, 'rate_limit', { retryAfterMs: RETRY_BUSY_MS }),
  KEY_REUSE: failure(422, 'request_failed', { keyReuse: true }),
};

export function createApi({
  ledger, provider, pricing = createPricing(), stripeWebhook, now = Date.now,
  clientIp, ipHashSecret, extensionIds = [], ceilingMicros = 2_000_000,
  isInMaintenance = () => false, forwardedProtoHeader, alert = console.warn,
}) {
  if (typeof clientIp !== 'function' || typeof ipHashSecret !== 'string' || !ipHashSecret) {
    throw new TypeError('A trusted client IP resolver and hash secret are required');
  }
  const origins = new Set([BETA_EXTENSION_ID, ...extensionIds].map((id) => {
    if (!/^[a-p]{32}$/.test(id)) throw new TypeError('Invalid extension ID');
    return `chrome-extension://${id}`;
  }));
  const replays = new Map();

  function bearerHash(request) {
    const match = /^Bearer (lwk_[A-Za-z0-9_-]{43})$/i.exec(request.headers.get('authorization') ?? '');
    return match ? sha256(match[1]) : null;
  }

  async function createAccount(request) {
    const raw = await readBoundedBytes(request);
    if (raw.tooLarge) return ok(413, bodyTooLarge());
    if (!raw.bytes || raw.bytes.length !== 0) return failure(400);
    const ip = clientIp(request);
    if (typeof ip !== 'string' || !ip) return failure(503, 'managed_unavailable');
    const token = newToken();
    const result = ledger.createAccount(sha256(token), {
      digestForDay(day) {
        const dailyKey = createHmac('sha256', ipHashSecret).update(day).digest();
        return createHmac('sha256', dailyKey).update(ip).digest('hex');
      },
    });
    return typeof result === 'string' ? ok(201, { accountId: result, token })
      : failure(429, 'rate_limit', { retryAfterMs: result.retryAfterMs });
  }

  function replay(reservationId, charged) {
    return replays.get(reservationId) ?? failure(409, 'request_failed', { duplicate: true, charged });
  }

  function claimResponse(claim) {
    if (claim.kind === 'DUPLICATE') return replay(claim.reservationId, claim.charged);
    if (claim.kind === 'KEY_REUSE') return ledgerFailure.KEY_REUSE;
    return ledgerFailure.BUSY;
  }

  function isHttpError(outcome) {
    return outcome.kind === 'http_error' || outcome.kind === 'no_response' && outcome.sent === false;
  }

  async function swap(request) {
    const json = await readJson(request);
    if (json.tooLarge) return ok(413, bodyTooLarge());
    const tokenHash = bearerHash(request);
    const accountId = tokenHash && ledger.authenticate(tokenHash);
    if (!accountId) return failure(401, 'managed_unauthorized');
    const input = json.value;
    const key = request.headers.get('idempotency-key');
    if (input === undefined || !key || !/^[a-fA-F0-9]{32}$/.test(key)) return failure(400);

    const keyHash = sha256(key);
    const bodyHash = sha256(canonicalSwapBody(input));
    ledger.expireStale();
    const prior = ledger.lookupClaim(accountId, keyHash, bodyHash);
    if (prior) return claimResponse(prior);

    if (!record(input)) return failure(400);
    if (input.promptVersion !== PROMPT_VERSION) {
      return failure(409, 'managed_update_required', { ahead: aheadOfCurrent(input.promptVersion) });
    }
    const args = validateSwap(input);
    if (!args) return failure(400);

    const built = buildSwapRequest(args);
    if (JSON.stringify(built).length > MAX_REQUEST_CHARS) {
      return failure(400, 'request_failed', { tooLarge: input.passages.length > 1 ? 'passages' : 'words' });
    }
    if (isInMaintenance()) return failure(503, 'managed_unavailable');
    built.generationConfig.maxOutputTokens = MAX_OUTPUT_TOKENS;
    const bytes = serializedRequestBytes(JSON.stringify(built));
    const model = input.model;

    function admit(priceRowId) {
      return ledger.reserve(accountId, null, null, priceRowId, ceilingMicros, keyHash, bodyHash, {
        model, tokenHash, requestBytes: bytes, maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
    }

    let admission = admit(pricing.priceRowHint(model, now())?.id ?? null);
    if (admission === 'STALE_PRICE') {
      admission = admit(ledger.getActivePriceRow(model)?.id ?? null);
    }
    if (typeof admission === 'string') return ledgerFailure[admission];
    if (admission.kind !== 'RESERVED') return claimResponse(admission);

    const { reservationId: id, priceRow, readerWorst } = admission;
    let firstFinished = false;
    let pendingLate = null;
    function reconcileLate(outcome) {
      const cost = isHttpError(outcome) ? 0 : meter(priceRow, outcome, bytes, readerWorst).provider;
      ledger.reconcile(id, cost, { providerRequestId: outcome.providerRequestId, usage: outcome.usage });
    }
    function receiveLate(outcome) {
      if (!firstFinished) {
        pendingLate = outcome;
        return;
      }
      try {
        reconcileLate(outcome);
      } catch {
        alert({ reason: 'reconcile_failed', reservationId: id });
      }
    }

    let outcome;
    try {
      outcome = await provider.call({ model, request: built, timeoutMs: PROVIDER_TIMEOUT_MS, onLateOutcome: receiveLate });
      if (!outcome) outcome = { kind: 'no_response', sent: true };
    } catch {
      outcome = { kind: 'no_response', sent: true };
    }
    let response;
    let winner;
    try {
      if (isHttpError(outcome)) {
        const category = outcome.status === 429 ? 'rate_limit' : outcome.status === 503 ? 'overloaded' : 'request_failed';
        winner = ledger.release(id, { providerRequestId: outcome.providerRequestId, reason: category });
        if (!winner.won) {
          reconcileLate(outcome);
          return replay(id, winner.costMicros > 0);
        }
        const retryAfterMs = outcome.retryAfterMs;
        const extras = Number.isSafeInteger(retryAfterMs) && retryAfterMs > 0 && retryAfterMs <= MAX_RETRY_MS
          ? { retryAfterMs } : undefined;
        response = failure(outcome.status === 429 || outcome.status === 503 ? outcome.status : 502, category, extras);
      } else {
        const charge = meter(priceRow, outcome, bytes, readerWorst);
        winner = ledger.settle(id, charge.reader, charge.provider, charge.reason, charge.details);
        if (!winner.won) {
          reconcileLate(outcome);
          return replay(id, winner.costMicros > 0);
        }
        if (charge.alert) alert({ reason: charge.alert, reservationId: id });

        const text = charge.status === 200 ? safeProviderText(outcome.text, input.passages) : null;
        if (text !== null) {
          const usage = outcome.usage ? {
            promptTokens: outcome.usage.promptTokenCount,
            outputTokens: outcome.usage.candidatesTokenCount ?? 0,
            thoughtTokens: outcome.usage.thoughtsTokenCount ?? 0,
          } : null;
          response = ok(200, { text, usage, costMicros: winner.costMicros, balanceMicros: winner.balanceMicros });
        } else {
          response = failure(charge.status === 200 ? 502 : charge.status, 'request_failed', charge.error);
        }
      }
    } finally {
      firstFinished = true;
      if (pendingLate) {
        receiveLate(pendingLate);
        pendingLate = null;
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
      const forwarded = forwardedProtoHeader && request.headers.get(forwardedProtoHeader);
      if (forwarded ? forwarded.toLowerCase() !== 'https' : url.protocol !== 'https:') result = failure(400);
      else if (request.method === 'OPTIONS' && ['/v0/accounts', '/v0/balance', '/v0/swaps'].includes(url.pathname)) {
        return new Response(null, { status: 204, headers });
      } else if (request.method === 'POST' && url.pathname === '/v0/accounts') {
        result = await createAccount(request);
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

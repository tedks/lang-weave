import { MAX_REQUEST_CHARS } from './adaptive.js';
import { parseSwapsResponse } from './gemini.js';
import { bundledLanguage } from './language-name.js';
import { validateBatchSwaps } from './levels.js';
import { MAX_RETRY_MS, STATUS_CATEGORIES, readBoundedBody } from './quota-status.js';
import { buildSwapRequest, canonicalSwapBody } from './swap-request.js';

// Reserved for the stubbed tracer. A real origin requires the launch decision.
export const MANAGED_BASE = 'https://managed.lang-weave.invalid';
export const MANAGED_MODEL = 'gemini-3.5-flash-lite';
export const MANAGED_PROMPT_VERSION = '0.16';
const TIMEOUT_MS = 30_000;
const IDEMPOTENCY_MS = 60_000;
const MAX_WIRE_BYTES = 192 * 1024;
const IDEMPOTENCY_STORE_KEY = 'managedBatchKeys';
const encoder = new TextEncoder();

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const failure = (category = 'request_failed', details = {}) =>
  Object.assign(new Error('Managed reading request failed'), { category, ...details });

// The reading worker serializes model calls. Keep only hashes and random keys in
// session storage so a service-worker wake can recover a key without page text.
async function idempotencyKey(keyStore, digest, now, replace) {
  try {
    const data = await keyStore.get([IDEMPOTENCY_STORE_KEY]);
    const recent = Object.fromEntries(Object.entries(data[IDEMPOTENCY_STORE_KEY] || {})
      .filter(([, entry]) => entry.until > now && entry.until <= now + IDEMPOTENCY_MS));
    if (!replace && recent[digest]) return recent[digest].key;
    const key = hex(crypto.getRandomValues(new Uint8Array(16)));
    recent[digest] = { key, until: now + IDEMPOTENCY_MS };
    await keyStore.set({ [IDEMPOTENCY_STORE_KEY]: recent });
    return key;
  } catch { throw failure('storage_failed'); }
}

async function proxyFailure(response) {
  let error;
  try { error = JSON.parse(await readBoundedBody(response))?.error; } catch { /* optional details */ }
  const category = error?.category !== 'ok' && STATUS_CATEGORIES.has(error?.category) ? error.category : 'request_failed';
  const details = { status: response.status };
  for (const field of ['ahead', 'duplicate', 'charged', 'keyReuse', 'blocked', 'dailyCap'])
    if (typeof error?.[field] === 'boolean') details[field] = error[field];
  if (['body', 'passages', 'words'].includes(error?.tooLarge)) details.tooLarge = error.tooLarge;
  if (Number.isSafeInteger(error?.retryAfterMs) && error.retryAfterMs > 0 && error.retryAfterMs <= MAX_RETRY_MS)
    details.retryAfterMs = error.retryAfterMs;
  return failure(category, details);
}

export async function requestManagedSwaps({ token, level, language, density = 'normal', unknownLimit = false,
    shownToday = [], words, batch, keyStore, fetchImpl = globalThis.fetch, now = Date.now }) {
  if (!token) throw failure('managed_unauthorized');
  if (words.length > 400) throw failure();
  const catalogSource = bundledLanguage(language) ? 'bundled' : 'pack';
  const wordRows = words.map(({ fr, en, status, personalId }) => ({ fr, en, status,
    source: personalId ? 'personal' : catalogSource }));
  const forms = new Set(wordRows.map(({ fr }) => fr));
  const shown = [...new Set(shownToday.filter((word) => forms.has(word)))];
  const results = {};
  let dropped = false;

  async function dispatch(body, key) {
    try {
      return await fetchImpl(`${MANAGED_BASE}/v0/swaps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        credentials: 'omit',
        redirect: 'error',
      });
    } catch (error) {
      if (error?.stale || ['local_budget', 'storage_failed'].includes(error?.category)) throw error;
      throw failure();
    }
  }

  async function request(passages, canSplitResponse) {
    const split = async (canSplitChildren) => {
      const mid = Math.ceil(passages.length / 2);
      await request(passages.slice(0, mid), canSplitChildren);
      await request(passages.slice(mid), canSplitChildren);
    };
    const body = canonicalSwapBody({ promptVersion: MANAGED_PROMPT_VERSION, model: MANAGED_MODEL,
      level, language, density, gradual: unknownLimit, words: wordRows, shownToday: shown, passages });
    const bytes = encoder.encode(body);
    const prompt = buildSwapRequest({ level, language, density, unknownLimit, shownToday: shown, words, batch: passages });
    if (JSON.stringify(prompt).length > MAX_REQUEST_CHARS || bytes.length > MAX_WIRE_BYTES) {
      if (passages.length > 1) await split(canSplitResponse);
      else dropped = true;
      return;
    }
    const digest = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    let key = await idempotencyKey(keyStore, digest, now(), false);
    let response = await dispatch(body, key);
    let error = response.status === 200 ? null : await proxyFailure(response);
    if (error?.status === 422 && error.keyReuse) {
      key = await idempotencyKey(keyStore, digest, now(), true);
      response = await dispatch(body, key);
      error = response.status === 200 ? null : await proxyFailure(response);
    }
    if (error?.status === 400 && error.tooLarge && canSplitResponse && passages.length > 1) {
      await split(false);
      return;
    }
    if (error) throw error;
    try {
      const { text } = await response.json();
      Object.assign(results, validateBatchSwaps(level, passages, parseSwapsResponse(text), words, language, density));
    } catch { throw failure(); }
  }

  try {
    if (batch.length) await request(batch.map(({ id, text }) => ({ id, text })), true);
    if (dropped) throw failure();
  } catch (error) {
    if (!error.stale) error.partialResults = results;
    throw error;
  }
  return { results, model: MANAGED_MODEL };
}

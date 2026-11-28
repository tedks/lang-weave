import { parseRetryAfter } from '../../extension/src/quota-status.js';

const failedBeforeSend = () => ({ kind: 'http_error', status: 0, category: 'request_failed' });
const sentWithoutResponse = () => ({ kind: 'no_response', sent: true });

function usageMetadata(value) {
  const { promptTokenCount, candidatesTokenCount = 0, thoughtsTokenCount = 0 } = value ?? {};
  if (![promptTokenCount, candidatesTokenCount, thoughtsTokenCount]
    .every((count) => Number.isSafeInteger(count) && count >= 0)) return null;
  return { promptTokenCount, candidatesTokenCount, thoughtsTokenCount };
}

// The M1 adapter follows the AI Studio outcome table in section 6.3.
// An injected transport can prove a pre-send failure by rejecting with
// `sent: false`. An ordinary Fetch rejection cannot provide that proof.
export function createProvider({ baseUrl, credential, fetchImpl, now = Date.now } = {}) {
  const base = typeof baseUrl === 'string' ? URL.parse(baseUrl) : null;
  if (!base || base.protocol !== 'https:' || !base.hostname.endsWith('.invalid') ||
      base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/') ||
      typeof credential !== 'string' || !credential || typeof fetchImpl !== 'function') {
    throw new TypeError('An HTTPS fixture base URL, credential and transport are required');
  }

  const safeString = (value) => typeof value === 'string' && !value.includes(credential) ? value : null;
  const safeRequestId = (value) => /^[A-Za-z0-9._:-]{1,128}$/.test(value ?? '') ? safeString(value) : null;

  return {
    async call({ model, request, timeoutMs, onLateOutcome }) {
      let body;
      try {
        body = JSON.stringify(request);
      } catch {
        return failedBeforeSend();
      }

      const controller = new AbortController();
      let timer;
      let providerRequestId;
      let timedOut = false;
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve({ ...sentWithoutResponse(), providerRequestId });
          // Ordinary fetch stops reading on abort. A transport that can still
          // report a completed response uses the reservation's late callback.
          controller.abort();
        }, timeoutMs);
      });

      async function send() {
        let receivedHeaders = false;
        try {
          const response = await fetchImpl(`${base.href}${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': credential },
            body,
            signal: controller.signal,
            redirect: 'manual',
          });
          receivedHeaders = true;
          providerRequestId = safeRequestId(response.headers.get('x-request-id')) ?? undefined;
          if (response.status !== 200) {
            // An HTTP status is enough to classify the charge. Provider error
            // bodies can contain request data and are never used as diagnostics.
            void response.body?.cancel().catch(() => {});
            const category = response.status === 429 ? 'rate_limit'
              : response.status === 503 ? 'overloaded' : 'request_failed';
            const retry = parseRetryAfter(response.headers.get('retry-after'), now());
            return { kind: 'http_error', status: response.status, category,
              retryAfterMs: retry === undefined ? undefined : Math.ceil(retry), providerRequestId };
          }
          let data;
          try {
            data = await response.json();
          } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
          }

          const bodyRequestId = safeRequestId(data?.responseId);
          const distinctIds = bodyRequestId && providerRequestId && bodyRequestId !== providerRequestId
            ? [providerRequestId, bodyRequestId] : null;
          const candidate = data?.candidates?.[0];
          const parts = candidate?.content?.parts;
          const text = Array.isArray(parts)
            ? parts.filter((part) => !part?.thought && typeof part?.text === 'string')
              .map((part) => part.text).join('') : null;
          return {
            kind: 'ok',
            text: safeString(text),
            finishReason: safeString(candidate?.finishReason),
            blockReason: safeString(data?.promptFeedback?.blockReason),
            usage: usageMetadata(data?.usageMetadata),
            providerRequestId: bodyRequestId ?? providerRequestId,
            ...(distinctIds ? { providerRequestIds: distinctIds } : {}),
          };
        } catch (error) {
          if (error?.sent === false && !receivedHeaders) return failedBeforeSend();
          return { ...sentWithoutResponse(), providerRequestId };
        }
      }

      try {
        const sending = send().then((outcome) => {
          if (timedOut) onLateOutcome?.(outcome);
          return outcome;
        });
        return await Promise.race([sending, deadline]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

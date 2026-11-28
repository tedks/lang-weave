import { expect, spyOn, test } from 'bun:test';
import { createProvider } from '../src/provider.js';

const baseUrl = 'https://fixture.invalid/models/';
const credential = 'fake-provider-secret-credential';
const request = { generationConfig: { maxOutputTokens: 2048 } };
const callArgs = { model: 'gemini-3.5-flash-lite', request, timeoutMs: 1000 };

const candidate = (finishReason, text = 'example') =>
  ({ finishReason, content: { parts: [{ thought: true, text: 'internal' }, { text }] } });

test('maps 200 outcome classes and retains response IDs and only output text', async () => {
  for (const finishReason of ['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION']) {
    const provider = createProvider({ credential, baseUrl, fetchImpl: async (url, init) => {
      expect(url).toEndWith('/gemini-3.5-flash-lite:generateContent');
      expect(init.headers['x-goog-api-key']).toBe(credential);
      expect(init.redirect).toBe('manual');
      expect(JSON.parse(init.body)).toEqual(request);
      return Response.json({
        candidates: [candidate(finishReason)], usageMetadata: { promptTokenCount: 2 }, responseId: 'response-fixture',
      });
    } });
    expect(await provider.call(callArgs)).toEqual({
      kind: 'ok', finishReason, text: 'example', blockReason: null,
      usage: { promptTokenCount: 2, candidatesTokenCount: 0, thoughtsTokenCount: 0 },
      providerRequestId: 'response-fixture',
    });
  }
  const blocked = createProvider({ credential, baseUrl, fetchImpl: async () =>
    Response.json({ promptFeedback: { blockReason: 'SAFETY' } }) });
  expect(await blocked.call(callArgs)).toMatchObject({ kind: 'ok', blockReason: 'SAFETY', finishReason: null, usage: null });
  const missing = createProvider({ credential, baseUrl, fetchImpl: async () => Response.json({ candidates: [candidate('STOP')] }) });
  expect((await missing.call(callArgs)).usage).toBeNull();
});

test('bounded retry metadata is retained without propagating bodies or exceptions', async () => {
  const log = spyOn(console, 'warn');
  const errorLog = spyOn(console, 'error');
  const adapter = (fetchImpl) => createProvider({ credential, baseUrl, fetchImpl });
  try {
    const non200 = await adapter(async () => new Response(credential, {
      status: 429, headers: { 'retry-after': '2', 'x-request-id': credential },
    })).call(callArgs);
    const failed = await adapter(async () => { throw Object.assign(new Error(credential), { sent: false }); }).call(callArgs);
    const lost = await adapter(async () => { throw new Error(credential); }).call(callArgs);
    const echoed = await adapter(async () => Response.json({
      candidates: [candidate('STOP', credential)], responseId: credential,
    })).call(callArgs);
    expect(non200).toMatchObject({ kind: 'http_error', status: 429, category: 'rate_limit', retryAfterMs: 2000 });
    expect(failed).toEqual({ kind: 'http_error', status: 0, category: 'request_failed' });
    expect(lost).toMatchObject({ kind: 'no_response', sent: true });
    expect(echoed).toMatchObject({ kind: 'ok', text: null });
    expect(() => createProvider({ credential, fetchImpl: async () => null })).toThrow('fixture base URL');
    expect(() => createProvider({ credential, baseUrl })).toThrow('fixture base URL');
    expect(() => createProvider({ credential, baseUrl: 'https://provider.example.com/models/', fetchImpl: async () => null }))
      .toThrow('fixture base URL');
    expect(JSON.stringify([non200, failed, lost, echoed, log.mock.calls, errorLog.mock.calls])).not.toContain(credential);
    expect(log).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    errorLog.mockRestore();
  }
});

test('a response body timing out after headers is still sent and retains the request ID', async () => {
  let signal;
  const provider = createProvider({ credential, baseUrl, fetchImpl: async (_url, init) => {
    signal = init.signal;
    return new Response(new ReadableStream(), { headers: { 'x-request-id': 'timeout-id' } });
  } });
  expect(await provider.call({ ...callArgs, timeoutMs: 15 }))
    .toEqual({ kind: 'no_response', sent: true, providerRequestId: 'timeout-id' });
  expect(signal.aborted).toBeTrue();
});

test('a transport response that completes after its deadline reports the late outcome with its ID', async () => {
  const transport = Promise.withResolvers();
  const late = Promise.withResolvers();
  const provider = createProvider({ credential, baseUrl, fetchImpl: () => transport.promise });
  expect(await provider.call({ ...callArgs, timeoutMs: 10, onLateOutcome: late.resolve })).toMatchObject({
    kind: 'no_response', sent: true,
  });
  transport.resolve(Response.json({ candidates: [candidate('STOP')], responseId: 'late-response' }));
  expect(await late.promise).toMatchObject({ kind: 'ok', finishReason: 'STOP', providerRequestId: 'late-response' });
});

test('a body read failure after 200 headers keeps the request classified as sent', async () => {
  const transportError = Object.assign(new Error('fixture stream closed'), { sent: false });
  const provider = createProvider({ credential, baseUrl, fetchImpl: async () =>
    new Response(new ReadableStream({ start(controller) { controller.error(transportError); } })) });
  expect(await provider.call(callArgs)).toMatchObject({ kind: 'no_response', sent: true });
});

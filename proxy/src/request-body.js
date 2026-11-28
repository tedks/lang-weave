export const MAX_INBOUND_BYTES = 192 * 1024;

export async function readBoundedBytes(request) {
  if (Number(request.headers.get('content-length')) > MAX_INBOUND_BYTES) return { tooLarge: true };
  if (!request.body) return { bytes: Buffer.alloc(0) };

  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { bytes: Buffer.concat(chunks, length) };
      length += value.byteLength;
      if (length > MAX_INBOUND_BYTES) {
        void reader.cancel().catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    void reader.cancel().catch(() => {});
    return {};
  } finally {
    reader.releaseLock();
  }
}

export function bodyTooLarge() {
  return { error: { category: 'request_failed', tooLarge: 'body' } };
}

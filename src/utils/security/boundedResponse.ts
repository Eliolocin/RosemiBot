export class ResponseSizeError extends Error {}

export async function readBoundedResponse(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        completed = true;
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) throw new ResponseSizeError(`Response exceeds ${maxBytes} bytes`);
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    // Detaching the reader would leave an oversized response downloading in the background.
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

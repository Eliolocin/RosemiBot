export class ResponseSizeError extends Error {}

export async function readBoundedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) throw new ResponseSizeError(`Response exceeds ${maxBytes} bytes`);
      chunks.push(value);
    }
  } finally {
    // Detaching the reader would leave an oversized response downloading in the background.
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

import { Glob } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import { streamOpenAICompatibleSseChunks } from "@/providers/openaiCompatible/openaiCompatibleSse";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Builds an SSE response whose underlying source reports whether it was cancelled.
 *
 * @param close - Leave false to model a server that has not ended the body yet, which is the
 *   state every abandoned stream is really in.
 */
function sseResponse(payloads: string[], close: boolean): { response: Response; wasCancelled: () => boolean } {
  let cancelled = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(payload));
      }
      if (close) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  return { response: new Response(stream), wasCancelled: () => cancelled };
}

describe("SSE consumer releases abandoned response bodies", () => {
  it("cancels the body when the consumer stops iterating early", async () => {
    const { response, wasCancelled } = sseResponse(['data: {"id":"a"}\n\n'], false);

    for await (const _chunk of streamOpenAICompatibleSseChunks(response)) {
      break;
    }

    expect(wasCancelled()).toBe(true);
  });

  it("leaves a stream that ended on its own alone", async () => {
    const { response, wasCancelled } = sseResponse(['data: {"id":"a"}\n\n'], true);

    const chunks = [];
    for await (const chunk of streamOpenAICompatibleSseChunks(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(wasCancelled()).toBe(false);
  });
});

/**
 * `releaseLock` reads like teardown but only detaches the reader: the body stays open and holds its
 * buffers and connection. Four adapters shipped that way and retained one stream source per
 * abandoned request, which only surfaced through a production heap diff.
 *
 * This is a source-level heuristic rather than a proof. It cannot tie a specific `getReader` call to
 * a specific `cancel`, so it catches the regression that actually happened (teardown reverting to
 * `releaseLock`, or a new reader with no teardown at all) and nothing subtler. It exists because
 * `novelaiService` and `safeHttpFetchEngine` reach their readers only through a live provider response or
 * the SSRF gate, which would otherwise leave those sites with no net at all.
 */
describe("no response body reader relies on releaseLock alone", () => {
  it("pairs every file that reads a response body with a cancel call", async () => {
    const offenders: string[] = [];

    for await (const file of new Glob("src/**/*.ts").scan(".")) {
      const source = await Bun.file(file).text();
      // Matches the BYOB form too, and does not assume the reader is named `reader`.
      if (!source.includes(".getReader(")) continue;
      if (!source.includes(".cancel(")) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});

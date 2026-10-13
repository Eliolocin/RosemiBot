import { describe, expect, it } from "bun:test";
import { readBoundedResponse, ResponseSizeError } from "@/utils/security/boundedResponse";

describe("bounded response reads", () => {
  it("accepts the exact byte ceiling without a Content-Length header", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      }),
    );
    expect(await readBoundedResponse(response, 4)).toEqual(Buffer.from([1, 2, 3, 4]));
  });
  it("cancels an unbounded stream as soon as actual bytes exceed the ceiling", async () => {
    let cancelled = false;
    let pulls = 0;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(3));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    await expect(readBoundedResponse(response, 4)).rejects.toBeInstanceOf(ResponseSizeError);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(3);
  });
});

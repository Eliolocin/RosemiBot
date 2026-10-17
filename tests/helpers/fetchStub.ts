import { spyOn } from "bun:test";

/** An IP literal skips DNS in the SSRF gate, so the stubbed global fetch is the only network hop. */
export const STUB_PUBLIC_HOST = "8.8.8.8";

/**
 * Replaces global fetch with `handler` until the returned spy is restored.
 *
 * Bun's `typeof fetch` also carries the static `preconnect`, so the handler is asserted to the real
 * signature here rather than at every call site.
 */
export function stubGlobalFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response,
) {
  return spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) =>
    handler(input, init)) as typeof fetch);
}

/**
 * A fetch that never answers on its own, so only the request's abort signal ends it.
 * Models a stalled transport: the caller's per-attempt timeout is what rejects it.
 */
export function stallUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });
}

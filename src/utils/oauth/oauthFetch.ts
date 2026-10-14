import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";

export type OAuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MAX_RESPONSE_BYTES = 128 * 1024;

export async function fetchOAuthJson(
  endpoint: string,
  init: RequestInit,
  options: { allowedOrigins: readonly string[]; timeoutMs?: number; fetchImpl?: OAuthFetch },
): Promise<{ response: Response; data: unknown }> {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || !options.allowedOrigins.includes(url.origin)) {
    throw new Error("OAuth endpoint is outside the approved origins.");
  }
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("OAuth response deadline exceeded.")), { once: true });
  });
  const request = { ...init, redirect: "manual" as const, signal };
  const pendingResponse = options.fetchImpl
    ? options.fetchImpl(url.toString(), request)
    : fetchUserRemoteUrl(url.toString(), request, { strict: true });
  const response = await Promise.race([
    pendingResponse.then((result) => {
      if (signal.aborted) {
        void result.body?.cancel().catch(() => {});
        signal.throwIfAborted();
      }
      return result;
    }),
    aborted,
  ]);
  const reader = response.body?.getReader();
  if (!reader) return { response, data: null };
  let bytes = 0;
  let body = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("OAuth response exceeded the size limit.");
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    try {
      return { response, data: JSON.parse(body) };
    } catch {
      return { response, data: null };
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

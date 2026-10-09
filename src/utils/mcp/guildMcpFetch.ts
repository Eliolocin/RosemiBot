import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import { ResponseSizeError } from "@/utils/security/boundedResponse";

const MAX_MCP_RESPONSE_BYTES = 8 * 1024 * 1024;

/** The SDK parses JSON and SSE after this byte counter, including discovery and internal checks. */
export function createGuildMcpFetch(endpoint: string): typeof fetchUserRemoteUrl {
  const origin = new URL(endpoint).origin;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin !== origin || url.username || url.password) {
      throw new Error("MCP transport requests must stay on the registered origin without URL credentials");
    }
    const response = await fetchUserRemoteUrl(input, { ...init, redirect: "error" });
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_MCP_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new ResponseSizeError(`MCP response exceeds ${MAX_MCP_RESPONSE_BYTES} bytes`);
    }
    if (!response.body) return response;
    let received = 0;
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > MAX_MCP_RESPONSE_BYTES)
            throw new ResponseSizeError(`MCP response exceeds ${MAX_MCP_RESPONSE_BYTES} bytes`);
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

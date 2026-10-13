import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { APIError, Smithery } from "@smithery/api";
import { createConnection, SmitheryAuthorizationError } from "@smithery/api/mcp";
import { createGuildMcpFetch } from "@/utils/mcp/guildMcpFetch";
import { validateRemoteUrl } from "@/utils/security/remoteUrlSecurity";

/**
 * The only recipient of a guild's Smithery account key. Both SDK base URLs are passed explicitly
 * because it otherwise reads `SMITHERY_BASE_URL` and `SMITHERY_CONNECT_BASE_URL` from the
 * environment, which would let ambient configuration choose where the key goes. The SDK's
 * default Connect host (`smithery.run`) answers 404 for namespaces created on this API, while
 * `/connect` here serves them and the MCP endpoint `createConnection` builds.
 */
const SMITHERY_API_ORIGIN = "https://api.smithery.ai";
const SMITHERY_CONNECT_BASE_URL = `${SMITHERY_API_ORIGIN}/connect`;

/** The endpoint `createConnection` returns: `/connect/{namespace}/{connectionId}/mcp` on the API origin. */
const SMITHERY_MCP_PATH = /^\/connect\/[^/]+\/[^/]+\/mcp$/;

/**
 * `createConnection`'s default session marker. Smithery Connect is stateless, so a preset session ID
 * makes the MCP client skip the initialize handshake, as the SDK helper does.
 */
const SMITHERY_STATELESS_SESSION_ID = "smithery-stateless";

/** A Smithery key needs its managed transport, so it cannot become a direct bearer token. */
export function isSmitheryUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".run.tools");
  } catch {
    return false;
  }
}

type SmitheryFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function createSmitherySetupFetch(deadline: AbortSignal): SmitheryFetch {
  const guarded = createGuildMcpFetch(SMITHERY_API_ORIGIN);
  return async (input, init) => {
    deadline.throwIfAborted();
    return await guarded(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
    });
  };
}

/**
 * Without a stable ID the SDK creates a new remote connection on every reconnect, and nothing
 * deletes them: one account accumulated thousands for a single server. Reusing one ID per
 * upstream URL also lets an administrator finish Smithery's authorization for the connection the
 * bot will use next. The hash keeps any secret in the URL's query out of the ID.
 */
function smitheryConnectionId(upstreamUrl: string): string {
  return `tomoribot-${new Bun.CryptoHasher("sha256").update(upstreamUrl).digest("hex").slice(0, 32)}`;
}

/**
 * Provider bodies, authorization links, and transport errors can echo the account key in encoded
 * forms that string redaction misses, so only fixed messages leave this module.
 */
function sanitizedSmitheryError(error: unknown, deadline: AbortSignal): Error {
  if (deadline.aborted) return new Error("Smithery connection timed out");
  if (error instanceof SmitheryAuthorizationError)
    return new Error("Smithery requires authorization for this server; complete it in Smithery, then retry");
  if (error instanceof APIError && typeof error.status === "number")
    return new Error(`Smithery API request failed with status ${error.status}`);
  return new Error("Smithery connection failed");
}

/**
 * Connects through Smithery Connect and discovers tools inside one deadline. The helper's
 * stateless transport sends no request until discovery, so a deadline covering only
 * `connect()` would leave a hanging transport unbounded.
 *
 * The connection lives in the account's first namespace, which Smithery creates when none
 * exists. Nothing here deletes remote connections or namespaces.
 */
export async function connectSmithery(
  clientName: string,
  upstreamUrl: string,
  apiKey: string,
  deadline: AbortSignal,
): Promise<{ client: MCPClient; functionNames: string[] }> {
  const upstream = await validateRemoteUrl(upstreamUrl);
  if (!upstream.valid) throw new Error(upstream.details ?? "Smithery upstream URL failed runtime validation");

  let client: MCPClient | null = null;
  try {
    const smithery = new Smithery({
      apiKey,
      baseURL: SMITHERY_API_ORIGIN,
      connectBaseURL: SMITHERY_CONNECT_BASE_URL,
      fetch: createSmitherySetupFetch(deadline),
      // SDK retries back off on timers the deadline cannot interrupt.
      maxRetries: 0,
      // The SDK's default logger is the console, outside structured logging and its redaction.
      logLevel: "off",
    });
    const { url } = await createConnection({
      client: smithery,
      connectionId: smitheryConnectionId(upstreamUrl),
      mcpUrl: upstreamUrl,
    });
    const mcpUrl = new URL(url);
    if (
      mcpUrl.origin !== SMITHERY_API_ORIGIN ||
      !SMITHERY_MCP_PATH.test(mcpUrl.pathname) ||
      mcpUrl.username ||
      mcpUrl.password ||
      mcpUrl.search ||
      mcpUrl.hash
    ) {
      throw new Error("Smithery returned an unexpected MCP endpoint");
    }

    // The helper's own transport uses an unguarded fetch, so it is discarded unconnected.
    const transport = new StreamableHTTPClientTransport(mcpUrl, {
      fetch: createGuildMcpFetch(SMITHERY_API_ORIGIN),
      requestInit: { headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error" },
      sessionId: SMITHERY_STATELESS_SESSION_ID,
    });
    client = new MCPClient({ name: clientName, version: "1.0.0" });
    await client.connect(transport);
    const { tools } = await client.listTools(undefined, { signal: deadline });
    return { client, functionNames: tools.map((tool) => tool.name) };
  } catch (error) {
    // Closing aborts the transport's in-flight fetches, which a rejected request alone does not.
    await client?.close().catch(() => undefined);
    throw sanitizedSmitheryError(error, deadline);
  }
}

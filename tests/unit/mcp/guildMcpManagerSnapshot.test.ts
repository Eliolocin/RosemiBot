import { describe, expect, it, spyOn } from "bun:test";
import type { GuildMcpServerRow } from "@/types/db/schema";
import type { GuildMCPConnection } from "@/types/tool/mcpTypes";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { log } from "@/utils/misc/logger";
import { createGuildMcpFetch } from "@/utils/mcp/guildMcpFetch";
import * as remotePolicy from "@/utils/security/remoteUrlSecurity";
import { ResponseSizeError } from "@/utils/security/boundedResponse";

interface TestableGuildMcpManager {
  connectServer(config: GuildMcpServerRow): Promise<GuildMCPConnection | null>;
  connectWithFallback(...args: unknown[]): Promise<unknown>;
  disconnectGuildServer(serverId: number, name: string): Promise<void>;
}

describe("guild MCP transport receipt", () => {
  for (const transport of ["http", "sse"] as const) {
    it(`bounds discovery and internal checker receipt through the real ${transport} SDK transport`, async () => {
      const validation = spyOn(remotePolicy, "validateRemoteUrl").mockResolvedValue({
        valid: true,
        hostname: "mcp.example.org",
        resolvedAddresses: ["203.0.113.10"],
      });
      const decrypt = spyOn(toolRepository, "decryptMcpAuthToken").mockResolvedValue(null);
      const snapshot = spyOn(toolRepository, "updateMcpToolNameSnapshot").mockResolvedValue("updated");
      let mode: "valid" | "large" | "invalid" | "oversized" = "valid";
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const encoder = new TextEncoder();
      const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
        const url = new URL(String(input));
        if (init?.method === "DELETE") return new Response(null, { status: 202 });
        if ((init?.method ?? "GET") === "GET") {
          if (transport === "http") return new Response(null, { status: 405 });
          return new Response(
            new ReadableStream<Uint8Array>({
              start(stream) {
                controller = stream;
                stream.enqueue(encoder.encode("event: endpoint\ndata: /messages\n\n"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }
        if (transport === "sse" && url.pathname !== "/messages") return new Response(null, { status: 405 });
        const request = JSON.parse(String(init?.body)) as { id?: number; method: string };
        if (request.id === undefined) return new Response(null, { status: 202 });
        const result =
          request.method === "initialize"
            ? {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "fixture", version: "1" },
              }
            : request.method === "tools/list"
              ? {
                  tools: [
                    { name: "check_slop", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
                  ],
                }
              : mode === "invalid"
                ? { content: [{ type: "text", text: 7 }] }
                : {
                    content: [
                      {
                        type: "text",
                        text:
                          mode === "oversized"
                            ? "x".repeat(8 * 1024 * 1024)
                            : mode === "large"
                              ? "x".repeat(6 * 1024 * 1024)
                              : "accepted",
                      },
                    ],
                  };
        const body = JSON.stringify({ jsonrpc: "2.0", id: request.id, result });
        if (transport === "sse") {
          controller?.enqueue(encoder.encode(`event: message\ndata: ${body}\n\n`));
          return new Response(null, { status: 202 });
        }
        return new Response(body, { headers: { "content-type": "application/json" } });
      }) as typeof fetch);
      const manager = getGuildMcpManager();
      const row = {
        ...config(transport === "http" ? 910 : 911, `bounded-${transport}`),
        url: "https://mcp.example.org/mcp",
      };
      try {
        expect(await manager.getRegisteredTool(row)).not.toBeNull();
        const signal = new AbortController().signal;
        const result = await manager.callInternalRuleChecker(row, "fixture", signal);
        expect(result).toEqual({ content: [{ type: "text", text: "accepted" }] });
        mode = "large";
        const largeResult = (await manager.callInternalRuleChecker(row, "fixture", AbortSignal.timeout(2000))) as {
          content: Array<{ type: string; text: string }>;
        };
        expect(largeResult.content[0]?.text.length).toBe(6 * 1024 * 1024);
        mode = "invalid";
        await expect(manager.callInternalRuleChecker(row, "fixture", signal)).rejects.toThrow();
        mode = "oversized";
        // SSE stream errors do not reject pending SDK requests until cancellation or timeout.
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 200);
        try {
          await expect(manager.callInternalRuleChecker(row, "fixture", abort.signal)).rejects.toThrow();
        } finally {
          clearTimeout(timer);
        }
      } finally {
        await manager.disconnectGuildServer(42, row.name);
        fetchSpy.mockRestore();
        snapshot.mockRestore();
        decrypt.mockRestore();
        validation.mockRestore();
      }
    });
  }
  it("pins requests and rejects redirects, origin changes, credentials and oversized JSON/SSE before parsing", async () => {
    const validation = spyOn(remotePolicy, "validateRemoteUrl").mockResolvedValue({
      valid: true,
      hostname: "mcp.example.org",
      resolvedAddresses: ["203.0.113.10"],
    });
    const fetchSpy = spyOn(globalThis, "fetch");
    const guarded = createGuildMcpFetch("https://mcp.example.org/mcp");
    let cancelled = false;
    try {
      fetchSpy.mockResolvedValue(new Response('{"content":[]}', { headers: { "content-type": "application/json" } }));
      expect(
        await (await guarded("https://mcp.example.org/mcp", { headers: { Authorization: "Bearer fixture" } })).json(),
      ).toEqual({ content: [] });
      const [url, init] = fetchSpy.mock.calls[0] ?? [];
      expect(String(url)).toBe("https://203.0.113.10/mcp");
      expect(new Headers(init?.headers).get("host")).toBe("mcp.example.org");
      expect(init?.redirect).toBe("manual");
      fetchSpy.mockClear();
      for (const url of ["https://other.example.org/mcp", "https://user:secret@mcp.example.org/mcp"]) {
        await expect(guarded(url)).rejects.toThrow();
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://other.example.org/mcp" } }),
      );
      await expect(guarded("https://mcp.example.org/mcp")).rejects.toThrow();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const oversized = () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        });
      for (const type of ["application/json", "text/event-stream"]) {
        fetchSpy.mockResolvedValue(new Response("x".repeat(8 * 1024 * 1024), { headers: { "content-type": type } }));
        expect((await (await guarded("https://mcp.example.org/mcp")).text()).length).toBe(8 * 1024 * 1024);
        cancelled = false;
        fetchSpy.mockResolvedValue(new Response(oversized(), { headers: { "content-type": type } }));
        const response = await guarded("https://mcp.example.org/mcp");
        await expect(response.text()).rejects.toBeInstanceOf(ResponseSizeError);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(cancelled).toBe(true);
      }
      fetchSpy.mockResolvedValue(new Response(oversized(), { headers: { "content-length": String(9 * 1024 * 1024) } }));
      await expect(guarded("https://mcp.example.org/mcp")).rejects.toBeInstanceOf(ResponseSizeError);
      validation.mockResolvedValue({ valid: false, failureCode: "PRODUCTION_BLOCKED_ADDRESS" });
      fetchSpy.mockClear();
      await expect(guarded("https://mcp.example.org/mcp")).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      validation.mockRestore();
    }
  });

  it("refuses Smithery managed keys without starting a transport", async () => {
    const manager = getGuildMcpManager() as unknown as TestableGuildMcpManager;
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      await expect(
        manager.connectWithFallback("fixture", "https://fixture.run.tools/mcp", "fixture-key"),
      ).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

function config(id: number, name: string): GuildMcpServerRow {
  return {
    guild_mcp_id: id,
    server_id: 42,
    name,
    url: "https://example.com/mcp",
    auth_token: null,
    key_version: 1,
    is_enabled: true,
    server_type: null,
    last_discovered_tool_names: ["prior_tool"],
  };
}

describe("guild MCP lazy discovery snapshots", () => {
  it("returns the live connection before detached snapshot persistence settles", async () => {
    const manager = getGuildMcpManager() as unknown as TestableGuildMcpManager;
    const row = config(900, "snapshot-refresh-detached");
    const closeCalls: string[] = [];
    const client = {
      listTools: async () => ({ tools: [{ name: "read_wiki" }, { name: "open_repo" }] }),
      close: async () => closeCalls.push("close"),
    };
    let rejectSnapshot!: (reason?: unknown) => void;
    const pendingSnapshot = new Promise<"updated">((_, reject) => {
      rejectSnapshot = reject;
    });
    const decryptSpy = spyOn(toolRepository, "decryptMcpAuthToken").mockResolvedValue(null);
    const updateSpy = spyOn(toolRepository, "updateMcpToolNameSnapshot").mockReturnValue(pendingSnapshot);
    const connectSpy = spyOn(manager, "connectWithFallback").mockResolvedValue(client);
    const warnSpy = spyOn(log, "warn").mockImplementation(() => {});

    try {
      const result = await Promise.race([
        manager.connectServer(row),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100)),
      ]);
      expect(result).not.toBe("blocked");
      expect(result).not.toBeNull();
      if (result === "blocked" || result === null) throw new Error("Expected a live MCP connection");
      expect(result.functionNames).toEqual(["read_wiki", "open_repo"]);
      expect(updateSpy).toHaveBeenCalledWith(42, 900, ["read_wiki", "open_repo"]);
      expect(closeCalls).toEqual([]);

      rejectSnapshot(new Error("metadata persistence secret marker"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(closeCalls).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        "[GuildMcpManager] Tool-name snapshot refresh threw for MCP server ID 900 " +
          "on server 42; keeping the live connection",
      );
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secret marker");
    } finally {
      await manager.disconnectGuildServer(42, row.name);
      decryptSpy.mockRestore();
      updateSpy.mockRestore();
      connectSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("keeps the live connection when the best-effort snapshot refresh fails", async () => {
    const manager = getGuildMcpManager() as unknown as TestableGuildMcpManager;
    const row = config(901, "snapshot-refresh-failure");
    const closeCalls: string[] = [];
    const client = {
      listTools: async () => ({ tools: [{ name: "read_wiki" }, { name: "open_repo" }] }),
      close: async () => closeCalls.push("close"),
    };
    const decryptSpy = spyOn(toolRepository, "decryptMcpAuthToken").mockResolvedValue(null);
    const updateSpy = spyOn(toolRepository, "updateMcpToolNameSnapshot").mockResolvedValue("failed");
    const connectSpy = spyOn(manager, "connectWithFallback").mockResolvedValue(client);

    try {
      const connection = await manager.connectServer(row);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(connection?.guildMcpId).toBe(901);
      expect(connection?.functionNames).toEqual(["read_wiki", "open_repo"]);
      expect(updateSpy).toHaveBeenCalledWith(42, 901, ["read_wiki", "open_repo"]);
      expect(closeCalls).toEqual([]);
    } finally {
      await manager.disconnectGuildServer(42, row.name);
      decryptSpy.mockRestore();
      updateSpy.mockRestore();
      connectSpy.mockRestore();
    }
  });

  it("retains the previous snapshot when live tool discovery fails", async () => {
    const manager = getGuildMcpManager() as unknown as TestableGuildMcpManager;
    const row = config(902, "snapshot-discovery-failure");
    const client = {
      listTools: async () => {
        throw new Error("discovery failed");
      },
      close: async () => {},
    };
    const decryptSpy = spyOn(toolRepository, "decryptMcpAuthToken").mockResolvedValue(null);
    const updateSpy = spyOn(toolRepository, "updateMcpToolNameSnapshot");
    const connectSpy = spyOn(manager, "connectWithFallback").mockResolvedValue(client);

    try {
      expect(await manager.connectServer(row)).toBeNull();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(row.last_discovered_tool_names).toEqual(["prior_tool"]);
    } finally {
      await manager.disconnectGuildServer(42, row.name);
      decryptSpy.mockRestore();
      updateSpy.mockRestore();
      connectSpy.mockRestore();
    }
  });
});

import { describe, expect, it, spyOn } from "bun:test";
import type { GuildMcpServerRow } from "@/types/db/schema";
import type { GuildMCPConnection } from "@/types/tool/mcpTypes";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import * as configCache from "@/utils/cache/guildMcpConfigCache";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { log } from "@/utils/misc/logger";
import { createGuildMcpFetch } from "@/utils/mcp/guildMcpFetch";
import * as remotePolicy from "@/utils/security/remoteUrlSecurity";
import { ResponseSizeError } from "@/utils/security/boundedResponse";
import { stubGlobalFetch } from "../../helpers/fetchStub";

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
        const result = await manager.callInternalRuleChecker(row, "check_slop", "fixture", signal);
        expect(result).toEqual({ content: [{ type: "text", text: "accepted" }] });
        mode = "large";
        const largeResult = (await manager.callInternalRuleChecker(
          row,
          "check_slop",
          "fixture",
          AbortSignal.timeout(2000),
        )) as {
          content: Array<{ type: string; text: string }>;
        };
        expect(largeResult.content[0]?.text.length).toBe(6 * 1024 * 1024);
        mode = "invalid";
        await expect(manager.callInternalRuleChecker(row, "check_slop", "fixture", signal)).rejects.toThrow();
        mode = "oversized";
        // SSE stream errors do not reject pending SDK requests until cancellation or timeout.
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 200);
        try {
          await expect(manager.callInternalRuleChecker(row, "check_slop", "fixture", abort.signal)).rejects.toThrow();
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

describe("guild MCP connect failures", () => {
  it("records 401s as unauthorized, escalates the backoff, and keeps quarantine until an explicit re-enable", async () => {
    const manager = getGuildMcpManager();
    const row = { ...config(940, "rejected-token"), url: "https://mcp.example.org/mcp" };
    const validation = spyOn(remotePolicy, "validateRemoteUrl").mockResolvedValue({
      valid: true,
      hostname: "mcp.example.org",
      resolvedAddresses: ["203.0.113.10"],
    });
    const decrypt = spyOn(toolRepository, "decryptMcpAuthToken").mockResolvedValue("revoked");
    const record = spyOn(toolRepository, "recordMcpConnectFailure").mockResolvedValue({
      status: "failing",
      failingSince: new Date(0),
    });
    const warn = spyOn(log, "warn").mockImplementation(async () => {});
    const info = spyOn(log, "info").mockImplementation(async () => {});
    let attempts = 0;
    const fetchSpy = stubGlobalFetch((_input, init) => {
      if ((init?.method ?? "GET") === "POST") attempts++;
      return new Response(null, { status: 401 });
    });
    let now = 1_000_000;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      expect(await manager.getRegisteredTool(row)).toBeNull();
      expect(record.mock.calls[0]?.[2]).toBe("unauthorized");
      const dialed = attempts;
      expect(dialed).toBeGreaterThan(0);

      now += 5 * 60_000;
      expect(await manager.getRegisteredTool(row)).toBeNull();
      expect(record).toHaveBeenCalledTimes(2);

      // The second failure backs off for 15 minutes, so 5 more minutes is still quarantined.
      now += 5 * 60_000;
      expect(await manager.getRegisteredTool(row)).toBeNull();
      expect(record).toHaveBeenCalledTimes(2);

      now += 10 * 60_000;
      record.mockResolvedValueOnce({ status: "auto-disabled", failingSince: new Date(0), serverDiscId: "fixture" });
      expect(await manager.getRegisteredTool(row)).toBeNull();
      expect(record).toHaveBeenCalledTimes(3);

      // A turn still holding the pre-disable row must not redial the dead server.
      expect(await manager.getRegisteredTool(row)).toBeNull();
      expect(record).toHaveBeenCalledTimes(3);

      // setEnabled disconnects on enable, which lifts the quarantine.
      await manager.disconnectGuildServer(row.server_id, row.name);
      expect(await manager.getRegisteredTool(row)).toBeNull();
      expect(record).toHaveBeenCalledTimes(4);
    } finally {
      await manager.disconnectGuildServer(row.server_id, row.name);
      clock.mockRestore();
      fetchSpy.mockRestore();
      info.mockRestore();
      warn.mockRestore();
      record.mockRestore();
      decrypt.mockRestore();
      validation.mockRestore();
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

function sessionFixture(withSession = true) {
  const manager = getGuildMcpManager();
  const row = { ...config(930, "session-recovery"), url: "https://mcp.example.org/mcp" };
  const validation = spyOn(remotePolicy, "validateRemoteUrl").mockResolvedValue({
    valid: true,
    hostname: "mcp.example.org",
    resolvedAddresses: ["203.0.113.10"],
  });
  const read = spyOn(configCache, "getGuildMcpConfigReadResult").mockResolvedValue({ status: "fresh", configs: [row] });
  const decrypt = spyOn(toolRepository, "decryptMcpAuthToken").mockResolvedValue(null);
  const snapshot = spyOn(toolRepository, "updateMcpToolNameSnapshot").mockResolvedValue("updated");
  const errors = spyOn(log, "error").mockImplementation(async () => {});
  const requests: Array<{ method: string; session: string | null }> = [];
  const expiredSessions = new Set<string>();
  let initializes = 0;
  let failure: { method: string; status: number } | undefined;
  const fetchSpy = stubGlobalFetch((_input, init) => {
    if ((init?.method ?? "GET") !== "POST") return new Response(null, { status: 405 });
    const rpc = JSON.parse(String(init?.body)) as { id?: number; method: string };
    const session = new Headers(init?.headers).get("mcp-session-id");
    requests.push({ method: rpc.method, session });
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    if (session && expiredSessions.has(session)) return Response.json({ error: "fixture rejection" }, { status: 404 });
    if (failure?.method === rpc.method) {
      const { status } = failure;
      failure = undefined;
      if (status === 404 && session) expiredSessions.add(session);
      return Response.json({ error: "fixture rejection" }, { status });
    }
    if (rpc.method === "initialize") {
      initializes++;
      return Response.json(
        {
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
          },
        },
        { headers: withSession ? { "mcp-session-id": `session-${initializes}` } : {} },
      );
    }
    return Response.json({
      jsonrpc: "2.0",
      id: rpc.id,
      result:
        rpc.method === "tools/list"
          ? { tools: [{ name: "check_slop", inputSchema: { type: "object" } }] }
          : { content: [{ type: "text", text: "accepted" }] },
    });
  });
  return {
    manager,
    row,
    requests,
    failNext(method: string, status: number) {
      failure = { method, status };
    },
    async restore() {
      await manager.disconnectGuildServer(row.server_id, row.name);
      for (const spy of [fetchSpy, errors, snapshot, decrypt, read, validation]) spy.mockRestore();
    },
  };
}

describe("guild MCP session recovery", () => {
  it.each([
    { status: 404, withSession: true, reconnects: true },
    { status: 404, withSession: false, reconnects: false },
    { status: 401, withSession: true, reconnects: false },
    { status: 500, withSession: true, reconnects: false },
  ])("handles HTTP $status with session=$withSession without replaying the tool", async ({
    status,
    withSession,
    reconnects,
  }) => {
    const fixture = sessionFixture(withSession);
    const { manager, row, requests } = fixture;
    try {
      expect(await manager.getRegisteredTool(row)).not.toBeNull();
      fixture.failNext("tools/call", status);
      expect((await manager.executeGuildMCPFunction(row.server_id, "check_slop", {})).success).toBe(false);
      expect(requests.filter((request) => request.method === "tools/call")).toHaveLength(1);
      expect((await manager.executeGuildMCPFunction(row.server_id, "check_slop", {})).success).toBe(true);
      const handshakes = requests.filter((request) => request.method === "initialize");
      expect(handshakes).toHaveLength(reconnects ? 2 : 1);
      expect(handshakes.every((request) => request.session === null)).toBe(true);
      expect(requests.filter((request) => request.method === "tools/call").map((request) => request.session)).toEqual(
        withSession ? ["session-1", reconnects ? "session-2" : "session-1"] : [null, null],
      );
    } finally {
      await fixture.restore();
    }
  });

  it.each(["tools/call", "tools/list"])("discards an expired session during internal %s requests", async (method) => {
    const fixture = sessionFixture();
    const { manager, row, requests } = fixture;
    try {
      const tool = await manager.getRegisteredTool(row);
      if (!tool) throw new Error("Expected a live MCP registration");
      fixture.failNext(method, 404);
      await expect(
        method === "tools/list"
          ? tool.tool()
          : manager.callInternalRuleChecker(row, "check_slop", "fixture", AbortSignal.timeout(2000)),
      ).rejects.toThrow();
      expect(await manager.getRegisteredTool(row)).not.toBeNull();
      expect(await manager.callInternalRuleChecker(row, "check_slop", "fixture", AbortSignal.timeout(2000))).toEqual({
        content: [{ type: "text", text: "accepted" }],
      });
      expect(requests.filter((request) => request.method === "initialize").map((request) => request.session)).toEqual([
        null,
        null,
      ]);
    } finally {
      await fixture.restore();
    }
  });
});

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
    const recordSpy = spyOn(toolRepository, "recordMcpConnectFailure").mockResolvedValue({
      status: "failing",
      failingSince: new Date(0),
    });
    const connectSpy = spyOn(manager, "connectWithFallback").mockResolvedValue(client);

    try {
      expect(await manager.connectServer(row)).toBeNull();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(row.last_discovered_tool_names).toEqual(["prior_tool"]);
    } finally {
      await manager.disconnectGuildServer(42, row.name);
      recordSpy.mockRestore();
      decryptSpy.mockRestore();
      updateSpy.mockRestore();
      connectSpy.mockRestore();
    }
  });
});

describe("guild MCP author routing", () => {
  it("never routes a Prose Linter registration's tools to the author", async () => {
    const linter: GuildMcpServerRow = {
      server_id: 42,
      guild_mcp_id: 7,
      name: "fixture-linter",
      url: "https://mcp.example.org/mcp",
      key_version: 1,
      is_enabled: true,
      server_type: "prose_linter",
      last_discovered_tool_names: ["check_slop", "check_slop_file"],
    };
    const read = spyOn(configCache, "getGuildMcpConfigReadResult").mockResolvedValue({
      status: "fresh",
      configs: [linter],
    });
    const manager = getGuildMcpManager();
    const discovery = spyOn(manager, "getRegisteredTool");
    try {
      expect((await manager.getGuildMCPRouting(42)).routes.size).toBe(0);
      expect(discovery).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      discovery.mockRestore();
    }
  });
});

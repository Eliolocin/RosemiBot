import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { GuildMcpServerRow } from "@/types/db/schema";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { connectSmithery } from "@/utils/mcp/smitheryConnection";
import * as remotePolicy from "@/utils/security/remoteUrlSecurity";
import { stubGlobalFetch } from "../../helpers/fetchStub";

const KEY = "smk_canary_7Qx/+=";
const KEY_FORMS = [KEY, encodeURIComponent(KEY), btoa(KEY)];
const API_ADDRESS = "203.0.113.20";
const UPSTREAM = "https://fixture.run.tools/mcp";

interface SeenRequest {
  host: string;
  pinnedHost: string;
  method: string;
  path: string;
  carriesKey: boolean;
  redirect: RequestRedirect | undefined;
  signal: AbortSignal | undefined;
  body: string;
}

type Route = (request: SeenRequest) => Response | Promise<Response> | undefined;

/** Answers the Smithery Connect REST and MCP routes the SDK uses, letting a test override any one of them. */
function smitheryFixture(override?: Route) {
  const seen: SeenRequest[] = [];
  const connections = new Set<string>();
  const fetchSpy = stubGlobalFetch(async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    const request: SeenRequest = {
      host: headers.get("host") ?? url.host,
      pinnedHost: url.hostname,
      method: init?.method ?? "GET",
      path: url.pathname,
      carriesKey: KEY_FORMS.some(
        (form) => [...headers.values()].some((value) => value.includes(form)) || body.includes(form),
      ),
      redirect: init?.redirect,
      signal: init?.signal ?? undefined,
      body,
    };
    seen.push(request);
    const overridden = await override?.(request);
    if (overridden) return overridden;
    if (request.path === "/namespaces") {
      return Response.json({ namespaces: [{ name: "fixture-ns", createdAt: "2026-01-01T00:00:00.000Z" }] });
    }
    const connection = /^\/connect\/[^/]+\/([^/]+)$/.exec(request.path)?.[1];
    if (connection && request.method === "GET") {
      return connections.has(connection)
        ? Response.json({ connectionId: connection, status: { state: "connected" } })
        : Response.json({ error: "Connection not found" }, { status: 404 });
    }
    if (connection && request.method === "PUT") {
      connections.add(connection);
      return Response.json({ connectionId: connection, status: { state: "connected" } }, { status: 201 });
    }
    if (request.path.endsWith("/mcp") && request.method === "POST") {
      const rpc = JSON.parse(body) as { id?: number; method: string };
      if (rpc.id === undefined) return new Response(null, { status: 202 });
      const result =
        rpc.method === "tools/list"
          ? {
              tools: [
                { name: "check_slop", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
              ],
            }
          : { content: [{ type: "text", text: "accepted" }] };
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
    }
    return new Response("unexpected fixture route", { status: 500 });
  });
  return { seen, fetchSpy };
}

function hangUntilAborted(request: SeenRequest): Promise<Response> {
  return new Promise((_, reject) => {
    request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
  });
}

function smitheryRow(id: number, name: string): GuildMcpServerRow {
  return {
    guild_mcp_id: id,
    server_id: 42,
    name,
    url: UPSTREAM,
    auth_token: Buffer.from("encrypted-fixture"),
    key_version: 1,
    is_enabled: true,
    server_type: null,
    last_discovered_tool_names: ["prior_tool"],
  };
}

function expectNoKeyIn(message: string): void {
  for (const form of KEY_FORMS) expect(message).not.toContain(form);
}

describe("Smithery Connect transport", () => {
  let validation: ReturnType<typeof spyOn>;
  const ambient = { base: process.env.SMITHERY_BASE_URL, connect: process.env.SMITHERY_CONNECT_BASE_URL };

  beforeEach(() => {
    validation = spyOn(remotePolicy, "validateRemoteUrl").mockImplementation(async (url) => ({
      valid: true,
      hostname: new URL(url).hostname,
      resolvedAddresses: [new URL(url).hostname === "api.smithery.ai" ? API_ADDRESS : "203.0.113.30"],
    }));
  });

  afterEach(() => {
    validation.mockRestore();
    process.env.SMITHERY_BASE_URL = ambient.base;
    process.env.SMITHERY_CONNECT_BASE_URL = ambient.connect;
    if (ambient.base === undefined) delete process.env.SMITHERY_BASE_URL;
    if (ambient.connect === undefined) delete process.env.SMITHERY_CONNECT_BASE_URL;
  });

  it("restores a saved registration, sending its key only to the pinned Smithery origin", async () => {
    process.env.SMITHERY_BASE_URL = "https://ambient.example.org";
    process.env.SMITHERY_CONNECT_BASE_URL = "https://ambient.example.org";
    const { seen, fetchSpy } = smitheryFixture();
    const decrypt = spyOn(toolRepository, "decryptMcpAuthToken").mockResolvedValue(KEY);
    const snapshot = spyOn(toolRepository, "updateMcpToolNameSnapshot").mockResolvedValue("updated");
    const manager = getGuildMcpManager();
    const row = smitheryRow(920, "restored-smithery");
    try {
      expect(await manager.getRegisteredTool(row, true)).not.toBeNull();
      expect(snapshot).toHaveBeenCalledWith(42, 920, ["check_slop"]);
      expect(await manager.callInternalRuleChecker(row, "fixture", AbortSignal.timeout(2000))).toEqual({
        content: [{ type: "text", text: "accepted" }],
      });
      expect(seen.some((request) => request.path.endsWith("/mcp"))).toBe(true);
      for (const request of seen) {
        expect(request.host).toBe("api.smithery.ai");
        expect(request.pinnedHost).toBe(API_ADDRESS);
        expect(request.redirect).toBe("manual");
      }
      expect(seen.filter((request) => request.carriesKey).length).toBe(seen.length);
      const put = seen.find((request) => request.method === "PUT");
      expect(JSON.parse(put?.body ?? "{}").mcpUrl).toBe(UPSTREAM);
      expect(put?.path).not.toContain("fixture.run.tools");
    } finally {
      await manager.disconnectGuildServer(42, row.name);
      fetchSpy.mockRestore();
      snapshot.mockRestore();
      decrypt.mockRestore();
    }
  });

  it("reuses one remote connection across reconnects and registration tests", async () => {
    const { seen, fetchSpy } = smitheryFixture();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { client, functionNames } = await connectSmithery("fixture", UPSTREAM, KEY, AbortSignal.timeout(2000));
        expect(functionNames).toEqual(["check_slop"]);
        await client.close();
      }
      expect(seen.filter((request) => request.method === "PUT").length).toBe(1);
      expect(new Set(seen.filter((request) => request.path.endsWith("/mcp")).map((request) => request.path)).size).toBe(
        1,
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("refuses redirects and unexpected MCP endpoints before the key leaves Smithery", async () => {
    for (const route of [
      (request: SeenRequest) =>
        request.path === "/namespaces"
          ? new Response(null, { status: 302, headers: { location: "https://elsewhere.example.org/namespaces" } })
          : undefined,
      (request: SeenRequest) =>
        request.path === "/namespaces" ? Response.json({ namespaces: [{ name: "a/b", createdAt: "x" }] }) : undefined,
    ]) {
      const { seen, fetchSpy } = smitheryFixture(route);
      try {
        await expect(connectSmithery("fixture", UPSTREAM, KEY, AbortSignal.timeout(2000))).rejects.toThrow();
        expect(seen.every((request) => request.host === "api.smithery.ai")).toBe(true);
        expect(seen.some((request) => request.path.endsWith("/mcp"))).toBe(false);
      } finally {
        fetchSpy.mockRestore();
      }
    }
  });

  it("rejects an oversized setup body before parsing and cancels its producer", async () => {
    let cancelled = false;
    const { fetchSpy } = smitheryFixture((request) =>
      request.path === "/namespaces"
        ? new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.enqueue(new Uint8Array(1024 * 1024));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { "content-type": "application/json" } },
          )
        : undefined,
    );
    try {
      await expect(connectSmithery("fixture", UPSTREAM, KEY, AbortSignal.timeout(5000))).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(cancelled).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("stops hung setup and hung discovery at one deadline", async () => {
    for (const hungPath of ["/namespaces", "/mcp"]) {
      const { seen, fetchSpy } = smitheryFixture((request) =>
        request.path.endsWith(hungPath) ? hangUntilAborted(request) : undefined,
      );
      try {
        await expect(connectSmithery("fixture", UPSTREAM, KEY, AbortSignal.timeout(100))).rejects.toThrow();
        const hung = seen.find((request) => request.path.endsWith(hungPath));
        expect(hung?.signal?.aborted).toBe(true);
        const settled = seen.length;
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(seen.length).toBe(settled);
      } finally {
        fetchSpy.mockRestore();
      }
    }
  });

  it("reports provider failures without credential echoes or authorization links", async () => {
    const echo = `${KEY_FORMS.join(" ")} https://authorize.example.org/setup?key=${encodeURIComponent(KEY)}`;
    for (const route of [
      (request: SeenRequest) =>
        request.path === "/namespaces" ? Response.json({ error: echo }, { status: 401 }) : undefined,
      (request: SeenRequest) =>
        request.method === "PUT"
          ? Response.json(
              { connectionId: "x", status: { state: "auth_required", authorizationUrl: echo, setupUrl: echo } },
              { status: 201 },
            )
          : undefined,
      (request: SeenRequest) =>
        request.method === "PUT"
          ? Response.json({ connectionId: "x", status: { state: "error", message: echo } }, { status: 201 })
          : undefined,
      (request: SeenRequest) => (request.path.endsWith("/mcp") ? new Response(echo, { status: 500 }) : undefined),
    ]) {
      const { fetchSpy } = smitheryFixture(route);
      try {
        const error = await connectSmithery("fixture", UPSTREAM, KEY, AbortSignal.timeout(2000)).then(
          () => null,
          (failure: unknown) => failure,
        );
        expect(error).toBeInstanceOf(Error);
        expectNoKeyIn((error as Error).message);
        expect((error as Error).message).not.toContain("authorize.example.org");
      } finally {
        fetchSpy.mockRestore();
      }
    }
  });

  it("keeps a failed saved registration's snapshot and quarantines it", async () => {
    const { seen, fetchSpy } = smitheryFixture((request) =>
      request.path === "/namespaces" ? new Response("unavailable", { status: 503 }) : undefined,
    );
    const decrypt = spyOn(toolRepository, "decryptMcpAuthToken").mockResolvedValue(KEY);
    const snapshot = spyOn(toolRepository, "updateMcpToolNameSnapshot");
    const manager = getGuildMcpManager();
    const row = smitheryRow(921, "failed-smithery");
    try {
      expect(await manager.getRegisteredTool(row, true)).toBeNull();
      const attempted = seen.length;
      expect(await manager.getRegisteredTool(row, true)).toBeNull();
      expect(seen.length).toBe(attempted);
      expect(snapshot).not.toHaveBeenCalled();
      expect(row.last_discovered_tool_names).toEqual(["prior_tool"]);
    } finally {
      await manager.disconnectGuildServer(42, row.name);
      fetchSpy.mockRestore();
      snapshot.mockRestore();
      decrypt.mockRestore();
    }
  });
});

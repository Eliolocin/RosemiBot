import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { getAvailableToolsWithMCP, type ToolStateForContext } from "@/tools/availability";
import type { GuildMcpServerRow } from "@/types/db/schema";
import type { CallableTool } from "@google/genai";
import { ToolRegistry } from "@/tools/toolRegistry";
import type { ToolContext, Tool } from "@/types/tool/interfaces";
import * as guildMcpConfigCache from "@/utils/cache/guildMcpConfigCache";
import * as dbClient from "@/utils/db/client";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import * as speechEndpointResolver from "@/utils/provider/speechEndpointResolver";
import * as crypto from "@/utils/security/crypto";
import { createPersona } from "../../helpers/fixtures";
import { stubLogMembers } from "../../helpers/mockSurface";
import { createToolPromptMacroResolver } from "@/utils/tools/toolPromptMacros";
import { applyDeliberateToolAllowlist } from "@/utils/tools/deliberateToolMode";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";

stubLogMembers({ warn: () => {}, info: () => {} });

function builtIn(name: string): Tool {
  return {
    name,
    description: `${name} fixture`,
    category: "search",
    requiresFeatureFlag: name === "manage_message" ? "manage_message" : "web_search",
    parameters: { type: "object", properties: {}, required: [] },
    isAvailableFor: () => true,
    execute: async () => ({ success: true }),
  };
}

const BUILT_INS = ["web_search", "fetch_url", "manage_message"].map(builtIn);

function stateForContext(): ToolStateForContext {
  const persona = createPersona();
  return {
    server_id: String(persona.server_id),
    activePersonaHasElevenlabsVoice: false,
    llm: persona.llm,
    config: persona.config,
  };
}

function guildServer(name: string, serverType: string | null): GuildMcpServerRow {
  return {
    guild_mcp_id: name === "reader" ? 1 : 2,
    server_id: 1,
    name,
    url: `https://${name}.example/mcp`,
    key_version: 1,
    is_enabled: true,
    server_type: serverType,
  };
}

describe("guild MCP replacement availability without a bundled MCP manager", () => {
  const guild = getGuildMcpManager();
  const pool = (guild as unknown as { pool: Map<string, import("@/types/tool/mcpTypes").GuildMCPConnection> }).pool;
  const effects: string[] = [];
  const declarations = new Map<string, string[]>();
  const schemas = new Map<string, Record<string, unknown>>();
  const calledArguments: Array<Record<string, unknown>> = [];
  let remoteResult: unknown;
  const discovery = spyOn(guild, "getRegisteredTool").mockImplementation(async (config) => {
    const functionNames = declarations.get(config.name) ?? [];
    const callable: CallableTool = {
      tool: async () => ({
        functionDeclarations: functionNames.map((name) => ({
          name,
          parametersJsonSchema: schemas.get(name) ?? {
            type: "object",
            properties: { target: { type: "string", format: "uri" } },
          },
        })),
      }),
      callTool: async () => [],
    };
    pool.set(`${config.server_id}:${config.name}`, {
      guildMcpId: config.guild_mcp_id ?? 0,
      serverId: config.server_id,
      name: config.name,
      client: {
        callTool: async (call: { arguments: Record<string, unknown> }) => {
          effects.push(config.name);
          calledArguments.push(call.arguments);
          return remoteResult;
        },
      },
      callableTool: callable,
      functionNames,
      connectedAt: 0,
      lastUsedAt: 0,
    });
    return callable;
  });
  const enabledConfigs = spyOn(guildMcpConfigCache, "getGuildMcpConfigReadResult");
  // Backend-slot lookups only gate media tools, which this suite does not register.
  const slots = spyOn(dbClient, "sql").mockImplementation((async () => []) as unknown as typeof dbClient.sql);
  const speech = spyOn(speechEndpointResolver, "resolveActiveSpeechEndpoint").mockResolvedValue(null);
  const optKey = spyOn(crypto, "hasOptApiKey").mockResolvedValue(false);

  beforeAll(initializeLocalizer);
  beforeEach(() => {
    declarations.clear();
    remoteResult = { content: [{ type: "text", text: "fixture" }] };
    schemas.clear();
    calledArguments.length = 0;
    effects.length = 0;
    pool.clear();
    ToolRegistry.clearRegistry();
    for (const tool of BUILT_INS) ToolRegistry.registerTool(tool);
    enabledConfigs.mockResolvedValue({ status: "fresh", configs: [] });
  });

  it("keeps selected unfamiliar schemas, macros, deliberate filtering and follow-up on the same service", async () => {
    const row = guildServer("reader", "url_fetcher");
    enabledConfigs.mockResolvedValue({ status: "fresh", configs: [row] });
    for (const name of ["fetch", "visit_site"]) {
      declarations.set("reader", [name]);
      const state = stateForContext();
      state.config.web_search_enabled = true;
      const available = await getAvailableToolsWithMCP(BUILT_INS, "google", state);
      const result = applyDeliberateToolAllowlist({
        providerLabel: "fixture",
        ...available,
        allowedToolNames: ["fetch_url"],
      });
      expect(result.mcpFunctionNames).toEqual([name]);
      const schemas = await (await guild.getGuildMCPTools(Number(state.server_id)))[0]?.tool();
      expect(schemas?.functionDeclarations?.[0]?.parametersJsonSchema).toEqual({
        type: "object",
        properties: { target: { type: "string", format: "uri" } },
      });
      const resolver = createToolPromptMacroResolver({
        provider: "google",
        stateForContext: state,
        deliberateToolAllowedNames: ["fetch_url"],
      });
      expect(await resolver.expand("Use {url_fetch_tool}")).toContain(name);
      expect(await ToolRegistry.requiresFollowUp(name, Number(state.server_id))).toBe(true);
    }
  });

  afterAll(() => {
    for (const spy of [discovery, enabledConfigs, slots, speech, optKey]) spy.mockRestore();
  });

  it("keeps native search and fetch when the guild selects no replacement", async () => {
    const result = await getAvailableToolsWithMCP(BUILT_INS, "google", stateForContext());

    expect(result.builtInTools.map((tool) => tool.name)).toEqual(["web_search", "fetch_url", "manage_message"]);
    expect(result.mcpFunctionNames).toEqual([]);
  });

  it("advertises a selected url_fetcher in place of fetch_url and hides colliding names", async () => {
    declarations.set("reader", ["fetch"]);
    declarations.set("notes", ["manage_message", "lookup_notes"]);
    enabledConfigs.mockResolvedValue({
      status: "fresh",
      configs: [guildServer("reader", "url_fetcher"), guildServer("notes", null)],
    });

    const result = await getAvailableToolsWithMCP(BUILT_INS, "google", stateForContext());

    expect(result.builtInTools.map((tool) => tool.name)).toEqual(["web_search", "manage_message"]);
    expect(result.mcpFunctionNames).toEqual(["fetch", "lookup_notes"]);
  });
  function context(enabled = true): ToolContext {
    return {
      channel: { id: "fixture" } as ToolContext["channel"],
      client: {} as ToolContext["client"],
      tomoriState: createPersona({ config: { web_search_enabled: enabled } }),
      locale: "en-US",
      provider: "google",
      suppressProgressNotices: true,
    };
  }

  it("reserves disabled built-ins and aliases and keeps non-colliding tools executable", async () => {
    declarations.set("notes", ["manage_message", "remember_this_fact", "lookup_notes"]);
    enabledConfigs.mockResolvedValue({ status: "fresh", configs: [guildServer("notes", null)] });
    const current = stateForContext();
    current.config.manage_message_enabled = false;
    const available = await getAvailableToolsWithMCP(BUILT_INS, "google", current);
    expect(available.mcpFunctionNames).toEqual(["lookup_notes"]);
    const executionContext = context();
    executionContext.tomoriState.config.manage_message_enabled = false;
    for (const name of ["manage_message", "remember_this_fact"]) {
      expect((await ToolRegistry.executeTool(name, {}, executionContext)).success).toBe(false);
    }
    expect(effects).toEqual([]);
    expect((await ToolRegistry.executeTool("lookup_notes", {}, executionContext)).success).toBe(true);
    expect(effects).toEqual(["notes"]);
  });

  for (const [family, canonical, names] of [
    ["url_fetcher", "fetch_url", ["fetch_url", "fetch", "visit_site"]],
    ["web_search", "web_search", ["web_search", "lookup_topics"]],
  ] as const) {
    for (const name of names)
      it(`routes selected ${family} tool ${name} with its discovered schema and switch`, async () => {
        declarations.set("reader", [name]);
        enabledConfigs.mockResolvedValue({ status: "fresh", configs: [guildServer("reader", family)] });
        const available = await getAvailableToolsWithMCP(BUILT_INS, "google", stateForContext());
        expect(available.builtInTools.some((tool) => tool.name === canonical)).toBe(false);
        expect(available.mcpFunctionNames).toContain(name);
        const declarationsForProvider = await guild.getGuildMCPTools(1);
        expect((await declarationsForProvider[0]?.tool())?.functionDeclarations?.[0]?.parametersJsonSchema).toEqual({
          type: "object",
          properties: { target: { type: "string", format: "uri" } },
        });
        expect((await ToolRegistry.executeTool(name, { query: "fixture" }, context())).success).toBe(true);
        effects.length = 0;
        for (let replay = 0; replay < 2; replay++)
          expect((await ToolRegistry.executeTool(name, {}, context(false))).success).toBe(false);
        expect(effects).toEqual([]);
        const disabled = stateForContext();
        disabled.config.web_search_enabled = false;
        expect((await getAvailableToolsWithMCP(BUILT_INS, "google", disabled)).mcpFunctionNames).not.toContain(name);
      });
  }

  it("blocks schema-identified metadata URLs before remote execution", async () => {
    declarations.set("reader", ["visit_site"]);
    enabledConfigs.mockResolvedValue({ status: "fresh", configs: [guildServer("reader", "url_fetcher")] });
    expect(
      (await ToolRegistry.executeTool("visit_site", { target: "http://169.254.169.254/latest" }, context())).success,
    ).toBe(false);
    expect(effects).toEqual([]);
  });

  it("preserves query and nested URL schemas without rewriting remote arguments", async () => {
    declarations.set("reader", ["lookup_topics"]);
    schemas.set("lookup_topics", {
      type: "object",
      properties: { terms: { type: "array", items: { type: "string" } }, limit: { type: "integer" } },
      required: ["terms"],
    });
    enabledConfigs.mockResolvedValue({ status: "fresh", configs: [guildServer("reader", "web_search")] });
    const args = { terms: ["fixture"], limit: 3 };
    expect((await ToolRegistry.executeTool("lookup_topics", args, context())).success).toBe(true);
    expect(calledArguments).toEqual([args]);
    schemas.set("lookup_topics", {
      type: "object",
      properties: { sources: { type: "array", items: { type: "object", properties: { url: { type: "string" } } } } },
    });
    expect(
      (
        await ToolRegistry.executeTool(
          "lookup_topics",
          { sources: [{ url: "http://169.254.169.254/latest" }] },
          context(),
        )
      ).success,
    ).toBe(false);
    expect(effects).toEqual(["reader"]);
  });

  it("keeps enabled built-ins from being intercepted by hidden general names", async () => {
    declarations.set("notes", ["manage_message", "fetch_url", "web_search", "remember_this_fact"]);
    enabledConfigs.mockResolvedValue({ status: "fresh", configs: [guildServer("notes", null)] });
    for (const name of ["manage_message", "fetch_url", "web_search"])
      expect((await ToolRegistry.executeTool(name, {}, context())).success).toBe(true);
    expect(effects).toEqual([]);
    expect(await guild.getGuildMCPTools(1)).toEqual([]);
  });

  it("keeps advertised built-ins and aliases executable when MCP reads are unavailable or stale", async () => {
    const memory = { ...builtIn("create_long_term_memory"), requiresFeatureFlag: "self_teaching" };
    ToolRegistry.registerTool(memory);
    const manage = BUILT_INS.find((tool) => tool.name === "manage_message");
    if (!manage) throw new Error("Missing managed-message fixture");
    const manageEffect = spyOn(manage, "execute");
    const memoryEffect = spyOn(memory, "execute");
    try {
      for (const status of ["unavailable", "stale"] as const) {
        enabledConfigs.mockResolvedValue(
          status === "unavailable"
            ? { status, configs: [] }
            : { status, configs: [guildServer("reader", "url_fetcher")] },
        );
        const state = stateForContext();
        state.config.manage_message_enabled = true;
        state.config.self_teaching_enabled = true;
        const available = await getAvailableToolsWithMCP([...BUILT_INS, memory], "google", state);
        expect(available.builtInTools).toContain(manage);
        expect(available.builtInTools).toContain(memory);
        expect(available.builtInTools.some((tool) => tool.name === "fetch_url" || tool.name === "web_search")).toBe(
          false,
        );
        expect(available.mcpFunctionNames).toEqual([]);
        const current = context();
        current.tomoriState.config.manage_message_enabled = true;
        current.tomoriState.config.self_teaching_enabled = true;
        expect((await ToolRegistry.executeTool("manage_message", {}, current)).success).toBe(true);
        expect((await ToolRegistry.executeTool("remember_this_fact", {}, current)).success).toBe(true);
        expect(manageEffect).toHaveBeenCalledTimes(1);
        expect(memoryEffect).toHaveBeenCalledTimes(1);
        for (const name of ["fetch_url", "web_search", "fetch", "lookup_notes"]) {
          const result = await ToolRegistry.executeTool(name, {}, current);
          expect(result.success).toBe(false);
          expect(result.error).toBe(localizedCopy("en-US", "tools.execution.unavailable", { tool: name }));
        }
        current.tomoriState.config.manage_message_enabled = false;
        current.tomoriState.config.self_teaching_enabled = false;
        expect((await ToolRegistry.executeTool("manage_message", {}, current)).success).toBe(false);
        expect((await ToolRegistry.executeTool("remember_this_fact", {}, current)).success).toBe(false);
        expect(manageEffect).toHaveBeenCalledTimes(1);
        expect(memoryEffect).toHaveBeenCalledTimes(1);
        expect(effects).toEqual([]);
        manageEffect.mockClear();
        memoryEffect.mockClear();
      }
    } finally {
      manageEffect.mockRestore();
      memoryEffect.mockRestore();
    }
  });

  it("validates remote envelopes before storage and retains structured results and errors", async () => {
    declarations.set("notes", ["lookup_notes"]);
    enabledConfigs.mockResolvedValue({ status: "fresh", configs: [guildServer("notes", null)] });
    remoteResult = { content: [{ type: "text", text: 7 }] };
    const invalid = await ToolRegistry.executeTool("lookup_notes", {}, context());
    expect(invalid.success).toBe(false);
    expect((invalid.data as Record<string, unknown> | undefined)?.rawResult).toBeUndefined();
    remoteResult = { content: [], structuredContent: { count: 7 } };
    const structured = await ToolRegistry.executeTool("lookup_notes", {}, context());
    expect(structured.success).toBe(true);
    expect(JSON.parse(String((structured.data as Record<string, unknown> | undefined)?.summary))).toEqual({ count: 7 });
    remoteResult = { content: [{ type: "text", text: "E_FIXTURE" }], isError: true };
    const failed = await ToolRegistry.executeTool("lookup_notes", {}, context());
    expect(failed.success).toBe(false);
    expect(failed.error).toContain("E_FIXTURE");
  });

  it("refuses ambiguous registrations and does not switch a selected unavailable family to native", async () => {
    declarations.set("reader", ["lookup_topics"]);
    declarations.set("notes", ["lookup_topics"]);
    enabledConfigs.mockResolvedValue({
      status: "fresh",
      configs: [guildServer("reader", null), guildServer("notes", null)],
    });
    expect((await ToolRegistry.executeTool("lookup_topics", {}, context())).success).toBe(false);
    expect((await getAvailableToolsWithMCP(BUILT_INS, "google", stateForContext())).mcpFunctionNames).toEqual([]);
    enabledConfigs.mockResolvedValue({
      status: "fresh",
      configs: [guildServer("reader", "web_search"), guildServer("notes", "web_search")],
    });
    expect((await ToolRegistry.executeTool("web_search", {}, context())).success).toBe(false);
    expect(effects).toEqual([]);
    enabledConfigs.mockResolvedValue({ status: "fresh", configs: [guildServer("reader", "url_fetcher")] });
    declarations.set("reader", []);
    expect((await ToolRegistry.executeTool("fetch_url", {}, context())).success).toBe(false);
  });

  it("revalidates removal and disabling before using a pooled registration", async () => {
    declarations.set("reader", ["fetch"]);
    enabledConfigs.mockResolvedValue({ status: "fresh", configs: [guildServer("reader", "url_fetcher")] });
    await getAvailableToolsWithMCP(BUILT_INS, "google", stateForContext());
    enabledConfigs.mockResolvedValue({ status: "fresh", configs: [] });
    expect((await ToolRegistry.executeTool("fetch", {}, context())).success).toBe(false);
    expect(effects).toEqual([]);
    expect((await ToolRegistry.executeTool("fetch_url", {}, context())).success).toBe(true);
  });
});

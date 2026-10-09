import { initializeLocalizer } from "@/utils/text/localizer";
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { type CallableTool, Type } from "@google/genai";
import { ToolRegistry } from "@/tools/toolRegistry";
import type { ToolContext } from "@/types/tool/interfaces";
import type { GuildMcpServerRow } from "@/types/db/schema";
import type { GuildMCPConnection } from "@/types/tool/mcpTypes";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createPersona } from "../../helpers/fixtures";
import { stubLogMembers } from "../../helpers/mockSurface";
import { ManageMessageTool } from "@/tools/functionCalls/manageMessageTool";
import { WebSearchTool } from "@/tools/webSearch/webSearchTool";
import * as searchDispatcher from "@/tools/webSearch/dispatcher";
import * as stateCache from "@/utils/cache/tomoriStateCache";
import * as mcpCache from "@/utils/cache/guildMcpConfigCache";
import { localizedCopy } from "../../helpers/localeCases";

stubLogMembers({ error: async () => {}, warn: () => {}, info: () => {}, success: () => {} });

function registration(): GuildMcpServerRow {
  return {
    guild_mcp_id: 91,
    server_id: 1,
    name: "fixture",
    url: "https://example.com/mcp",
    is_enabled: true,
    key_version: 1,
    server_type: null,
  };
}

describe("reviewed requests at real dispatch owners", () => {
  let cancelled = false;
  let effects: Array<{ name: string; args: Record<string, unknown> }>;
  let context: ToolContext;
  const guild = getGuildMcpManager();
  const guildRoute = spyOn(guild, "getGuildMCPRouting");
  const configRead = spyOn(mcpCache, "getGuildMcpConfigReadResult");

  beforeAll(initializeLocalizer);
  beforeEach(() => {
    cancelled = false;
    effects = [];
    ToolRegistry.clearRegistry();
    context = {
      channel: { id: "fixture-channel" } as ToolContext["channel"],
      client: {} as ToolContext["client"],
      tomoriState: createPersona(),
      locale: "en-US",
      provider: "review-fixture",
      suppressProgressNotices: true,
      messageIdMap: new MessageIdMap(),
      isExecutionCancelled: () => cancelled,
    };
    guildRoute.mockResolvedValue({ routes: new Map(), replaced: new Set() });
    configRead.mockResolvedValue({ status: "fresh", configs: [registration()] });
  });

  afterEach(() => {
    ToolRegistry.clearRegistry();
  });
  afterAll(() => {
    for (const spy of [guildRoute, configRead]) spy.mockRestore();
  });

  // These spies replace discovery only. The registry and guild MCP manager invoke real fake transports.
  const transport = (name: string, interruptOnDiscovery = false): CallableTool => ({
    tool: async () => {
      if (interruptOnDiscovery) cancelled = true;
      return { functionDeclarations: [{ name, parameters: { type: Type.OBJECT, properties: {} } }] };
    },
    callTool: async (calls) => {
      for (const call of calls) effects.push({ name: call.name ?? "", args: call.args ?? {} });
      return [{ functionResponse: { name, response: { completed: true } } }];
    },
  });

  it("prevents author dispatch of the configured internal checker", async () => {
    context.tomoriState.config.response_rule_checker_ref = {
      scope: "workspace",
      registrationId: 91,
      toolName: "check_slop",
    };
    const connection: GuildMCPConnection = {
      guildMcpId: 91,
      serverId: context.tomoriState.server_id,
      name: "fixture-checker",
      client: {},
      callableTool: transport("check_slop"),
      functionNames: ["check_slop"],
      connectedAt: 0,
      lastUsedAt: 0,
    };
    guildRoute.mockResolvedValue({
      replaced: new Set(),
      routes: new Map([["check_slop", { connection, config: registration() }]]),
    });
    expect((await ToolRegistry.executeTool("check_slop", { text: "PRIVATE_DRAFT" }, context)).success).toBe(false);
    expect(effects).toHaveLength(0);
  });

  it("fixes aliases and opaque targets before review and retains execution-time availability", async () => {
    ToolRegistry.registerTool({
      name: "create_long_term_memory",
      description: "Harmless memory fixture",
      category: "memory",
      parameters: { type: "object", properties: {}, required: [] },
      isAvailableFor: () => true,
      isAvailableForContext: (_provider, current) => current.userId === "allowed",
      execute: async (args) => {
        effects.push({ name: "create_long_term_memory", args });
        return { success: true };
      },
    });
    const opaque = context.messageIdMap?.register("900000000000000001", "ref");
    const prepared = await ToolRegistry.prepareToolRequest("remember_this_fact", { message_id: opaque }, context);
    context.preparedToolRequest = prepared;
    expect(prepared).toEqual({
      name: "create_long_term_memory",
      args: { message_id: "900000000000000001", __original_message_id: opaque },
    });
    expect((await ToolRegistry.executeTool(prepared.name, prepared.args, context)).success).toBe(false);
    expect(effects).toEqual([]);
    context.userId = "allowed";
    expect((await ToolRegistry.executeTool(prepared.name, prepared.args, context)).success).toBe(true);
    expect(effects).toEqual([prepared]);
  });

  for (const cancelAfterLookup of [false, true]) {
    it(`workspace MCP ${cancelAfterLookup ? "cancels after" : "executes after"} asynchronous connection lookup`, async () => {
      guildRoute.mockImplementation(async () => {
        cancelled = cancelAfterLookup;
        const connection: GuildMCPConnection = {
          guildMcpId: 91,
          serverId: context.tomoriState.server_id,
          name: "fixture",
          client: {
            callTool: async (call: { name: string; arguments: Record<string, unknown> }) => {
              effects.push({ name: call.name, args: call.arguments });
              return { content: [{ type: "text", text: "fixture-result" }] };
            },
          },
          callableTool: transport("fixture_lookup"),
          functionNames: ["fixture_lookup"],
          connectedAt: 0,
          lastUsedAt: 0,
        };
        return { replaced: new Set(), routes: new Map([["fixture_lookup", { connection, config: registration() }]]) };
      });
      const request = { name: "fixture_lookup", args: { target: "fixture", text: "Quiet note" } };
      context.preparedToolRequest = request;
      expect((await ToolRegistry.executeTool(request.name, request.args, context)).success).toBe(!cancelAfterLookup);
      expect(effects).toEqual(cancelAfterLookup ? [] : [request]);
    });
  }

  it("registry cancellation after route lookup blocks a built-in effect", async () => {
    ToolRegistry.registerTool({
      name: "fixture_action",
      description: "Harmless action",
      category: "utility",
      parameters: { type: "object", properties: {}, required: [] },
      isAvailableFor: () => true,
      execute: async (args) => {
        effects.push({ name: "fixture_action", args });
        return { success: true };
      },
    });
    guildRoute.mockImplementation(async () => {
      cancelled = true;
      return { routes: new Map(), replaced: new Set() };
    });
    expect((await ToolRegistry.executeTool("fixture_action", {}, context)).success).toBe(false);
    expect(effects).toEqual([]);
  });

  it("refuses accidental, hallucinated, stale and replayed disabled manage_message calls", async () => {
    const tool = new ManageMessageTool();
    const effect = spyOn(tool, "execute").mockResolvedValue({ success: true });
    ToolRegistry.registerTool(tool);
    context.provider = "google";
    context.tomoriState.config.manage_message_enabled = true;
    expect(ToolRegistry.getAvailableTools(context.provider, context)).toContain(tool);
    context.tomoriState.config.manage_message_enabled = false;
    for (let call = 0; call < 4; call++) {
      const result = await ToolRegistry.executeTool(
        "manage_message",
        { action: "delete", message_id: "fixture" },
        context,
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe(localizedCopy("en-US", "tools.execution.unavailable", { tool: "manage_message" }));
    }
    expect(effect).not.toHaveBeenCalled();
    context.tomoriState.config.manage_message_enabled = true;
    context.tomoriState.config.tool_use_enabled = false;
    expect((await ToolRegistry.executeTool("manage_message", {}, context)).success).toBe(true);
    effect.mockRestore();
  });

  it("rechecks guild flags after asynchronous routing while preserving personal provider state", async () => {
    const current = createPersona({ config: { manage_message_enabled: true } });
    const read = spyOn(stateCache, "getCachedTomoriState").mockResolvedValue(current);
    const tool = new ManageMessageTool();
    const effect = spyOn(tool, "execute").mockResolvedValue({ success: true });
    ToolRegistry.registerTool(tool);
    context.provider = "google";
    context.guildId = "fixture-guild";
    context.tomoriState.config.manage_message_enabled = true;
    guildRoute.mockImplementation(async () => {
      current.config.manage_message_enabled = false;
      return { routes: new Map(), replaced: new Set() };
    });
    try {
      expect((await ToolRegistry.executeTool("manage_message", {}, context)).success).toBe(false);
      expect(effect).not.toHaveBeenCalled();
      current.config.manage_message_enabled = true;
      guildRoute.mockImplementation(async () => {
        current.config.manage_message_enabled = false;
        throw new Error("Current MCP registrations unavailable");
      });
      expect((await ToolRegistry.executeTool("manage_message", {}, context)).success).toBe(false);
      expect(effect).not.toHaveBeenCalled();
      guildRoute.mockResolvedValue({ routes: new Map(), replaced: new Set() });
      current.config.manage_message_enabled = true;
      context.tomoriState.persona_nickname = "Mirri";
      context.tomoriState.llm.llm_codename = "personal-model";
      context.tomoriState.config.api_key = Buffer.from("personal-key");
      expect((await ToolRegistry.executeTool("manage_message", {}, context)).success).toBe(true);
      const executed = effect.mock.calls[0]?.[1];
      expect(executed?.tomoriState.persona_nickname).toBe("Mirri");
      expect(executed?.tomoriState.llm.llm_codename).toBe("personal-model");
      expect(executed?.tomoriState.config.api_key).toEqual(Buffer.from("personal-key"));
      effect.mockClear();
      read.mockRejectedValue(new Error("unavailable"));
      expect((await ToolRegistry.executeTool("manage_message", {}, context)).success).toBe(false);
      expect(effect).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      effect.mockRestore();
    }
  });

  it("checks declared bot permissions and model capabilities before effects", async () => {
    ToolRegistry.registerTool({
      name: "fixture_action",
      description: "Permission fixture",
      category: "utility",
      parameters: { type: "object", properties: {}, required: [] },
      requiredModelCapabilities: { sees_images: true },
      requiresPermissions: ["SEND_MESSAGES"],
      isAvailableFor: () => true,
      execute: async (args) => {
        effects.push({ name: "fixture_action", args });
        return { success: true };
      },
    });
    context.tomoriState.llm.sees_images = false;
    expect((await ToolRegistry.executeTool("fixture_action", {}, context)).success).toBe(false);
    context.tomoriState.llm.sees_images = true;
    expect((await ToolRegistry.executeTool("fixture_action", {}, context)).success).toBe(false);
    expect(effects).toEqual([]);
    context.client = { user: { id: "fixture-bot" } } as ToolContext["client"];
    context.channel = {
      id: "fixture-channel",
      permissionsFor: () => ({ has: () => true }),
    } as unknown as ToolContext["channel"];
    expect((await ToolRegistry.executeTool("fixture_action", {}, context)).success).toBe(true);
  });

  it("refuses retired engine names while search is off and preserves admitted engine execution", async () => {
    ToolRegistry.registerTool(new WebSearchTool());
    const search = spyOn(searchDispatcher, "executeWebSearchWithFallback").mockResolvedValue({
      success: true,
      message: "fixture result",
    });
    context.tomoriState.config.web_search_enabled = false;
    try {
      for (const name of [
        "web_search",
        "brave_web_search",
        "brave_image_search",
        "brave_video_search",
        "brave_news_search",
      ]) {
        expect((await ToolRegistry.executeTool(name, { query: "fixture" }, context)).success).toBe(false);
      }
      expect(search).not.toHaveBeenCalled();
      context.tomoriState.config.web_search_enabled = true;
      expect((await ToolRegistry.executeTool("web_search", { query: "fixture" }, context)).success).toBe(true);
      expect(search).toHaveBeenCalledTimes(1);
    } finally {
      search.mockRestore();
    }
  });
});

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { Collection, type Client, type Guild, type Sticker } from "discord.js";
import type { ToolContext } from "@/types/tool/interfaces";
import { StickerTool } from "@/tools/functionCalls/stickerTool";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { buildServerStickerContextItem } from "@/utils/text/context/serverAssets";
import { createToolPromptMacroResolver, resolvePromptCapabilityValues } from "@/utils/tools/toolPromptMacros";
import { createCustomExpression, createPersona } from "../../helpers/fixtures";

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});
const restores: Array<() => void> = [];

function fixture(customs = [createCustomExpression()]) {
  const guild = {
    id: "123456789012345678",
    stickers: { cache: new Collection<string, Sticker>(), fetch: async () => undefined },
  } as unknown as Guild;
  const client = {
    user: { id: "123456789012345679" },
    guilds: { cache: new Collection([[guild.id, guild]]) },
  } as unknown as Client;
  const state = createPersona({ persona_id: 3, config: { sticker_usage_enabled: true } });
  const context = {
    channel: { guild, permissionsFor: () => ({ has: () => false }) },
    client,
    tomoriState: state,
    activePersonaId: 3,
    provider: "google",
    locale: "en-US",
  } as unknown as ToolContext;
  const customSpy = spyOn(serverRepository, "loadCustomExpressions").mockResolvedValue(customs);
  const nativeSpy = spyOn(serverRepository, "loadStickersByInternalId").mockResolvedValue([]);
  restores.push(
    () => customSpy.mockRestore(),
    () => nativeSpy.mockRestore(),
  );
  return { guild, client, state, context, tool: new StickerTool() };
}

describe("custom sticker selection", () => {
  it("selects a custom-only server without external sticker permission and keeps transport private", async () => {
    const { context, tool } = fixture();
    const result = await tool.execute({ sticker_name: "wave_custom" }, context);
    expect(result.success).toBe(true);
    expect(result.stickerSelection?.kind).toBe("custom");
    expect(JSON.stringify(result.data)).not.toContain("https://");
    expect(JSON.stringify(result.data)).not.toContain("storage_reference");
    for (const overrides of [
      { provider: "novelai" },
      { isUserImpersonation: true },
      { tomoriState: createPersona({ config: { sticker_usage_enabled: false } }) },
    ]) {
      expect((await tool.execute({ sticker_name: "Wave custom" }, { ...context, ...overrides })).success).toBe(false);
    }
  });
  it("does not reveal restricted names in guessed-name, guessed-ID or retry results", async () => {
    const secret = createCustomExpression({
      name: "Confidential",
      name_key: "confidential",
      restricted: true,
      persona_ids: [8],
    });
    const { context, tool } = fixture([secret]);
    for (const args of [{ sticker_name: secret.name }, { sticker_id: secret.custom_expression_id }, {}]) {
      const result = await tool.execute(args, context);
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain(secret.name);
      expect(JSON.stringify(result)).not.toContain(secret.custom_expression_id);
    }
    expect((await tool.execute({ sticker_name: secret.name }, { ...context, activePersonaId: 8 })).success).toBe(true);
  });
  it("returns ambiguity when a native name later collides with a custom", async () => {
    const { guild, context, tool } = fixture();
    guild.stickers.cache.set("123456789012345680", {
      id: "123456789012345680",
      name: "Wave-custom",
      guildId: guild.id,
      available: true,
      createdTimestamp: 1,
    } as Sticker);
    const result = await tool.execute({ sticker_name: "Wave custom" }, context);
    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({ status: "sticker_name_ambiguous" });
  });
  it("lists every eligible custom in context while excluding media and access metadata", async () => {
    const customs = Array.from({ length: 32 }, (_, i) =>
      createCustomExpression({
        custom_expression_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        name: `Expression ${i}`,
        name_key: `expression ${i}`,
      }),
    );
    customs.push(createCustomExpression({ name: "Confidential", restricted: true, persona_ids: [] }));
    const { client, guild, state } = fixture(customs);
    const item = await buildServerStickerContextItem({
      client,
      guildId: guild.id,
      serverName: "Example",
      botName: "Mirri",
      isDMChannel: false,
      isUserImpersonation: false,
      tomoriConfig: state.config,
      tomoriState: state,
      preloadedStickers: [],
      preloadedCustomExpressions: customs,
      toolPromptMacroResolver: createToolPromptMacroResolver({
        provider: state.llm.llm_provider,
        stateForContext: { ...state, server_id: String(state.server_id), activePersonaHasElevenlabsVoice: false },
        availableToolNames: new Set(["select_sticker_for_response"]),
      }),
      convertMentions: async (text) => text,
    });
    const text = JSON.stringify(item);
    for (const row of customs.slice(0, 32)) expect(text).toContain(row.name);
    expect(text).not.toContain("Confidential");
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("delivery_kind");
    expect(text).not.toContain("persona_ids");
  });
  it("omits sticker context whenever the selection tool is unavailable for the turn", async () => {
    const { client, guild, state } = fixture();
    for (const overrides of [
      { deliberateToolAllowedNames: ["web_search"] },
      { availableToolNames: new Set<string>() },
      { capabilities: { tool_use: false } },
      {
        stateForContext: {
          ...state,
          server_id: String(state.server_id),
          activePersonaHasElevenlabsVoice: false,
          llm: { ...state.llm, has_tools: false },
        },
      },
    ]) {
      const item = await buildServerStickerContextItem({
        client,
        guildId: guild.id,
        serverName: "Example",
        botName: "Mirri",
        isDMChannel: false,
        isUserImpersonation: false,
        tomoriConfig: state.config,
        tomoriState: state,
        preloadedStickers: [],
        preloadedCustomExpressions: [createCustomExpression()],
        toolPromptMacroResolver: createToolPromptMacroResolver({
          provider: state.llm.llm_provider,
          capabilities: resolvePromptCapabilityValues(state.config),
          stateForContext: { ...state, server_id: String(state.server_id), activePersonaHasElevenlabsVoice: false },
          availableToolNames: new Set(["select_sticker_for_response"]),
          ...overrides,
        }),
        convertMentions: async (text) => text,
      });
      expect(item).toBeNull();
    }
  });
});

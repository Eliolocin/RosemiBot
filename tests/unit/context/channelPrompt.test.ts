import { describe, expect, test } from "bun:test";
import type { Client } from "discord.js";
import type { AssembledServerConfig } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { DEFAULT_SYSTEM_PROMPT, buildPromptContextItems } from "@/utils/text/context/templates";

const SERVER_PROMPT = "SERVER SYSTEM PROMPT";
const CHANNEL_PROMPT = "CHANNEL-SCOPED PROMPT";
const PERSONA_PROMPT = "PERSONA PROMPT";

/**
 * Builds the minimal params `buildPromptContextItems` reads. `convertMentions`
 * and `toolPromptMacroResolver` are identity passthroughs so assertions compare
 * against the raw prompt text.
 */
function makeParams(overrides: {
  systemPrompt?: string | null;
  channelPromptOverride?: { prompt: string; mode: "append" | "replace" } | null;
  personaPrompt?: string | null;
  presetOwnsSystemPrompt?: boolean;
}) {
  return {
    client: {} as Client,
    guildId: "guild-1",
    botName: "Tomori",
    tomoriAttributes: ["bullet one", "bullet two"],
    tomoriConfig: {
      system_prompt: overrides.systemPrompt ?? null,
      personal_memories_enabled: true,
    } as AssembledServerConfig,
    channelPromptOverride: overrides.channelPromptOverride ?? null,
    personaPrompt: overrides.personaPrompt ?? null,
    isUserImpersonation: false,
    impersonatedIdentityName: null,
    presetOwnsSystemPrompt: overrides.presetOwnsSystemPrompt ?? false,
    toolPromptMacroResolver: { expand: async (text: string) => text },
    convertMentions: async (text: string) => text,
  };
}

/** Returns the joined text of the first item carrying `tag`, or undefined. */
function textForTag(items: StructuredContextItem[], tag: ContextItemTag): string | undefined {
  const item = items.find((i) => i.metadataTag === tag);
  if (!item) return undefined;
  return item.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

describe("buildPromptContextItems — per-channel prompt override", () => {
  test("no override: system-prompt slot holds the server prompt; no channel block", async () => {
    const items = await buildPromptContextItems(makeParams({ systemPrompt: SERVER_PROMPT }));

    expect(textForTag(items, ContextItemTag.SYSTEM_HUMANIZER_RULES)).toBe(SERVER_PROMPT);
    expect(items.some((i) => i.metadataTag === ContextItemTag.SYSTEM_CHANNEL_PROMPT)).toBe(false);
  });

  test("append: keeps the server prompt and adds a distinct channel block right after it", async () => {
    const items = await buildPromptContextItems(
      makeParams({
        systemPrompt: SERVER_PROMPT,
        channelPromptOverride: { prompt: CHANNEL_PROMPT, mode: "append" },
      }),
    );

    expect(textForTag(items, ContextItemTag.SYSTEM_HUMANIZER_RULES)).toBe(SERVER_PROMPT);
    expect(textForTag(items, ContextItemTag.SYSTEM_CHANNEL_PROMPT)).toBe(CHANNEL_PROMPT);

    // The channel block must sit immediately after the humanizer block.
    const humanizerIndex = items.findIndex((i) => i.metadataTag === ContextItemTag.SYSTEM_HUMANIZER_RULES);
    const channelIndex = items.findIndex((i) => i.metadataTag === ContextItemTag.SYSTEM_CHANNEL_PROMPT);
    expect(channelIndex).toBe(humanizerIndex + 1);
  });

  test("append with no server prompt: appends to DEFAULT_SYSTEM_PROMPT", async () => {
    const items = await buildPromptContextItems(
      makeParams({
        systemPrompt: null,
        channelPromptOverride: { prompt: CHANNEL_PROMPT, mode: "append" },
      }),
    );

    expect(textForTag(items, ContextItemTag.SYSTEM_HUMANIZER_RULES)).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(textForTag(items, ContextItemTag.SYSTEM_CHANNEL_PROMPT)).toBe(CHANNEL_PROMPT);
  });

  test("replace: channel prompt takes over the system-prompt slot; no separate channel block", async () => {
    const items = await buildPromptContextItems(
      makeParams({
        systemPrompt: SERVER_PROMPT,
        channelPromptOverride: { prompt: CHANNEL_PROMPT, mode: "replace" },
      }),
    );

    expect(textForTag(items, ContextItemTag.SYSTEM_HUMANIZER_RULES)).toBe(CHANNEL_PROMPT);
    expect(items.some((i) => i.metadataTag === ContextItemTag.SYSTEM_CHANNEL_PROMPT)).toBe(false);
  });

  test("an active preset drops the stored server prompt and the default", async () => {
    for (const systemPrompt of [SERVER_PROMPT, null]) {
      const items = await buildPromptContextItems(makeParams({ systemPrompt, presetOwnsSystemPrompt: true }));

      expect(items.some((i) => i.metadataTag === ContextItemTag.SYSTEM_HUMANIZER_RULES)).toBe(false);
    }
  });

  test("replace survives even when the preset owns the system prompt", async () => {
    const items = await buildPromptContextItems(
      makeParams({
        systemPrompt: SERVER_PROMPT,
        presetOwnsSystemPrompt: true,
        channelPromptOverride: { prompt: CHANNEL_PROMPT, mode: "replace" },
      }),
    );

    // Replace must not be dropped by the suppress flag: it supplies the slot content.
    expect(textForTag(items, ContextItemTag.SYSTEM_HUMANIZER_RULES)).toBe(CHANNEL_PROMPT);
  });

  test("override never touches persona prompt or persona attributes", async () => {
    for (const mode of ["append", "replace"] as const) {
      const items = await buildPromptContextItems(
        makeParams({
          systemPrompt: SERVER_PROMPT,
          personaPrompt: PERSONA_PROMPT,
          channelPromptOverride: { prompt: CHANNEL_PROMPT, mode },
        }),
      );

      expect(textForTag(items, ContextItemTag.SYSTEM_PERSONA_PROMPT)).toBe(PERSONA_PROMPT);
      expect(textForTag(items, ContextItemTag.SYSTEM_PERSONALITY)).toBe("bullet one\nbullet two");
    }
  });

  test("omits prompt items that become empty after macro expansion", async () => {
    const params = makeParams({
      systemPrompt: "{{if capability:self_teaching}}memory instructions{{/if}}",
      personaPrompt: "{{if capability:self_teaching}}persona instructions{{/if}}",
    });
    params.tomoriAttributes = ["{{if capability:self_teaching}}attribute{{/if}}"];
    params.toolPromptMacroResolver = { expand: async () => "" };

    const items = await buildPromptContextItems(params);

    expect(items).toEqual([]);
  });
});

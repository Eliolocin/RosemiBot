import type { Client } from "discord.js";
import type { AssembledServerConfig, PersonaSpriteRow, TomoriState } from "@/types/db/schema";
import { ContextItemTag, type RequestSnapshot, type StructuredContextItem } from "@/types/misc/context";
import { getCachedPersonaSprites } from "@/utils/cache/personaSpriteCache";
import { PERSONA_SPRITE_LIMITS } from "@/utils/persona/sprites";
import type { MentionConverter } from "./templates";

const DEFAULT_USAGE_INSTRUCTIONS = "Use when this sprite fits the current emotion or situation.";

export function buildPersonaSpritePromptText(
  botName: string,
  sprites: readonly PersonaSpriteRow[],
  maxCount: number = PERSONA_SPRITE_LIMITS.PROMPT_MAX_COUNT,
): string | null {
  const usableSprites = sprites.slice(0, maxCount);
  if (usableSprites.length === 0) {
    return null;
  }

  const lines = [
    `Available sprites for ${botName}:`,
    "",
    `Use sprites to express emotions and identities better. To use a sprite, ${botName} must start a response line with this exact format:`,
    `\`${botName} ({sprite label}):\``,
    "",
    `If no listed sprite fits, respond normally as \`${botName}:\`.`,
    `A sprite stays active on later lines until another label appears; start a line with \`${botName}:\` to return to ${botName}'s default appearance.`,
    "",
    "Valid sprite labels:",
  ];

  for (const sprite of usableSprites) {
    const instructions = sprite.usage_instructions.trim() || DEFAULT_USAGE_INSTRUCTIONS;
    lines.push(`\`${botName} (${sprite.sprite_name}):\` ${instructions}`);
  }

  return lines.join("\n");
}

export async function buildPersonaSpriteContextItem(params: {
  client: Client;
  guildId: string;
  tomoriState?: TomoriState | null;
  tomoriConfig: AssembledServerConfig;
  botName: string;
  isUserImpersonation: boolean;
  snapshot?: RequestSnapshot;
  convertMentions: MentionConverter;
}): Promise<StructuredContextItem | null> {
  const personaId = params.tomoriState?.persona_id;
  if (params.isUserImpersonation || typeof personaId !== "number") {
    return null;
  }

  const sprites = await getCachedPersonaSprites(personaId);
  const promptText = buildPersonaSpritePromptText(params.botName, sprites);
  if (!promptText) {
    return null;
  }

  return {
    role: "system",
    parts: [
      {
        type: "text",
        // Same generic "User" stand-in as the persona prompt, so `{user}` reads identically in
        // attributes and sprite instructions.
        text: await params.convertMentions(
          promptText,
          params.client,
          params.guildId,
          "User",
          params.botName,
          params.tomoriConfig.personal_memories_enabled,
          params.snapshot,
        ),
      },
    ],
    metadataTag: ContextItemTag.KNOWLEDGE_PERSONA_SPRITES,
  };
}

import type { Client } from "discord.js";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { AssembledServerConfig, PersonaUserBlockRow, PersonaUserBlockType } from "@/types/db/schema";
import { formatTimeWithOffset, formatUTCOffset } from "@/utils/text/timezoneHelper";
import type { ToolPromptMacroResolver } from "@/utils/tools/toolPromptMacros";

/**
 * Expanded on its own, apart from the block lines, because those carry user-controlled names and
 * reasons that must never be parsed as conditionals or macros.
 */
const UNBLOCK_AFFORDANCE_TEMPLATE =
  "{{if tool:unblock_user}}Use {unblock_user_tool} to lift a block early if needed.{{/if}}";

export async function buildPersonaUserBlocksContextItem(params: {
  client: Client;
  guildId: string;
  botName: string;
  tomoriConfig: AssembledServerConfig;
  personaUserBlocks?: PersonaUserBlockRow[];
  toolPromptMacroResolver: ToolPromptMacroResolver;
}): Promise<StructuredContextItem | null> {
  const activeBlocks = params.personaUserBlocks ?? [];
  if (activeBlocks.length === 0) {
    return null;
  }

  const timezoneOffset = params.tomoriConfig.timezone_offset ?? 0;
  const lines = [
    `[System: Active persona-scoped user blocks for ${params.botName}:`,
    "These blocks affect only this persona. They are not deletion, forgetting, or memory redaction rules.",
  ];

  for (const block of activeBlocks) {
    const targetName = await resolveBlockedUserDisplayName(params.client, params.guildId, block.user_disc_id);
    const typeLabel = block.block_type;
    lines.push(
      "",
      `- Target: ${targetName} (Discord user ID: ${block.user_disc_id})`,
      `  Type: ${typeLabel}`,
      `  Effect: ${formatBlockEffect(block.block_type)}`,
      `  Duration window: ${formatBlockDurationHours(block)} hour(s)`,
      `  Expires: ${formatBlockExpiry(block.expires_at, timezoneOffset)}`,
      `  Reason: ${block.reason}`,
    );
  }

  const unblockAffordance = await params.toolPromptMacroResolver.expand(UNBLOCK_AFFORDANCE_TEMPLATE);
  if (unblockAffordance) lines.push("", unblockAffordance);
  lines.push("]");

  return {
    role: "system",
    parts: [{ type: "text", text: lines.join("\n") }],
    metadataTag: ContextItemTag.KNOWLEDGE_PERSONA_USER_BLOCKS,
  };
}

async function resolveBlockedUserDisplayName(client: Client, guildId: string, userDiscId: string): Promise<string> {
  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
  const member = guild ? await guild.members.fetch(userDiscId).catch(() => null) : null;
  const user = member?.user ?? (await client.users.fetch(userDiscId).catch(() => null));
  return member?.displayName ?? user?.globalName ?? user?.username ?? userDiscId;
}

function formatBlockEffect(blockType: PersonaUserBlockType): string {
  if (blockType === "mute") {
    return "The target cannot trigger this persona.";
  }
  return "The target cannot trigger this persona, and their recent live dialogue-history messages/media are hidden from this persona's context.";
}

function formatBlockDurationHours(block: PersonaUserBlockRow): number {
  const baseline = block.updated_at ?? block.created_at ?? new Date();
  return Math.max(1, Math.ceil((block.expires_at.getTime() - baseline.getTime()) / 3_600_000));
}

function formatBlockExpiry(expiresAt: Date, timezoneOffset: number): string {
  return `${formatTimeWithOffset(expiresAt, timezoneOffset, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })} (${formatUTCOffset(timezoneOffset)})`;
}

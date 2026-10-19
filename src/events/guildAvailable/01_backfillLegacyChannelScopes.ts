import type { Client, Guild } from "discord.js";
import { backfillLegacyChannelScopes } from "@/utils/memory/legacyChannelScopeBackfill";
import { log } from "@/utils/misc/logger";

/** Resolves a guild's pending legacy channel scopes when it returns from an outage after login. */
export default async (_client: Client, guild: Guild): Promise<void> => {
  try {
    await backfillLegacyChannelScopes((id) => (id === guild.id ? guild : undefined), guild.id);
  } catch (error) {
    log.error("Legacy channel scope backfill failed for a returning guild", error as Error);
  }
};

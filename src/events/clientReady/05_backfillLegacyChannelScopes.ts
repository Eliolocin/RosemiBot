import type { Client } from "discord.js";
import { backfillLegacyChannelScopes } from "@/utils/memory/legacyChannelScopeBackfill";
import { log } from "@/utils/misc/logger";

/** Resolves pending legacy channel scopes for every cached guild, so a deploy needs no manual step. */
export default async (client: Client): Promise<void> => {
  try {
    const { scoped, unmatched, deferred } = await backfillLegacyChannelScopes((id) => client.guilds.cache.get(id));
    if (scoped + unmatched + deferred === 0) return;
    log.info(
      `Legacy channel scope backfill: ${scoped} scoped, ${unmatched} unmatched (active in every channel until an admin picks channels), ${deferred} deferred`,
    );
  } catch (error) {
    log.error("Legacy channel scope backfill failed; pending rows retry on the next boot", error as Error);
  }
};

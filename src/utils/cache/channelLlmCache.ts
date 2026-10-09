/**
 * Channel LLM Override Cache
 * Provides in-memory TTL caching for per-channel LLM model overrides.
 * Prevents a DB query per-message for the channel override lookup step.
 *
 * Priority chain (highest → lowest):
 *   1. persona_llm  : persona-specific override stored in persona_configs
 *   2. channel LLM  : this cache / channel_llm_overrides table
 *   3. global llm   : server_model_configs.llm_id (the existing TomoriState.llm)
 */

import type { LlmRow } from "@/types/db/schema";
import { llmOverrideRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import {
  getChannelLlmCacheEntry,
  getChannelLlmCacheSize,
  clearChannelLlmCache,
  invalidateAllChannelLlmCacheForServer,
  invalidateChannelLlmCache,
  setChannelLlmCache,
} from "@/utils/cache/channelLlmCacheStore";

export {
  clearChannelLlmCache,
  getChannelLlmCacheSize,
  invalidateAllChannelLlmCacheForServer,
  invalidateChannelLlmCache,
  setChannelLlmCache,
};

async function getCachedOwnChannelLlm(serverId: number, channelDiscId: string): Promise<LlmRow | null> {
  const cached = getChannelLlmCacheEntry(serverId, channelDiscId);
  if (cached !== undefined) return cached;

  try {
    const llm = await llmOverrideRepo.getChannelLlmOverride(serverId, channelDiscId);
    setChannelLlmCache(serverId, channelDiscId, llm);
    return llm;
  } catch (error) {
    log.error(`[ChannelLlmCache] Failed to fetch channel LLM override for ${serverId}:${channelDiscId}:`, error);
    return null;
  }
}

/**
 * Gets the channel-level LLM override for a given server/channel pair.
 * Checks the in-memory cache first; falls back to the database on miss.
 * Caches negative results (null) to avoid repeated DB round-trips for channels without overrides.
 *
 * A thread with no override of its own inherits its parent channel's. Each id is cached under its
 * own key, so changing the parent's override only needs to evict the parent's entry: a thread's
 * cached null never shadows the new value because the parent is looked up separately every time.
 *
 * @param serverId - Database integer server ID
 * @param channelDiscId - Discord channel snowflake ID
 * @param parentChannelDiscId - Parent channel snowflake when `channelDiscId` is a thread
 * @returns The overriding LlmRow, or null if no channel override is set
 */
export async function getCachedChannelLlm(
  serverId: number,
  channelDiscId: string,
  parentChannelDiscId?: string | null,
): Promise<LlmRow | null> {
  const own = await getCachedOwnChannelLlm(serverId, channelDiscId);
  if (own || !parentChannelDiscId) return own;
  return getCachedOwnChannelLlm(serverId, parentChannelDiscId);
}

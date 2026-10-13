import type { Guild } from "discord.js";
import type { CustomExpressionRow, ServerEmojiRow, ServerStickerRow } from "@/types/db/schema";
import { serverRepository } from "@/utils/db/repositories";
import { log } from "../misc/logger";
import { lazySyncGuildEmojis } from "./emojiLazySync";
import { lazySyncGuildStickers } from "./stickerLazySync";

/**
 * Cache entry structure for emoji/sticker data per server
 * Includes timestamp for TTL (Time To Live) expiration tracking
 */
interface EmojiStickerCacheEntry {
  emojis: ServerEmojiRow[];
  stickers: ServerStickerRow[];
  customs: CustomExpressionRow[];
  emojisLoaded: boolean;
  stickersLoaded: boolean;
  cachedAt: number; // Timestamp in milliseconds
}

/**
 * In-memory cache map: server_id → cache entry
 * Reduces database queries from 4 per message to 0 (cache hit)
 */
const cache = new Map<number, EmojiStickerCacheEntry>();

// 10 minutes balances freshness against performance: 99% of messages should hit cache.
const MEMORY_CACHE_DURATION_MS = 10 * 60 * 1000;

/**
 * Cache statistics for monitoring
 */
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Loads emoji/sticker data with configurable in-memory cache (default 10 min)
 * Falls back to DB query and lazy sync if cache miss or stale
 *
 * Cache flow:
 * 1. Check in-memory cache
 *    - HIT & FRESH (within TTL) → Return immediately (0 DB queries)
 *    - MISS or STALE → Continue to step 2
 * 2. Lazy sync from Discord if needed (24hr cache check)
 * 3. Load from DB
 * 4. Cache in memory for next requests
 *
 * @param serverId - Internal database server ID
 * @param guild - Discord Guild object (for lazy sync if needed)
 * @param emojiUsageEnabled - Whether emoji usage is enabled for this server
 * @param stickerUsageEnabled - Whether sticker usage is enabled for this server
 * @returns Object containing emojis and stickers arrays (or null if disabled/error)
 */
export async function loadEmojiStickerCache(
  serverId: number,
  guild: Guild,
  emojiUsageEnabled: boolean,
  stickerUsageEnabled: boolean,
): Promise<{
  emojis: ServerEmojiRow[] | null;
  stickers: ServerStickerRow[] | null;
  customs: CustomExpressionRow[] | null;
}> {
  if (!emojiUsageEnabled && !stickerUsageEnabled) {
    return { emojis: null, stickers: null, customs: null };
  }

  const now = Date.now();
  const cachedEntry = cache.get(serverId);

  if (cachedEntry) {
    // Check if cache is still fresh (< 5 minutes old)
    const cacheAge = now - cachedEntry.cachedAt;
    if (
      cacheAge < MEMORY_CACHE_DURATION_MS &&
      (!emojiUsageEnabled || cachedEntry.emojisLoaded) &&
      (!stickerUsageEnabled || cachedEntry.stickersLoaded)
    ) {
      cacheHits++;
      return {
        emojis: emojiUsageEnabled ? cachedEntry.emojis : null,
        stickers: stickerUsageEnabled ? cachedEntry.stickers : null,
        customs: stickerUsageEnabled ? cachedEntry.customs : null,
      };
    }

    // Cache stale - fall through to refresh
  }

  // Cache miss or stale - refresh from DB
  cacheMisses++;

  try {
    // Lazy sync from Discord if needed (24hr check)
    if (emojiUsageEnabled) {
      await lazySyncGuildEmojis(guild, serverId);
    }
    if (stickerUsageEnabled) {
      await lazySyncGuildStickers(guild, serverId);
    }

    let emojis: ServerEmojiRow[] | null = null;
    let stickers: ServerStickerRow[] | null = null;
    let customs: CustomExpressionRow[] | null = null;

    if (emojiUsageEnabled) {
      emojis = await serverRepository.loadEmojis(serverId);
    }

    if (stickerUsageEnabled) {
      stickers = await serverRepository.loadStickersByInternalId(serverId);
      customs = await serverRepository.loadCustomExpressions(serverId);
    }

    cache.set(serverId, {
      emojis: emojis || [],
      stickers: stickers || [],
      customs: customs || [],
      emojisLoaded: emojiUsageEnabled,
      stickersLoaded: stickerUsageEnabled,
      cachedAt: now,
    });

    return { emojis, stickers, customs };
  } catch (error) {
    log.error(`[Emoji/Sticker Cache] Error loading data for server ${serverId}:`, error);

    // Return stale cache if available (fallback)
    if (cachedEntry) {
      log.warn(`[Emoji/Sticker Cache] Returning stale cache for server ${serverId} due to error`);
      return {
        emojis: emojiUsageEnabled ? cachedEntry.emojis : null,
        stickers: stickerUsageEnabled ? cachedEntry.stickers : null,
        // A stale whitelist can expose media after access was revoked, so customs fail closed.
        customs: null,
      };
    }

    return { emojis: null, stickers: null, customs: null };
  }
}

/**
 * Invalidates in-memory cache for a specific server
 * Called by event handlers when Discord emojis/stickers change
 *
 * @param serverId - Internal database server ID to invalidate
 */
export function invalidateEmojiStickerCache(serverId: number): void {
  cache.delete(serverId);
}

/**
 * Clears entire in-memory cache
 * Useful for testing or manual refresh operations
 */
export function clearEmojiStickerCache(): void {
  cache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * Gets cache statistics for monitoring and debugging
 *
 * @returns Object with cache hits, misses, and hit rate percentage
 */
export function getEmojiStickerCacheStats(): {
  hits: number;
  misses: number;
  hitRate: string;
  cacheSize: number;
} {
  const total = cacheHits + cacheMisses;
  const hitRate = total > 0 ? `${((cacheHits / total) * 100).toFixed(2)}%` : "N/A";

  return {
    hits: cacheHits,
    misses: cacheMisses,
    hitRate,
    cacheSize: cache.size,
  };
}

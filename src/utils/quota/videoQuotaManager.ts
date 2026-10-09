import { log } from "@/utils/misc/logger";
import type { VideoQuotaConfigRow } from "@/types/db/schema";
import {
  getOrCreateVideoConfig,
  incrementVideoQuota as repositoryIncrementVideoQuota,
  resetServerwideVideoPeriod,
  touchServerwideVideoQuota,
  touchUserVideoQuota,
} from "@/utils/db/repositories/QuotaRepository";

/** Shares the same shape as image quota checks for consistency. */
export interface VideoQuotaCheckResult {
  allowed: boolean;
  reason?: "user_quota_exceeded" | "serverwide_quota_exceeded" | "disabled";
  userRemaining?: number;
  serverwideRemaining?: number;
  resetTime?: Date;
}

/**
 * Get or create server's video quota configuration.
 * Creates default config if not exists (3 daily user quota, unlimited serverwide).
 * Lower default than image quotas because video generation is more expensive.
 */
export async function getVideoQuotaConfig(serverId: number): Promise<VideoQuotaConfigRow> {
  return getOrCreateVideoConfig(serverId);
}

/**
 * Check if user can generate a video based on daily quota.
 * Returns remaining quota and whether generation is allowed.
 */
async function checkUserDailyVideoQuota(
  serverId: number,
  userDiscId: string,
  config: VideoQuotaConfigRow,
): Promise<VideoQuotaCheckResult> {
  // If daily user quota is 0 (unlimited), allow
  if (config.daily_user_quota === 0) {
    return { allowed: true };
  }

  try {
    const today = new Date().toISOString().split("T")[0];

    const userQuota = await touchUserVideoQuota(serverId, userDiscId, today);

    const remaining = config.daily_user_quota - userQuota.usage_count;

    if (remaining <= 0) {
      const resetTime = new Date();
      resetTime.setHours(24, 0, 0, 0);

      return {
        allowed: false,
        reason: "user_quota_exceeded",
        userRemaining: 0,
        resetTime,
      };
    }

    return {
      allowed: true,
      userRemaining: remaining,
    };
  } catch (error) {
    log.error("Failed to check user daily video quota", error);
    return { allowed: true };
  }
}

/**
 * Check if server has remaining server-wide video quota.
 */
async function checkServerwideVideoQuota(
  serverId: number,
  config: VideoQuotaConfigRow,
): Promise<VideoQuotaCheckResult> {
  // If serverwide quota is 0 (unlimited), allow
  if (config.serverwide_quota === 0) {
    return { allowed: true };
  }

  try {
    const serverwideQuota = await touchServerwideVideoQuota(serverId, config.serverwide_quota_resets_in);

    const now = new Date();
    const periodEnd = new Date(serverwideQuota.quota_period_end);

    if (now >= periodEnd) {
      const resetQuota = await resetServerwideVideoPeriod(serverId, config.serverwide_quota_resets_in);

      return {
        allowed: true,
        serverwideRemaining: config.serverwide_quota,
        resetTime: new Date(resetQuota.quota_period_end),
      };
    }

    const remaining = config.serverwide_quota - serverwideQuota.usage_count;

    if (remaining <= 0) {
      return {
        allowed: false,
        reason: "serverwide_quota_exceeded",
        serverwideRemaining: 0,
        resetTime: periodEnd,
      };
    }

    return {
      allowed: true,
      serverwideRemaining: remaining,
      resetTime: periodEnd,
    };
  } catch (error) {
    log.error("Failed to check serverwide video quota", error);
    return { allowed: true };
  }
}

/**
 * Check all video quotas (user daily + server-wide).
 * Returns combined result indicating if generation is allowed.
 */
export async function checkVideoQuota(serverId: number, userDiscId: string): Promise<VideoQuotaCheckResult> {
  try {
    const config = await getVideoQuotaConfig(serverId);

    // Check user daily quota first (most common limit)
    // Note: daily_user_quota === 0 means unlimited (handled inside checkUserDailyVideoQuota)
    const userCheck = await checkUserDailyVideoQuota(serverId, userDiscId, config);
    if (!userCheck.allowed) {
      return userCheck;
    }

    const serverwideCheck = await checkServerwideVideoQuota(serverId, config);
    if (!serverwideCheck.allowed) {
      return serverwideCheck;
    }

    return {
      allowed: true,
      userRemaining: userCheck.userRemaining,
      serverwideRemaining: serverwideCheck.serverwideRemaining,
      resetTime: serverwideCheck.resetTime,
    };
  } catch (error) {
    log.error("Failed to check video quota", error);
    return { allowed: true };
  }
}

/**
 * Increment both user daily and server-wide video quotas after successful generation.
 * Should only be called AFTER video generation succeeds.
 */
export async function incrementVideoQuota(serverId: number, userDiscId: string): Promise<void> {
  try {
    await repositoryIncrementVideoQuota(serverId, userDiscId);
    log.info("Incremented video quotas");
  } catch (error) {
    log.error("Failed to increment video quota", error);
  }
}

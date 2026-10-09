import { log } from "@/utils/misc/logger";
import type { ImageQuotaConfigRow } from "@/types/db/schema";
import {
  getOrCreateImageConfig,
  incrementImageQuota as repositoryIncrementImageQuota,
  resetServerwideImagePeriod,
  touchServerwideImageQuota,
  touchUserImageQuota,
} from "@/utils/db/repositories/QuotaRepository";

export interface QuotaCheckResult {
  allowed: boolean; // Whether user can generate image
  reason?: "user_quota_exceeded" | "serverwide_quota_exceeded" | "disabled"; // Reason if denied
  userRemaining?: number; // User's remaining quota for the day
  serverwideRemaining?: number; // Server's remaining quota for the period
  resetTime?: Date; // When the quota resets (for error messages)
}

/**
 * Get or create server's quota configuration
 * Creates default config if not exists (10 daily user quota, unlimited serverwide)
 */
export async function getQuotaConfig(serverId: number): Promise<ImageQuotaConfigRow> {
  return getOrCreateImageConfig(serverId);
}

/**
 * Check if user can generate an image based on daily quota
 * Returns remaining quota and whether generation is allowed
 */
async function checkUserDailyQuota(
  serverId: number,
  userDiscId: string,
  config: ImageQuotaConfigRow,
): Promise<QuotaCheckResult> {
  // If daily user quota is 0 (unlimited), allow
  if (config.daily_user_quota === 0) {
    return { allowed: true };
  }

  try {
    const today = new Date().toISOString().split("T")[0];

    const userQuota = await touchUserImageQuota(serverId, userDiscId, today);

    const remaining = config.daily_user_quota - userQuota.usage_count;

    if (remaining <= 0) {
      const resetTime = new Date();
      resetTime.setHours(24, 0, 0, 0); // Next midnight

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
    log.error("Failed to check user daily quota", error);
    return { allowed: true };
  }
}

/**
 * Check if server has remaining server-wide quota
 * Returns remaining quota and whether generation is allowed
 */
async function checkServerwideQuota(serverId: number, config: ImageQuotaConfigRow): Promise<QuotaCheckResult> {
  // If serverwide quota is 0 (unlimited), allow
  if (config.serverwide_quota === 0) {
    return { allowed: true };
  }

  try {
    const serverwideQuota = await touchServerwideImageQuota(serverId, config.serverwide_quota_resets_in);

    const now = new Date();
    const periodEnd = new Date(serverwideQuota.quota_period_end);

    if (now >= periodEnd) {
      const resetQuota = await resetServerwideImagePeriod(serverId, config.serverwide_quota_resets_in);

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
    log.error("Failed to check serverwide quota", error);
    return { allowed: true };
  }
}

/**
 * Check all quotas (user daily + server-wide)
 * Returns combined result indicating if generation is allowed
 */
export async function checkImageQuota(serverId: number, userDiscId: string): Promise<QuotaCheckResult> {
  try {
    const config = await getQuotaConfig(serverId);

    // Check user daily quota first (most common limit)
    // Note: daily_user_quota === 0 means unlimited (handled inside checkUserDailyQuota)
    const userCheck = await checkUserDailyQuota(serverId, userDiscId, config);
    if (!userCheck.allowed) {
      return userCheck;
    }

    const serverwideCheck = await checkServerwideQuota(serverId, config);
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
    log.error("Failed to check image quota", error);
    return { allowed: true };
  }
}

/**
 * Increment both user daily and server-wide quotas after successful image generation
 * Should only be called AFTER image generation succeeds
 */
export async function incrementImageQuota(serverId: number, userDiscId: string): Promise<void> {
  try {
    await repositoryIncrementImageQuota(serverId, userDiscId);
    log.info("Incremented image quotas");
  } catch (error) {
    log.error("Failed to increment image quota", error);
  }
}

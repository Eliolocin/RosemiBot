import { log } from "@/utils/misc/logger";
import type { TextQuotaConfigRow } from "@/types/db/schema";
import {
  getOrCreateTextConfig,
  incrementTextQuota as repositoryIncrementTextQuota,
  resetServerwideTextPeriod,
  touchServerwideTextQuota,
  touchUserTextQuota,
} from "@/utils/db/repositories/QuotaRepository";

export interface TextQuotaCheckResult {
  allowed: boolean; // Whether user can trigger text generation
  reason?: "user_quota_exceeded" | "serverwide_quota_exceeded" | "disabled"; // Reason if denied
  userRemaining?: number; // User's remaining quota for the day
  serverwideRemaining?: number; // Server's remaining quota for the period
  resetTime?: Date; // When the quota resets (for error messages)
}

/**
 * Get or create server's text quota configuration
 * Creates default config if not exists (unlimited by default)
 */
export async function getTextQuotaConfig(serverId: number): Promise<TextQuotaConfigRow> {
  return getOrCreateTextConfig(serverId);
}

/**
 * Check if user can trigger text generation based on daily quota
 * Returns remaining quota and whether trigger is allowed
 */
async function checkUserDailyTextQuota(
  serverId: number,
  userDiscId: string,
  config: TextQuotaConfigRow,
): Promise<TextQuotaCheckResult> {
  // If daily user quota is 0 (unlimited), allow
  if (config.daily_user_quota === 0) {
    return { allowed: true };
  }

  try {
    const today = new Date().toISOString().split("T")[0];

    const userQuota = await touchUserTextQuota(serverId, userDiscId, today);

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
    log.error("Failed to check user daily text quota", error);
    return { allowed: true };
  }
}

/**
 * Check if server has remaining server-wide text quota
 * Returns remaining quota and whether trigger is allowed
 */
async function checkServerwideTextQuota(serverId: number, config: TextQuotaConfigRow): Promise<TextQuotaCheckResult> {
  // If serverwide quota is 0 (unlimited), allow
  if (config.serverwide_quota === 0) {
    return { allowed: true };
  }

  try {
    const serverwideQuota = await touchServerwideTextQuota(serverId, config.serverwide_quota_resets_in);

    const now = new Date();
    const periodEnd = new Date(serverwideQuota.quota_period_end);

    if (now >= periodEnd) {
      const resetQuota = await resetServerwideTextPeriod(serverId, config.serverwide_quota_resets_in);

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
    log.error("Failed to check serverwide text quota", error);
    return { allowed: true };
  }
}

/**
 * Check all text quotas (user daily + server-wide)
 * Returns combined result indicating if trigger is allowed
 */
export async function checkTextQuota(serverId: number, userDiscId: string): Promise<TextQuotaCheckResult> {
  try {
    const config = await getTextQuotaConfig(serverId);

    // Check user daily quota first (most common limit)
    // Note: daily_user_quota === 0 means unlimited (handled inside checkUserDailyTextQuota)
    const userCheck = await checkUserDailyTextQuota(serverId, userDiscId, config);
    if (!userCheck.allowed) {
      return userCheck;
    }

    const serverwideCheck = await checkServerwideTextQuota(serverId, config);
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
    log.error("Failed to check text quota", error);
    return { allowed: true };
  }
}

/**
 * Increment both user daily and server-wide text quotas after successful generation.
 * Should only be called AFTER a text response succeeds.
 * Only increments counters that have an active limit, so skips writes when quota is unlimited (0)
 * so usage does not accumulate retroactively before limits are first configured.
 */
export async function incrementTextQuota(serverId: number, userDiscId: string): Promise<void> {
  try {
    await repositoryIncrementTextQuota(serverId, userDiscId);
    log.info("Incremented text quotas");
  } catch (error) {
    log.error("Failed to increment text quota", error);
  }
}

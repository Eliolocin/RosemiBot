import { sql } from "@/utils/db/client";
import { initializeDatabase, invalidatePresetPointerStateCaches } from "@/utils/db/initializeDatabase";
import { seedPersonaSpritesFromCatalog } from "@/db/seed/catalog/presetSpriteSeed";
import { seedPersonaAvatarsFromCatalog } from "@/db/seed/catalog/presetAvatarSeed";
import { withPresetAssetLock } from "@/db/seed/catalog/presetAssetLock";
import { log } from "@/utils/misc/logger";
import { collectProcessMemorySnapshot } from "@/utils/misc/processMemory";
import type { AppEnvironment } from "@/types/config";

/**
 * Initializes the database, cleans up expired cooldowns, and sets up the pg_cron
 * job for recurring cooldown cleanup (production environments only).
 *
 * Exits the process on critical DB initialization failure.
 *
 */
export async function initDatabase(environment: AppEnvironment): Promise<void> {
  log.section("Initializing Database...");

  // Small delay in development to reduce hot-reload conflicts
  if (environment !== "production") {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const managesSchema = isDatabaseSchemaManagementEnabled();

  try {
    if (managesSchema) {
      await initializeDatabase();
    } else {
      await sql`SELECT 1`;
      log.success("PostgreSQL runtime connection verified (schema management disabled)");
    }
  } catch {
    process.exit(1);
  }

  log.section("Cleaning up expired cooldowns...");
  try {
    const { cooldownRepository } = await import("@/utils/db/repositories/CooldownRepository");
    const cleanupResult = await cooldownRepository.cleanupExpiredCooldowns();
    if (cleanupResult.success) {
      log.success(`Cooldowns cleanup completed: ${cleanupResult.deletedCount} expired entries removed`);
    } else {
      log.warn(`Cooldowns cleanup failed: ${cleanupResult.error}`);
    }
  } catch (error) {
    log.warn("Error during startup cooldowns cleanup:", error);
    // Non-critical, so continue startup
  }

  if (!managesSchema) {
    return;
  }

  try {
    const host = process.env.POSTGRES_HOST || "localhost";
    const port = Number.parseInt(process.env.POSTGRES_PORT || "5432", 10);

    if (!host || Number.isNaN(port)) {
      log.warn("Could not determine database host/port for pg_cron setup");
      return;
    }

    const [extensionCheck] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_available_extensions
        WHERE name = 'pg_cron'
      ) as available
    `;

    if (!extensionCheck?.available) {
      log.warn("pg_cron extension not available - using startup cleanup method");
      return;
    }

    await sql`CREATE EXTENSION IF NOT EXISTS pg_cron;`;

    // Delete any existing job with the same name (idempotent across pg_cron versions)
    await sql`
      DELETE FROM cron.job
      WHERE jobname = 'tomoribot_cooldown_cleanup'
    `;

    await sql`
      INSERT INTO cron.job (jobname, schedule, command, nodename, nodeport, database, username)
      VALUES (
        'tomoribot_cooldown_cleanup',
        '0 * * * *',
        'SELECT cleanup_expired_cooldowns();',
        ${host},
        ${port},
        current_database(),
        current_user
      )
    `;
    log.success(`pg_cron job for cooldown cleanup scheduled/verified for ${host}:${port}`);
  } catch (err) {
    log.info(`pg_cron setup failed (non-critical): ${err instanceof Error ? err.message : err}`);
    log.info("Cooldown cleanup will be handled by startup method instead");
  }
}

export function isDatabaseSchemaManagementEnabled(raw = process.env.DATABASE_SCHEMA_MANAGEMENT_ENABLED): boolean {
  if (raw === undefined) return true;
  return ["true", "1", "yes", "on"].includes(raw.trim().toLowerCase());
}

type PresetArtPhase = "total" | "sprites" | "avatars" | "fanout";
type PresetArtPhaseStatus = "started" | "completed" | "failed";

function recordPresetArtPhase(phase: PresetArtPhase, status: PresetArtPhaseStatus, durationMs?: number): void {
  if (process.env.RUN_ENV !== "production") return;
  const memory = collectProcessMemorySnapshot();
  log.metric("preset_art_phase", {
    phase,
    status,
    ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
    rss_mb: memory.rssMb,
    heap_used_mb: memory.heapUsedMb,
    external_mb: memory.externalMb,
    array_buffers_mb: memory.arrayBuffersMb,
  });
}

/** Production hides success logs, so phase markers remain in JSONL if memory pressure ends a run. */
export async function measurePresetArtPhase<T>(phase: PresetArtPhase, action: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  recordPresetArtPhase(phase, "started");

  let status: PresetArtPhaseStatus = "failed";
  try {
    const result = await action();
    status = "completed";
    return result;
  } finally {
    recordPresetArtPhase(phase, status, Math.round(performance.now() - startedAt));
  }
}

/** Seeds catalog art after gateway readiness, when the bot has storage credentials. */
export async function seedStorageBackedCatalogs(): Promise<void> {
  try {
    const { spriteSeed, avatarSeed } = await measurePresetArtPhase("total", () =>
      withPresetAssetLock(sql, async (client) => {
        const spriteSeed = await measurePresetArtPhase("sprites", () => seedPersonaSpritesFromCatalog(client));
        const avatarSeed = await measurePresetArtPhase("avatars", () => seedPersonaAvatarsFromCatalog(client));
        return { spriteSeed, avatarSeed };
      }),
    );
    log.success(
      `PostgreSQL preset sprite catalog seeded (${spriteSeed.seeded}/${spriteSeed.declarations} declarations seeded, ` +
        `${spriteSeed.failed} failed, ${spriteSeed.removed} removed, ${spriteSeed.presets} preset variants)`,
    );
    log.success(
      `PostgreSQL preset avatar catalog seeded (${avatarSeed.seeded}/${avatarSeed.declarations} declarations seeded, ` +
        `${avatarSeed.failed} failed)`,
    );
  } finally {
    await invalidatePresetPointerStateCaches(sql);
  }
}

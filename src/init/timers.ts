import type { Client } from "discord.js";
import { measurePresetArtPhase, seedStorageBackedCatalogs } from "@/init/database";
import { log } from "@/utils/misc/logger";
import { healthTracker } from "@/utils/misc/healthTracker";

/**
 * Registers all post-ready timers and background monitors.
 * All registrations are deferred via client.once("clientReady") so they
 * only start after Discord confirms the bot is connected.
 *
 * Non-critical: failures here degrade diagnostics/reminders but do not
 * affect core chat functionality.
 *
 */
export function initTimers(client: Client): void {
  client.once("clientReady", () => {
    healthTracker.initialize(client);
    log.success("Health tracker initialized");
  });

  log.section("Initializing Scheduled Work Coordinator...");
  try {
    // Dynamic import deferred, because module references timers that require the client to be ready
    import("@/timers/scheduledWorkCoordinator")
      .then(({ initializeScheduledWorkCoordinator }) => {
        client.once("clientReady", () => {
          initializeScheduledWorkCoordinator(client);
          log.success("Scheduled work coordinator initialized");
        });
      })
      .catch((error: Error) => {
        log.error("Failed to initialize scheduled work coordinator", error);
      });
  } catch (error) {
    log.error("Failed to initialize scheduled work coordinator", error as Error);
  }

  log.section("Initializing Memory Monitor...");
  try {
    import("@/timers/memoryMonitor")
      .then(({ initializeMemoryMonitor }) => {
        client.once("clientReady", () => {
          initializeMemoryMonitor(client);
          log.success("Memory monitoring system initialized");
        });
      })
      .catch((error: Error) => {
        log.error("Failed to initialize memory monitor", error);
      });
  } catch (error) {
    log.error("Failed to initialize memory monitor", error as Error);
  }

  log.section("Initializing Cache Metrics Logger...");
  try {
    import("@/timers/cacheMetricsLogger")
      .then(({ initializeCacheMetricsLogger }) => {
        client.once("clientReady", () => {
          initializeCacheMetricsLogger(client);
          log.success("Cache metrics logger initialized");
        });
      })
      .catch((error: Error) => {
        log.error("Failed to initialize cache metrics logger", error);
      });
  } catch (error) {
    log.error("Failed to initialize cache metrics logger", error as Error);
  }

  log.section("Scheduling Preset Art Seed and Avatar Fan-out...");
  try {
    // Storage uploads run after clientReady so a slow upload cannot delay login.
    // Guild avatar updates wait for the seed's new content hashes.
    client.once("clientReady", () => {
      void seedStorageBackedCatalogs()
        .then(() => import("@/utils/persona/presetAvatarReconciler"))
        .then(({ reconcilePresetMainAvatars }) => {
          return measurePresetArtPhase("fanout", () => reconcilePresetMainAvatars(client));
        })
        .catch((error: Error) => {
          log.error("Preset art seed or avatar fan-out failed", error);
        });
    });
  } catch (error) {
    log.error("Failed to schedule preset art seed and avatar fan-out", error as Error);
  }

  log.section("Initializing Message-Proxy Index Pruner...");
  try {
    import("@/timers/messageProxyIndexPruner")
      .then(({ initializeMessageProxyIndexPruner }) => {
        client.once("clientReady", () => {
          initializeMessageProxyIndexPruner();
          log.success("Message-proxy index pruner initialized");
        });
      })
      .catch((error: Error) => {
        log.error("Failed to initialize message-proxy index pruner", error);
      });
  } catch (error) {
    log.error("Failed to initialize message-proxy index pruner", error as Error);
  }

  log.section("Initializing Upload Quota System...");
  try {
    import("@/utils/security/rateLimiter")
      .then(({ initializeQuotaCleanup }) => {
        initializeQuotaCleanup();
        log.success("Upload quota tracking system initialized");
      })
      .catch((error: Error) => {
        log.error("Failed to initialize quota cleanup system", error);
      });
  } catch (error) {
    log.error("Failed to initialize quota cleanup system", error as Error);
  }

  log.section("Initializing RAG Availability Monitor...");
  try {
    import("@/timers/ragAvailabilityMonitor")
      .then(({ initializeRagAvailabilityMonitor }) => {
        initializeRagAvailabilityMonitor();
        log.success("RAG availability monitor initialized");
      })
      .catch((error: Error) => {
        log.error("Failed to initialize RAG availability monitor", error);
      });
  } catch (error) {
    log.error("Failed to initialize RAG availability monitor", error as Error);
  }

  log.section("Initializing OpenRouter Catalog Refresher...");
  try {
    import("@/timers/openrouterCatalogRefresher")
      .then(({ initializeOpenRouterCatalogRefresher }) => {
        initializeOpenRouterCatalogRefresher();
        log.success("OpenRouter catalog refresher initialized");
      })
      .catch((error: Error) => {
        log.error("Failed to initialize OpenRouter catalog refresher", error);
      });
  } catch (error) {
    log.error("Failed to initialize OpenRouter catalog refresher", error as Error);
  }

  log.section("Initializing STM Janitor...");
  try {
    import("@/timers/stmJanitor")
      .then(({ initializeStmJanitor }) => {
        initializeStmJanitor();
        log.success("STM janitor initialized");
      })
      .catch((error: Error) => {
        log.error("Failed to initialize STM janitor", error);
      });
  } catch (error) {
    log.error("Failed to initialize STM janitor", error as Error);
  }
}

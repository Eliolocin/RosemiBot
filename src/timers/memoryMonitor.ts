/**
 * Memory Monitor System
 * Periodically checks memory usage and logs status changes
 */

import type { Client } from "discord.js";
import { clearEmergencyCaches } from "@/utils/cache/emergencyCacheClearer";
import { log } from "@/utils/misc/logger";
import {
  memoryGuard,
  formatMemoryStatus,
  type MemoryStatus,
  registerMemoryEmergencyHandler,
} from "@/utils/security/rateLimiter";

/**
 * Class to manage the memory monitoring system
 */
export class MemoryMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private unregisterEmergencyHandler: (() => void) | null = null;
  private isRunning = false;
  private readonly POLL_INTERVAL_MS: number;
  private lastStatus: MemoryStatus = "safe";
  private readonly client?: Client;

  constructor(pollIntervalMs = 30000, client?: Client) {
    this.POLL_INTERVAL_MS = pollIntervalMs; // Default 30 seconds
    this.client = client;
  }

  /**
   * Starts the memory monitoring timer
   */
  public start(): void {
    if (this.isRunning) {
      log.warn("Memory monitor is already running");
      return;
    }

    log.info(`Starting memory monitor (polling every ${this.POLL_INTERVAL_MS / 1000}s)`);
    this.isRunning = true;
    this.unregisterEmergencyHandler = registerMemoryEmergencyHandler((event) => {
      clearEmergencyCaches({
        client: this.client,
        source: "memory_guard",
      });
      log.metric("memory_emergency_entered", {
        rss_mb: Math.round(event.rssUsedMB * 100) / 100,
        rss_pct: Math.round(event.percentUsed * 10000) / 100,
        rss_limit_mb: event.memoryLimitMB,
        cooldown_ms: event.cooldownMs,
      });
    });

    this.checkMemoryStatus().catch((error) => {
      log.error("Error during initial memory check on monitor start:", error);
    });

    this.intervalId = setInterval(() => {
      this.checkMemoryStatus().catch((error) => {
        log.error("Error during scheduled memory check:", error);
      });
    }, this.POLL_INTERVAL_MS);

    log.success("Memory monitor started successfully");
  }

  /**
   * Stops the memory monitoring timer
   */
  public stop(): void {
    if (!this.isRunning) {
      log.warn("Memory monitor is not running");
      return;
    }

    log.info("Stopping memory monitor");
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.unregisterEmergencyHandler) {
      this.unregisterEmergencyHandler();
      this.unregisterEmergencyHandler = null;
    }

    log.success("Memory monitor stopped successfully");
  }

  /**
   * Checks memory status and logs if status has changed
   */
  public async checkMemoryStatus(): Promise<void> {
    try {
      const memCheck = memoryGuard.checkMemory();
      const currentStatus = memCheck.status;

      // Only log if status changed (avoid spam)
      if (currentStatus !== this.lastStatus) {
        const summary = formatMemoryStatus(memCheck);

        if (currentStatus === "critical") {
          log.error(`Memory status changed to CRITICAL: ${summary}`);
        } else if (currentStatus === "warning") {
          log.warn(`Memory status changed to WARNING: ${summary}`);
        } else {
          log.success(`Memory status recovered to SAFE: ${summary}`);
        }

        this.lastStatus = currentStatus;
      }
    } catch (error) {
      log.error("Error checking memory status:", error);
    }
  }

  /**
   * Gets the current status of the memory monitor
   */
  public getStatus(): {
    isRunning: boolean;
    intervalMs: number;
    lastStatus: MemoryStatus;
  } {
    return {
      isRunning: this.isRunning,
      intervalMs: this.POLL_INTERVAL_MS,
      lastStatus: this.lastStatus,
    };
  }
}

let memoryMonitorInstance: MemoryMonitor | null = null;

/**
 * @param clientOrPollIntervalMs - Optional Discord client or polling interval in milliseconds (default 30000)
 * @param pollIntervalMs - Optional polling interval when a client is provided
 */
export function initializeMemoryMonitor(clientOrPollIntervalMs?: Client | number, pollIntervalMs?: number): void {
  if (memoryMonitorInstance) {
    log.warn("Memory monitor already initialized");
    return;
  }

  const client = typeof clientOrPollIntervalMs === "number" ? undefined : clientOrPollIntervalMs;
  const explicitIntervalMs = typeof clientOrPollIntervalMs === "number" ? clientOrPollIntervalMs : pollIntervalMs;
  const intervalMs = explicitIntervalMs || Number.parseInt(process.env.MEMORY_MONITOR_INTERVAL_MS || "30000", 10);

  memoryMonitorInstance = new MemoryMonitor(intervalMs, client);
  memoryMonitorInstance.start();
  log.success("Memory monitoring system initialized");
}

export function stopMemoryMonitor(): void {
  if (memoryMonitorInstance) {
    memoryMonitorInstance.stop();
    memoryMonitorInstance = null;
    log.success("Memory monitoring system stopped");
  }
}

export function getMemoryMonitorStatus(): {
  isRunning: boolean;
  intervalMs: number;
  lastStatus: MemoryStatus;
} | null {
  return memoryMonitorInstance ? memoryMonitorInstance.getStatus() : null;
}

/**
 * Manually trigger a memory status check (useful for testing)
 */
export async function checkMemoryManually(): Promise<void> {
  if (!memoryMonitorInstance) {
    throw new Error("Memory monitor not initialized");
  }

  await memoryMonitorInstance.checkMemoryStatus();
}

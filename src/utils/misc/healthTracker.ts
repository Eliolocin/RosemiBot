import type { Client } from "discord.js";
import { log } from "./logger";

/**
 * Health tracking system for monitoring bot connectivity.
 *
 * Tracks Discord readiness and WebSocket heartbeat only. **It does not observe the event loop**,
 * despite what the health endpoint's name suggests; `eventLoopMonitor` does that and reports
 * separately.
 */
class HealthTracker {
  /**
   * Timestamp of the last Discord event received (any event type)
   */
  private lastActivityTimestamp: number = Date.now();

  /**
   * Discord client instance for checking WebSocket status
   */
  private client: Client | null = null;

  /**
   * Maximum time (in milliseconds) without activity before considering unhealthy
   * Default: 2 minutes
   * NOTE: Currently unused - see "Lonely Bot" problem comment in getHealthStatus()
   */
  // private readonly activityTimeout: number = 2 * 60 * 1000;

  /**
   * Maximum WebSocket ping latency (in milliseconds) before considering unhealthy
   * Default: 5 seconds
   */
  private readonly maxPingLatency: number = 5000;

  /**
   * Failed gateway connection attempts since the last established session
   */
  private gatewayFailureCount: number = 0;

  /**
   * When the most recent gateway connection attempt failed
   */
  private lastGatewayFailureAt: number | null = null;

  /**
   * Initialize the health tracker with a Discord client
   */
  initialize(client: Client): void {
    this.client = client;
    this.lastActivityTimestamp = Date.now();
    log.info("Health tracker initialized");
  }

  /**
   * Record that a Discord event was processed
   * Call this from event handlers to update activity timestamp
   */
  recordActivity(): void {
    this.lastActivityTimestamp = Date.now();
  }

  getHealthStatus(): HealthStatus {
    const now = Date.now();
    const timeSinceLastActivity = now - this.lastActivityTimestamp;

    if (!this.client) {
      return {
        healthy: false,
        reason: "Client not initialized",
        details: {
          clientReady: false,
          timeSinceLastActivity,
          websocketPing: null,
        },
      };
    }

    const isClientReady = this.client.isReady();
    if (!isClientReady) {
      return {
        healthy: false,
        reason: "Discord client not ready",
        details: {
          clientReady: false,
          timeSinceLastActivity,
          websocketPing: null,
        },
      };
    }

    // Check WebSocket ping (measures roundtrip latency to Discord)
    const websocketPing = this.client.ws.ping;
    if (websocketPing < 0 || websocketPing > this.maxPingLatency) {
      return {
        healthy: false,
        reason: `WebSocket ping unhealthy: ${websocketPing}ms`,
        details: {
          clientReady: true,
          timeSinceLastActivity,
          websocketPing,
        },
      };
    }

    // Activity timeout check (DISABLED). Quiet hours produce no Discord events, so the bot would
    // report "unhealthy" while idle and a restart policy would loop it.
    //
    // Activity is not liveness: a loop that yields between chunks still answers a short health
    // probe while the handlers behind it make no progress, which is how a starved main thread went
    // unnoticed. `eventLoopMonitor` measures that progress on the same endpoint.
    //
    // Re-enabling this needs `client.on('raw', ...)` rather than typed events, and a progress
    // signal that does not depend on activity.
    /*
		if (timeSinceLastActivity > this.activityTimeout) {
			return {
				healthy: false,
				reason: `No Discord activity for ${Math.floor(timeSinceLastActivity / 1000)}s`,
				details: {
					clientReady: true,
					timeSinceLastActivity,
					websocketPing,
				},
			};
		}
		*/

    return {
      healthy: true,
      reason: "All systems operational",
      details: {
        clientReady: true,
        timeSinceLastActivity,
        websocketPing,
      },
    };
  }

  getTimeSinceLastActivity(): number {
    return Date.now() - this.lastActivityTimestamp;
  }

  /**
   * Records a failed gateway connection attempt.
   *
   * A gateway incident otherwise leaves no durable trace once the log rows are rate-limited, so
   * the count and the timestamp of the latest attempt are what separate "discord.js is retrying
   * and will recover" from "this process has never connected".
   */
  recordGatewayFailure(): void {
    this.gatewayFailureCount++;
    this.lastGatewayFailureAt = Date.now();
  }

  /** Clears the failure streak once a session is established or resumed. */
  recordGatewayConnected(): void {
    this.gatewayFailureCount = 0;
    this.lastGatewayFailureAt = null;
  }

  /**
   * Get WebSocket ping latency in milliseconds
   */
  getWebSocketPing(): number {
    return this.client?.ws.ping ?? -1;
  }

  /**
   * Reports connection progress for the health endpoint.
   *
   * These are counters rather than a verdict, so they deliberately do not feed `healthy`: a
   * reconnecting gateway is expected to recover.
   *
   * Login is absent by design. A failed login exits the process, so any state recorded for it
   * would be unreadable by the probe that is meant to report it; the exit code and the log line
   * are what carry that outcome.
   */
  getConnectionState(): {
    gatewayFailureCount: number;
    lastGatewayFailureAt: string | null;
  } {
    return {
      gatewayFailureCount: this.gatewayFailureCount,
      lastGatewayFailureAt: this.lastGatewayFailureAt ? new Date(this.lastGatewayFailureAt).toISOString() : null,
    };
  }
}

interface HealthStatus {
  /**
   * Whether the bot is considered healthy
   */
  healthy: boolean;

  /**
   * Human-readable reason for the health status
   */
  reason: string;

  /**
   * Detailed metrics for debugging
   */
  details: {
    /**
     * Whether Discord client is in ready state
     */
    clientReady: boolean;

    /**
     * Time in milliseconds since last Discord event
     */
    timeSinceLastActivity: number;

    /**
     * WebSocket ping latency in milliseconds (null if not available)
     */
    websocketPing: number | null;
  };
}

/**
 * Singleton instance for global health tracking
 */
export const healthTracker = new HealthTracker();

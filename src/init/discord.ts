import { ApplicationFlags, Client, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import { log } from "@/utils/misc/logger";
import { healthTracker } from "@/utils/misc/healthTracker";
import type { AppEnvironment } from "@/types/config";
import { shouldRejectWebhookRateLimit } from "@/utils/discord/webhook/avatarEditRateLimit";

/**
 * Whether a Discord connection failure is one the bot can recover from on its own.
 *
 * The gateway sits behind an edge that answers a connect attempt with a non-101 status while a
 * region is unhealthy, so the failure arrives as a transport error rather than a gateway close
 * code. Retrying is correct for those. A rejected token or an unapproved privileged intent is
 * not: no amount of retrying changes Discord's answer, and a restart loop only hides the
 * misconfiguration behind transport noise.
 *
 * @param error - Failure raised by a gateway connect attempt or by login
 * @returns True when the caller should retry rather than exit
 */
export function isTransientGatewayError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  if (message.includes("expected 101 status code")) return true;
  if (message.includes("disallowed intents") || message.includes("privileged intent")) return false;
  if (message.includes("invalid token") || message.includes("unauthorized")) return false;

  const code = (error as { code?: unknown }).code;
  if (code === "DisallowedIntents" || code === "TokenInvalid" || code === "InvalidToken") return false;

  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status >= 500 || status === 408 || status === 429;

  return (
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("socket hang up") ||
    message.includes("socket closed") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("websocket") ||
    message.includes("429")
  );
}

/**
 * Resolves whether the privileged GuildPresences intent should be requested,
 * preferring Discord's own approval state so the bot self-heals with no manual
 * configuration.
 *
 * GuildPresences is a privileged intent: requesting it without Discord's
 * approval makes the gateway reject the entire connection (DisallowedIntents /
 * WS close 4014). To avoid that (and a failed-then-retried connection), we ask
 * Discord up front whether the intent is enabled for this application.
 *
 * Resolution order:
 *   1. Live probe of the application's gateway flags via REST `GET /applications/@me`.
 *      `GatewayPresence` (approved for 100+ guild bots) or `GatewayPresenceLimited`
 *      (enabled for <100 guild bots) means the intent is safe to request. The moment
 *      Discord grants approval, so this flips on the next restart, no code change.
 *   2. On probe failure (e.g. network/REST error), fall back to the legacy default:
 *      enabled outside production, disabled in production.
 *
 * @param environment - Resolved runtime environment (used only for the fallback)
 * @returns true if the GuildPresences intent should be included
 */
export async function resolvePresenceIntentEnabled(environment: AppEnvironment): Promise<boolean> {
  // Legacy behavior is the safety net if we cannot reach Discord to probe.
  const legacyDefault = environment !== "production";

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    log.warn("Cannot probe Presence Intent approval (DISCORD_TOKEN unset); using default");
    return legacyDefault;
  }

  // Ask Discord which privileged gateway intents this application is approved for.
  try {
    const rest = new REST().setToken(token);
    const application = (await rest.get(Routes.currentApplication())) as { flags?: number };
    const flags = application.flags ?? 0;
    // Either flag indicates the Presence Intent is enabled/approved for this bot.
    const presenceApproved =
      (flags & ApplicationFlags.GatewayPresence) !== 0 || (flags & ApplicationFlags.GatewayPresenceLimited) !== 0;
    log.info(
      `Presence Intent approval probe: ${presenceApproved ? "approved" : "not approved"} (application flags=${flags})`,
    );
    return presenceApproved;
  } catch (error) {
    // Probe failed, so degrade to the legacy default rather than risk a 4014.
    log.warn("Failed to probe Presence Intent approval; using default", error);
    return legacyDefault;
  }
}

/**
 * Creates and configures the Discord.js client with appropriate intents,
 * cache sweepers, and process-level error handlers.
 *
 * The privileged GuildPresences intent is included only when
 * {@link resolvePresenceIntentEnabled} reports it as enabled. Downstream
 * consumers (e.g. the context builder) detect its presence via
 * `client.options.intents.has(GatewayIntentBits.GuildPresences)` and degrade
 * gracefully when it is absent, so flipping it requires no other changes.
 *
 * @param includePresences - Whether to request the privileged GuildPresences intent
 * @returns Configured Discord.js Client (not yet logged in)
 */
export function createDiscordClient(includePresences: boolean): Client {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildExpressions,
  ];

  // GuildPresences is privileged, so request it only when Discord has approved it
  // (or it is force-enabled). See resolvePresenceIntentEnabled.
  if (includePresences) {
    intents.push(GatewayIntentBits.GuildPresences);
  }

  const client = new Client({
    intents,
    partials: [Partials.Channel, Partials.Message],
    rest: { rejectOnRateLimit: shouldRejectWebhookRateLimit },
    sweepers: {
      messages: {
        interval: 3600, // Run sweep every 1 hour (in seconds)
        lifetime: 1800, // Keep messages for 30 minutes (in seconds)
      },
      // Never sweep the client's own member: discord.js resolves permissions through it.
      // Voice paths read members synchronously with no fetch fallback.
      guildMembers: {
        interval: 3600,
        filter: () => (member) => member.id !== member.client.user.id && !member.voice.channelId,
      },
      users: {
        interval: 3600,
        filter: () => (user) => user.bot,
      },
      // Presence data is gateway-only with no REST fetch, so a swept entry stays missing until
      // that user's next presence change. Offline-with-no-activity is the only safe set to drop:
      // getUserPresenceDetails renders a cached offline presence as "Offline" and a missing one as
      // "Offline or status unknown", so the information lost is nil. Widening this filter to
      // idle/dnd or to entries carrying activities would silently degrade what Tomori can see.
      presences: {
        interval: 3600,
        filter: () => (presence) => presence.status === "offline" && presence.activities.length === 0,
      },
    },
  });

  client.on("error", (error) => {
    log.error("Discord client error occurred", error);
  });

  // A reconnect is transport maintenance, not an application defect. Logging every failed attempt
  // at error level fills `error_logs` with identical rows during one gateway incident, which is
  // what buries unrelated failures in the same Grafana view, so only the first attempt reports at
  // error level and the rest stay visible at a level that does not write a row.
  const gatewayErrorReporter = createGatewayErrorReporter();
  client.on("shardError", (error, shardId) => {
    gatewayErrorReporter(error, shardId);
  });

  // Session lifecycle is the other half of a connection failure: without these, a resumed session
  // and a fresh identify are indistinguishable in the logs, and an event gap is invisible.
  //
  // The reporter is cleared only where a session is actually established. Clearing it on a
  // disconnect would re-arm error level for the next attempt of the same outage, which is the
  // repetition the reporter exists to absorb.
  client.on("shardReady", (shardId) => {
    gatewayErrorReporter.reset(shardId);
    healthTracker.recordGatewayConnected();
    log.rateLimit(`Discord gateway shard ready (shard ${shardId})`, { shardId });
  });

  client.on("shardResume", (shardId, replayedEvents) => {
    gatewayErrorReporter.reset(shardId);
    healthTracker.recordGatewayConnected();
    log.rateLimit(`Discord gateway session resumed (shard ${shardId})`, { shardId, replayedEvents });
  });

  client.on("shardDisconnect", (event, shardId) => {
    log.rateLimit(`Discord gateway disconnected (shard ${shardId})`, {
      code: event.code,
      reason: event.reason ?? "",
      wasClean: event.wasClean,
    });
  });

  client.on("shardReconnecting", (shardId) => {
    log.rateLimit(`Discord gateway reconnecting (shard ${shardId})`, { shardId });
  });

  client.on("invalidated", () => {
    log.warn("Discord session invalidated; discord.js will reconnect with a new session");
  });

  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception occurred", error);
    // Don't exit process for WebSocket errors, so let Discord.js reconnect
    if (error.message?.includes("error is not an Object")) {
      log.warn("WebSocket error caught - Discord.js will attempt to reconnect");
      return;
    }
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    log.error("Unhandled promise rejection", reason, {
      errorType: "UnhandledPromiseRejection",
      metadata: { promise: promise.toString() },
    });
  });

  return client;
}

/**
 * Rate-limits gateway connection failures to one error row per shard per episode.
 *
 * discord.js retries a failed handshake on its own, so a single outage produces one failure per
 * attempt with the same message. Only the first is news; the rest are the same fact repeated, and
 * at error level each one is a row the failure views have to filter out.
 */
function createGatewayErrorReporter(): ((error: unknown, shardId: number) => void) & {
  reset: (shardId: number) => void;
} {
  const reported = new Set<number>();

  const report = (error: unknown, shardId: number) => {
    healthTracker.recordGatewayFailure();
    const metadata = { shardId, reason: error instanceof Error ? error.message : String(error) };

    if (!reported.has(shardId)) {
      reported.add(shardId);
      log.error(
        `Discord WebSocket shard error occurred (shard ${shardId}); further attempts for this shard stay at warn level until it connects`,
        error,
      );
      return;
    }

    log.warn(`Discord WebSocket shard error repeated (shard ${shardId})`, error instanceof Error ? error : undefined, {
      errorType: "DiscordGatewayError",
      metadata,
    });
  };

  report.reset = (shardId: number) => {
    reported.delete(shardId);
  };

  return report;
}

import { config } from "dotenv";
import { resolveEnvironment } from "@/types/config";
import { startHealthServer } from "@/init/healthServer";
import { registerHeapSnapshotHandler } from "@/init/heapSnapshot";
import { loadSecrets } from "@/init/secrets";
import { initStartupBackup } from "@/init/backup";
import { createDiscordClient, isTransientGatewayError, resolvePresenceIntentEnabled } from "@/init/discord";
import { initDatabase } from "@/init/database";
import { initLoaders } from "@/init/loaders";
import { initBridges } from "@/init/bridges";
import { initTimers } from "@/init/timers";
import { initMediaProcessing } from "@/init/media";
import { log } from "@/utils/misc/logger";
import { discordPresenceRetention } from "@/utils/cache/discordPresenceRetention";
import { statRepository } from "@/utils/db/repositories/StatRepository";

/**
 * Detects Discord's "privileged intent not approved" rejection.
 *
 * When the GuildPresences intent is requested but not approved, the gateway
 * closes the connection with code 4014 and discord.js rejects login with a
 * `DisallowedIntents` error. We match on the error code and message so the
 * failure can be reported as an actionable misconfiguration rather than a
 * silent, never-connected process.
 *
 * @returns true if the failure is a disallowed/privileged intent rejection
 */
function isDisallowedIntentsError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (code === "DisallowedIntents") return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("disallowed intents") || message.includes("privileged intent");
}

config({ quiet: true });

const environment = resolveEnvironment();

// Bind to PORT immediately so Cloud Run's startup probe passes before the rest of init runs
if (environment === "production") {
  const healthPort = Number.parseInt(process.env.PORT ?? "8080", 10);
  startHealthServer(healthPort);
}

await loadSecrets(environment);

await initStartupBackup(environment);

registerHeapSnapshotHandler();

initMediaProcessing();

// Probe Discord for Presence Intent approval (or honor an explicit override) before
// building the client, so the privileged intent is requested only when it is actually
// enabled. Approval is then picked up the moment Discord grants it, with no failed
// gateway handshake and no manual env change.
const includePresences = await resolvePresenceIntentEnabled(environment);
const client = createDiscordClient(includePresences);

await initDatabase(environment);

// GUILD_CREATE caches presences during login, so restore eligible pairs before connecting.
if (includePresences) {
  const presencePairs = await statRepository.getPresenceRetentionPairs();
  for (const pair of presencePairs) discordPresenceRetention.retain(pair.server_disc_id, pair.user_disc_id);
  log.info(`Discord presence retention initialized for ${presencePairs.length} guild-user pairs`);
}

await initLoaders(client);

await initBridges(client);

initTimers(client);

// Login triggers clientReady, which starts the deferred timers.
//
// A failure here has to exit rather than retry: `Client#login` awaits `client.destroy()`, which
// leaves `ws.destroyed` set (discord.js clears it only in the WebSocket manager constructor),
// drops `client.token`, and stops the cache sweepers. A second `login()` in the same process
// never reports ready, which the health endpoint reads as 503 and the runtime reads as a dead
// container. A rebuilt client is not an option either, because the Matrix bridge closes over the
// instance it was handed. The restart policy is the only path that yields a usable client.
//
// Exiting also keeps a transient gateway failure distinguishable from a misconfiguration.
try {
  await client.login(process.env.DISCORD_TOKEN);
} catch (error) {
  if (isDisallowedIntentsError(error)) {
    log.error(
      "Discord rejected login: a requested privileged intent is not approved for this bot. " +
        "This is unexpected because approval is probed before connecting. Check whether the " +
        "Presence Intent was revoked. Restarting will re-probe and boot without the intent " +
        "(presence context degrades gracefully).",
      error as Error,
    );
    process.exit(1);
  }

  const transient = isTransientGatewayError(error);
  log.error(
    transient
      ? "Discord login failed because the gateway is unreachable. The process will exit so the " +
          "container runtime restarts it with backoff; no action is needed if Discord recovers."
      : "Discord login failed",
    error as Error,
  );
  // Best effort: the handshake already failed, so this only avoids leaving a half-open socket and
  // a session Discord would hold until it times out.
  await client.destroy().catch(() => undefined);
  process.exit(1);
}

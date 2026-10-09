import { type ActivityOptions, ActivityType, type Client } from "discord.js";
// biome-ignore lint/correctness/noUnusedImports: For package version tagging in status
import _pkg from "../../../package.json";
import { log } from "../../utils/misc/logger";

// Cycle delay in milliseconds (1 minute)
const CYCLE_DELAY = 60000;

// Tomori's birthday (May 11)
const BIRTHDAY_MONTH = 4; // 0-indexed (April = 3, May = 4)
const BIRTHDAY_DAY = 11;

/**
 * Checks if today is Tomori's birthday (May 11).
 * @returns {boolean} True if today is May 11, false otherwise.
 */
function isTomoriBirthday(): boolean {
  const now = new Date();
  return now.getMonth() === BIRTHDAY_MONTH && now.getDate() === BIRTHDAY_DAY;
}

/**
 * Gets the server count from the database (including all servers and DM channels).
 * Falls back to Discord cache count on error.
 * @param client - The Discord client instance for fallback count.
 */
/*
async function getServerCount(client: Client): Promise<number> {
  try {
    const result = await sql<[{ count: string }]>`
			SELECT COUNT(*) as count
			FROM servers
		`;

    // sql returns count as string, parse to number
    const count = Number.parseInt(result[0]?.count || "0", 10);
    return count;
  } catch (error) {
    // Fall back to Discord cache if database query fails
    log.warn("Failed to get server count from database, using cache", {
      errorType: "DatabaseQueryError",
      metadata: { error },
    });
    return client.guilds.cache.size;
  }
}*/

/**
 * Posts the current Discord guild count to Top.gg once during startup.
 * Only runs in production and only when TOPGG_TOKEN is configured.
 * Non-critical, so failures are logged as warnings and do not affect startup.
 *
 * @param client - The Discord client instance (must be ready, provides bot ID and guild cache).
 */
async function postTopggStats(client: Client): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";
  const topggToken = process.env.TOPGG_TOKEN;

  if (!isProduction || !topggToken || !client.user) return;

  // Use the actual Discord guild count (guilds the bot has joined)
  const serverCount = client.guilds.cache.size;
  const botId = client.user.id;

  try {
    const response = await fetch(`https://top.gg/api/bots/${botId}/stats`, {
      method: "POST",
      headers: {
        Authorization: topggToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ server_count: serverCount }),
    });

    if (!response.ok) {
      log.warn(`Top.gg stats update failed: HTTP ${response.status}`, {
        errorType: "TopggApiError",
        metadata: { status: response.status, botId, serverCount },
      });
    } else {
      log.info(`Top.gg stats updated: ${serverCount} server(s)`);
    }
  } catch (error) {
    log.warn("Top.gg stats update failed (non-critical)", {
      errorType: "TopggNetworkError",
      metadata: { error },
    });
  }
}

/**
 * Sets the bot's status and logs startup information.
 */
const handler = async (client: Client): Promise<void> => {
  log.section(`Launching ${client.user?.tag} on Discord...`);

  log.success(`${client.user?.tag} up and running!`);

  await postTopggStats(client);

  log.section("Listening for error and info logs...");
  log.info(`Time started: [${new Date().toLocaleTimeString()}]`);

  const birthdayStatus: ActivityOptions = {
    name: "Celebrating my birthday!",
    type: ActivityType.Streaming,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // Required for Streaming type
  };

  /**
   * Updates the bot's status based on whether it's Tomori's birthday.
   * If it's May 11, shows birthday status; otherwise rotates through normal statuses.
   * Fetches server count from database for accurate status display.
   * Skips setting status if not in production environment.
   */
  async function updateStatus(): Promise<void> {
    if (!client.user) return;

    const isProduction = process.env.NODE_ENV === "production";
    if (!isProduction) {
      return;
    }

    if (isTomoriBirthday()) {
      client.user.setActivity(birthdayStatus);
    } else {
      const serverCount = client.guilds.cache.size;

      const normalStatus: ActivityOptions[] = [
        {
          name: `Commands Update! /update`,
          type: ActivityType.Playing,
        },
        {
          name: `Listening for /help in ${serverCount} servers`,
          type: ActivityType.Listening,
        },
      ];

      if (normalStatus.length > 0) {
        const random = Math.floor(Math.random() * normalStatus.length);
        client.user.setActivity(normalStatus[random]);
      }
    }
  }

  await updateStatus();

  setInterval(() => {
    void updateStatus(); // Use void to indicate intentional fire-and-forget
  }, CYCLE_DELAY);
};

export default handler;

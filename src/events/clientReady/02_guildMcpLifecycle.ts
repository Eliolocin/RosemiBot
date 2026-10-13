import { getGuildMcpManager } from "../../utils/mcp/guildMcpManager";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { statRepository } from "@/utils/db/repositories/StatRepository";
import { log } from "../../utils/misc/logger";
import type { ErrorContext } from "../../types/db/schema";

/**
 * Registers guild MCP shutdown cleanup and, outside production, pre-connects enabled guild servers.
 * Guild MCP servers are remote and administrator-registered; the bot starts no local MCP process.
 */
export default async (): Promise<void> => {
  try {
    log.section("Preparing guild MCP connections");

    const guildMcpManager = getGuildMcpManager();

    // Uses "once" to avoid double-fire, and re-raises the signal after cleanup
    // so the default handler (or other listeners) can terminate the process.
    const cleanupHandler = async (signal: string) => {
      log.info("Shutting down guild MCP connections...");
      await guildMcpManager.cleanup();
      // Drain any buffered usage stats so a normal restart loses nothing
      // (plan §4: graceful shutdown covers the documented crash window).
      await statRepository.shutdown();
      process.kill(process.pid, signal);
    };
    process.once("SIGINT", () => cleanupHandler("SIGINT"));
    process.once("SIGTERM", () => cleanupHandler("SIGTERM"));

    const runEnv = process.env.RUN_ENV || "development";
    if (runEnv !== "production") {
      try {
        const allEnabled = await toolRepository.loadAllEnabledMcpServers();
        if (allEnabled.length > 0) {
          log.info(`[GuildMCP] Dev mode: eager-connecting ${allEnabled.length} enabled guild MCP server(s)...`);
          // Non-blocking, so failures are logged but don't prevent startup
          guildMcpManager.eagerConnectAll(allEnabled).catch((err) => {
            log.warn("[GuildMCP] Eager connect encountered errors (non-fatal)", err);
          });
        } else {
          log.info("[GuildMCP] No enabled guild MCP servers found for eager connect");
        }
      } catch (error) {
        log.warn("[GuildMCP] Failed to load guild MCP servers for eager connect (non-fatal)", error);
      }
    } else {
      log.info("[GuildMCP] Production mode: guild MCP connections will be established on-demand");
    }
  } catch (error) {
    const context: ErrorContext = {
      errorType: "MCPInitializationError",
      metadata: { stage: "startup" },
    };

    await log.error("Error during guild MCP startup:", error, context);

    // Guild MCP is optional; built-in tools work without it.
    log.info("Bot will continue startup despite guild MCP startup failure");
  }
};

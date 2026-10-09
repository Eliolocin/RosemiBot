import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type AutocompleteInteraction,
} from "discord.js";
import { enrichErrorContext, runWithErrorContext } from "@/utils/misc/errorContextStore";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import { ColorCode, log } from "../../utils/misc/logger";
import type { UserRow, ErrorContext } from "../../types/db/schema";
import { DatabaseUnavailableError } from "@/types/errors";
import { cooldownRepository, serverRepository, statRepository, userRepository } from "@/utils/db/repositories";
import {
  loadCommandData,
  ROOT_COMMAND_EXECUTION_KEY,
  type CommandExecutionMap,
  type CommandCooldownMap,
  type CommandAutocompleteMap,
} from "../../utils/discord/commandLoader";
import { resolvePreferredDiscordDisplayName } from "../../utils/discord/displayName";
import { dispatchGlobalInteraction, isGlobalRoutableInteraction } from "@/utils/discord/interactions/router";
import { getCachedBlacklistStatus } from "@/utils/cache/userCache";
import { isBlacklistGatedCommand } from "@/utils/moderation/serverBlacklist";

// Cooldown for any command whose category is listed below, in milliseconds.
const DEFAULT_COOLDOWN_MS = 1_600;

// Every category except `persona` shares this window: the retired per-category overrides
// (COOLDOWN_CONFIG, COOLDOWN_MEMORY, COOLDOWN_TEACH, COOLDOWN_FORGET, COOLDOWN_SERVER,
// COOLDOWN_PERSONAL, COOLDOWN_CONDITIONING) all resolved to the same 3000 ms in practice.
const CATEGORY_COOLDOWN_MS = 3_000;
const COOLDOWN_PERSONA_MS = 10_000;

/**
 * Operators tune every cooldown with one unitless multiplier instead of per-category
 * milliseconds, so `/persona` stays proportionally longer than the rest whatever the scale.
 * 0 disables cooldowns; an unset or invalid value keeps the windows above unchanged.
 */
function parseCooldownScale(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) return 1;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

const COMMAND_COOLDOWN_SCALE = parseCooldownScale(process.env.COMMAND_COOLDOWN_SCALE);

const COOLDOWN_MAP = new Map<string, number>([
  ["config", CATEGORY_COOLDOWN_MS],
  ["persona", COOLDOWN_PERSONA_MS],
  ["memory", CATEGORY_COOLDOWN_MS],
  ["learn", CATEGORY_COOLDOWN_MS],
  ["server", CATEGORY_COOLDOWN_MS],
  ["personal", CATEGORY_COOLDOWN_MS],
  ["scheduled-task", CATEGORY_COOLDOWN_MS],
  ["conditioning", CATEGORY_COOLDOWN_MS],
  ["punish", CATEGORY_COOLDOWN_MS],
  ["reward", CATEGORY_COOLDOWN_MS],
  ["nuke", CATEGORY_COOLDOWN_MS],
  ["setup", CATEGORY_COOLDOWN_MS],
]);

type LoadedCommandMaps = {
  executionMap: CommandExecutionMap;
  cooldownMap: CommandCooldownMap;
  autocompleteMap: CommandAutocompleteMap;
};

// Cache for command execution maps - stored at module level
let executionMap: CommandExecutionMap | null = null;
let cooldownMap: CommandCooldownMap | null = null;

let autocompleteMap: CommandAutocompleteMap | null = null;

async function checkCooldown(userId: string, category: string): Promise<boolean> {
  return cooldownRepository.hasCommandCategoryCooldown(userId, category);
}

async function getRemainingCooldown(userId: string, category: string): Promise<number> {
  return cooldownRepository.getRemainingCommandCategoryCooldownSeconds(userId, category);
}

async function setCooldown(userId: string, category: string, duration: number): Promise<void> {
  await cooldownRepository.setCommandCategoryCooldown(userId, category, duration);
}

const handler = async (client: Client, interaction: Interaction): Promise<void> => {
  if (interaction.isAutocomplete()) {
    await runWithErrorContext(
      {
        source: "command_autocomplete",
        sourceDetail: interaction.commandName,
        userDiscId: interaction.user.id,
        serverDiscId: interaction.guildId ?? undefined,
        channelDiscId: interaction.channelId ?? undefined,
      },
      () => runAutocompleteCommand(client, interaction),
    );
    return;
  }

  if (interaction.isChatInputCommand()) {
    await runWithErrorContext(
      {
        source: "command",
        sourceDetail: interaction.commandName,
        userDiscId: interaction.user.id,
        serverDiscId: interaction.guildId,
        channelDiscId: interaction.channelId,
      },
      () => runChatInputCommand(client, interaction),
    );
    return;
  }

  if (isGlobalRoutableInteraction(interaction)) {
    await runWithErrorContext(
      {
        source: "interaction",
        sourceDetail: interaction.customId,
        userDiscId: interaction.user.id,
        serverDiscId: interaction.guildId,
        channelDiscId: interaction.channelId,
      },
      () => dispatchGlobalInteraction(client, interaction),
    );
  }
};

/**
 * Returns the three lookup maps rather than a boolean so callers get non-null locals. A boolean
 * cannot narrow the module-level caches, and both dispatch branches index them immediately.
 */
async function ensureCommandsLoaded(): Promise<LoadedCommandMaps | null> {
  if (executionMap && cooldownMap && autocompleteMap) {
    return { executionMap, cooldownMap, autocompleteMap };
  }

  log.info("Initializing command execution maps...");
  const loadedData = await loadCommandData();

  if (loadedData.executionMap.size === 0) {
    return null;
  }

  executionMap = loadedData.executionMap;
  cooldownMap = loadedData.cooldownMap;
  autocompleteMap = loadedData.autocompleteMap;

  // No command module exports a cooldown today, so the loader map arrives empty and the
  // module-level defaults are the only source of per-root durations.
  if (cooldownMap.size === 0) {
    for (const [category, duration] of COOLDOWN_MAP.entries()) {
      cooldownMap.set(category, duration);
    }
  }

  log.success("Command execution maps initialized.");
  return { executionMap, cooldownMap, autocompleteMap };
}

/**
 * @param commandName - Root command name, which doubles as its cooldown category
 * @param scale - Multiplier applied to the base window; defaults to `COMMAND_COOLDOWN_SCALE`
 * @returns Cooldown in milliseconds; 0 means the command has no cooldown
 */
export function resolveCommandCooldown(commandName: string, scale = COMMAND_COOLDOWN_SCALE): number {
  const baseMs = cooldownMap?.get(commandName) ?? COOLDOWN_MAP.get(commandName) ?? DEFAULT_COOLDOWN_MS;
  return Math.round(baseMs * scale);
}

const runChatInputCommand = async (client: Client, interaction: ChatInputCommandInteraction): Promise<void> => {
  // Determine locale early for potential error messages
  const initialLocale = interaction.locale ?? interaction.guildLocale ?? "en-US";

  try {
    const maps = await ensureCommandsLoaded();
    if (!maps) {
      void log.error("Command load produced no commands; will retry on next interaction.", undefined, {
        errorType: "CommandRouteMissing",
        metadata: { commandName: interaction.commandName, userDiscordId: interaction.user.id },
      });
      await replyInfoEmbed(
        interaction,
        initialLocale,
        {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        },
        MessageFlags.Ephemeral,
      );
      return;
    }

    const commandName = interaction.commandName; // The top-level command (category)
    const groupName = interaction.options.getSubcommandGroup(false); // The subcommand group (null for flat commands)
    const subcommandName = interaction.options.getSubcommand(false); // The specific subcommand (may be null)

    // Guild-only subcommand restrictions are now handled at the Discord registration level
    // Commands in guild-only categories (like "server") are automatically restricted to guilds

    const subcommandMap = maps.executionMap.get(commandName);
    if (!subcommandMap) {
      // Discord still offers this command, so every invocation fails until the deployment is fixed.
      // Not awaited (here or in the sibling branches): the error_logs insert would sit in front of
      // the interaction acknowledgement.
      void log.error(`Command category not found: ${commandName}`, undefined, {
        errorType: "CommandRouteMissing",
        metadata: { commandName, userDiscordId: interaction.user.id },
      });
      await replyInfoEmbed(
        interaction,
        initialLocale,
        {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        },
        MessageFlags.Ephemeral,
      );
      return;
    }

    const executionKey = subcommandName
      ? groupName
        ? `${groupName}.${subcommandName}`
        : subcommandName
      : ROOT_COMMAND_EXECUTION_KEY;

    const executeFunction = subcommandMap.get(executionKey);
    if (!executeFunction) {
      const fullCommandPath = groupName
        ? `${commandName} ${groupName} ${subcommandName}`
        : subcommandName
          ? `${commandName} ${subcommandName}`
          : commandName;
      void log.error(`Subcommand not found: ${fullCommandPath}`, undefined, {
        errorType: "CommandRouteMissing",
        metadata: { commandName: fullCommandPath, userDiscordId: interaction.user.id },
      });
      await replyInfoEmbed(
        interaction,
        initialLocale,
        {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        },
        MessageFlags.Ephemeral,
      );
      return;
    }

    const mainLogicPromise = async () => {
      if (
        interaction.guildId &&
        isBlacklistGatedCommand(commandName, groupName, subcommandName) &&
        (await getCachedBlacklistStatus(interaction.guildId, interaction.user.id))
      ) {
        await replyInfoEmbed(
          interaction,
          initialLocale,
          {
            titleKey: "general.errors.blacklisted_title",
            descriptionKey: "general.errors.blacklisted_description",
            color: ColorCode.WARN,
          },
          MessageFlags.Ephemeral,
        );
        return;
      }

      const cooldownDuration = resolveCommandCooldown(commandName);

      const isOnCooldown = cooldownDuration > 0 && (await checkCooldown(interaction.user.id, commandName));
      if (isOnCooldown) {
        const remainingSeconds = await getRemainingCooldown(interaction.user.id, commandName);
        await replyInfoEmbed(
          interaction,
          initialLocale,
          {
            titleKey: "general.cooldown_title",
            descriptionKey: "general.cooldown",
            descriptionVars: {
              seconds: remainingSeconds,
              category: commandName,
            },
            color: ColorCode.WARN,
          },
          MessageFlags.Ephemeral,
        );
        return;
      }

      if (cooldownDuration > 0) {
        await setCooldown(interaction.user.id, commandName, cooldownDuration);
      }

      let userData: UserRow | undefined;
      const existingUser = await userRepository.loadByDiscordId(interaction.user.id);

      if (existingUser) {
        userData = existingUser;
      } else {
        // Get locale to use for new user (works for both guilds and DMs)
        const userLanguage = interaction.locale;
        const memberDisplayName =
          interaction.member && typeof interaction.member === "object"
            ? "displayName" in interaction.member
              ? interaction.member.displayName
              : "nick" in interaction.member && typeof interaction.member.nick === "string"
                ? interaction.member.nick
                : null
            : null;

        // Use the userRepository.register helper (Rule #17) - works for both guild and DM contexts
        const registeredUser = await userRepository.register(
          interaction.user.id,
          resolvePreferredDiscordDisplayName({
            memberDisplayName,
            user: interaction.user,
          }),
          userLanguage,
        );

        if (registeredUser) {
          userData = registeredUser;
        }
      }

      const finalLocale = userData?.language_pref ?? interaction.guildLocale ?? "en-US";

      if (userData) {
        enrichErrorContext({ userId: userData.user_id });
        await executeFunction(client, interaction, userData, finalLocale);

        // Record command usage (fire-and-forget so stat tracking never adds
        // latency to the command response). command_used is persona-agnostic, so
        // it buffers under the lineage-0 sentinel. DM commands have no guild and
        // are skipped (stat_counters.server_id is a NOT NULL FK). The single
        // commandLoader dispatch path covers every slash command for free.
        const statUserId = userData.user_id;
        if (interaction.guildId && statUserId) {
          const guildId = interaction.guildId;
          // Record the full command path (category + optional group + subcommand,
          // space-joined) so stats distinguish subcommands like "config humanizer"
          // from "config message-fetch-limit"; top-level alone is too coarse for
          // underused-command detection.
          const fullCommandName = groupName
            ? `${commandName} ${groupName} ${subcommandName}`
            : subcommandName
              ? `${commandName} ${subcommandName}`
              : commandName;
          void (async () => {
            try {
              const internalServerId = await serverRepository.loadServerIdByDiscId(guildId);
              if (internalServerId) {
                statRepository.recordStat({
                  serverId: internalServerId,
                  userId: statUserId,
                  metric: "command_used",
                  metricKey: fullCommandName,
                });
              }
            } catch (statError) {
              log.warn(`Failed to record command_used stat for ${fullCommandName}: ${statError}`);
            }
          })();
        }
      } else {
        const context: ErrorContext = {
          errorType: "UserDataError",
          metadata: {
            userDiscordId: interaction.user.id,
            command: subcommandName ? `${commandName} ${subcommandName}` : commandName,
          },
        };
        await log.error("User data unavailable for command execution", undefined, context);

        await replyInfoEmbed(interaction, finalLocale, {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        });
      }
    };

    // Execute main command logic
    // Discord handles interaction timeouts natively, and helper functions
    // (awaitModalSubmit, awaitMessageComponent) have their own timeouts
    await mainLogicPromise();
  } catch (error) {
    const context: ErrorContext = {
      errorType: "CommandHandlingError",
      metadata: {
        commandName: interaction.commandName,
        groupName: interaction.options.getSubcommandGroup(false) ?? "none",
        subcommandName: interaction.options.getSubcommand(false),
        userDiscordId: interaction.user.id,
        guildDiscordId: interaction.guild?.id ?? "DM",
      },
    };
    await log.error(`Error in command handler for: ${interaction.commandName}`, error, context);

    // Reply to user with enhanced defensive error handling
    // The improved replyInfoEmbed function can now handle various interaction states more robustly
    try {
      // A pool retirement now reaches here as a typed error rather than as a plausible-looking
      // wrong answer, so the reply can say the run is worth repeating instead of implying the
      // command itself is broken.
      const isDatabaseUnavailable = error instanceof DatabaseUnavailableError;
      // Always attempt to use the helper function - it will handle the interaction state internally
      await replyInfoEmbed(interaction, initialLocale, {
        titleKey: isDatabaseUnavailable
          ? "general.errors.database_unavailable_title"
          : "general.errors.unknown_error_title",
        descriptionKey: isDatabaseUnavailable
          ? "general.errors.database_unavailable_description"
          : "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    } catch (replyError) {
      log.error(
        "Command handler error reply failed completely:",
        {
          originalError: error,
          replyError: replyError,
          interactionState: {
            id: interaction.id,
            commandName: interaction.commandName,
            deferred: interaction.deferred,
            replied: interaction.replied,
            user: interaction.user.id,
          },
        },
        context,
      );
    }
  }
};

const runAutocompleteCommand = async (client: Client, interaction: AutocompleteInteraction): Promise<void> => {
  try {
    const maps = await ensureCommandsLoaded();
    if (!maps) {
      await interaction.respond([]);
      return;
    }

    const commandName = interaction.commandName;
    const groupName = interaction.options.getSubcommandGroup(false);
    const subcommandName = interaction.options.getSubcommand(false);

    const subcommandMap = maps.autocompleteMap.get(commandName);
    if (!subcommandMap) {
      await interaction.respond([]);
      return;
    }

    const executionKey = subcommandName
      ? groupName
        ? `${groupName}.${subcommandName}`
        : subcommandName
      : ROOT_COMMAND_EXECUTION_KEY;

    const autocompleteHandler = subcommandMap.get(executionKey);
    if (!autocompleteHandler) {
      await interaction.respond([]);
      return;
    }

    await autocompleteHandler(client, interaction);
  } catch (error) {
    const context: ErrorContext = {
      errorType: "AutocompleteHandlingError",
      metadata: {
        commandName: interaction.commandName,
        groupName: interaction.options.getSubcommandGroup(false) ?? "none",
        subcommandName: interaction.options.getSubcommand(false),
        userDiscordId: interaction.user.id,
        guildDiscordId: interaction.guild?.id ?? "DM",
      },
    };
    await log.error(`Error in autocomplete handler for: ${interaction.commandName}`, error, context);

    try {
      if (!interaction.responded) {
        await interaction.respond([]);
      }
    } catch {
      // The interaction is already gone or acknowledged; there is nothing further to answer with.
    }
  }
};

export default handler;

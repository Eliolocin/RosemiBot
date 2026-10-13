import {
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { getMessageProxyWaitMs } from "@/utils/messageProxy/proxyExpectation";
import { messageProxyInstanceRepository } from "@/utils/db/repositories/MessageProxyInstanceRepository";
import { getPluralBuddyAccessToken } from "@/utils/messageProxy/services/pluralbuddy/oauthTokens";
import {
  MESSAGE_PROXY_DISABLED_SERVICE_ID,
  MESSAGE_PROXY_SERVICE_DESCRIPTORS,
  getMessageProxyServiceChoices,
  type MessageProxyServiceSelection,
} from "@/utils/messageProxy/registry";
import { userRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

function formatDelaySeconds(waitMs: number): string {
  return (waitMs / 1000).toFixed(1).replace(/\.0$/, "");
}

function serviceLocaleKey(serviceId: MessageProxyServiceSelection): string {
  if (serviceId === MESSAGE_PROXY_DISABLED_SERVICE_ID) return "none_option";
  return (
    MESSAGE_PROXY_SERVICE_DESCRIPTORS.find((descriptor) => descriptor.serviceId === serviceId)?.settingsLocaleKey ??
    "none_option"
  );
}

function selectionLabel(locale: string, serviceId: MessageProxyServiceSelection, instanceName: string | null): string {
  const service = localizer(locale, `commands.personal.message-proxy.${serviceLocaleKey(serviceId)}`);
  return instanceName ? `${service} (${instanceName})` : service;
}

function enabledSuccessDescriptionLocaleKey(serviceId: Exclude<MessageProxyServiceSelection, "none">): string {
  const descriptor = MESSAGE_PROXY_SERVICE_DESCRIPTORS.find((candidate) => candidate.serviceId === serviceId);
  if (!descriptor) throw new Error(`Missing message-proxy descriptor for enabled service: ${serviceId}`);
  return descriptor.enabledSuccessDescriptionLocaleKey;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("message-proxy")
    .setDescription(localizer("en-US", "commands.personal.message-proxy.description"))
    .addStringOption((option) =>
      option
        .setName("service")
        .setDescription(localizer("en-US", "commands.personal.message-proxy.service_description"))
        .setRequired(true)
        .addChoices(
          ...getMessageProxyServiceChoices().map((serviceId) => ({
            name: localizer("en-US", `commands.personal.message-proxy.${serviceLocaleKey(serviceId)}`),
            value: serviceId,
          })),
        ),
    )
    .addStringOption((option) =>
      option
        .setName("instance")
        .setDescription(localizer("en-US", "commands.personal.message-proxy.instance_description"))
        .setAutocomplete(true),
    );

export async function autocomplete(_client: Client, interaction: AutocompleteInteraction): Promise<void> {
  const serviceId = interaction.options.getString("service");
  if (serviceId !== "pluralkit" && serviceId !== "pluralbuddy") {
    await interaction.respond([]);
    return;
  }
  const instances = await messageProxyInstanceRepository.listEnabled(serviceId, interaction.options.getFocused());
  await interaction.respond(
    instances.map((instance) => ({
      name: `${instance.displayName} (${instance.origin})`.slice(0, 100),
      value: instance.instanceId,
    })),
  );
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = userData.user_id;
  if (userId === undefined) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  try {
    const requestedService = interaction.options.getString("service", true) as MessageProxyServiceSelection;
    const requestedInstanceId = interaction.options.getString("instance");
    if (!getMessageProxyServiceChoices().includes(requestedService)) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (requestedService === MESSAGE_PROXY_DISABLED_SERVICE_ID && requestedInstanceId) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }
    const instance =
      requestedService === MESSAGE_PROXY_DISABLED_SERVICE_ID
        ? null
        : await messageProxyInstanceRepository.getEnabled(requestedService, requestedInstanceId);
    if (requestedService !== MESSAGE_PROXY_DISABLED_SERVICE_ID && !instance) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.message-proxy.instance_unavailable_title",
        descriptionKey: "commands.personal.message-proxy.instance_unavailable_description",
        color: ColorCode.WARN,
      });
      return;
    }

    if (requestedService === "pluralbuddy" && instance && !(await getPluralBuddyAccessToken(instance))) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.message-proxy.pluralbuddy_unavailable_title",
        descriptionKey: "commands.personal.message-proxy.pluralbuddy_unavailable_description",
        color: ColorCode.WARN,
      });
      return;
    }

    if (
      requestedService === userData.message_proxy_service &&
      (userData.message_proxy_instance_id ?? (instance ? `${requestedService}:official` : null)) ===
        (instance?.instanceId ?? null)
    ) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.message-proxy.already_selected_title",
        descriptionKey: "commands.personal.message-proxy.already_selected_description",
        descriptionVars: {
          service: selectionLabel(locale, requestedService, instance?.displayName ?? null),
        },
        color: ColorCode.WARN,
      });
      return;
    }

    const updated = await userRepository.setMessageProxyService(userId, requestedService, instance?.instanceId);
    if (!updated) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const isDisabled = requestedService === MESSAGE_PROXY_DISABLED_SERVICE_ID;
    await replyInfoEmbed(interaction, locale, {
      titleKey: isDisabled
        ? "commands.personal.message-proxy.disabled_success_title"
        : "commands.personal.message-proxy.enabled_success_title",
      descriptionKey: isDisabled
        ? "commands.personal.message-proxy.disabled_success_description"
        : enabledSuccessDescriptionLocaleKey(requestedService),
      descriptionVars: isDisabled
        ? undefined
        : {
            service: selectionLabel(locale, requestedService, instance?.displayName ?? null),
            delay_seconds: formatDelaySeconds(getMessageProxyWaitMs()),
          },
      color: ColorCode.SUCCESS,
    });

    log.info(
      `User ${interaction.user.id} (${userData.user_nickname}) set message_proxy_service to ${requestedService}`,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal message-proxy",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Error executing /personal message-proxy for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

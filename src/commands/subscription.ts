import type { SlashCommandBuilder } from "discord.js";
import { isSupporterBillingEnabled } from "@/modules/supporter-billing/config";
import { executeSubscriptionCommand } from "@/modules/supporter-billing/subscribe";
import { resolveEnvironment } from "@/types/config";
import { localizer } from "@/utils/text/localizer";

export const configureCommand = (command: SlashCommandBuilder) =>
  command.setName("subscription").setDescription(localizer("en-US", "commands.subscription.description"));

export const isCommandEnabled = () => isSupporterBillingEnabled(resolveEnvironment());

export const execute = executeSubscriptionCommand;

import type { SlashCommandBuilder } from "discord.js";
import { isSupporterBillingEnabled } from "@/modules/supporter-billing/config";
import { executeSubscribeCommand } from "@/modules/supporter-billing/subscribe";
import { resolveEnvironment } from "@/types/config";
import { localizer } from "@/utils/text/localizer";

export const configureCommand = (command: SlashCommandBuilder) =>
  command.setName("subscribe").setDescription(localizer("en-US", "commands.subscribe.description"));

export const isCommandEnabled = () => isSupporterBillingEnabled(resolveEnvironment());

export const execute = executeSubscribeCommand;

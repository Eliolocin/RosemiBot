import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { showSubscriptionSurface } from "@/modules/supporter-billing/subscribe/components";

export async function executeSubscribeCommand(
  client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await showSubscriptionSurface(client, interaction, locale);
}

export async function executeSubscriptionCommand(
  client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await showSubscriptionSurface(client, interaction, locale, { account: true });
}

export * from "@/modules/supporter-billing/subscribe/components";
export * from "@/modules/supporter-billing/subscribe/panel";
export * from "@/modules/supporter-billing/subscribe/state";
export * from "@/modules/supporter-billing/subscribe/types";

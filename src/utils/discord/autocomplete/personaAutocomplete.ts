import type { ApplicationCommandOptionChoiceData, AutocompleteInteraction, Client } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { userRepository } from "@/utils/db/repositories";
import { getCachedWhitelistStatus } from "@/utils/cache/channelWhitelistCache";
import { getCachedPersonalSpotlightStatus } from "@/utils/cache/personalSpotlightCache";
import { filterPersonasForTrigger } from "@/utils/persona/personaAccess";
import { safeSelectOptionText } from "@/utils/discord/ui/interactionCore";
import type { CommandAutocompleteFunction } from "@/utils/discord/commandLoader";

import { getCachedTomoriState, getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";

function rankPersonasByNickname<T extends { persona_nickname?: string | null }>(
  personas: readonly T[],
  focusedValue: string,
): readonly T[] {
  if (!focusedValue) {
    return personas;
  }

  const exact: T[] = [];
  const prefix: T[] = [];
  const substring: T[] = [];

  for (const p of personas) {
    const nickname = (p.persona_nickname ?? "").toLowerCase();
    if (nickname === focusedValue) {
      exact.push(p);
    } else if (nickname.startsWith(focusedValue)) {
      prefix.push(p);
    } else if (nickname.includes(focusedValue)) {
      substring.push(p);
    }
  }

  return [...exact, ...prefix, ...substring];
}

/**
 * Answers a persona autocomplete with every persona in the workspace that passes `include`, ranked
 * by nickname match, ignoring channel whitelists and spotlights.
 *
 * @param leadingChoices - Non-persona entries listed first while their name matches the typed text
 */
export async function respondWithPersonaChoices(
  interaction: AutocompleteInteraction,
  serverDiscId: string | undefined,
  include: (persona: TomoriState) => boolean = () => true,
  leadingChoices: readonly ApplicationCommandOptionChoiceData<string>[] = [],
): Promise<void> {
  let responded = false;
  try {
    if (!serverDiscId) {
      responded = true;
      await interaction.respond([]);
      return;
    }

    const personas = (await getCachedAllPersonas(serverDiscId)).filter(include);
    const focusedValue = (interaction.options.getFocused() || "").toLowerCase();
    const filtered = rankPersonasByNickname(personas, focusedValue);
    const leading = leadingChoices.filter((choice) => choice.name.toLowerCase().includes(focusedValue));

    responded = true;
    await interaction.respond(
      [
        ...leading,
        ...filtered.map((p) => ({
          name: safeSelectOptionText(p.persona_nickname ?? "Unknown Persona", 100),
          value: String(p.persona_id),
        })),
      ].slice(0, 25),
    );
  } catch {
    if (!responded) {
      try {
        await interaction.respond([]);
      } catch {
        // Autocomplete must fail silently if respond throws
      }
    }
  }
}

/**
 * Suggests every persona on the server, ignoring channel whitelists and spotlights, for commands
 * that inspect a persona rather than trigger it (`/stats persona`, `/context`).
 */
export const handleServerPersonaAutocomplete: CommandAutocompleteFunction = async (
  _client: Client,
  interaction: AutocompleteInteraction,
): Promise<void> => respondWithPersonaChoices(interaction, interaction.guild?.id);

/**
 * Like `handleServerPersonaAutocomplete`, but a DM resolves to the user's own workspace, for commands
 * that also run in DMs (`/persona export`).
 */
export const handleWorkspacePersonaAutocomplete: CommandAutocompleteFunction = async (
  _client: Client,
  interaction: AutocompleteInteraction,
): Promise<void> => respondWithPersonaChoices(interaction, interaction.guild?.id ?? interaction.user.id);

/**
 * Shaped as `CommandAutocompleteFunction` so a module can export it directly. The client is unused
 * but must stay in the signature: a shorter one still assigns cleanly and would silently receive
 * the client as its first argument.
 */
export const handlePersonaAutocomplete: CommandAutocompleteFunction = async (
  _client: Client,
  interaction: AutocompleteInteraction,
): Promise<void> => {
  try {
    if (!interaction.guild || !interaction.channel) {
      await interaction.respond([]);
      return;
    }

    const tomoriState = await getCachedTomoriState(interaction.guild.id);
    if (!tomoriState) {
      await interaction.respond([]);
      return;
    }

    const allPersonas = await getCachedAllPersonas(interaction.guild.id);
    if (allPersonas.length === 0) {
      await interaction.respond([]);
      return;
    }

    const invokingMember = interaction.guild.members.cache.get(interaction.user.id);
    const memberRoleDiscIds = invokingMember?.roles.cache.map((role) => role.id);

    const guildChannel = interaction.guild.channels.cache.get(interaction.channel.id) ?? interaction.channel;
    const isThread =
      "isThread" in guildChannel && typeof guildChannel.isThread === "function" && guildChannel.isThread();
    const parentChannelId = isThread && "parent" in guildChannel ? guildChannel.parent?.id : undefined;

    const whitelistStatus = await getCachedWhitelistStatus(
      interaction.guild.id,
      interaction.channel.id,
      memberRoleDiscIds,
      parentChannelId,
    );

    const userRow = await userRepository.loadByDiscordId(interaction.user.id);
    const personalSpotlightStatus = userRow?.user_id
      ? await getCachedPersonalSpotlightStatus(
          tomoriState.server_id,
          userRow.user_id,
          parentChannelId ?? interaction.channel.id,
        )
      : null;

    const eligiblePersonas = filterPersonasForTrigger(allPersonas, whitelistStatus, personalSpotlightStatus);

    if (eligiblePersonas.length === 0) {
      await interaction.respond([]);
      return;
    }

    const focusedValue = (interaction.options.getFocused() || "").toLowerCase();
    const filtered = rankPersonasByNickname(eligiblePersonas, focusedValue);

    const limited = filtered.slice(0, 25);

    const choices = limited.map((p) => ({
      name: safeSelectOptionText(p.persona_nickname ?? "Unknown Persona", 100),
      value: String(p.persona_id),
    }));

    await interaction.respond(choices);
  } catch (error) {
    // Autocomplete must always answer, even on failure.
    try {
      await interaction.respond([]);
    } catch {
      // The dispatcher still logs and attempts its own fallback answer.
    }
    throw error;
  }
};

import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import {
  type MemoryExportDependencies,
  PERSONAL_MEMORY_EXPORT_SELECTIONS,
  respondWithMemoryExportPersonas,
  runMemoryExport,
} from "@/commands/export/memoriesExportOperation";
import type { UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";

const SCOPE_LABEL_KEYS: Record<(typeof PERSONAL_MEMORY_EXPORT_SELECTIONS)[number], string> = {
  global: "commands.export.personal.memories.scope_choice_global",
  persona: "commands.export.personal.memories.scope_choice_persona",
  all: "commands.export.personal.memories.scope_choice_all",
};

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("memories")
    .setDescription(localizer("en-US", "commands.export.personal.memories.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.export.personal.memories.scope_description"))
        .setRequired(true)
        .addChoices(
          ...PERSONAL_MEMORY_EXPORT_SELECTIONS.map((value) => ({
            name: localizer("en-US", SCOPE_LABEL_KEYS[value]),
            value,
          })),
        ),
    )
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription(localizer("en-US", "commands.export.personal.memories.persona_description"))
        .setRequired(false)
        .setAutocomplete(true),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
  deps: Partial<MemoryExportDependencies> = {},
): Promise<void> {
  await runMemoryExport(
    interaction,
    locale,
    "personal",
    interaction.options.getString("scope"),
    interaction.options.getString("persona"),
    deps,
  );
}

export const autocomplete = async (_client: Client, interaction: AutocompleteInteraction): Promise<void> =>
  respondWithMemoryExportPersonas(interaction);

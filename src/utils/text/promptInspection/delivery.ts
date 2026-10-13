import { resolveRequestMaxOutputTokens } from "@/utils/provider/modelLimits";
import { AttachmentBuilder, EmbedBuilder, type InteractionEditReplyOptions, type User } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { PromptInspection } from "@/utils/text/promptInspection/assemble";
import { buildJsonSnapshot, buildRequestConfig, buildTextSnapshot } from "@/utils/text/promptInspection/serialize";

export type PromptSnapshotFormat = "text" | "json";

/**
 * Whether a member may receive the full prompt text. Token counts stay visible to everyone; the
 * text itself carries other members' memories and the server's prompts, so it is gated.
 */
export function canViewPromptText(
  memberPermissions: { has(permission: "ManageGuild"): boolean } | null,
  tomoriState: TomoriState,
): boolean {
  return (memberPermissions?.has("ManageGuild") ?? false) || (tomoriState.config.prompt_snapshot_enabled ?? false);
}

export interface PromptSnapshotDelivery {
  inspection: PromptInspection;
  format: PromptSnapshotFormat;
  guildId: string;
  user: User;
  locale: string;
  /** Whether the user asked for tool schemas, which TXT omits even when they were requested. */
  toolsRequested: boolean;
  /** `/tool prompt snapshot` points users at its own options; `/context` has buttons instead. */
  includeRerunHints: boolean;
  editReply(options: InteractionEditReplyOptions): Promise<unknown>;
}

/**
 * Sends the snapshot file to the user's DMs, falling back to the private reply when DMs are closed.
 */
export async function deliverPromptSnapshot(delivery: PromptSnapshotDelivery): Promise<void> {
  const { inspection, format, locale, toolsRequested } = delivery;
  const { selectedPersona, providerName, modelName, toolsData } = inspection;

  // Both output formats show the request config in the DM, while JSON also
  // stores it at the top level for machine-readable inspection.
  const requestConfig = buildRequestConfig(
    inspection.answeringState,
    providerName,
    modelName,
    await resolveRequestMaxOutputTokens(inspection.answeringState),
  );

  let fileContent: string;
  let fileName: string;
  const fileStem = `prompt-snapshot-${inspection.channelId}-${selectedPersona.persona_lineage_id}-${Date.now()}`;

  if (format === "json") {
    const snapshotData = await buildJsonSnapshot(
      inspection.contextItems,
      inspection.answeringState,
      providerName,
      modelName,
      toolsData,
      requestConfig,
    );
    fileContent = JSON.stringify(snapshotData, null, 2);
    fileName = `${fileStem}.json`;
  } else {
    fileContent = buildTextSnapshot(inspection.contextItems);
    fileName = `${fileStem}.txt`;
  }

  const attachment = new AttachmentBuilder(Buffer.from(fileContent, "utf-8"), { name: fileName });
  const formatLabel = format === "json" ? "JSON" : "Text";

  const descriptionParts: string[] = [];
  descriptionParts.push(
    localizer(locale, "commands.tool.prompt.snapshot.dm_description", {
      persona_name: selectedPersona.persona_nickname,
      format: formatLabel,
    }),
  );
  descriptionParts.push(
    [
      "```yaml",
      `server_id: ${delivery.guildId}`,
      `channel: #${inspection.channelName}`,
      `persona: ${selectedPersona.persona_nickname}`,
      `provider: ${providerName}`,
      `model: ${modelName}`,
      `preset: ${inspection.presetName ?? "(native)"}`,
      `captured: ${inspection.capturedAt}`,
      "```",
    ].join("\n"),
  );
  descriptionParts.push(
    [
      localizer(locale, "commands.tool.prompt.snapshot.dm_config_heading"),
      "```json",
      JSON.stringify(requestConfig, null, 2),
      "```",
    ].join("\n"),
  );
  if (format === "text") {
    descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.dm_txt_headers_note"));
    if (delivery.includeRerunHints) {
      descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.dm_hint_try_json"));
      if (toolsRequested) {
        descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.dm_tools_txt_note"));
      }
    }
  } else {
    if (delivery.includeRerunHints) {
      descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.dm_hint_try_text"));
    }
    if (toolsRequested) {
      descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.dm_tools_filtering_note"));
    }
  }
  if (inspection.historyPairsDropped > 0) {
    descriptionParts.push(
      localizer(locale, "commands.tool.prompt.snapshot.dm_truncated_note", { count: inspection.historyPairsDropped }),
    );
  }
  const dmDescription = descriptionParts.join("\n\n");

  try {
    await delivery.user.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.tool.prompt.snapshot.dm_title"))
          .setDescription(dmDescription)
          .setColor(ColorCode.INFO),
      ],
      files: [attachment],
    });

    await delivery.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizedStatusTitle(locale, "commands.tool.prompt.snapshot.success_title", ColorCode.SUCCESS))
          .setDescription(localizer(locale, "commands.tool.prompt.snapshot.success_description"))
          .setColor(ColorCode.SUCCESS),
      ],
    });
  } catch (dmError) {
    log.warn(`Failed to DM prompt snapshot to user ${delivery.user.id}:`, dmError as Error);
    await delivery.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizedStatusTitle(locale, "commands.tool.prompt.snapshot.dm_failed_title", ColorCode.WARN))
          .setDescription(
            `${localizer(locale, "commands.tool.prompt.snapshot.dm_failed_description")}\n\n${dmDescription}`,
          )
          .setColor(ColorCode.WARN),
      ],
      files: [attachment],
    });
  }
}

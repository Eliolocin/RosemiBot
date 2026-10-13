import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ActionRowData,
  type ButtonComponentData,
  type ComponentInContainerData,
  type TopLevelComponentData,
} from "discord.js";
import { getLastReplyUsage } from "@/utils/cache/lastReplyUsageCache";
import { buildInteractionRouteId } from "@/utils/discord/interactions/routeRegistry";
import { buildPanelContainer } from "@/utils/discord/ui/panel";
import { resolveModelPricing } from "@/utils/provider/modelPricing";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { localizer } from "@/utils/text/localizer";
import type { PromptInspection } from "@/utils/text/promptInspection/assemble";
import {
  type ContextGrid,
  type ContextUsage,
  layoutContextGrid,
  measureContextUsage,
} from "@/utils/text/promptInspection/contextUsage";
import type { PromptSnapshotFormat } from "@/utils/text/promptInspection/delivery";

export const CONTEXT_ROUTE_NAMESPACE = "context";
export const CONTEXT_ROUTE_VERSION = "v1";

export interface ContextUsagePanelPayload {
  components: TopLevelComponentData[];
  flags: MessageFlags.IsComponentsV2;
}

/**
 * The button route carries the persona ID rather than the built prompt, so a click rebuilds the
 * snapshot from current state like every other panel route.
 */
function buildContextSnapshotRouteId(personaId: number, format: PromptSnapshotFormat): string {
  return buildInteractionRouteId(CONTEXT_ROUTE_NAMESPACE, CONTEXT_ROUTE_VERSION, "snapshot", String(personaId), format);
}

function formatTokens(locale: string, tokens: number): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(tokens);
}

function formatInputCost(locale: string, tokens: number, pricePerMillion: number): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumSignificantDigits: 2 }).format(
    (tokens / 1_000_000) * pricePerMillion,
  );
}

function formatShare(locale: string, tokens: number, capacityTokens: number): string {
  const share = capacityTokens > 0 ? tokens / capacityTokens : 0;
  // One decimal rounds a small segment of a large window to "0%", which reads as empty.
  const digits = share > 0 && share < 0.01 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 1 };
  return new Intl.NumberFormat(locale, { style: "percent", ...digits }).format(share);
}

function buildSnapshotButtonRow(
  locale: string,
  personaId: number,
  canViewText: boolean,
): ActionRowData<ButtonComponentData> {
  return {
    type: ComponentType.ActionRow,
    components: (["text", "json"] as const).map((format) => ({
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId: buildContextSnapshotRouteId(personaId, format),
      label: localizer(locale, `commands.context.view_${format}_button`),
      disabled: !canViewText,
    })),
  };
}

function buildUsageLine(locale: string, inspection: PromptInspection, usage: ContextUsage): string {
  if (!inspection.budget) {
    return localizer(locale, "commands.context.usage_unknown_window", {
      used: formatTokens(locale, usage.inputTokens),
    });
  }
  return localizer(locale, "commands.context.usage_line", {
    used: formatTokens(locale, usage.inputTokens),
    window: formatTokens(locale, inspection.budget.contextLength),
    share: formatShare(locale, usage.inputTokens, inspection.budget.contextLength),
  });
}

/** The grid's key as one quote block: what a cell stands for, then each part with its figures. */
function buildLegend(locale: string, grid: ContextGrid): string {
  const legendLines: string[] = [
    localizer(locale, "commands.context.scale_line", { tokens: formatTokens(locale, grid.tokensPerCell) }),
  ];
  if (grid.hasCircles) {
    legendLines.push(localizer(locale, "commands.context.circle_line"));
  }
  for (const part of grid.parts) {
    legendLines.push(
      localizer(locale, "commands.context.legend_line", {
        emoji: part.glyph,
        label: localizer(locale, `commands.context.segment_${part.id}`),
        tokens: formatTokens(locale, part.tokens),
        share: formatShare(locale, part.tokens, grid.capacityTokens),
      }),
    );
  }
  return legendLines
    .flatMap((line) => line.split("\n"))
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * The estimated input cost of one reply, and the provider-reported size of the last real one. Each
 * line is left out when its figure is unknown: no catalog price, or no reply from this model yet.
 */
function buildMeasurementLines(
  locale: string,
  inspection: PromptInspection,
  usage: ContextUsage,
  providerLabel: string,
): string[] {
  const lines: string[] = [];

  const pricing = resolveModelPricing(inspection.answeringState);
  if (pricing) {
    lines.push(
      localizer(locale, "commands.context.cost_line", {
        cost: formatInputCost(locale, usage.inputTokens, pricing.input),
      }),
    );
  }

  const personaId = inspection.selectedPersona.persona_id;
  const lastReply = typeof personaId === "number" ? getLastReplyUsage(inspection.channelId, personaId) : undefined;
  if (lastReply && lastReply.modelCodename === inspection.modelName) {
    lines.push(
      localizer(locale, "commands.context.last_reply_line", {
        tokens: formatTokens(locale, lastReply.inputTokens),
        provider: providerLabel,
      }),
    );
  }

  return lines;
}

/**
 * Renders the context window as an emoji grid with a legend, followed by the snapshot buttons.
 * Members without full-prompt access see the buttons disabled, so they learn the view exists.
 *
 * Prose formatting is off: its hard wrap breaks legend lines at a fixed width, while Discord's own
 * soft wrap fits each client.
 */
export function buildContextUsagePayload(
  locale: string,
  inspection: PromptInspection,
  canViewText: boolean,
): ContextUsagePanelPayload {
  const usage = measureContextUsage(inspection.contextItems, inspection.toolsData);
  const grid = layoutContextGrid(usage, inspection.budget);
  const providerLabel = getProviderDisplayName(inspection.answeringState.llm.llm_provider);

  const headerLines = [
    `### ${localizer(locale, "commands.context.title")}`,
    localizer(locale, "commands.context.target_line", {
      persona_name: inspection.selectedPersona.persona_nickname,
      model: inspection.modelName,
      provider: providerLabel,
    }),
    buildUsageLine(locale, inspection, usage),
    ...buildMeasurementLines(locale, inspection, usage, providerLabel),
  ];

  const footnotes = [
    localizer(locale, "commands.context.estimate_note"),
    localizer(locale, "commands.context.not_counted_note"),
  ];
  if (inspection.historyPairsDropped > 0) {
    footnotes.unshift(localizer(locale, "commands.context.truncated_note", { count: inspection.historyPairsDropped }));
  }
  if (!canViewText) {
    footnotes.push(localizer(locale, "commands.context.text_locked_note"));
  }

  const containerComponents: ComponentInContainerData[] = [
    { type: ComponentType.TextDisplay, content: headerLines.join("\n") },
  ];
  if (grid.rows.length > 0) {
    containerComponents.push(
      { type: ComponentType.TextDisplay, content: grid.rows.join("\n") },
      { type: ComponentType.TextDisplay, content: buildLegend(locale, grid) },
    );
  }
  containerComponents.push({
    type: ComponentType.TextDisplay,
    content: footnotes.map((note) => `-# ${note}`).join("\n"),
  });

  const personaId = inspection.selectedPersona.persona_id;
  if (typeof personaId === "number") {
    containerComponents.push(buildSnapshotButtonRow(locale, personaId, canViewText));
  }

  return {
    components: [buildPanelContainer(containerComponents, undefined, { formatProse: false })],
    flags: MessageFlags.IsComponentsV2,
  };
}

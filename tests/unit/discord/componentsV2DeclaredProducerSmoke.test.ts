import { beforeAll, describe, expect, it } from "bun:test";
import { type BaseMessageOptions, ButtonStyle, MessageFlags } from "discord.js";
import { terminalPayload as buildConfigTerminalPayload } from "@/utils/discord/interactions/configRouteContext";
import { terminalPayload as buildPersonalConfigTerminalPayload } from "@/utils/discord/interactions/personalConfigRouteContext";
import { buildGeneratedImageComponentsV2Payload } from "@/utils/discord/generatedImageMessage";
import { buildGeneratedVideoComponentsV2Payload } from "@/utils/discord/generatedVideoMessage";
import { ContextItemTag } from "@/types/misc/context";
import { buildContextUsagePayload } from "@/utils/discord/ui/contextUsagePanel";
import { buildRangeSelectorPayload } from "@/utils/discord/ui/interactionCore";
import { buildPersonaWorkflowNotice } from "@/utils/discord/ui/personaWorkflow";
import {
  type ComponentsV2MessagePayload,
  validateComponentsV2MessageLimits,
} from "@/utils/discord/ui/componentsV2Limits";
import { buildStatsDashboardPayload, type StatsTab } from "@/utils/stats/statsDashboard";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";

beforeAll(async () => initializeLocalizer());

/**
 * What the declared producers return: Discord's own option types, whose `components` admit raw API
 * JSON and builders and whose `flags` differ between the create and edit variants.
 */
interface ProducerComponentsV2Payload {
  components?: BaseMessageOptions["components"];
  flags?: unknown;
}

function assertValidPayload(payload: ProducerComponentsV2Payload, label: string): void {
  expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
  // Every producer here emits literal component data, so the payload narrows to the validator's
  // contract at this boundary rather than carrying Discord's wider option types into it.
  const result = validateComponentsV2MessageLimits(payload as ComponentsV2MessagePayload);
  expect(result.valid, `${label} violations: ${JSON.stringify(result.violations)}`).toBe(true);
}

describe("Declared Components V2 producer smoke fixtures", () => {
  it("validates the config route terminal payload", () => {
    assertValidPayload(
      buildConfigTerminalPayload("en-US", "general.errors.permission_denied_description"),
      "configRouteContext.terminalPayload",
    );
  });

  it("validates the personal config route terminal payload", () => {
    assertValidPayload(
      buildPersonalConfigTerminalPayload("en-US", "general.errors.permission_denied_description"),
      "personalConfigRouteContext.terminalPayload",
    );
  });

  it("validates generated image and video payload builders", () => {
    assertValidPayload(
      buildGeneratedImageComponentsV2Payload("generated.png", 1_250, "en-US", ["Mirri"]),
      "generatedImageMessage.buildGeneratedImageComponentsV2Payload",
    );
    assertValidPayload(
      buildGeneratedVideoComponentsV2Payload("generated.mp4", 2_500, "en-US"),
      "generatedVideoMessage.buildGeneratedVideoComponentsV2Payload",
    );
  });

  it("validates the shared interaction-core range selector payload", () => {
    assertValidPayload(
      buildRangeSelectorPayload("en-US", "smoke-range", 26, 0),
      "interactionCore.buildRangeSelectorPayload",
    );
  });

  it("validates the persona workflow notice payload", () => {
    assertValidPayload(
      buildPersonaWorkflowNotice({
        locale: "en-US",
        titleKey: "general.persona_workflow.modal_ready_title",
        descriptionKey: "general.persona_workflow.modal_ready_description",
        button: {
          customId: "smoke-open",
          labelKey: "general.persona_workflow.open_modal_button",
          style: ButtonStyle.Secondary,
        },
      }),
      "personaWorkflow.buildPersonaWorkflowNotice",
    );
  });

  it("validates the context usage payload with every segment and note present", () => {
    const persona = createPersona();
    const segmentTags = [
      ContextItemTag.SYSTEM_HUMANIZER_RULES,
      ContextItemTag.SYSTEM_PERSONALITY,
      ContextItemTag.KNOWLEDGE_SERVER_INFO,
      ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
      ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
      ContextItemTag.DIALOGUE_HISTORY,
      ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS,
    ];
    assertValidPayload(
      buildContextUsagePayload(
        "en-US",
        {
          selectedPersona: persona,
          answeringState: persona,
          providerName: "google",
          modelName: "gemini-2.5-pro",
          channelId: "123456789012345678",
          channelName: "general",
          presetName: null,
          capturedAt: new Date(0).toISOString(),
          contextItems: segmentTags.map((metadataTag) => ({
            role: "system",
            parts: [{ type: "text", text: "x".repeat(4_000) }],
            metadataTag,
          })),
          toolsData: [{ name: "weather" }],
          budget: { contextLength: 1_048_576, outputReserve: 8192 },
          historyPairsDropped: 3,
        },
        false,
      ),
      "contextUsagePanel.buildContextUsagePayload",
    );
  });

  it("validates the stats dashboard payload", () => {
    const tabs: StatsTab[] = [
      {
        id: "overview",
        labelKey: "commands.stats.tabs.overview_label",
        page: {
          titleKey: "commands.stats.tabs.overview_title",
          subtitle: "Representative statistics",
          footerKey: "commands.stats.footer",
          fields: [],
        },
      },
    ];
    assertValidPayload(
      buildStatsDashboardPayload("smoke-stats", tabs, 0, "en-US", true),
      "statsDashboard.buildStatsDashboardPayload",
    );
  });
});

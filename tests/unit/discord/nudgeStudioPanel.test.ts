import { beforeAll, describe, expect, it } from "bun:test";
import {
  CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX,
  CUSTOM_IDLE_NUDGE_BRIEF_MAX,
  CUSTOM_IDLE_NUDGE_LIMIT,
  CUSTOM_IDLE_NUDGE_LIST_MAX,
  CUSTOM_IDLE_NUDGE_TITLE_MAX,
  NATURAL_NUDGE_CATEGORIES,
  type NaturalNudgeCategory,
} from "@/modules/natural-nudges/db/types";
import { nudgeStudioFieldId } from "@/modules/natural-nudges/discord/studioCatalog";
import type { NudgeStudioView, StudioEntry } from "@/modules/natural-nudges/discord/studioOperations";
import {
  availabilityOptions,
  buildAvailabilityModal,
  buildIdleNudgeFormModal,
  buildNudgeStudioPayload,
  buildRemovalModal,
  removalOptions,
} from "@/modules/natural-nudges/discord/studioPanel";
import {
  BUILTIN_IDLE_NUDGES,
  CATEGORY_IMPLIED_PREREQUISITES,
  customIdleNudgeDefinition,
  NUDGE_PREREQUISITE_IDS,
  NUDGE_TOOL_NAMES,
} from "@/modules/natural-nudges/runtime/idleNudges";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import { DISCORD_MODAL_COMPONENTS_MAX, validateRawModalLimits } from "@/utils/discord/ui/componentsV2Limits";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createCustomIdleNudge } from "../../helpers/fixtures";
import { expectForEveryLocale, localizedCopy } from "../../helpers/localeCases";
import { collectTextDisplays, expectSafePanelPayload } from "../../helpers/panelLimits";

const NONCE = "nonce1234567";
const STRING_SELECT = 3;

beforeAll(async () => initializeLocalizer());

function customRow(category: NaturalNudgeCategory, index: number) {
  return createCustomIdleNudge({
    custom_idle_nudge_id: index + 1,
    category,
    title: `*_${index}`.padEnd(CUSTOM_IDLE_NUDGE_TITLE_MAX, "*"),
    brief: "`B*".repeat(CUSTOM_IDLE_NUDGE_BRIEF_MAX).slice(0, CUSTOM_IDLE_NUDGE_BRIEF_MAX),
    agenda_hint: "A".repeat(CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX),
    prerequisites: NUDGE_PREREQUISITE_IDS.slice(0, 8),
    recommended_tools: NUDGE_TOOL_NAMES.slice(0, 8),
    enabled: index % 3 !== 0,
  });
}

/** The fullest view a category can hold: every built-in plus the whole server's custom limit, all blocked. */
function fullestView(category: NaturalNudgeCategory, customs = CUSTOM_IDLE_NUDGE_LIMIT): NudgeStudioView {
  const rows = Array.from({ length: customs }, (_, index) => customRow(category, index));
  const entries: StudioEntry[] = [
    ...BUILTIN_IDLE_NUDGES.filter((definition) => definition.category === category).map((definition) => ({
      definition,
      enabled: true,
      blocker: { kind: "tool" as const, tool: "interact_with_recent_message" as const },
    })),
    ...rows.map((custom) => ({
      definition: customIdleNudgeDefinition(custom),
      enabled: custom.enabled,
      custom,
      blocker: custom.enabled ? { kind: "tool" as const, tool: "peek_profile_picture" as const } : undefined,
    })),
  ];
  return { category, entries, customCount: customs };
}

function modalSelect(modal: { components: RawDiscordComponent[] }, customId: string) {
  return modal.components.map((label) => label.component).find((component) => component?.custom_id === customId);
}

describe("Nudge Studio panel", () => {
  it("stays within message limits in every locale and category at the custom idle nudge limit", () => {
    expectForEveryLocale((locale) => {
      for (const category of NATURAL_NUDGE_CATEGORIES) {
        for (const customs of [0, CUSTOM_IDLE_NUDGE_LIMIT - 1, CUSTOM_IDLE_NUDGE_LIMIT]) {
          for (const receipt of [false, true]) {
            const payload = buildNudgeStudioPayload({
              locale,
              view: fullestView(category, customs),
              receipt: receipt
                ? {
                    tone: "success",
                    heading: localizedCopy("en-US", "commands.nudge-studio.saved_heading"),
                    detail: localizedCopy("en-US", "commands.nudge-studio.saved_detail"),
                  }
                : undefined,
            });
            expectSafePanelPayload(payload, `${locale}:${category}:${customs}:${receipt}`);
          }
        }
      }
    });
  });

  it("marks enabled, blocked, and disabled idle nudges and tags custom ones", () => {
    const check = BUILTIN_IDLE_NUDGES[0];
    const custom = createCustomIdleNudge({ category: "ping_user", enabled: false });
    const view: NudgeStudioView = {
      category: "ping_user",
      entries: [
        { definition: check, enabled: true },
        { definition: BUILTIN_IDLE_NUDGES[2], enabled: true, blocker: { kind: "tool", tool: "web_search" } },
        { definition: customIdleNudgeDefinition(custom), enabled: false, custom },
      ],
      customCount: 1,
    };
    const rows = collectTextDisplays(buildNudgeStudioPayload({ locale: "en-US", view }))
      .flatMap((content) => content.split("\n"))
      .filter((line) => /^> [🟢🟡🔴]/u.test(line));
    const blocker = localizedCopy("en-US", "commands.nudge-studio.blocker_tool", {
      tool: localizedCopy("en-US", "commands.nudge-studio.tool_web_search"),
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]?.startsWith("> 🟢")).toBe(true);
    expect(rows[1]?.startsWith("> 🟡")).toBe(true);
    expect(rows[1]).toContain(blocker);
    expect(rows[2]?.startsWith("> 🔴")).toBe(true);
  });

  it("keeps the add option only below the server-wide custom limit", () => {
    const optionValues = (customs: number): string[] => {
      const payload = buildNudgeStudioPayload({ locale: "en-US", view: fullestView("ping_user", customs) });
      const rows = JSON.parse(JSON.stringify(payload.components[0])).components as Array<{
        components?: Array<{ type: number; options?: Array<{ value: string }> }>;
      }>;
      const select = rows.flatMap((row) => row.components ?? []).find((component) => component.type === STRING_SELECT);
      return select?.options?.map((option) => option.value) ?? [];
    };

    expect(optionValues(CUSTOM_IDLE_NUDGE_LIMIT - 1)).toHaveLength(CUSTOM_IDLE_NUDGE_LIMIT);
    expect(optionValues(CUSTOM_IDLE_NUDGE_LIMIT - 1)[0]).toBe("add");
    expect(optionValues(CUSTOM_IDLE_NUDGE_LIMIT)).not.toContain("add");
  });
});

describe("Nudge Studio modals", () => {
  it("fits every form, availability, and removal modal within Discord's modal limits", () => {
    expectForEveryLocale((locale) => {
      for (const category of NATURAL_NUDGE_CATEGORIES) {
        const view = fullestView(category);
        const modals = [
          buildIdleNudgeFormModal(locale, category, NONCE),
          buildIdleNudgeFormModal(locale, category, NONCE, customRow(category, 1)),
          buildAvailabilityModal(locale, category, NONCE, availabilityOptions(locale, view)),
          buildRemovalModal(locale, category, NONCE, removalOptions(view)),
        ];
        for (const modal of modals) {
          expect(modal.components.length).toBeLessThanOrEqual(DISCORD_MODAL_COMPONENTS_MAX);
          expect(validateRawModalLimits(modal).violations).toEqual([]);
        }
      }
    });
  });

  it("opens an edit prefilled, without the prerequisite its category already enforces", () => {
    const custom = createCustomIdleNudge({
      category: "ping_user",
      prerequisites: ["relationship_user", "recent_memory", "tool:web_search"],
      recommended_tools: ["web_search"],
    });
    const modal = buildIdleNudgeFormModal("en-US", "ping_user", NONCE, custom);
    const needs = modalSelect(modal, nudgeStudioFieldId("needs", NONCE));
    const tools = modalSelect(modal, nudgeStudioFieldId("tools", NONCE));

    expect(needs?.options?.some((option) => option.value === CATEGORY_IMPLIED_PREREQUISITES.ping_user)).toBe(false);
    expect(needs?.options?.filter((option) => option.default).map((option) => option.value)).toEqual([
      "recent_memory",
      "tool:web_search",
    ]);
    expect(tools?.options?.filter((option) => option.default).map((option) => option.value)).toEqual(["web_search"]);
    expect(modal.components[0]?.component?.value).toBe(custom.title);
  });

  it("caps Needs and Tools picks at what a stored custom idle nudge can hold", () => {
    for (const category of NATURAL_NUDGE_CATEGORIES) {
      const modal = buildIdleNudgeFormModal("en-US", category, NONCE);
      for (const field of ["needs", "tools"] as const) {
        expect(modalSelect(modal, nudgeStudioFieldId(field, NONCE))?.max_values).toBe(CUSTOM_IDLE_NUDGE_LIST_MAX);
      }
    }
  });

  it("presents removal with every custom idle nudge checked and availability checked by state", () => {
    const view = fullestView("start_topic", 12);
    expect(removalOptions(view).every((option) => option.checked)).toBe(true);
    expect(removalOptions(view)).toHaveLength(12);
    expect(availabilityOptions("en-US", view).map((option) => option.checked)).toEqual(
      view.entries.map((entry) => entry.enabled),
    );
  });
});

import { beforeAll, describe, expect, it } from "bun:test";
import type {
  ActionRowComponentData,
  ActionRowData,
  ComponentInContainerData,
  ContainerComponentData,
} from "discord.js";
import {
  buildStatusCategoryButtonId,
  buildStatusDashboardRouteId,
  buildStatusPersonaSelectorId,
  buildStatusPageSelectorId,
  parseStatusDashboardRoute,
  parseStatusPersonaSelection,
  parseStatusPageSelection,
  STATUS_ROUTE_NAMESPACE,
  STATUS_ROUTE_VERSION,
} from "@/utils/discord/statusDashboardCatalog";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { dashboardPayload, type StatusPageCategory } from "@/utils/metrics/status/statusPageRenderer";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";

beforeAll(async () => initializeLocalizer());

/** `dashboardPayload` always wraps its body in one container component, whatever its declared element type says. */
function payloadContainerComponents(payload: ReturnType<typeof dashboardPayload>): readonly ComponentInContainerData[] {
  const container = payload.components[0] as ContainerComponentData<ComponentInContainerData>;
  return container.components;
}

/** Only the action-row member of the container union carries a child array. */
function rowComponents(row: ComponentInContainerData | undefined): readonly unknown[] {
  return (row as ActionRowData<ActionRowComponentData> | undefined)?.components ?? [];
}

describe("status dashboard route catalog", () => {
  it("round-trips the exact category and page wire contracts", () => {
    const categoryId = buildStatusCategoryButtonId("en-US", "models");
    const pageId = buildStatusPageSelectorId("ja", "personal");
    const parsedCategoryId = parseInteractionRoute(categoryId);
    const parsedPageId = parseInteractionRoute(pageId);

    expect(categoryId).toBe("status:v1:category:en-US:models");
    expect(pageId).toBe("status:v1:page:ja:personal");
    expect(parsedCategoryId).not.toBeNull();
    expect(parsedPageId).not.toBeNull();
    if (!parsedCategoryId || !parsedPageId) return;
    expect(parseStatusDashboardRoute(parsedCategoryId)).toEqual({
      action: "category",
      locale: "en-US",
      category: "models",
    });
    expect(parseStatusDashboardRoute(parsedPageId)).toEqual({
      action: "page",
      locale: "ja",
      category: "personal",
    });
  });

  it("parses Persona routes with and without the carried page index", () => {
    for (const [customId, expected] of [
      ["status:v1:persona-select:en-US:42", { action: "persona-select", locale: "en-US", personaId: 42 }],
      ["status:v1:persona-select:en-US:42:3", { action: "persona-select", locale: "en-US", personaId: 42, page: 3 }],
      ["status:v1:persona-page:en-US:42:25", { action: "persona-page", locale: "en-US", personaId: 42, start: 25 }],
      [
        "status:v1:persona-page:en-US:42:25:3",
        { action: "persona-page", locale: "en-US", personaId: 42, start: 25, page: 3 },
      ],
      ["status:v1:persona-select:en-US:42:-1", null],
    ] as const) {
      const parsed = parseInteractionRoute(customId);
      expect(parsed).not.toBeNull();
      if (!parsed) continue;
      expect(parseStatusDashboardRoute(parsed)).toEqual(expected);
    }
  });

  it("rejects unknown fields and parses selected page values separately", () => {
    const unknownCategory = parseInteractionRoute("status:v1:category:en-US:unknown");
    const extraField = parseInteractionRoute("status:v1:category:en-US:models:extra");
    const unsupportedLocale = parseInteractionRoute("status:v1:category:xx:models");
    const invalidPersonaId = parseInteractionRoute("status:v1:persona-page:en-US:0:25");
    const invalidRangeStart = parseInteractionRoute("status:v1:persona-page:en-US:42:-1");
    expect(unknownCategory).not.toBeNull();
    expect(extraField).not.toBeNull();
    expect(unsupportedLocale).not.toBeNull();
    expect(invalidPersonaId).not.toBeNull();
    expect(invalidRangeStart).not.toBeNull();
    if (!unknownCategory || !extraField || !unsupportedLocale || !invalidPersonaId || !invalidRangeStart) return;
    expect(parseStatusDashboardRoute(unknownCategory)).toBeNull();
    expect(parseStatusDashboardRoute(extraField)).toBeNull();
    expect(parseStatusDashboardRoute(unsupportedLocale)).toBeNull();
    expect(parseStatusDashboardRoute(invalidPersonaId)).toBeNull();
    expect(parseStatusDashboardRoute(invalidRangeStart)).toBeNull();
    expect(parseStatusPageSelection("0")).toBe(0);
    expect(parseStatusPageSelection("12")).toBe(12);
    expect(parseStatusPageSelection("-1")).toBeNull();
    expect(parseStatusPageSelection("1x")).toBeNull();
    expect(parseStatusPageSelection(undefined)).toBeNull();
    expect(parseStatusPersonaSelection("42")).toBe(42);
    expect(parseStatusPersonaSelection("0")).toBeNull();
    expect(parseStatusPersonaSelection("1x")).toBeNull();
  });

  it("keeps every generated ID within Discord's 100-character limit and has no old interaction anchor", () => {
    for (const category of ["persona", "behavior", "models", "access", "personal"] as const) {
      for (const action of ["category", "page"] as const) {
        const customId = buildStatusDashboardRouteId({ action, locale: "en-US", category });
        expect(customId.length).toBeLessThanOrEqual(100);
        expect(customId.startsWith(`${STATUS_ROUTE_NAMESPACE}:${STATUS_ROUTE_VERSION}:`)).toBe(true);
        expect(customId).not.toContain("interaction-");
      }
    }
    expect(buildStatusPersonaSelectorId("en-US", Number.MAX_SAFE_INTEGER).length).toBeLessThanOrEqual(100);
    expect(
      buildStatusDashboardRouteId({
        action: "persona-page",
        locale: "en-US",
        personaId: Number.MAX_SAFE_INTEGER,
        start: Number.MAX_SAFE_INTEGER,
      }).length,
    ).toBeLessThanOrEqual(100);
  });

  it("renders a bounded Persona selector with reachable off-range selections", () => {
    const personas = Array.from({ length: 51 }, (_, index) =>
      createPersona({ persona_id: index + 1, persona_nickname: `Persona ${index + 1}` }),
    );
    const categories: StatusPageCategory[] = [
      {
        id: "persona",
        labelKey: "commands.status.scope_choice_persona",
        pages: [
          {
            titleKey: "commands.status.persona_page1_title",
            titleVars: { persona_name: "Persona 40" },
            fields: [],
          },
        ],
      },
    ];

    const payload = dashboardPayload("status-test", "en-US", categories, "persona", 0, false, {
      selectedPersonaId: 40,
      personas,
      personaSelectStart: 0,
    });
    const components = payloadContainerComponents(payload);
    const selector = rowComponents(components[2])[0] as {
      customId: string;
      options: Array<{ value: string; default?: boolean }>;
      placeholder: string;
    };
    const range = rowComponents(components[3])[2] as { customId: string };

    expect(selector.customId).toBe(buildStatusPersonaSelectorId("en-US", 40, 0));
    expect(selector.options).toHaveLength(25);
    expect(selector.options.some((option) => option.value === "40")).toBe(false);
    expect(selector.options.some((option) => option.default)).toBe(false);
    expect(selector.placeholder).toContain("Persona 40");
    expect(range.customId).toBe(
      buildStatusDashboardRouteId({ action: "persona-page", locale: "en-US", personaId: 40, start: 25, page: 0 }),
    );
    expect(JSON.stringify(payload)).not.toContain("status-test");
  });

  it("removes repeated page-title chrome from every selector choice", () => {
    const categories: StatusPageCategory[] = [
      {
        id: "behavior",
        labelKey: "commands.status.scope_choice_behavior",
        pages: [
          { titleKey: "commands.status.server_page1_title", fields: [] },
          { titleKey: "commands.status.server_page2_title", fields: [] },
        ],
      },
      {
        id: "persona",
        labelKey: "commands.status.scope_choice_persona",
        pages: [
          {
            titleKey: "commands.status.persona_page1_title",
            titleVars: { persona_name: "Mirri" },
            fields: [],
          },
          {
            titleKey: "commands.status.persona_page2_title",
            titleVars: { persona_name: "Mirri" },
            fields: [],
          },
        ],
      },
    ];
    const behaviorPayload = dashboardPayload("legacy-id", "en-US", categories, "behavior", 0, false);
    const personaPayload = dashboardPayload("legacy-id", "en-US", categories, "persona", 0, false);
    const behaviorComponents = payloadContainerComponents(behaviorPayload);
    const personaComponents = payloadContainerComponents(personaPayload);
    const behaviorOptions = (rowComponents(behaviorComponents[2])[0] as { options?: unknown[] } | undefined)?.options;
    const personaOptions = (rowComponents(personaComponents[2])[0] as { options?: unknown[] } | undefined)?.options;

    expect(behaviorOptions).toEqual([
      { label: "General Behavior", value: "0", default: true },
      { label: "System Prompt", value: "1", default: false },
    ]);
    expect(personaOptions).toEqual([
      { label: "Identity", value: "0", default: true },
      { label: "Attributes", value: "1", default: false },
    ]);
  });
});

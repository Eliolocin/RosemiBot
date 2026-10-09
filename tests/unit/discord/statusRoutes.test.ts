import { createPersona, createUserRow } from "../../helpers/fixtures";
import { beforeAll, describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";
import {
  InteractionRouteRegistry,
  parseInteractionRoute,
  type GlobalRoutableInteraction,
} from "@/utils/discord/interactions/routeRegistry";
import {
  buildStatusCategoryButtonId,
  buildStatusDashboardRouteId,
  buildStatusPageSelectorId,
  buildStatusPersonaSelectorId,
} from "@/utils/discord/statusDashboardCatalog";
import { createStatusInteractionRoute } from "@/utils/discord/interactions/statusRoutes";
import type { StatusPageCategory } from "@/utils/metrics/status/statusPageRenderer";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import {
  createRouteInteraction,
  type RouteInteraction,
  type RouteInteractionOptions,
} from "../../helpers/routeInteraction";

beforeAll(async () => initializeLocalizer());

const state = { server_id: 9, config: {} } as TomoriState;
const user = { user_id: 7, user_disc_id: "viewer" } as UserRow;

/** The viewer the user row above describes, in the guild the persona state belongs to. */
function makeStatusInteraction(options: RouteInteractionOptions): RouteInteraction {
  return createRouteInteraction({
    guildId: "guild-9",
    ...options,
    overrides: { user: { id: "viewer", username: "viewer", displayName: "viewer", globalName: "viewer" } },
  });
}

function page(titleKey: string): StatusPageCategory["pages"][number] {
  return { titleKey, fields: [] };
}

function categories(suffix: string): StatusPageCategory[] {
  return [
    { id: "persona", labelKey: "commands.status.scope_choice_persona", pages: [] },
    {
      id: "behavior",
      labelKey: "commands.status.scope_choice_behavior",
      pages: [page(`commands.status.server_page1_title`), page(`commands.status.server_page2_title${suffix}`)],
    },
    {
      id: "models",
      labelKey: "commands.status.scope_choice_models",
      pages: [page("commands.status.server_page4_title")],
    },
    {
      id: "access",
      labelKey: "commands.status.scope_choice_access",
      pages: [page("commands.status.server_page8_title")],
    },
    {
      id: "personal",
      labelKey: "commands.status.scope_choice_personal",
      pages: [page("commands.status.personal_title")],
    },
  ];
}

function persona(personaId: number, personaNickname: string): TomoriState {
  return { persona_id: personaId, persona_nickname: personaNickname, persona_lineage_id: personaId } as TomoriState;
}

function makeRegistry(
  interaction: RouteInteraction,
  events: string[],
  resolve: () => Promise<StatusPageCategory[]>,
  personas: TomoriState[] = [],
  buildPersonaPages: (selectedPersona: TomoriState) => Promise<StatusPageCategory["pages"]> = async (selectedPersona) =>
    Array.from({ length: 5 }, (_, index) => ({
      titleKey: `commands.status.persona_page${index + 1}_title`,
      titleVars: { persona_name: selectedPersona.persona_nickname },
      fields: [],
    })),
): InteractionRouteRegistry {
  return new InteractionRouteRegistry([
    createStatusInteractionRoute({
      loadUserByDiscordId: async () => {
        events.push("user");
        expect(interaction.deferred).toBe(true);
        return user;
      },
      getCachedTomoriState: async () => {
        events.push("state");
        expect(interaction.deferred).toBe(true);
        return state;
      },
      loadPersonasForServer: async () => {
        events.push("personas");
        expect(interaction.deferred).toBe(true);
        return personas;
      },
      buildPersonaStatusPages: async (selectedPersona) => {
        events.push(`persona:${selectedPersona.persona_id}`);
        expect(interaction.deferred).toBe(true);
        return buildPersonaPages(selectedPersona);
      },
      resolveCategories: async () => {
        events.push("pages");
        expect(interaction.deferred).toBe(true);
        return resolve();
      },
    }),
  ]);
}

describe("persistent status interaction route", () => {
  it("rechecks current prompt access on every route and after a member loses permission", async () => {
    const current = createPersona({ config: { prompt_snapshot_enabled: false } });
    let manageGuild = true;
    const gates: boolean[] = [];
    const route = createStatusInteractionRoute({
      loadUserByDiscordId: async () => createUserRow(),
      getCachedTomoriState: async () => current,
      loadPersonasForServer: async () => [current],
      buildServerConfigPages: async (_client, _state, _locale, canView) => {
        gates.push(Boolean(canView));
        return Array.from({ length: 5 }, () => ({ titleKey: "commands.status.server_page1_title", fields: [] }));
      },
      buildServerModelPages: async () =>
        Array.from({ length: 4 }, () => ({ titleKey: "commands.status.server_page1_title", fields: [] })),
      buildServerChannelPages: async () => [{ titleKey: "commands.status.server_page1_title", fields: [] }],
      buildPersonalStatusPages: async () => [{ titleKey: "commands.status.server_page1_title", fields: [] }],
      buildPersonaStatusPages: async (_state, _user, _locale, canView) => {
        gates.push(Boolean(canView));
        return [page("commands.status.persona_page1_title")];
      },
    });
    const registry = new InteractionRouteRegistry([route]);
    for (const [permission, enabled] of [
      [true, false],
      [false, false],
      [false, true],
      [true, true],
    ] as const) {
      manageGuild = permission;
      current.config.prompt_snapshot_enabled = enabled;
      for (const options of [
        { customId: buildStatusCategoryButtonId("en-US", "persona"), kind: "button" },
        { customId: buildStatusPageSelectorId("en-US", "persona"), kind: "string-select", values: ["0"] },
        {
          customId: buildStatusPersonaSelectorId("en-US", current.persona_id ?? 1),
          kind: "string-select",
          values: [String(current.persona_id)],
        },
        {
          customId: buildStatusDashboardRouteId({
            action: "persona-page",
            locale: "en-US",
            personaId: current.persona_id ?? 1,
            start: 0,
          }),
          kind: "button",
        },
      ] as const) {
        const interaction = makeStatusInteraction({
          ...options,
          values: "values" in options ? [...(options.values ?? [])] : undefined,
        });
        Object.assign(interaction, { memberPermissions: { has: () => manageGuild } });
        const before = gates.length;
        await registry.dispatch({} as Client, interaction as unknown as GlobalRoutableInteraction);
        expect(gates.slice(before)).toEqual([permission || enabled, permission || enabled]);
        expect(interaction.calls[0]?.method).toBe("deferUpdate");
      }
    }
  });

  it("routes a category button through the registry after acknowledgement and repaints fresh data", async () => {
    const interaction = makeStatusInteraction({
      customId: buildStatusCategoryButtonId("en-US", "models"),
      kind: "button",
    });
    const events: string[] = [];
    const registry = makeRegistry(interaction, events, async () => categories("-fresh"));

    const handled = await registry.dispatch({} as Client, interaction as unknown as GlobalRoutableInteraction);

    expect(handled).toBe(true);
    expect(events).toEqual(["user", "state", "pages"]);
    // Acknowledgement precedes every dependency read, which makeRegistry also asserts on entry.
    expect(interaction.calls[0]?.method).toBe("deferUpdate");
    expect(interaction.deferred).toBe(true);
    expect(interaction.edits).toHaveLength(1);
    expect(JSON.stringify(interaction.edits[0])).toContain(localizer("en-US", "commands.status.server_page4_title"));
  });

  it("routes a page selector with a bounded value and uses editReply rather than update", async () => {
    const interaction = makeStatusInteraction({
      customId: buildStatusPageSelectorId("en-US", "behavior"),
      kind: "string-select",
      values: ["1"],
    });
    const events: string[] = [];
    const registry = makeRegistry(interaction, events, async () => categories("-fresh"));

    await registry.dispatch({} as Client, interaction as unknown as GlobalRoutableInteraction);

    expect(events).toEqual(["user", "state", "pages"]);
    // The route must acknowledge with deferUpdate and repaint with editReply, never with update.
    expect(interaction.calls.map((call) => call.method)).toEqual(["deferUpdate", "editReply"]);
    expect(interaction.edits).toHaveLength(1);
    expect(JSON.stringify(interaction.edits[0])).toContain("server_page2_title-fresh");
    expect(JSON.stringify(interaction.edits[0])).toContain(buildStatusPageSelectorId("en-US", "behavior"));
  });

  it("requires concrete component types before type-specific access", async () => {
    const buttonWithPageRoute = makeStatusInteraction({
      customId: buildStatusPageSelectorId("en-US", "behavior"),
      kind: "button",
      values: ["0"],
    });
    const selectWithCategoryRoute = makeStatusInteraction({
      customId: buildStatusCategoryButtonId("en-US", "behavior"),
      kind: "string-select",
    });
    const buttonWithPersonaSelectorRoute = makeStatusInteraction({
      customId: buildStatusPersonaSelectorId("en-US", 2),
      kind: "button",
      values: ["2"],
    });
    const selectWithPersonaRangeRoute = makeStatusInteraction({
      customId: buildStatusDashboardRouteId({ action: "persona-page", locale: "en-US", personaId: 2, start: 25 }),
      kind: "string-select",
    });
    const events: string[] = [];
    const registry = makeRegistry(buttonWithPageRoute, events, async () => categories(""));
    const secondRegistry = makeRegistry(selectWithCategoryRoute, events, async () => categories(""));
    const thirdRegistry = makeRegistry(buttonWithPersonaSelectorRoute, events, async () => categories(""));
    const fourthRegistry = makeRegistry(selectWithPersonaRangeRoute, events, async () => categories(""));

    await expect(
      registry.dispatch({} as Client, buttonWithPageRoute as unknown as GlobalRoutableInteraction),
    ).rejects.toThrow("String Select");
    await expect(
      secondRegistry.dispatch({} as Client, selectWithCategoryRoute as unknown as GlobalRoutableInteraction),
    ).rejects.toThrow("button");
    await expect(
      thirdRegistry.dispatch({} as Client, buttonWithPersonaSelectorRoute as unknown as GlobalRoutableInteraction),
    ).rejects.toThrow("String Select");
    await expect(
      fourthRegistry.dispatch({} as Client, selectWithPersonaRangeRoute as unknown as GlobalRoutableInteraction),
    ).rejects.toThrow("button");
    expect(events).toHaveLength(0);
  });

  it("rejects forged page values before user/workspace reads", async () => {
    const interaction = makeStatusInteraction({
      customId: buildStatusPageSelectorId("en-US", "behavior"),
      kind: "string-select",
      values: ["forged"],
    });
    const events: string[] = [];
    const registry = makeRegistry(interaction, events, async () => categories(""));

    await registry.dispatch({} as Client, interaction as unknown as GlobalRoutableInteraction);

    expect(interaction.deferred).toBe(true);
    expect(events).toEqual([]);
    expect(interaction.edits).toHaveLength(1);
  });

  it("opens Persona from a fresh roster and rebuilds its five pages", async () => {
    const interaction = makeStatusInteraction({
      customId: buildStatusCategoryButtonId("en-US", "persona"),
      kind: "button",
    });
    const events: string[] = [];
    const registry = makeRegistry(interaction, events, async () => categories(""), [persona(2, "Mirri")]);

    await registry.dispatch({} as Client, interaction as unknown as GlobalRoutableInteraction);

    expect(interaction.deferred).toBe(true);
    expect(events).toEqual(["user", "state", "personas", "pages", "persona:2"]);
    expect(interaction.edits).toHaveLength(1);
    expect(JSON.stringify(interaction.edits[0])).toContain("Mirri");
    expect(JSON.stringify(interaction.edits[0])).toContain(buildStatusPersonaSelectorId("en-US", 2));
  });

  it("validates the selected Persona against a fresh roster before repainting", async () => {
    const interaction = makeStatusInteraction({
      customId: buildStatusPersonaSelectorId("en-US", 1),
      kind: "string-select",
      values: ["2"],
    });
    const events: string[] = [];
    const registry = makeRegistry(interaction, events, async () => categories(""), [
      persona(1, "Main"),
      persona(2, "Mirri"),
    ]);

    await registry.dispatch({} as Client, interaction as unknown as GlobalRoutableInteraction);

    expect(events).toEqual(["user", "state", "personas", "pages", "persona:2"]);
    expect(interaction.edits).toHaveLength(1);
    expect(JSON.stringify(interaction.edits[0])).toContain("Mirri");
  });

  it("falls back safely when a selected Persona was deleted", async () => {
    const interaction = makeStatusInteraction({
      customId: buildStatusDashboardRouteId({ action: "persona-page", locale: "en-US", personaId: 99, start: 25 }),
      kind: "button",
    });
    const events: string[] = [];
    const registry = makeRegistry(interaction, events, async () => categories(""), [persona(2, "Current")]);

    await registry.dispatch({} as Client, interaction as unknown as GlobalRoutableInteraction);

    expect(events).toEqual(["user", "state", "personas", "pages", "persona:2"]);
    expect(interaction.edits).toHaveLength(1);
    expect(JSON.stringify(interaction.edits[0])).toContain("Current");
  });

  it("carries a validated selected Persona through non-Persona navigation", async () => {
    const interaction = makeStatusInteraction({
      customId: buildStatusCategoryButtonId("en-US", "behavior", 2),
      kind: "button",
    });
    const events: string[] = [];
    const registry = makeRegistry(interaction, events, async () => categories(""), [persona(2, "Mirri")]);

    await registry.dispatch({} as Client, interaction as unknown as GlobalRoutableInteraction);

    expect(events).toEqual(["user", "state", "personas", "pages"]);
    expect(interaction.edits).toHaveLength(1);
    expect(JSON.stringify(interaction.edits[0])).toContain(buildStatusCategoryButtonId("en-US", "persona", 2));
    expect(JSON.stringify(interaction.edits[0])).toContain(buildStatusPageSelectorId("en-US", "behavior", 2));
  });

  it("does not depend on the old command interaction ID", () => {
    expect(buildStatusCategoryButtonId("en-US", "behavior")).toBe("status:v1:category:en-US:behavior");
    expect(parseInteractionRoute("status:v1:category:en-US:behavior")?.segments).toEqual([
      "category",
      "en-US",
      "behavior",
    ]);
  });
});

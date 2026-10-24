import { computePersonaNudgeFingerprint } from "@/modules/natural-nudges/db/types";
import { beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { CUSTOM_IDLE_NUDGE_LIMIT } from "@/modules/natural-nudges/db/types";
import {
  buildNudgeStudioRouteId,
  nudgeStudioFieldId,
  parseNudgeStudioRoute,
  type NudgeStudioRoute,
} from "@/modules/natural-nudges/discord/studioCatalog";
import {
  idleNudgeContentFromDefinition,
  loadNudgeStudioView,
  nextAvailability,
  nudgeStudioOperations,
  type NudgeStudioView,
  type StudioWriteResult,
} from "@/modules/natural-nudges/discord/studioOperations";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { defaultServerNaturalNudgeConfig, type PersonaNaturalNudgeConfig } from "@/modules/natural-nudges/db/types";
import {
  createNudgeStudioInteractionRoute,
  type NudgeStudioRouteDependencies,
} from "@/modules/natural-nudges/discord/studioRoutes";
import { BUILTIN_IDLE_NUDGES, customIdleNudgeDefinition } from "@/modules/natural-nudges/runtime/idleNudges";
import { parseInteractionRoute, type GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createCustomIdleNudge, createLlmRow, createPersona } from "../../helpers/fixtures";
import { localizedCopy, localizedProse } from "../../helpers/localeCases";
import { collectTextDisplays } from "../../helpers/panelLimits";
import { createRouteInteraction } from "../../helpers/routeInteraction";

const NONCE = "nonce1234567";

beforeAll(async () => initializeLocalizer());

const PERSONA_KEY = "persona:2:n0";

function view(customCount = 1): NudgeStudioView {
  const custom = createCustomIdleNudge({ custom_idle_nudge_id: 7, category: "ping_user" });
  return {
    category: "ping_user",
    entries: [
      ...BUILTIN_IDLE_NUDGES.filter((definition) => definition.category === "ping_user").map((definition) => ({
        definition,
        enabled: true,
      })),
      { definition: customIdleNudgeDefinition(custom), enabled: true, custom, scope: [2] },
      {
        definition: {
          key: PERSONA_KEY,
          category: "ping_user",
          title: "Juno check-in",
          brief: "Have {persona} check on {target}.",
          agendaHint: null,
          prerequisites: [],
          recommendedTools: [],
          builtIn: false,
          ownerPersonaId: 2,
        },
        enabled: true,
      },
    ],
    customCount,
    personaNames: new Map([[2, "Juno"]]),
  };
}

function personaEntryFingerprint(): string {
  const entry = view().entries.find((entry) => entry.definition.ownerPersonaId === 2);
  if (!entry) throw new Error("Missing persona entry");
  return computePersonaNudgeFingerprint(2, idleNudgeContentFromDefinition(entry.definition));
}

function harness(overrides: Partial<NudgeStudioRouteDependencies> = {}) {
  const snapshots = new Map<string, string[]>();
  const result = { current: "success" as StudioWriteResult };
  const operations = {
    addCustomIdleNudge: mock(async () => result.current),
    updateCustomIdleNudge: mock(async () => result.current),
    updatePersonaIdleNudge: mock(async () => result.current),
    setPersonaIdleNudgeAvailability: mock(async () => result.current),
    removePersonaIdleNudges: mock(async () => result.current),
    setIdleNudgeAvailability: mock(async () => result.current),
    removeCustomIdleNudges: mock(async () => result.current),
  };
  const showModal = mock(async (...args: Parameters<NudgeStudioRouteDependencies["showModal"]>) => {
    await (args[0].showModal as (payload: unknown) => Promise<void>)(args[1]);
  });
  const recordAction = mock(async () => {});
  const studioView = { current: view() };
  const checkboxValues = new Map<string, string[]>();
  const selectValues = new Map<string, string[]>();
  const route = createNudgeStudioInteractionRoute({
    resolveScope: async () => ({
      serverId: 1,
      personas: [createPersona(), createPersona({ persona_id: 2, persona_nickname: "Juno" })],
    }),
    loadView: async () => studioView.current,
    operations,
    showModal,
    takeCheckboxValues: (_id, customId) => checkboxValues.get(customId),
    takeSelectValues: (_id, customId) => selectValues.get(customId),
    storeSnapshot: (nonce, values) => snapshots.set(nonce, [...values]),
    takeSnapshot: (nonce) => {
      const values = snapshots.get(nonce);
      snapshots.delete(nonce);
      return values;
    },
    recordAction,
    createNonce: () => NONCE,
    ...overrides,
  });
  const dispatch = async (
    target: NudgeStudioRoute,
    kind: "button" | "string-select" | "modal",
    options: { values?: string[]; fields?: Record<string, string>; isManager?: boolean } = {},
  ) => {
    const customId = buildNudgeStudioRouteId(target);
    const interaction = createRouteInteraction({ customId, kind, ...options });
    const parsed = parseInteractionRoute(customId);
    if (!parsed) throw new Error("Invalid fixture route");
    await route.execute({} as Client, interaction as unknown as GlobalRoutableInteraction, parsed);
    return interaction;
  };
  return { dispatch, operations, showModal, recordAction, snapshots, checkboxValues, selectValues, studioView, result };
}

const base = { locale: "en-US", category: "ping_user" } as const;

describe("Nudge Studio routes", () => {
  it("answers a member without Manage Server before opening any modal", async () => {
    const h = harness();
    const interaction = await h.dispatch({ ...base, action: "remove-open" }, "button", { isManager: false });
    expect(h.showModal).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.replies)).toContain(
      localizedCopy("en-US", "general.errors.permission_denied_description"),
    );
  });

  it("opens the add modal below the limit and refuses it at the limit", async () => {
    const h = harness();
    await h.dispatch({ ...base, action: "select" }, "string-select", { values: ["add"] });
    expect(h.showModal.mock.calls[0]?.[1].custom_id).toBe(
      buildNudgeStudioRouteId({ ...base, action: "add-submit", nonce: NONCE, page: 0 }),
    );

    h.studioView.current = view(CUSTOM_IDLE_NUDGE_LIMIT);
    const atLimit = await h.dispatch({ ...base, action: "select" }, "string-select", { values: ["add"] });
    expect(h.showModal).toHaveBeenCalledTimes(1);
    expect(atLimit.deferred).toBe(true);
    expect(collectTextDisplays(atLimit.edits.at(-1)).join(" ")).toMatch(
      localizedProse("en-US", "commands.nudge-studio.limit_detail"),
    );
  });

  it("opens a selected custom idle nudge as its edit modal, and repaints the panel when it vanished", async () => {
    const h = harness();
    await h.dispatch({ ...base, action: "select" }, "string-select", { values: ["custom:7"] });
    expect(h.showModal.mock.calls[0]?.[1].custom_id).toBe(
      buildNudgeStudioRouteId({ ...base, action: "edit-submit", id: 7, nonce: NONCE, page: 0 }),
    );

    const stale = await h.dispatch({ ...base, action: "select" }, "string-select", { values: ["99"] });
    expect(h.showModal).toHaveBeenCalledTimes(1);
    expect(stale.replies).toEqual([]);
    expect(collectTextDisplays(stale.edits.at(-1)).join(" ")).toMatch(
      localizedProse("en-US", "commands.nudge-studio.stale_detail"),
    );
  });

  it("opens Toggle Availability for the picked idle nudge and writes only the presented personas", async () => {
    const h = harness();
    await h.dispatch({ ...base, action: "toggle-open", page: 1 }, "string-select", { values: ["custom:7"] });
    expect(h.showModal.mock.calls[0]?.[1].custom_id).toBe(
      buildNudgeStudioRouteId({ ...base, action: "toggle-submit", key: "custom:7", page: 1, nonce: NONCE }),
    );
    expect(h.snapshots.get(NONCE)).toEqual(["1", "2"]);

    h.checkboxValues.set(nudgeStudioFieldId("checklist", NONCE, 0), ["1"]);
    await h.dispatch({ ...base, action: "toggle-submit", key: "custom:7", page: 1, nonce: NONCE }, "modal");
    expect(h.operations.setIdleNudgeAvailability).toHaveBeenCalledWith(
      1,
      "ping_user",
      "custom:7",
      [1, 2],
      [1, 2],
      new Set([1]),
    );
    expect(h.recordAction).toHaveBeenCalledTimes(1);
  });

  it("repaints instead of opening Toggle Availability for an idle nudge that vanished", async () => {
    const h = harness();
    const stale = await h.dispatch({ ...base, action: "toggle-open", page: 0 }, "string-select", {
      values: ["custom:99"],
    });
    expect(h.showModal).not.toHaveBeenCalled();
    expect(collectTextDisplays(stale.edits.at(-1)).join(" ")).toMatch(
      localizedProse("en-US", "commands.nudge-studio.stale_detail"),
    );
  });

  it("opens and submits a persona-owned edit with its owner and fingerprint, without pre-deferring", async () => {
    const h = harness();
    const entry = h.studioView.current.entries.find((candidate) => candidate.definition.ownerPersonaId === 2);
    if (!entry) throw new Error("fixture missing persona entry");
    const fp = computePersonaNudgeFingerprint(2, idleNudgeContentFromDefinition(entry.definition));
    const interaction = await h.dispatch({ ...base, action: "select", page: 2 }, "string-select", {
      values: [PERSONA_KEY],
    });

    expect(h.showModal.mock.calls[0]?.[1].custom_id).toBe(
      buildNudgeStudioRouteId({
        ...base,
        action: "persona-edit-submit",
        page: 2,
        ownerId: 2,
        idleNudgeId: "n0",
        fp,
        nonce: NONCE,
      }),
    );
    expect(interaction.calls[0]?.method).toBe("showModal");
    expect(interaction.deferred).toBe(false);

    h.selectValues.set(nudgeStudioFieldId("needs", NONCE), ["recent_memory"]);
    await h.dispatch(
      { ...base, action: "persona-edit-submit", page: 2, ownerId: 2, idleNudgeId: "n0", fp, nonce: NONCE },
      "modal",
      {
        fields: {
          [nudgeStudioFieldId("title", NONCE)]: "Gentle nudge",
          [nudgeStudioFieldId("brief", NONCE)]: "Have {persona} ask {target} about tea.",
          [nudgeStudioFieldId("agenda", NONCE)]: "",
        },
      },
    );
    expect(h.operations.updatePersonaIdleNudge).toHaveBeenCalledWith("ping_user", [1, 2], 2, "n0", fp, {
      title: "Gentle nudge",
      brief: "Have {persona} ask {target} about tea.",
      agendaHint: "",
      prerequisites: ["recent_memory"],
      recommendedTools: [],
    });
    expect(h.recordAction).toHaveBeenCalledWith({
      action: "nudge-studio.workspace.idle-nudge.edit",
      serverId: 1,
      userDiscId: "user-1",
    });
  });

  it("refuses a persona edit whose owner is no longer in scope", async () => {
    const h = harness();
    const stale = await h.dispatch({ ...base, action: "select" }, "string-select", {
      values: ["persona:99:n0"],
    });
    expect(h.showModal).not.toHaveBeenCalled();
    expect(collectTextDisplays(stale.edits.at(-1)).join(" ")).toMatch(
      localizedProse("en-US", "commands.nudge-studio.stale_detail"),
    );
  });

  it("opens a persona-owned availability checklist with only the owner", async () => {
    const h = harness();
    await h.dispatch({ ...base, action: "toggle-open", page: 0 }, "string-select", { values: [PERSONA_KEY] });
    const modal = h.showModal.mock.calls[0]?.[1];
    expect(modal.custom_id).toBe(
      buildNudgeStudioRouteId({
        ...base,
        action: "persona-toggle-submit",
        page: 0,
        ownerId: 2,
        idleNudgeId: "n0",
        nonce: NONCE,
      }),
    );
    expect(modal.components[0]?.component?.options).toHaveLength(1);

    h.checkboxValues.set(nudgeStudioFieldId("checklist", NONCE, 0), []);
    await h.dispatch(
      { ...base, action: "persona-toggle-submit", page: 0, ownerId: 2, idleNudgeId: "n0", nonce: NONCE },
      "modal",
    );
    expect(h.operations.setPersonaIdleNudgeAvailability).toHaveBeenCalledWith("ping_user", [1, 2], 2, "n0", false);
  });

  it("never sends a persona key through the all-personas availability write", async () => {
    const h = harness();
    h.checkboxValues.set(nudgeStudioFieldId("checklist", NONCE, 0), []);
    await h.dispatch({ ...base, action: "toggle-submit", key: PERSONA_KEY, page: 0, nonce: NONCE }, "modal");
    expect(h.operations.setIdleNudgeAvailability).not.toHaveBeenCalled();
  });

  it("removes only the unchecked persona entry and leaves the checked server entry", async () => {
    const h = harness();
    await h.dispatch({ ...base, action: "remove-open", page: 0 }, "button");
    expect(h.snapshots.get(NONCE)).toEqual(["c:7", `p:2:n0:${personaEntryFingerprint()}`]);

    h.checkboxValues.set(nudgeStudioFieldId("checklist", NONCE, 0), ["c:7"]);
    await h.dispatch({ ...base, action: "remove-submit", nonce: NONCE, page: 0 }, "modal");
    expect(h.operations.removePersonaIdleNudges).toHaveBeenCalledWith(
      "ping_user",
      [1, 2],
      [
        {
          ownerPersonaId: 2,
          idleNudgeId: "n0",
          fp: personaEntryFingerprint(),
        },
      ],
      new Set(),
    );
    expect(h.operations.removeCustomIdleNudges).toHaveBeenCalledWith(1, "ping_user", [], new Set([7]));
  });

  it("keeps server entries when an owner removal is stale", async () => {
    const h = harness();
    await h.dispatch({ ...base, action: "remove-open", page: 0 }, "button");
    h.operations.removePersonaIdleNudges.mockResolvedValue("stale");
    h.checkboxValues.set(nudgeStudioFieldId("checklist", NONCE), []);
    const interaction = await h.dispatch({ ...base, action: "remove-submit", nonce: NONCE, page: 0 }, "modal");
    expect(h.operations.removeCustomIdleNudges).not.toHaveBeenCalled();
    expect(h.recordAction).not.toHaveBeenCalled();
    expect(collectTextDisplays(interaction.edits.at(-1)).join(" ")).toMatch(
      localizedProse("en-US", "commands.nudge-studio.stale_detail"),
    );
  });

  it("keeps every generated persona route within Discord's custom ID limit", () => {
    const routes: NudgeStudioRoute[] = [
      {
        action: "persona-edit-submit",
        locale: "es-419",
        category: "revive_topic",
        page: 99,
        ownerId: 2_147_483_647,
        idleNudgeId: "a".repeat(24),
        fp: "abcdefgh",
        nonce: "a".repeat(12),
      },
      {
        action: "persona-toggle-submit",
        locale: "es-419",
        category: "revive_topic",
        page: 99,
        ownerId: 2_147_483_647,
        idleNudgeId: "a".repeat(24),
        nonce: "a".repeat(12),
      },
      {
        action: "toggle-submit",
        locale: "es-419",
        category: "revive_topic",
        key: `custom:${2_147_483_647}`,
        page: 99,
        nonce: "a".repeat(32),
      },
    ];
    for (const route of routes) {
      const customId = buildNudgeStudioRouteId(route);
      expect(customId.length).toBeLessThanOrEqual(100);
      const parsed = parseInteractionRoute(customId);
      expect(parsed && parseNudgeStudioRoute(parsed)).toEqual(route);
    }
  });

  it("round-trips built-in and custom keys and the page through the toggle route", () => {
    for (const key of ["custom:7", "ping_user.remind_you"]) {
      const route = { ...base, action: "toggle-submit", key, page: 1, nonce: NONCE } as const;
      const parsed = parseInteractionRoute(buildNudgeStudioRouteId(route));
      expect(parsed && parseNudgeStudioRoute(parsed)).toEqual(route);
    }
  });

  it("refuses a checklist submit whose snapshot is gone, so a repeated submit writes nothing", async () => {
    const h = harness();
    await h.dispatch({ ...base, action: "remove-open" }, "button");
    h.checkboxValues.set(nudgeStudioFieldId("checklist", NONCE, 0), []);
    await h.dispatch({ ...base, action: "remove-submit", nonce: NONCE }, "modal");
    const repeated = await h.dispatch({ ...base, action: "remove-submit", nonce: NONCE }, "modal");

    expect(h.operations.removeCustomIdleNudges).toHaveBeenCalledTimes(1);
    expect(h.operations.removeCustomIdleNudges).toHaveBeenCalledWith(1, "ping_user", [7], new Set());
    expect(h.operations.removePersonaIdleNudges).toHaveBeenCalledWith(
      "ping_user",
      [1, 2],
      [
        {
          ownerPersonaId: 2,
          idleNudgeId: "n0",
          fp: personaEntryFingerprint(),
        },
      ],
      new Set(),
    );
    expect(collectTextDisplays(repeated.edits.at(-1)).join(" ")).toMatch(
      localizedProse("en-US", "commands.nudge-studio.stale_detail"),
    );
  });

  it("writes nothing when a checklist submit carries no checkbox data at all", async () => {
    const cases = [
      async (h: ReturnType<typeof harness>) => {
        await h.dispatch({ ...base, action: "remove-open" }, "button");
        return h.dispatch({ ...base, action: "remove-submit", nonce: NONCE }, "modal");
      },
      async (h: ReturnType<typeof harness>) => {
        await h.dispatch({ ...base, action: "toggle-open", page: 0 }, "string-select", { values: ["custom:7"] });
        return h.dispatch({ ...base, action: "toggle-submit", key: "custom:7", page: 0, nonce: NONCE }, "modal");
      },
    ];
    for (const run of cases) {
      const h = harness();
      const interaction = await run(h);

      expect(h.operations.removeCustomIdleNudges).not.toHaveBeenCalled();
      expect(h.operations.setIdleNudgeAvailability).not.toHaveBeenCalled();
      expect(collectTextDisplays(interaction.edits.at(-1)).join(" ")).toMatch(
        localizedProse("en-US", "commands.nudge-studio.stale_detail"),
      );
    }
  });

  it("submits every Needs and Tools pick, and an untouched select as empty", async () => {
    const h = harness();
    h.selectValues.set(nudgeStudioFieldId("needs", NONCE), ["recent_memory", "tool:web_search"]);
    await h.dispatch({ ...base, action: "add-submit", nonce: NONCE }, "modal", {
      fields: {
        [nudgeStudioFieldId("title", NONCE)]: "Snack check",
        [nudgeStudioFieldId("brief", NONCE)]: "Have {persona} ask {target} about snacks.",
        [nudgeStudioFieldId("agenda", NONCE)]: "",
      },
    });
    expect(h.operations.addCustomIdleNudge).toHaveBeenCalledWith(1, "ping_user", {
      title: "Snack check",
      brief: "Have {persona} ask {target} about snacks.",
      agendaHint: "",
      prerequisites: ["recent_memory", "tool:web_search"],
      recommendedTools: [],
    });
  });

  it("repaints a failed write with its receipt and records no action", async () => {
    const h = harness();
    h.result.current = "invalid";
    const interaction = await h.dispatch({ ...base, action: "edit-submit", id: 7, nonce: NONCE }, "modal", {
      fields: {
        [nudgeStudioFieldId("title", NONCE)]: "",
        [nudgeStudioFieldId("brief", NONCE)]: "",
        [nudgeStudioFieldId("agenda", NONCE)]: "",
      },
    });
    expect(h.recordAction).not.toHaveBeenCalled();
    expect(collectTextDisplays(interaction.edits.at(-1)).join(" ")).toMatch(
      localizedProse("en-US", "commands.nudge-studio.invalid_detail"),
    );
  });
});

describe("Nudge Studio view loading", () => {
  it("appends persona-owned entries with owner names and owner-sourced blockers", async () => {
    const custom = createCustomIdleNudge({ custom_idle_nudge_id: 9, category: "ping_user" });
    const personaConfig: PersonaNaturalNudgeConfig = {
      persona_id: 2,
      talkativeness: 1,
      interests: [],
      idle_nudges: [
        {
          id: "n0",
          category: "ping_user",
          title: "Juno check-in",
          brief: "Have {persona} check on {target}.",
          agenda_hint: null,
          prerequisites: ["tool:web_search"],
          recommended_tools: [],
        },
        {
          id: "n1",
          category: "ping_user",
          title: "Juno second",
          brief: "Have {persona} ask a question.",
          agenda_hint: null,
          prerequisites: [],
          recommended_tools: [],
        },
      ],
      disabled_idle_nudge_ids: ["n1"],
      has_override: true,
      idle_nudges_override: true,
      idle_nudges_inherited: false,
    };
    const spies = [
      spyOn(naturalNudgeRepository, "loadServerConfig").mockResolvedValue(defaultServerNaturalNudgeConfig(1)),
      spyOn(naturalNudgeRepository, "listCustomIdleNudges").mockResolvedValue([custom]),
      spyOn(naturalNudgeRepository, "loadPersonaScopes").mockResolvedValue(new Map()),
      spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(new Map([[2, personaConfig]])),
    ];
    try {
      const view = await loadNudgeStudioView(1, "ping_user", [
        createPersona({
          server_id: 1,
          persona_id: 2,
          persona_nickname: "Juno",
          llm: createLlmRow({ has_tools: false }),
        }),
      ]);
      const owned = view.entries.filter((entry) => entry.definition.ownerPersonaId === 2);
      expect(owned.map((entry) => entry.definition.key)).toEqual(["persona:2:n0", "persona:2:n1"]);
      expect(owned[0]?.enabled).toBe(true);
      expect(owned[0]?.blocker).toEqual({ kind: "tool", tool: "web_search" });
      expect(owned[1]?.enabled).toBe(false);
      expect(owned[1]?.blocker).toBeUndefined();
      expect(view.personaNames.get(2)).toBe("Juno");
      expect(view.customCount).toBe(1);
      expect(view.entries.some((entry) => entry.definition.key === "custom:9")).toBe(true);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("persona nudge Studio operations", () => {
  const personaConfig: PersonaNaturalNudgeConfig = {
    persona_id: 2,
    talkativeness: 2,
    interests: [],
    idle_nudges: [
      {
        id: "n0",
        category: "ping_user",
        title: "Juno check-in",
        brief: "Have {persona} check on {target}.",
        agenda_hint: null,
        prerequisites: [],
        recommended_tools: [],
      },
    ],
    disabled_idle_nudge_ids: [],
    has_override: true,
    idle_nudges_override: true,
    idle_nudges_inherited: false,
  };

  it("checks live membership and the definition fingerprint before editing", async () => {
    const load = spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(new Map([[2, personaConfig]]));
    const update = spyOn(naturalNudgeRepository, "updatePersonaIdleNudge").mockResolvedValue("success");
    try {
      const fp = computePersonaNudgeFingerprint(2, {
        category: "ping_user",
        title: "Juno check-in",
        brief: "Have {persona} check on {target}.",
        agenda_hint: null,
        prerequisites: [],
        recommended_tools: [],
      });
      const form = {
        title: "Juno check-in",
        brief: "Have {persona} check on {target}.",
        agendaHint: "",
        prerequisites: [],
        recommendedTools: [],
      };
      await expect(nudgeStudioOperations.updatePersonaIdleNudge("ping_user", [1], 2, "n0", fp, form)).resolves.toBe(
        "stale",
      );
      expect(update).not.toHaveBeenCalled();

      await expect(
        nudgeStudioOperations.updatePersonaIdleNudge("ping_user", [1, 2], 2, "n0", "abcd1234", form),
      ).resolves.toBe("stale");
      expect(update).not.toHaveBeenCalled();

      await expect(nudgeStudioOperations.updatePersonaIdleNudge("ping_user", [1, 2], 2, "n0", fp, form)).resolves.toBe(
        "success",
      );
      expect(update).toHaveBeenCalledWith(2, "n0", expect.objectContaining({ title: "Juno check-in" }));
    } finally {
      load.mockRestore();
      update.mockRestore();
    }
  });

  it("writes availability only for a live owner and an existing entry", async () => {
    const load = spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(new Map([[2, personaConfig]]));
    const toggle = spyOn(naturalNudgeRepository, "setPersonaIdleNudgeAvailability").mockResolvedValue("success");
    try {
      await expect(
        nudgeStudioOperations.setPersonaIdleNudgeAvailability("ping_user", [1], 2, "n0", false),
      ).resolves.toBe("stale");
      expect(toggle).not.toHaveBeenCalled();

      await expect(
        nudgeStudioOperations.setPersonaIdleNudgeAvailability("ping_user", [1, 2], 2, "n0", false),
      ).resolves.toBe("success");
      expect(toggle).toHaveBeenCalledWith(2, "n0", false);
    } finally {
      load.mockRestore();
      toggle.mockRestore();
    }
  });

  it("refuses to remove an owner entry edited after the Studio checklist opened", async () => {
    const original = personaConfig.idle_nudges[0];
    if (!original) throw new Error("Missing owner entry");
    const fp = computePersonaNudgeFingerprint(2, original);
    const latest = { ...personaConfig, idle_nudges: [{ ...original, brief: "Updated brief." }] };
    const load = spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(new Map([[2, latest]]));
    const remove = spyOn(naturalNudgeRepository, "removePersonaIdleNudge").mockResolvedValue("success");
    try {
      const presented = [{ ownerPersonaId: 2, idleNudgeId: original.id, fp }];
      await expect(
        nudgeStudioOperations.removePersonaIdleNudges("ping_user", [1, 2], presented, new Set()),
      ).resolves.toBe("stale");
      expect(remove).not.toHaveBeenCalled();

      load.mockResolvedValue(new Map([[2, personaConfig]]));
      await expect(
        nudgeStudioOperations.removePersonaIdleNudges("ping_user", [1, 2], presented, new Set()),
      ).resolves.toBe("success");
      expect(remove).toHaveBeenCalledWith(2, original.id, fp);
    } finally {
      load.mockRestore();
      remove.mockRestore();
    }
  });
});

describe("Toggle Availability submit", () => {
  const live = [1, 2, 3];
  const open = { enabled: true, scope: null } as const;
  const scoped = (...scope: number[]) => ({ enabled: true, scope }) as const;
  const off = { enabled: false } as const;

  it("opens an idle nudge to everyone, future personas included, once every live persona is checked", () => {
    expect(nextAvailability(scoped(1), live, live, new Set(live))).toEqual(open);
    expect(nextAvailability(off, live, live, new Set(live))).toEqual(open);
  });

  it("turns an idle nudge off when no live persona is left checked", () => {
    expect(nextAvailability(open, live, live, new Set())).toEqual(off);
    expect(nextAvailability(scoped(9), live, [], new Set())).toEqual(off);
  });

  it("turns an idle nudge that was off back on for only the checked personas", () => {
    expect(nextAvailability(off, live, live, new Set([2]))).toEqual(scoped(2));
  });

  it("keeps an unpresented persona's access and drops deleted personas", () => {
    expect(nextAvailability(open, live, [1, 2], new Set([1]))).toEqual(scoped(1, 3));
    expect(nextAvailability(scoped(3, 9), live, [1, 2], new Set([1]))).toEqual(scoped(1, 3));
    expect(nextAvailability(off, live, [1, 2], new Set([1, 2]))).toEqual(scoped(1, 2));
  });
});

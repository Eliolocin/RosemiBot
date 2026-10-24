import { beforeAll, describe, expect, it, mock } from "bun:test";
import type { Client } from "discord.js";
import { CUSTOM_IDLE_NUDGE_LIMIT } from "@/modules/natural-nudges/db/types";
import {
  buildNudgeStudioRouteId,
  nudgeStudioFieldId,
  parseNudgeStudioRoute,
  type NudgeStudioRoute,
} from "@/modules/natural-nudges/discord/studioCatalog";
import {
  nextAvailability,
  type NudgeStudioView,
  type StudioWriteResult,
} from "@/modules/natural-nudges/discord/studioOperations";
import {
  createNudgeStudioInteractionRoute,
  type NudgeStudioRouteDependencies,
} from "@/modules/natural-nudges/discord/studioRoutes";
import { BUILTIN_IDLE_NUDGES, customIdleNudgeDefinition } from "@/modules/natural-nudges/runtime/idleNudges";
import { parseInteractionRoute, type GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createCustomIdleNudge, createPersona } from "../../helpers/fixtures";
import { localizedCopy, localizedProse } from "../../helpers/localeCases";
import { collectTextDisplays } from "../../helpers/panelLimits";
import { createRouteInteraction } from "../../helpers/routeInteraction";

const NONCE = "nonce1234567";

beforeAll(async () => initializeLocalizer());

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
    ],
    customCount,
    personaNames: new Map(),
  };
}

function harness(overrides: Partial<NudgeStudioRouteDependencies> = {}) {
  const snapshots = new Map<string, string[]>();
  const result = { current: "success" as StudioWriteResult };
  const operations = {
    addCustomIdleNudge: mock(async () => result.current),
    updateCustomIdleNudge: mock(async () => result.current),
    setIdleNudgeAvailability: mock(async () => result.current),
    removeCustomIdleNudges: mock(async () => result.current),
  };
  const showModal = mock(async (..._args: Parameters<NudgeStudioRouteDependencies["showModal"]>) => {});
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
      buildNudgeStudioRouteId({ ...base, action: "add-submit", nonce: NONCE }),
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
    await h.dispatch({ ...base, action: "select" }, "string-select", { values: ["7"] });
    expect(h.showModal.mock.calls[0]?.[1].custom_id).toBe(
      buildNudgeStudioRouteId({ ...base, action: "edit-submit", id: 7, nonce: NONCE }),
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

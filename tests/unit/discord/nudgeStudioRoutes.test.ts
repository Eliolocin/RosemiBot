import { beforeAll, describe, expect, it, mock } from "bun:test";
import type { Client } from "discord.js";
import { CUSTOM_IDLE_NUDGE_LIMIT } from "@/modules/natural-nudges/db/types";
import {
  buildNudgeStudioRouteId,
  nudgeStudioFieldId,
  type NudgeStudioRoute,
} from "@/modules/natural-nudges/discord/studioCatalog";
import type { NudgeStudioView, StudioWriteResult } from "@/modules/natural-nudges/discord/studioOperations";
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
      { definition: customIdleNudgeDefinition(custom), enabled: true, custom },
    ],
    customCount,
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
    resolveScope: async () => ({ serverId: 1, personas: [createPersona()] }),
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
    const interaction = await h.dispatch({ ...base, action: "toggle-open" }, "button", { isManager: false });
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

  it("writes availability for exactly the presented idle nudges", async () => {
    const h = harness();
    await h.dispatch({ ...base, action: "toggle-open" }, "button");
    const presented = h.snapshots.get(NONCE);
    expect(presented).toEqual(view().entries.map((entry) => entry.definition.key));

    h.checkboxValues.set(nudgeStudioFieldId("checklist", NONCE, 0), ["ping_user.check_in", "custom:7"]);
    await h.dispatch({ ...base, action: "toggle-submit", nonce: NONCE }, "modal");
    expect(h.operations.setIdleNudgeAvailability).toHaveBeenCalledWith(
      1,
      "ping_user",
      presented,
      new Set(["ping_user.check_in", "custom:7"]),
    );
    expect(h.recordAction).toHaveBeenCalledTimes(1);
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
    for (const [open, submit] of [
      ["remove-open", "remove-submit"],
      ["toggle-open", "toggle-submit"],
    ] as const) {
      const h = harness();
      await h.dispatch({ ...base, action: open }, "button");
      const interaction = await h.dispatch({ ...base, action: submit, nonce: NONCE }, "modal");

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

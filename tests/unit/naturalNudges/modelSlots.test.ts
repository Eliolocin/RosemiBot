import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { naturalNudgePanelDependencies } from "@/modules/natural-nudges/discord/operations";
import * as configModelOperations from "@/utils/discord/interactions/configModelOperations";
import * as executors from "@/providers/utils/providerFeatureExecutors";
import {
  registerProviderOption,
  type ProviderOptionCapability,
  type ProviderOptionDefinition,
} from "@/utils/provider/providerOptionRegistry";
import { createPersona } from "../../helpers/fixtures";
import { decisionModelSchema } from "@/types/db/schema";

const OPTION_VALUE = "test-option";
const MODEL_ID = 5;
const ops = naturalNudgePanelDependencies.operations;
const state = createPersona({ server_id: 12 });

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** The option offers `MODEL_ID` as a structured-output text model; every config write succeeds. */
function stubPanel(): void {
  const spies = [
    spyOn(naturalNudgeRepository, "saveServerConfig").mockResolvedValue(true),
    spyOn(configModelOperations, "loadStructuredOutputModelGroups").mockResolvedValue([
      { provider: OPTION_VALUE, models: [{ id: MODEL_ID, name: "fixture", description: "" }] },
    ]),
    spyOn(executors, "loadDecisionModelsForScope").mockResolvedValue([]),
  ];
  cleanups.push(() => {
    for (const spy of spies) spy.mockRestore();
  });
}

function registerOwner(claimSucceeds = true): { claimed: string[]; released: string[] } {
  const owned = new Set<ProviderOptionCapability>(["nudge-planner", "nudge-checker"]);
  const record = { claimed: [] as string[], released: [] as string[] };
  const option: ProviderOptionDefinition = {
    value: OPTION_VALUE,
    catalogProvider: "openrouter",
    capabilities: ["text", "nudge-planner", "nudge-checker"],
    copy: {
      labelKey: "commands.providers.entry_kind_provider",
      entryDescriptionKeys: {
        server: "commands.providers.entry_kind_endpoint",
        personal: "commands.providers.entry_kind_brave",
      },
      addActionLabelKey: "commands.providers.select_add_provider",
      addActionDescriptionKeys: {
        server: "commands.providers.select_add_provider_description",
        personal: "commands.providers.select_add_endpoint_description",
      },
      removeImpactKey: "commands.providers.remove_impact_provider",
    },
    availability: () => ({ eligible: true }),
    selection: {
      load: async () => null,
      ensure: async () => true,
      claim: async (_scope, capability) => {
        record.claimed.push(capability);
        return claimSucceeds;
      },
      release: async (_scope, capability) => {
        record.released.push(capability);
        return true;
      },
      remove: async () => "removed",
      owns: (_scope, capability) => owned.has(capability),
    },
  };
  cleanups.push(registerProviderOption(option));
  return record;
}

describe("Natural Nudges model slots", () => {
  it("gives each pinned slot to the provider it was picked under and releases it when unpinned", async () => {
    stubPanel();
    const record = registerOwner();
    expect(await ops.setPlannerModel(state, OPTION_VALUE, MODEL_ID)).toBe("success");
    expect(await ops.setCheckerModel(state, { kind: "llm", provider: OPTION_VALUE, id: MODEL_ID })).toBe("success");
    expect(record.claimed).toEqual(["nudge-planner", "nudge-checker"]);

    expect(await ops.setPlannerModel(state, "", null)).toBe("success");
    expect(await ops.setCheckerModel(state, null)).toBe("success");
    expect(record.released).toEqual(["nudge-planner", "nudge-checker"]);
  });

  it("reports a failed ownership write instead of success", async () => {
    stubPanel();
    registerOwner(false);
    expect(await ops.setPlannerModel(state, OPTION_VALUE, MODEL_ID)).toBe("write-failed");
  });

  it("keeps the selected provider alias when a Decision checker shares the OpenRouter catalog", async () => {
    stubPanel();
    const record = registerOwner();
    const providers = spyOn(configModelOperations, "loadConfigModelProviders").mockResolvedValue([
      "openrouter",
      OPTION_VALUE,
    ]);
    const decisions = spyOn(executors, "loadDecisionModelsForScope").mockResolvedValue([
      {
        model: decisionModelSchema.parse({
          decision_model_id: 8,
          provider: "openrouter",
          codename: "fixture/decision",
          input_token_limit: 32000,
          supported_primitives: ["predicate", "choice"],
        }),
        reference: { provider: "openrouter", modelId: 8, registrationId: null, customEndpointId: null },
      },
    ]);
    try {
      expect(await ops.setCheckerModel(state, { kind: "decision", provider: OPTION_VALUE, id: 8 })).toBe("success");
      expect(record.claimed).toEqual(["nudge-checker"]);
      expect(await ops.setCheckerModel(state, { kind: "decision", provider: "openrouter", id: 8 })).toBe("success");
      expect(record.released).toEqual(["nudge-checker"]);
    } finally {
      decisions.mockRestore();
      providers.mockRestore();
    }
  });
});

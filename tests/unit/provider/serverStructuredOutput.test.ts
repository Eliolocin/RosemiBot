import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { savedProviderConfigSchema, type SavedProviderConfigRow } from "@/types/db/schema";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import * as capabilityResolver from "@/utils/provider/providerCapabilityResolver";
import {
  registerProviderOption,
  type ProviderOptionCapability,
  type ProviderOptionDefinition,
} from "@/utils/provider/providerOptionRegistry";
import { ProviderRequestDeniedError, type ProviderUsageContext } from "@/utils/provider/providerUsage";
import { resolveServerStructuredModel } from "@/utils/provider/serverStructuredOutput";
import * as crypto from "@/utils/security/crypto";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

const SERVER_ID = 12;
const MODEL_ID = 5;
const OPTION_VALUE = "test-option";
const usageContext: ProviderUsageContext = {};

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function savedRow(provider: string): SavedProviderConfigRow {
  return savedProviderConfigSchema.parse({
    server_id: SERVER_ID,
    provider,
    api_key: Buffer.from("encrypted"),
    llm_id: null,
    llm_disabled_params: [],
    llm_logit_biases: [],
    fallback_model_refs: [],
    diffusion_model_id: null,
    embedding_model_id: null,
    nai_diffusion_model_id: null,
    nai_preset_name: null,
  });
}

/** One OpenRouter catalog model the server is offered, with a saved key under every provider name. */
function stubCatalog(): { savedLookups: string[] } {
  const model = createLlmRow({ llm_id: MODEL_ID, llm_provider: "openrouter", supports_structoutput: true });
  const savedLookups: string[] = [];
  const spies = [
    spyOn(llmModelRepo, "loadById").mockResolvedValue(model),
    spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([model]),
    spyOn(llmProviderRepo, "loadSavedProviderConfig").mockImplementation(async (_serverId, provider) => {
      savedLookups.push(provider);
      return savedRow(provider);
    }),
    spyOn(capabilityResolver, "resolveStructuredOutputCapability").mockResolvedValue({} as never),
    spyOn(crypto, "decryptApiKey").mockResolvedValue("saved-key"),
  ];
  cleanups.push(() => {
    for (const spy of spies) spy.mockRestore();
  });
  return { savedLookups };
}

function registerPayingOption(input: { owned: ProviderOptionCapability[]; eligible?: boolean; refuse?: boolean }): {
  requests: Array<{ capability: ProviderOptionCapability; modelId: number }>;
} {
  const requests: Array<{ capability: ProviderOptionCapability; modelId: number }> = [];
  const option: ProviderOptionDefinition = {
    value: OPTION_VALUE,
    catalogProvider: "openrouter",
    capabilities: ["text", "reviewer", "nudge-planner", "nudge-checker"],
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
    availability: () => ({ eligible: input.eligible ?? true }),
    selection: {
      load: async () => null,
      ensure: async () => true,
      claim: async () => true,
      remove: async () => "removed",
      owns: (_scope, capability) => input.owned.includes(capability),
      resolveServerCredentials: async ({ capability, modelId }) => {
        requests.push({ capability, modelId });
        if (input.refuse)
          throw new ProviderRequestDeniedError(usageContext, () => ({ titleKey: "fixture", description: "fixture" }));
        return { apiKey: "option-key", usageContext, savedProvider: OPTION_VALUE };
      },
    },
  };
  cleanups.push(registerProviderOption(option));
  return { requests };
}

const persona = () => createPersona({ server_id: SERVER_ID });

describe("Server-pinned structured model payer", () => {
  it("bills the option that owns the slot, mirroring its saved row and carrying its usage context", async () => {
    const { savedLookups } = stubCatalog();
    const { requests } = registerPayingOption({ owned: ["nudge-planner"] });
    const resolved = await resolveServerStructuredModel(persona(), MODEL_ID, { serverId: SERVER_ID }, "nudge-planner");
    expect(resolved).toMatchObject({ apiKey: "option-key", usageContext });
    expect(requests).toEqual([{ capability: "nudge-planner", modelId: MODEL_ID }]);
    expect(savedLookups).toEqual([OPTION_VALUE]);
  });

  it("bills the server's saved key when the option owns a different slot", async () => {
    const { savedLookups } = stubCatalog();
    const { requests } = registerPayingOption({ owned: ["reviewer"] });
    const resolved = await resolveServerStructuredModel(persona(), MODEL_ID, { serverId: SERVER_ID }, "nudge-checker");
    expect(resolved).toMatchObject({ apiKey: "saved-key" });
    expect(resolved && "usageContext" in resolved ? resolved.usageContext : undefined).toBeUndefined();
    expect(requests).toEqual([]);
    expect(savedLookups).toEqual(["openrouter"]);
  });

  it("never falls back to the saved key when the owning option is unavailable or refuses", async () => {
    const { savedLookups } = stubCatalog();
    registerPayingOption({ owned: ["text"], eligible: false });
    expect(await resolveServerStructuredModel(persona(), MODEL_ID, { serverId: SERVER_ID }, "text")).toBeNull();
    for (const cleanup of cleanups.splice(1)) cleanup();

    registerPayingOption({ owned: ["text"], refuse: true });
    await expect(
      resolveServerStructuredModel(persona(), MODEL_ID, { serverId: SERVER_ID }, "text"),
    ).rejects.toBeInstanceOf(ProviderRequestDeniedError);
    expect(savedLookups).toEqual([]);
  });
});

import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  savedProviderConfigSchema,
  userSavedProviderConfigSchema,
  speechModelSchema,
  type SavedProviderConfigRow,
  type SavedProviderConfigUpsert,
  type TomoriState,
} from "@/types/db/schema";
import * as realSpeechRepository from "@/utils/db/repositories/SpeechRepository";
import * as realSpeechModelCache from "@/utils/cache/openrouterSpeechModelCache";
import * as realRepositories from "@/utils/db/repositories";
import * as realLlmModelRepository from "@/utils/db/repositories/LlmModelRepository";
import * as realLlmProviderRepository from "@/utils/db/repositories/LlmProviderRepository";
import * as realSavedProviderConfig from "@/utils/provider/savedProviderConfig";
import * as realOpenRouterModelRegistry from "@/utils/provider/openrouterModelRegistry";
import * as realProviderActivation from "@/utils/provider/providerActivation";
import {
  registerProviderOption,
  type ProviderOptionCapability,
  type ProviderOptionDefinition,
} from "@/utils/provider/providerOptionRegistry";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { cache } from "@/utils/cache/tomoriStateCacheStore";
import { createScopedModuleMocker, overrideMembers } from "../../helpers/mockSurface";

const upserted: SavedProviderConfigUpsert[] = [];
let persistedState = state();
let writeSucceeds = true;
let claimResult: boolean | Error = true;
let releaseResult: boolean | Error = true;
let owned: ProviderOptionCapability[] = [];
let savedProvider = "test-option";
let speechSelections: Array<{ ownerId: number; modelId: number; provider: string }> = [];
let speechCatalogProviders: string[] = [];
let builtInSpeechWrites = 0;
let personalSpeechRow = userSavedProviderConfigSchema.parse({
  ...savedRow(),
  user_id: 13,
  enabled_capabilities: [],
  assigned_capabilities: [],
});

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/db/repositories/SpeechRepository": realSpeechRepository,
  "@/utils/cache/openrouterSpeechModelCache": realSpeechModelCache,
  "@/utils/db/repositories": realRepositories,
  "@/utils/db/repositories/LlmModelRepository": realLlmModelRepository,
  "@/utils/db/repositories/LlmProviderRepository": realLlmProviderRepository,
  "@/utils/provider/savedProviderConfig": realSavedProviderConfig,
  "@/utils/provider/openrouterModelRegistry": realOpenRouterModelRegistry,
  "@/utils/provider/providerActivation": realProviderActivation,
});

scopedMock.module("@/utils/cache/openrouterSpeechModelCache", () => ({
  ...realSpeechModelCache,
  validateOpenRouterSpeechModel: async () => true,
}));
scopedMock.module("@/utils/db/repositories/SpeechRepository", () => ({
  ...realSpeechRepository,
  setHostedSpeechSelection: async () => {
    builtInSpeechWrites += 1;
    return false;
  },
}));

scopedMock.module("@/utils/db/repositories", () => ({
  ...realRepositories,
  configRepository: overrideMembers(realRepositories.configRepository, {
    updateModelConfig: async (
      _id: number,
      changes: Parameters<typeof realRepositories.configRepository.updateModelConfig>[1],
    ) => {
      if (!writeSucceeds) return false;
      Object.assign(persistedState.config, changes);
      return true;
    },
    updateChatConfig: async () => true,
  }),
  llmModelRepo: overrideMembers(realRepositories.llmModelRepo, {
    loadAvailableModelsForProvider: async () => [llmRow()],
    loadAvailableSpeechModels: async (provider: string) => {
      speechCatalogProviders.push(provider);
      return provider === "openrouter"
        ? [
            speechModelSchema.parse({
              speech_model_id: 88,
              provider: "openrouter",
              codename: "mirri-voice",
              voice_mode: "design",
            }),
          ]
        : [];
    },
  }),
}));

scopedMock.module("@/utils/provider/savedProviderConfig", () => ({
  ...realSavedProviderConfig,
  loadSavedProvidersForCapability: async () => [savedRow(savedProvider)],
  loadUserSavedProvidersForCapability: async () => [personalSpeechRow],
}));

scopedMock.module("@/utils/db/repositories/LlmModelRepository", () => ({
  ...realLlmModelRepository,
  llmModelRepo: overrideMembers(realLlmModelRepository.llmModelRepo, {
    loadAvailableDecisionModels: async () => [],
  }),
}));

scopedMock.module("@/utils/db/repositories/LlmProviderRepository", () => ({
  ...realLlmProviderRepository,
  llmProviderRepo: overrideMembers(realLlmProviderRepository.llmProviderRepo, {
    loadSavedProviderConfig: async () => savedRow(savedProvider),
    loadUserSavedProviderConfig: async () => personalSpeechRow,
    loadUserSavedProviderConfigs: async () => [personalSpeechRow],
    loadCustomEndpointsForServer: async () => [],
    upsertSavedProviderConfig: async (_serverId: number, config: SavedProviderConfigUpsert) => {
      upserted.push(config);
      return true;
    },
  }),
}));

scopedMock.module("@/utils/provider/openrouterModelRegistry", () => ({
  ...realOpenRouterModelRegistry,
  registerOpenRouterModelForScope: async () => ({
    status: "registered" as const,
    model: { modelId: 77, codename: "mirri-model" },
  }),
}));

scopedMock.module("@/utils/provider/providerActivation", () => ({
  ...realProviderActivation,
  activateServerTextModelFromSavedConfig: async () => ({ status: "activated" as const, modelName: "mirri-model" }),
}));

function savedRow(provider = "test-option"): SavedProviderConfigRow {
  return savedProviderConfigSchema.parse({
    server_id: 12,
    provider,
    api_key: null,
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

function llmRow() {
  return createLlmRow({
    llm_id: 77,
    llm_provider: savedProvider === "test-option" ? "openrouter" : savedProvider,
    llm_codename: "mirri-model",
    supports_structoutput: true,
  });
}

function state(): TomoriState {
  return createPersona({
    server_id: 12,
    llm: createLlmRow({ llm_provider: "openrouter", llm_id: 70 }),
    config: { llm_id: 70 },
  });
}

function seedCache() {
  const snapshot = structuredClone(persistedState);
  cache.set("guild-1", { mainPersona: snapshot, personas: [snapshot], cachedAt: Date.now() });
}

interface Recorded {
  ensured: number;
  validated: string[];
  claimed: ProviderOptionCapability[];
}

let disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  upserted.length = 0;
  persistedState = state();
  writeSucceeds = true;
  claimResult = true;
  releaseResult = true;
  owned = [];
  savedProvider = "test-option";
  speechSelections = [];
  speechCatalogProviders = [];
  builtInSpeechWrites = 0;
  personalSpeechRow = userSavedProviderConfigSchema.parse({
    ...savedRow(),
    user_id: 13,
    enabled_capabilities: [],
    assigned_capabilities: [],
  });
  cache.delete("guild-1");
});

function registerModellingOption(recorded: Recorded): ProviderOptionDefinition {
  const option: ProviderOptionDefinition = {
    value: "test-option",
    catalogProvider: "openrouter",
    capabilities: ["text", "vision", "embedding", "image", "video", "decision", "speech-design", "speech-clone"],
    copy: {
      labelKey: "commands.providers.entry_kind_provider",
      entryDescriptionKeys: {
        server: "commands.providers.entry_kind_provider",
        personal: "commands.providers.entry_kind_endpoint",
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
      ensure: async () => {
        recorded.ensured += 1;
        return true;
      },
      claim: async (_scope, capability) => {
        recorded.claimed.push(capability);
        if (claimResult instanceof Error) throw claimResult;
        if (claimResult) owned = [...owned.filter((value) => value !== capability), capability];
        return claimResult;
      },
      owns: (_scope, capability) => owned.includes(capability),
      setSpeech: async ({ scope, modelId }) => {
        speechSelections.push({ ownerId: scope.ownerId, modelId, provider: "test-option" });
        if (scope.kind === "personal") {
          personalSpeechRow = {
            ...personalSpeechRow,
            speech_design_model_id: modelId,
            enabled_capabilities: ["speech_design"],
            assigned_capabilities: ["speech_design"],
          };
        } else {
          persistedState.config.speech_design_model_id = modelId;
          owned = [...owned, "speech-design"];
        }
        return true;
      },
      release: async (_scope, capability) => {
        if (releaseResult instanceof Error) throw releaseResult;
        if (releaseResult) owned = owned.filter((value) => value !== capability);
        return releaseResult;
      },
      remove: async () => "removed",
      validateModel: async ({ modelCodename }) => {
        recorded.validated.push(modelCodename);
        return true;
      },
    },
  };
  disposers.push(registerProviderOption(option));
  return option;
}

describe("provider option model persistence", () => {
  it("binds a picked model to the option payer after validating and ensuring it", async () => {
    const recorded: Recorded = { ensured: 0, validated: [], claimed: [] };
    registerModellingOption(recorded);
    const { providerPanelOperations } = await import("@/utils/provider/providerPanelOperations");

    const result = await providerPanelOperations.saveProviderModel({
      scopeKind: "server",
      serverDiscId: "guild-1",
      state: state(),
      entryId: "provider:test-option",
      capability: "text",
      codeName: "mirri-model",
    });

    expect(result).toEqual({ status: "success", entryId: "provider:test-option", codeName: "mirri-model" });
    expect(recorded.ensured).toBe(1);
    expect(recorded.validated).toEqual(["mirri-model"]);
    expect(recorded.claimed).toEqual(["text"]);
    expect(upserted).toHaveLength(1);
    expect(upserted[0]?.provider).toBe("test-option");
    expect(upserted[0]?.llm_id).toBe(77);
  });

  it("picks a model view choice as the option payer for the workspace slot", async () => {
    const recorded: Recorded = { ensured: 0, validated: [], claimed: [] };
    registerModellingOption(recorded);
    const { configModelOperations } = await import("@/utils/discord/interactions/configModelOperations");

    const result = await configModelOperations.setCapabilityModel({
      tomoriState: state(),
      serverDiscId: "guild-1",
      capability: "text",
      provider: "test-option",
      modelId: 77,
    });

    expect(result).toEqual({ status: "success", modelName: "mirri-model", reembedded: false });
    expect(recorded.claimed).toEqual(["text"]);
  });

  it("refuses a capability the option does not offer before touching its stored row", async () => {
    const recorded: Recorded = { ensured: 0, validated: [], claimed: [] };
    registerModellingOption(recorded);
    const { providerPanelOperations } = await import("@/utils/provider/providerPanelOperations");

    const result = await providerPanelOperations.saveProviderModel({
      scopeKind: "server",
      serverDiscId: "guild-1",
      state: state(),
      entryId: "provider:test-option",
      capability: "transcription",
      codeName: "mirri-model",
    });

    expect(result).toEqual({ status: "unsupported-capability" });
    expect(recorded.ensured).toBe(0);
    expect(upserted).toHaveLength(0);
  });
  it("releases an option payer when the provider panel activates a built-in model", async () => {
    const recorded: Recorded = { ensured: 0, validated: [], claimed: [] };
    registerModellingOption(recorded);
    const { providerPanelOperations } = await import("@/utils/provider/providerPanelOperations");
    for (const provider of ["openrouter"]) {
      owned = ["text"];
      savedProvider = provider;
      const result = await providerPanelOperations.saveProviderModel({
        scopeKind: "server",
        serverDiscId: "guild-1",
        state: state(),
        entryId: `provider:${provider}`,
        capability: "text",
        codeName: "mirri-model",
      });
      expect(result.status).toBe("success");
      expect(owned).toEqual([]);
    }
  });

  it("moves a model-view slot from an option payer to a different built-in catalog", async () => {
    registerModellingOption({ ensured: 0, validated: [], claimed: [] });
    owned = ["vision"];
    savedProvider = "google";
    const { configModelOperations } = await import("@/utils/discord/interactions/configModelOperations");
    const result = await configModelOperations.setCapabilityModel({
      tomoriState: state(),
      serverDiscId: "guild-1",
      capability: "vision",
      provider: "google",
      modelId: 77,
    });
    expect(result.status).toBe("success");
    expect(persistedState.config.vision_llm_id).toBe(77);
    expect(owned).toEqual([]);
  });

  it("registers an option speech model through its catalog provider", async () => {
    registerModellingOption({ ensured: 0, validated: [], claimed: [] });
    const { providerPanelOperations } = await import("@/utils/provider/providerPanelOperations");
    const result = await providerPanelOperations.saveProviderModel({
      scopeKind: "server",
      serverDiscId: "guild-1",
      state: state(),
      entryId: "provider:test-option",
      capability: "speech",
      codeName: "mirri-voice",
    });
    expect(result).toMatchObject({ status: "success", entryId: "provider:test-option", codeName: "mirri-voice" });
    expect(speechCatalogProviders).toEqual(["openrouter"]);
    expect(speechSelections).toEqual([{ ownerId: 12, modelId: 88, provider: "test-option" }]);
    expect(builtInSpeechWrites).toBe(0);
  });

  it("registers personal speech under a keyless option payer without a built-in payer row", async () => {
    registerModellingOption({ ensured: 0, validated: [], claimed: [] });
    const { providerPanelOperations } = await import("@/utils/provider/providerPanelOperations");
    const result = await providerPanelOperations.saveProviderModel({
      scopeKind: "personal",
      ownerId: 13,
      serverDiscId: "guild-1",
      state: state(),
      entryId: "provider:test-option",
      capability: "speech",
      codeName: "mirri-voice",
    });
    expect(result.status).toBe("success");
    expect(speechCatalogProviders).toEqual(["openrouter"]);
    expect(speechSelections).toEqual([{ ownerId: 13, modelId: 88, provider: "test-option" }]);
    expect(personalSpeechRow.provider).toBe("test-option");
    expect(personalSpeechRow.api_key).toBeNull();
    expect(personalSpeechRow.speech_design_model_id).toBe(88);
    expect(personalSpeechRow.enabled_capabilities).toEqual(["speech_design"]);
    expect(builtInSpeechWrites).toBe(0);
  });

  it("picks option speech in the server and personal model views under the option payer", async () => {
    registerModellingOption({ ensured: 0, validated: [], claimed: [] });
    const { configModelOperations } = await import("@/utils/discord/interactions/configModelOperations");
    const { personalConfigOperations } = await import("@/utils/discord/interactions/personalConfigOperations");
    const serverResult = await configModelOperations.setCapabilityModel({
      tomoriState: state(),
      serverDiscId: "guild-1",
      capability: "tts-design",
      provider: "test-option",
      modelId: 88,
    });
    expect(serverResult.status).toBe("success");
    expect(persistedState.config.speech_design_model_id).toBe(88);
    expect(owned).toContain("speech-design");
    const personalResult = await personalConfigOperations.setCapabilityModel({
      userId: 13,
      userDiscId: "user-1",
      capability: "speech_design",
      provider: "test-option",
      modelId: 88,
    });
    expect(personalResult.status).toBe("success");
    expect(personalSpeechRow.speech_design_model_id).toBe(88);
    expect(personalSpeechRow.enabled_capabilities).toEqual(["speech_design"]);
    expect(personalSpeechRow.api_key).toBeNull();
    expect(builtInSpeechWrites).toBe(0);
  });

  it("invalidates successful model writes even when ownership claim fails or throws", async () => {
    registerModellingOption({ ensured: 0, validated: [], claimed: [] });
    const { configModelOperations } = await import("@/utils/discord/interactions/configModelOperations");
    for (const outcome of [false, new Error("ownership write failed")]) {
      persistedState = state();
      seedCache();
      claimResult = outcome;
      const operation = configModelOperations.setCapabilityModel({
        tomoriState: state(),
        serverDiscId: "guild-1",
        capability: "vision",
        provider: "test-option",
        modelId: 77,
      });
      if (outcome instanceof Error) await expect(operation).rejects.toThrow();
      else expect((await operation).status).toBe("write-failed");
      expect(persistedState.config.vision_llm_id).toBe(77);
      expect(cache.has("guild-1")).toBe(false);
    }
  });

  it("invalidates a persisted clear even when releasing ownership fails or throws", async () => {
    registerModellingOption({ ensured: 0, validated: [], claimed: [] });
    const { configModelOperations } = await import("@/utils/discord/interactions/configModelOperations");
    for (const outcome of [false, new Error("ownership write failed")]) {
      persistedState = state();
      persistedState.config.vision_llm_id = 77;
      owned = ["vision"];
      seedCache();
      releaseResult = outcome;
      const operation = configModelOperations.clearCapabilityModel({
        tomoriState: structuredClone(persistedState),
        serverDiscId: "guild-1",
        capability: "vision",
      });
      if (outcome instanceof Error) await expect(operation).rejects.toThrow();
      else expect((await operation).status).toBe("write-failed");
      expect(persistedState.config.vision_llm_id).toBeNull();
      expect(cache.has("guild-1")).toBe(false);
    }
  });

  it("retains the cache when the model write fails", async () => {
    registerModellingOption({ ensured: 0, validated: [], claimed: [] });
    const { configModelOperations } = await import("@/utils/discord/interactions/configModelOperations");
    seedCache();
    writeSucceeds = false;
    const result = await configModelOperations.setCapabilityModel({
      tomoriState: state(),
      serverDiscId: "guild-1",
      capability: "vision",
      provider: "test-option",
      modelId: 77,
    });
    expect(result.status).toBe("write-failed");
    expect(persistedState.config.vision_llm_id ?? null).toBeNull();
    expect(cache.has("guild-1")).toBe(true);
    expect(owned).toEqual([]);
  });
});

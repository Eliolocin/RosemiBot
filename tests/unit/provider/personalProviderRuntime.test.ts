import { beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  CustomEndpointRow,
  LlmRow,
  PersonalFallbackSettings,
  TomoriState,
  UserSavedProviderConfigRow,
} from "@/types/db/schema";
import { userSavedProviderConfigSchema } from "@/types/db/schema";
import * as realRepositories from "@/utils/db/repositories";
import { resolveContextBudget } from "@/utils/provider/contextBudget";
import { resolveRequestMaxOutputTokens } from "@/utils/provider/modelLimits";
import { createScopedModuleMocker, overrideMembers } from "../../helpers/mockSurface";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

const primary = { llm_id: 11, llm_provider: "custom:u4:local", llm_codename: "primary" } as LlmRow;
const fallback = { llm_id: 12, llm_provider: "google", llm_codename: "fallback" } as LlmRow;
const serverFallback = { llm_id: 90, llm_provider: "google", llm_codename: "server-fallback" } as LlmRow;
const personalText = createLlmRow({
  llm_id: 14,
  llm_provider: "deepseek",
  llm_codename: "deepseek-flash",
  context_window: 128_000,
  max_output_tokens: 16_000,
});
const endpoint = {
  custom_endpoint_id: 5,
  connection_id: 1,
  server_id: null,
  user_id: 4,
  label: "local",
  capability: "text",
  model_ref_id: 13,
} as CustomEndpointRow;

let rows: UserSavedProviderConfigRow[] = [];
let fallbackSettings: PersonalFallbackSettings = { fallback_model_refs: [], model_randomizer_enabled: false };

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/db/repositories": realRepositories,
});

scopedMock.module("@/utils/db/repositories", () => ({
  ...realRepositories,
  llmModelRepo: overrideMembers(realRepositories.llmModelRepo, {
    loadById: async (id: number) => [primary, fallback, personalText].find((model) => model.llm_id === id) ?? null,
    getLlmsByIds: async (ids: number[]) => (ids.includes(fallback.llm_id as number) ? [fallback] : []),
  }),
  llmProviderRepo: overrideMembers(realRepositories.llmProviderRepo, {
    loadUserSavedProviderConfigs: async () => rows,
    loadPersonalFallbackSettings: async () => fallbackSettings,
    loadCustomEndpointsByIds: async (ids: number[]) =>
      ids.includes(endpoint.custom_endpoint_id as number) ? [endpoint] : [],
  }),
}));

function makeState(): TomoriState {
  return createPersona({
    // The server's own row, kept distinct from the personal overlay rows the repository mock
    // returns.
    llm: createLlmRow({ llm_id: 1, llm_provider: "google", llm_codename: "server-primary" }),
    fallback_llms: [serverFallback],
    fallback_chain: [{ kind: "llm", model: serverFallback }],
    config: { fallback_llm_ids: [90] },
  });
}

function makePersonalRow(
  enabledCapabilities: UserSavedProviderConfigRow["enabled_capabilities"],
): UserSavedProviderConfigRow {
  return {
    user_id: 4,
    provider: "custom:u4:local",
    enabled_capabilities: enabledCapabilities,
    llm_id: 11,
  } as UserSavedProviderConfigRow;
}

/** A user-level chain that mixes a custom endpoint with a Google catalog model. */
function makeMixedProviderChain(modelRandomizerEnabled = false): PersonalFallbackSettings {
  return {
    fallback_model_refs: [
      { type: "custom_endpoint", id: 5 },
      { type: "llm", id: 12 },
    ],
    model_randomizer_enabled: modelRandomizerEnabled,
  };
}

describe("personal provider fallback overlay", () => {
  beforeEach(() => {
    rows = [];
    fallbackSettings = { fallback_model_refs: [], model_randomizer_enabled: false };
  });

  it("materializes a chain that mixes providers and preserves its configured order", async () => {
    rows = [makePersonalRow(["text"])];
    fallbackSettings = makeMixedProviderChain();

    const { applyPersonalProviderSelectionsToTomoriState } = await import("@/utils/provider/personalProviderRuntime");
    const result = await applyPersonalProviderSelectionsToTomoriState(makeState(), 4);

    expect(result.tomoriState.config.fallback_llm_ids).toEqual([12]);
    expect(result.tomoriState.fallback_chain).toEqual([
      { kind: "custom_endpoint", endpoint },
      { kind: "llm", model: fallback },
    ]);
    expect(result.tomoriState.fallback_llms).toEqual([fallback]);
  });

  it("runs the same user-level chain whichever provider owns personal text", async () => {
    rows = [
      makePersonalRow([]),
      { user_id: 4, provider: "deepseek", enabled_capabilities: ["text"], llm_id: 14 } as UserSavedProviderConfigRow,
    ];
    fallbackSettings = makeMixedProviderChain(true);

    const { applyPersonalProviderSelectionsToTomoriState } = await import("@/utils/provider/personalProviderRuntime");
    const result = await applyPersonalProviderSelectionsToTomoriState(makeState(), 4);

    expect(result.activeConfigs.text?.provider).toBe("deepseek");
    expect(result.tomoriState.fallback_chain).toEqual([
      { kind: "custom_endpoint", endpoint },
      { kind: "llm", model: fallback },
    ]);
    expect(result.tomoriState.config.model_randomizer_enabled).toBe(true);
  });

  it("keeps the server fallback chain when no personal text provider is active", async () => {
    rows = [makePersonalRow(["embedding"])];
    fallbackSettings = makeMixedProviderChain();
    const state = makeState();

    const { applyPersonalProviderSelectionsToTomoriState } = await import("@/utils/provider/personalProviderRuntime");
    const result = await applyPersonalProviderSelectionsToTomoriState(state, 4);

    expect(result.tomoriState.fallback_chain).toBe(state.fallback_chain);
    expect(result.tomoriState.fallback_llms).toBe(state.fallback_llms);
  });

  it("overlays personal model randomizer state when personal text is active", async () => {
    rows = [makePersonalRow(["text"])];
    fallbackSettings = makeMixedProviderChain(true);
    const state = { ...makeState(), config: { ...makeState().config, model_randomizer_enabled: false } };

    const { applyPersonalProviderSelectionsToTomoriState } = await import("@/utils/provider/personalProviderRuntime");
    const result = await applyPersonalProviderSelectionsToTomoriState(state, 4);

    expect(result.tomoriState.config.model_randomizer_enabled).toBe(true);
  });

  it.each([
    { name: "personal override", enabled: true, personalLimit: 1_024, expected: 1_024 },
    { name: "model ceiling", enabled: true, personalLimit: 32_000, expected: 16_000 },
    { name: "inherited limit", enabled: true, personalLimit: null, expected: 2_048 },
    { name: "inactive personal Text", enabled: false, personalLimit: 1_024, expected: 2_048 },
  ])("uses $name for both request output and history reservation", async ({ enabled, personalLimit, expected }) => {
    rows = [
      userSavedProviderConfigSchema.parse({
        user_saved_config_id: 1,
        user_id: 4,
        provider: "deepseek",
        api_key: null,
        llm_id: personalText.llm_id,
        diffusion_model_id: null,
        embedding_model_id: null,
        nai_diffusion_model_id: null,
        nai_preset_name: null,
        llm_max_output_tokens: personalLimit,
        llm_disabled_params: [],
        llm_logit_biases: [],
        assigned_capabilities: ["text"],
        enabled_capabilities: enabled ? ["text"] : [],
      }),
    ];
    const state = createPersona({ llm: personalText, config: { llm_max_output_tokens: 2_048 } });

    const { applyPersonalProviderSelectionsToTomoriState } = await import("@/utils/provider/personalProviderRuntime");
    const { tomoriState } = await applyPersonalProviderSelectionsToTomoriState(state, 4);

    expect(await resolveRequestMaxOutputTokens(tomoriState)).toBe(expected);
    expect((await resolveContextBudget(tomoriState, state.server_id.toString()))?.outputReserve).toBe(expected);
    expect(state.config.llm_max_output_tokens).toBe(2_048);
  });

  it("overlays Standard and NAI diffusion models independently when on different provider rows", async () => {
    rows = [
      {
        user_id: 4,
        provider: "openrouter",
        enabled_capabilities: ["image"],
        assigned_capabilities: ["image"],
        diffusion_model_id: 101,
        nai_diffusion_model_id: null,
      } as UserSavedProviderConfigRow,
      {
        user_id: 4,
        provider: "novelai",
        enabled_capabilities: ["image_nai"],
        assigned_capabilities: ["image_nai"],
        diffusion_model_id: null,
        nai_diffusion_model_id: 202,
      } as UserSavedProviderConfigRow,
    ];
    const state = makeState();

    const { applyPersonalProviderSelectionsToTomoriState } = await import("@/utils/provider/personalProviderRuntime");
    const result = await applyPersonalProviderSelectionsToTomoriState(state, 4);

    expect(result.activeConfigs.image?.provider).toBe("openrouter");
    expect(result.activeConfigs.image_nai?.provider).toBe("novelai");
    expect(result.tomoriState.config.diffusion_model_id).toBe(101);
    expect(result.tomoriState.config.nai_diffusion_model_id).toBe(202);
  });
});

import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { SavedProviderConfigRow, TomoriState } from "@/types/db/schema";
import { useEnvSandbox } from "../../helpers/env";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { configRepository, llmModelRepo, llmOverrideRepo, llmProviderRepo } from "@/utils/db/repositories";
import * as speechRepository from "@/utils/db/repositories/SpeechRepository";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import * as openrouterSpeechModelCache from "@/utils/cache/openrouterSpeechModelCache";
import {
  supporterCapabilityMarkerRepository,
  supporterSponsorshipRepository,
  supporterServerSponsorshipSchema,
} from "@/modules/supporter-billing/db";
import * as supporterFunding from "@/modules/supporter-billing/runtime/funding";
import { configModelOperations } from "@/utils/discord/interactions/configModelOperations";
import { loadConfigSwitchModelsView } from "@/utils/discord/interactions/configModelLoaders";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());
useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);

function makeState({ config, ...overrides }: Record<string, unknown> = {}): TomoriState {
  return {
    server_id: 9,
    persona_id: 55,
    persona_nickname: "Aphel",
    is_alter: false,
    trigger_words: [],
    naming_config: { prefixes: {}, suffixes: {}, addressTerms: {} },
    attribute_list: [],
    sample_dialogues_in: [],
    sample_dialogues_out: [],
    llm: { llm_id: 1, llm_codename: "gemini-2.5-flash", llm_provider: "google", sees_images: true, has_tools: true },
    vision_llm: null,
    fallback_chain: [],
    config: {
      subscription_capabilities: [],
      speech_design_endpoint_id: null,
      speech_clone_endpoint_id: null,
      speech_design_model_id: null,
      speech_clone_model_id: null,
      llm_id: 1,
      vision_llm_id: null,
      embedding_model_id: null,
      diffusion_model_id: null,
      nai_diffusion_model_id: null,
      video_model_id: null,
      imagegen_enabled: true,
      videogen_enabled: false,
      llm_temperature: 1,
      llm_top_p: 0.95,
      llm_top_k: 0,
      llm_frequency_penalty: 0,
      llm_presence_penalty: 0,
      llm_min_p: 0.05,
      llm_max_output_tokens: null,
      thinking_level: "auto",
      llm_stop_strings: [],
      llm_stop_speaker_pattern_enabled: false,
      llm_logit_biases: [],
      fallback_model_refs: [],
      model_randomizer_enabled: false,
      image_default_positive_tags: ["masterpiece"],
      image_default_negative_tags: ["lowres"],
      nai_sampler: null,
      nai_steps: null,
      nai_scale: null,
      nai_noise_schedule: null,
      nai_cfg_rescale: null,
      ...((config as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  } as unknown as TomoriState;
}

function makeSavedProvider(provider: string, overrides: Record<string, unknown> = {}): SavedProviderConfigRow {
  return {
    server_id: 9,
    provider,
    api_key: "key",
    key_version: 1,
    llm_id: 1,
    diffusion_model_id: null,
    embedding_model_id: null,
    nai_diffusion_model_id: null,
    video_model_id: null,
    vision_llm_id: null,
    nai_preset_name: null,
    llm_temperature: 1,
    llm_top_p: 0.95,
    llm_top_k: 0,
    llm_frequency_penalty: 0,
    llm_presence_penalty: 0,
    llm_min_p: 0.05,
    llm_max_output_tokens: null,
    llm_disabled_params: [],
    llm_logit_biases: [],
    thinking_level: "auto",
    fallback_model_refs: [],
    ...overrides,
  } as unknown as SavedProviderConfigRow;
}

describe("config model subscription billing choices", () => {
  it("saves subscription text and vision choices from the scoped OpenRouter catalog", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    const model = createLlmRow({
      llm_id: 7,
      llm_provider: "openrouter",
      llm_codename: "synthetic/vision-model",
      sees_images: true,
    });
    const state = createPersona({ server_id: 9 });
    const providers = spyOn(llmProviderRepo, "loadSavedProviderConfigs").mockResolvedValue([
      makeSavedProvider("supporter", { api_key: null }),
      makeSavedProvider("openrouter", { api_key: "synthetic-byok-key" }),
    ]);
    const models = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockImplementation(async (provider) =>
      provider === "openrouter" ? [model] : [],
    );
    const update = spyOn(configRepository, "updateModelConfig").mockResolvedValue(true);
    const chatUpdate = spyOn(configRepository, "updateChatConfig").mockResolvedValue(true);
    const invalidate = spyOn(tomoriStateCache, "invalidateTomoriStateCache").mockImplementation(() => undefined);
    const marker = spyOn(supporterCapabilityMarkerRepository, "setServerCapabilityFunded").mockResolvedValue(
      "synthetic-server",
    );
    try {
      for (const capability of ["text", "vision"] as const) {
        update.mockClear();
        chatUpdate.mockClear();
        invalidate.mockClear();
        const result = await configModelOperations.setCapabilityModel({
          tomoriState: state,
          serverDiscId: "synthetic-server",
          capability,
          provider: "supporter",
          modelId: 7,
        });

        expect(result).toMatchObject({ status: "success", modelName: model.llm_codename });
        expect(models).toHaveBeenLastCalledWith("openrouter", false, { kind: "server", ownerId: 9 });
        expect(update).toHaveBeenCalledWith(
          9,
          capability === "text" ? expect.objectContaining({ llm_id: 7, api_key: null }) : { vision_llm_id: 7 },
          ...(capability === "text" ? ["supporter"] : []),
        );
        if (capability === "vision") expect(marker).toHaveBeenCalledWith(9, "vision", true);
        expect(invalidate).toHaveBeenCalledWith("synthetic-server");
        if (capability === "vision") expect(chatUpdate).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of [providers, models, update, chatUpdate, invalidate, marker]) spy.mockRestore();
    }
  });

  it("stores the selected speech payer and treats a payer change on the same model as a new selection", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    const saved = spyOn(llmProviderRepo, "loadSavedProviderConfigs").mockResolvedValue([
      makeSavedProvider("supporter", { api_key: null }),
      makeSavedProvider("openrouter", { api_key: "synthetic-byok-key" }),
    ]);
    const endpoints = spyOn(llmProviderRepo, "loadCustomEndpointsForServer").mockResolvedValue([]);
    const speechModels = spyOn(llmModelRepo, "loadAvailableSpeechModels").mockResolvedValue([
      {
        speech_model_id: 5,
        provider: "openrouter",
        codename: "fish-audio/s2.1-pro",
        voice_mode: "clone",
        descriptions: null,
      },
      {
        speech_model_id: 6,
        provider: "openrouter",
        codename: "bytedance-seed/seed-audio-1-0",
        voice_mode: "design",
        descriptions: null,
      },
    ] as never);
    const catalog = spyOn(openrouterSpeechModelCache, "validateOpenRouterSpeechModel").mockResolvedValue(true);
    const write = spyOn(speechRepository, "setHostedSpeechSelection").mockResolvedValue(true);
    try {
      const modes = [
        { capability: "tts-clone" as const, mode: "clone" as const, marker: "speech_clone" as const, modelId: 5 },
        { capability: "tts-design" as const, mode: "design" as const, marker: "speech_design" as const, modelId: 6 },
      ];
      for (const { capability, mode, marker, modelId } of modes) {
        write.mockClear();
        const withPayer = (
          capabilities: TomoriState["config"]["subscription_capabilities"],
          selectedId: number | null,
        ) =>
          makeState({
            config: {
              subscription_capabilities: capabilities,
              ...(mode === "design" ? { speech_design_model_id: selectedId } : { speech_clone_model_id: selectedId }),
            },
          });
        const select = (state: TomoriState, provider: string) =>
          configModelOperations.setCapabilityModel({
            tomoriState: state,
            serverDiscId: "guild-1",
            capability,
            provider,
            modelId,
          });

        expect(await select(withPayer([], null), "supporter")).toMatchObject({ status: "success" });
        expect(write).toHaveBeenLastCalledWith(
          { kind: "server", ownerId: 9 },
          modelId,
          mode,
          false,
          undefined,
          "supporter",
        );

        expect(await select(withPayer([marker], modelId), "supporter")).toMatchObject({ status: "already-selected" });
        expect(write).toHaveBeenCalledTimes(1);

        expect(await select(withPayer([marker], modelId), "openrouter")).toMatchObject({ status: "success" });
        expect(write).toHaveBeenLastCalledWith({ kind: "server", ownerId: 9 }, modelId, mode);

        expect(await select(withPayer([], modelId), "supporter")).toMatchObject({ status: "success" });
        expect(write).toHaveBeenLastCalledWith(
          { kind: "server", ownerId: 9 },
          modelId,
          mode,
          false,
          undefined,
          "supporter",
        );
      }
    } finally {
      saved.mockRestore();
      endpoints.mockRestore();
      speechModels.mockRestore();
      catalog.mockRestore();
      write.mockRestore();
    }
  });

  it("persists the chosen server OpenRouter credential source and permits a BYOK copy of the sponsored primary", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    const model = createLlmRow({ llm_id: 101, llm_provider: "openrouter", llm_codename: "synthetic/shared-model" });
    const state = createPersona({ llm: model, config: { llm_id: 101, subscription_capabilities: ["text"] } });
    const rows = spyOn(llmProviderRepo, "loadSavedProviderConfigs").mockResolvedValue([
      makeSavedProvider("openrouter"),
      makeSavedProvider("supporter", { api_key: null }),
    ]);
    const endpoints = spyOn(llmProviderRepo, "loadCustomEndpointsForServer").mockResolvedValue([]);
    const models = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([model]);
    const write = spyOn(llmOverrideRepo, "setFallbackModelRefs").mockResolvedValue(true);
    const sponsorship = spyOn(supporterSponsorshipRepository, "loadActiveSponsorshipForServer").mockResolvedValue(
      supporterServerSponsorshipSchema.parse({
        sponsorship_id: 1,
        server_id: state.server_id,
        server_disc_id: "synthetic-server",
        sponsor_identity_id: 2,
        status: "active",
        created_by_disc_id: "synthetic-user",
        created_at: new Date(),
        updated_at: new Date(),
        revoked_at: null,
      }),
    );
    try {
      expect(
        await configModelOperations.setFallbackChain({
          tomoriState: state,
          serverDiscId: "synthetic-server",
          provider: "openrouter",
          slotValues: [model.llm_codename],
        }),
      ).toMatchObject({ status: "success", refs: [{ type: "llm", id: 101 }] });
      const otherPrimary = createPersona({ llm: createLlmRow({ llm_id: 102 }), config: { llm_id: 102 } });
      expect(
        await configModelOperations.setFallbackChain({
          tomoriState: otherPrimary,
          serverDiscId: "synthetic-server",
          provider: "supporter",
          slotValues: [model.llm_codename],
        }),
      ).toMatchObject({ status: "success", refs: [{ type: "llm", id: 101, credentialProvider: "supporter" }] });
      expect(models.mock.calls.every((call) => call[0] === "openrouter")).toBe(true);
      expect(
        await configModelOperations.setFallbackChain({
          tomoriState: state,
          serverDiscId: "synthetic-server",
          provider: "supporter",
          slotValues: [model.llm_codename],
        }),
      ).toMatchObject({ status: "primary-conflict" });
      expect(sponsorship).not.toHaveBeenCalled();
    } finally {
      for (const spy of [rows, endpoints, models, write, sponsorship]) spy.mockRestore();
    }
  });

  it("keeps a subscription fallback of a BYOK primary and does not consult the sponsorship", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    const model = createLlmRow({ llm_id: 101, llm_provider: "openrouter", llm_codename: "synthetic/shared-model" });
    const state = createPersona({ llm: model, config: { llm_id: 101 } });
    const subscriptionFallback = { type: "llm" as const, id: 101, credentialProvider: "supporter" as const };
    const editedState = createPersona({
      llm: model,
      config: { llm_id: 101, fallback_model_refs: [subscriptionFallback] },
    });
    const rows = spyOn(llmProviderRepo, "loadSavedProviderConfigs").mockResolvedValue([
      makeSavedProvider("openrouter"),
      makeSavedProvider("supporter", { api_key: null }),
    ]);
    const endpoints = spyOn(llmProviderRepo, "loadCustomEndpointsForServer").mockResolvedValue([]);
    const models = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([model]);
    const write = spyOn(llmOverrideRepo, "setFallbackModelRefs").mockResolvedValue(true);
    const sponsorship = spyOn(supporterSponsorshipRepository, "loadActiveSponsorshipForServer").mockResolvedValue(
      supporterServerSponsorshipSchema.parse({
        sponsorship_id: 1,
        server_id: state.server_id,
        server_disc_id: "synthetic-server",
        sponsor_identity_id: 2,
        status: "active",
        created_by_disc_id: "synthetic-user",
        created_at: new Date(),
        updated_at: new Date(),
        revoked_at: null,
      }),
    );
    try {
      expect(
        await configModelOperations.setFallbackChain({
          tomoriState: editedState,
          serverDiscId: "synthetic-server",
          provider: "openrouter",
          slotValues: ["", "", "", "", ""],
        }),
      ).toMatchObject({ status: "no-changes" });
      expect(write).not.toHaveBeenCalled();

      expect(
        await configModelOperations.setFallbackChain({
          tomoriState: state,
          serverDiscId: "synthetic-server",
          provider: "supporter",
          slotValues: [model.llm_codename],
        }),
      ).toMatchObject({ status: "success", refs: [subscriptionFallback] });
      expect(sponsorship).not.toHaveBeenCalled();
    } finally {
      for (const spy of [rows, endpoints, models, write, sponsorship]) spy.mockRestore();
    }
  });

  it("labels an OpenRouter assignment Subscription only when the stored marker names that capability", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    const providers = spyOn(llmProviderRepo, "loadSavedProviderConfigs").mockResolvedValue([
      makeSavedProvider("openrouter"),
      makeSavedProvider("supporter", { api_key: null }),
    ]);
    const decisions = spyOn(llmModelRepo, "loadDecisionModelOptions").mockResolvedValue([]);
    const speechEndpoints = spyOn(llmProviderRepo, "loadCustomEndpointsForServer").mockResolvedValue([]);
    const speechModels = spyOn(llmModelRepo, "loadAvailableSpeechModels").mockResolvedValue([]);
    const channelOverrides = spyOn(llmOverrideRepo, "getAllChannelLlmOverridesForServer").mockResolvedValue([]);
    const personas = spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue([] as unknown as TomoriState[]);
    const funding = spyOn(supporterFunding, "resolveSupporterFunding").mockResolvedValue({
      ok: true,
      tier: { defaultModelByCapability: { text: "synthetic/shared-model" } },
    } as never);
    try {
      const llm = createLlmRow({
        llm_id: 101,
        llm_provider: "openrouter",
        llm_codename: "synthetic/shared-model",
        sees_images: false,
      });
      const byokView = await loadConfigSwitchModelsView(
        makeState({ llm }),
        "guild-1",
        undefined,
        undefined,
        async () => [],
      );
      expect(byokView.slots.find((slot) => slot.capability === "text")?.currentProvider).toBe("openrouter");

      const subscribedView = await loadConfigSwitchModelsView(
        makeState({ llm, config: { subscription_capabilities: ["text"] } }),
        "guild-1",
        undefined,
        undefined,
        async () => [],
      );
      expect(subscribedView.slots.find((slot) => slot.capability === "text")?.currentProvider).toBe("supporter");
    } finally {
      for (const spy of [providers, decisions, speechEndpoints, speechModels, channelOverrides, personas, funding])
        spy.mockRestore();
    }
  });
});

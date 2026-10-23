import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { FallbackModelRef } from "@/types/db/schema";
import { userSavedProviderConfigSchema } from "@/types/db/schema";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { personalConfigOperations } from "@/utils/discord/interactions/personalConfigOperations";
import { loadFallbackSelectionOptions } from "@/utils/discord/interactions/personalConfigLoaders";
import { initializeLocalizer } from "@/utils/text/localizer";
import * as personalRuntime from "@/utils/provider/personalProviderRuntime";
import { useEnvSandbox } from "../../helpers/env";
import { createPersona } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";

beforeAll(async () => initializeLocalizer());

describe("personal fallback credential sources", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);

  it("offers and persists personal OpenRouter fallback credential sources independently", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    const model = {
      ...createPersona().llm,
      llm_id: 101,
      llm_provider: "openrouter",
      llm_codename: "synthetic/shared-model",
    };
    const rows = ["openrouter", "supporter"].map((provider) =>
      userSavedProviderConfigSchema.parse({
        user_id: 1,
        provider,
        api_key: provider === "openrouter" ? Buffer.from("synthetic-key") : null,
        llm_id: 101,
        diffusion_model_id: null,
        embedding_model_id: null,
        nai_diffusion_model_id: null,
        nai_preset_name: null,
        llm_disabled_params: [],
        llm_logit_biases: [],
        enabled_capabilities: provider === "supporter" ? ["text"] : [],
        assigned_capabilities: provider === "supporter" ? ["text"] : [],
      }),
    );
    const loadRows = spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockResolvedValue(rows);
    const loadRow = spyOn(llmProviderRepo, "loadUserSavedProviderConfig").mockImplementation(
      async (_userId, provider) => rows.find((row) => row.provider === provider) ?? null,
    );
    const endpoints = spyOn(llmProviderRepo, "loadCustomEndpointsForUser").mockResolvedValue([]);
    const models = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([model]);
    const loadModel = spyOn(llmModelRepo, "loadById").mockResolvedValue(model);
    const loadFallbacks = spyOn(llmModelRepo, "getLlmsByIds").mockResolvedValue([model]);
    const [byok, subscription] = rows;
    if (!byok || !subscription) throw new Error("Missing credential sources");
    let chain: FallbackModelRef[] = [];
    const settings = spyOn(llmProviderRepo, "loadPersonalFallbackSettings").mockImplementation(async () => ({
      fallback_model_refs: chain,
      model_randomizer_enabled: false,
    }));
    const write = spyOn(llmProviderRepo, "updatePersonalFallbackModelRefs").mockImplementation(
      async (_userId, refs) => {
        chain = refs;
        return true;
      },
    );
    try {
      const options = await loadFallbackSelectionOptions(1, "supporter", "en-US");
      expect(options.map((option) => option.refKey)).toEqual(["llm:101", "llm:101:supporter"]);
      expect(options[1]?.label).toContain(localizedCopy("en-US", "commands.providers.subscription_label"));
      expect(
        await personalConfigOperations.setFallbacks({
          userId: 1,
          userDiscId: "synthetic-user",
          provider: "supporter",
          slotValues: ["llm:101"],
        }),
      ).toMatchObject({ status: "success" });
      const overlay = await personalRuntime.applyPersonalProviderSelectionsToTomoriState(createPersona(), 1);
      expect(overlay.tomoriState.fallback_chain).toEqual([{ kind: "llm", model }]);
      byok.enabled_capabilities = ["text"];
      subscription.enabled_capabilities = [];
      expect(
        await personalConfigOperations.setFallbacks({
          userId: 1,
          userDiscId: "synthetic-user",
          provider: "openrouter",
          slotValues: ["llm:101:supporter"],
        }),
      ).toMatchObject({ status: "success" });
      expect(chain).toEqual([{ type: "llm", id: 101, credentialProvider: "supporter" }]);
      byok.enabled_capabilities = [];
      subscription.enabled_capabilities = ["text"];
      expect(
        await personalConfigOperations.setFallbacks({
          userId: 1,
          userDiscId: "synthetic-user",
          provider: "supporter",
          slotValues: ["llm:101:supporter"],
        }),
      ).toMatchObject({ status: "primary-conflict" });
      rows.pop();
      expect(
        await personalConfigOperations.setFallbacks({
          userId: 1,
          userDiscId: "synthetic-user",
          provider: "openrouter",
          slotValues: ["llm:101:supporter"],
        }),
      ).toMatchObject({ status: "write-failed" });
    } finally {
      for (const spy of [loadRows, loadRow, endpoints, models, loadModel, loadFallbacks, settings, write])
        spy.mockRestore();
    }
  });
});

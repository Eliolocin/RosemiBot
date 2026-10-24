import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { SavedProviderConfigUpsert } from "@/types/db/schema";
import * as realTomoriStateCache from "@/utils/cache/tomoriStateCache";
import * as realRepositories from "@/utils/db/repositories";
import * as realLogitBiasResolver from "@/utils/provider/logitBiasResolver";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { createScopedModuleMocker, overrideMembers } from "../../helpers/mockSurface";

const modelConfigPatches: Array<Record<string, unknown>> = [];
const chatConfigPatches: Array<Record<string, unknown>> = [];
const invalidatedServers: string[] = [];
let updatedModel = true;
let updatedChat = true;

const selectedModel = createLlmRow({
  llm_id: 42,
  llm_codename: "provider-b-primary",
  llm_provider: "provider-b",
});

const tomoriState = createPersona({
  server_id: 7,
  llm: createLlmRow({ llm_id: 1, llm_codename: "provider-a-primary", llm_provider: "provider-a" }),
  config: {
    llm_id: 1,
    fallback_model_refs: [
      { type: "llm", id: 7 },
      { type: "custom_endpoint", id: 9 },
      { type: "llm", id: 42 },
    ],
  },
});

const savedConfig = {
  server_id: 7,
  provider: "provider-b",
  llm_id: 42,
  fallback_model_refs: [{ type: "llm", id: 99 }],
  api_key: null,
  key_version: 1,
  diffusion_model_id: null,
  embedding_model_id: null,
  nai_diffusion_model_id: null,
  nai_preset_name: null,
  llm_disabled_params: [],
  llm_logit_biases: [],
  thinking_level: "auto",
} satisfies SavedProviderConfigUpsert;

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/cache/tomoriStateCache": realTomoriStateCache,
  "@/utils/db/repositories": realRepositories,
  "@/utils/provider/logitBiasResolver": realLogitBiasResolver,
});

scopedMock.module("@/utils/cache/tomoriStateCache", () => ({
  ...realTomoriStateCache,
  invalidateTomoriStateCache: (serverDiscId: string) => {
    invalidatedServers.push(serverDiscId);
  },
}));

scopedMock.module("@/utils/db/repositories", () => ({
  ...realRepositories,
  llmModelRepo: overrideMembers(realRepositories.llmModelRepo, {
    loadById: async () => selectedModel,
  }),
  configRepository: overrideMembers(realRepositories.configRepository, {
    updateModelConfig: async (_serverId: number, patch: Record<string, unknown>) => {
      modelConfigPatches.push(patch);
      return updatedModel;
    },
    updateChatConfig: async (_serverId: number, patch: Record<string, unknown>) => {
      chatConfigPatches.push(patch);
      return updatedChat;
    },
  }),
}));

scopedMock.module("@/utils/provider/logitBiasResolver", () => ({
  ...realLogitBiasResolver,
  resolveLogitBiasEntriesForLlm: () => ({ entries: [] }),
}));

beforeEach(() => {
  modelConfigPatches.length = 0;
  chatConfigPatches.length = 0;
  invalidatedServers.length = 0;
  updatedModel = true;
  updatedChat = true;
});

describe("server provider activation fallback persistence", () => {
  it.each([
    { model: true, chat: false },
    { model: false, chat: true },
    { model: false, chat: false },
    { model: true, chat: true },
  ])("invalidates committed writes when model=$model and chat=$chat", async ({ model, chat }) => {
    const { activateServerTextModelFromSavedConfig } = await import("@/utils/provider/providerActivation");
    updatedModel = model;
    updatedChat = chat;
    const result = await activateServerTextModelFromSavedConfig({ serverDiscId: "guild-1", tomoriState, savedConfig });
    expect(result.status).toBe(model && chat ? "activated" : "update_failed");
    expect(invalidatedServers).toEqual(model || chat ? ["guild-1"] : []);
    if (model && chat) expect(result.modelName).toBe(selectedModel.llm_codename);
  });

  it("preserves the live cross-provider chain instead of restoring or clearing the provider snapshot", async () => {
    const { activateServerTextModelFromSavedConfig } = await import("@/utils/provider/providerActivation");

    const result = await activateServerTextModelFromSavedConfig({
      serverDiscId: "guild-1",
      tomoriState,
      savedConfig,
    });

    expect(result.status).toBe("activated");
    expect(modelConfigPatches[0]).toMatchObject({ fallback_llm_ids: [7] });
    expect(chatConfigPatches[0]).toMatchObject({
      fallback_model_refs: [
        { type: "llm", id: 7 },
        { type: "custom_endpoint", id: 9 },
      ],
    });
  });
});

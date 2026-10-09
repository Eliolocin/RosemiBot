import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { APIAttachment, ChatInputCommandInteraction, Client } from "discord.js";
import type { PersonalProviderCapability, UserSavedProviderConfigRow } from "@/types/db/schema";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { createScopedModuleMocker } from "../../helpers/mockSurface";
import * as realCache from "@/utils/cache/tomoriStateCache";
import * as realPersonalRuntime from "@/utils/provider/personalProviderRuntime";
import * as realCredentials from "@/utils/provider/credentialResolver";
import * as realCrypto from "@/utils/security/crypto";
import * as realNaiModels from "@/utils/image/naiDiffusionModels";
import * as realNaiGeneration from "@/utils/image/naiImageGeneration";
import * as realQuota from "@/utils/quota/imageQuotaManager";
import * as realInteractionCore from "@/utils/discord/ui/interactionCore";
import { initializeLocalizer } from "@/utils/text/localizer";

const personalNaiConfig: UserSavedProviderConfigRow = {
  user_saved_config_id: 1,
  user_id: 1,
  provider: "novelai",
  api_key: Buffer.from("encrypted-personal-key"),
  key_version: 1,
  llm_id: null,
  diffusion_model_id: null,
  embedding_model_id: null,
  nai_diffusion_model_id: 20,
  video_model_id: null,
  vision_llm_id: null,
  nai_preset_name: null,
  llm_temperature: null,
  llm_top_p: null,
  llm_top_k: null,
  llm_frequency_penalty: null,
  llm_presence_penalty: null,
  llm_min_p: null,
  llm_max_output_tokens: null,
  llm_disabled_params: [],
  llm_logit_biases: [],
  thinking_level: "auto",
  model_randomizer_enabled: false,
  enabled_capabilities: ["image_nai"],
  assigned_capabilities: ["image_nai"],
  fallback_model_refs: [],
  saved_at: new Date(),
  updated_at: new Date(),
};
const personalStandardConfig: UserSavedProviderConfigRow = {
  ...personalNaiConfig,
  provider: "openrouter",
  diffusion_model_id: 10,
  nai_diffusion_model_id: null,
  enabled_capabilities: ["image"],
  assigned_capabilities: ["image"],
};

const serverState = createPersona({ config: { nai_diffusion_model_id: 4 } });
let activeConfigs: Partial<Record<PersonalProviderCapability, UserSavedProviderConfigRow>> = {};
let resolvedModelCodename = "nai-diffusion-model";
const resolveCredentials = mock(async () => ({
  provider: "novelai",
  apiKey: "personal-nai-key",
  keyVersion: 1,
  savedConfig: personalNaiConfig,
  source: "personal" as const,
}));
const getOptionalKey = mock(async () => "server-nai-key");
const checkQuota = mock(async () => ({ allowed: true }));
const generateImage = mock(async () => {
  throw new Error("401 Unauthorized");
});
const replyInfo = mock(async (..._args: unknown[]) => undefined);
let modalResult:
  | { outcome: "timeout" }
  | {
      outcome: "submit";
      interaction: ChatInputCommandInteraction;
      values: Record<string, string>;
      attachments: Record<string, APIAttachment>;
    } = { outcome: "timeout" };
const modal = mock(async () => modalResult);

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/cache/tomoriStateCache": realCache,
  "@/utils/provider/personalProviderRuntime": realPersonalRuntime,
  "@/utils/provider/credentialResolver": realCredentials,
  "@/utils/security/crypto": realCrypto,
  "@/utils/image/naiDiffusionModels": realNaiModels,
  "@/utils/image/naiImageGeneration": realNaiGeneration,
  "@/utils/quota/imageQuotaManager": realQuota,
  "@/utils/discord/ui/interactionCore": realInteractionCore,
});

scopedMock.module("@/utils/cache/tomoriStateCache", () => ({
  ...realCache,
  getCachedTomoriState: async () => serverState,
}));
scopedMock.module("@/utils/provider/personalProviderRuntime", () => ({
  ...realPersonalRuntime,
  applyPersonalProviderSelectionsToTomoriState: async () => ({ tomoriState: serverState, activeConfigs }),
}));
scopedMock.module("@/utils/provider/credentialResolver", () => ({
  ...realCredentials,
  resolveCapabilityCredentials: resolveCredentials,
}));
scopedMock.module("@/utils/security/crypto", () => ({
  ...realCrypto,
  getOptApiKey: getOptionalKey,
}));
scopedMock.module("@/utils/image/naiDiffusionModels", () => ({
  ...realNaiModels,
  resolveNaiDiffusionModel: async (config: { nai_diffusion_model_id: number | null }) => ({
    diffusionModelId: config.nai_diffusion_model_id ?? 4,
    codename: resolvedModelCodename,
    source: "override" as const,
  }),
}));
scopedMock.module("@/utils/image/naiImageGeneration", () => ({
  ...realNaiGeneration,
  generateNovelAiImage: generateImage,
}));
scopedMock.module("@/utils/quota/imageQuotaManager", () => ({
  ...realQuota,
  checkImageQuota: checkQuota,
}));
scopedMock.module("@/utils/discord/ui/interactionCore", () => ({
  ...realInteractionCore,
  promptWithRawModal: modal,
  replyInfoEmbed: replyInfo,
}));

const interaction = {
  channel: { id: "channel-1" },
  guild: { id: "guild-1" },
  user: { id: "user-1" },
} as unknown as ChatInputCommandInteraction;

describe("/novelai generate image credential selection", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  beforeEach(() => {
    activeConfigs = {};
    resolvedModelCodename = "nai-diffusion-model";
    resolveCredentials.mockClear();
    getOptionalKey.mockClear();
    checkQuota.mockClear();
    generateImage.mockClear();
    replyInfo.mockClear();
    modalResult = { outcome: "timeout" };
    modal.mockClear();
  });

  it("uses the personal image-nai credential without consuming server quota", async () => {
    activeConfigs = { image_nai: personalNaiConfig };
    const { execute } = await import("@/commands/novelai/generate/image");

    await execute({} as Client, interaction, createUserRow(), "en-US");

    expect(resolveCredentials).toHaveBeenCalledWith(serverState.server_id, "image-nai", {
      userId: 1,
    });
    expect(getOptionalKey).not.toHaveBeenCalled();
    expect(checkQuota).not.toHaveBeenCalled();
    expect(modal).toHaveBeenCalledTimes(1);
  });

  it("keeps the server optional key path when only a standard image provider is personal", async () => {
    activeConfigs = { image: personalStandardConfig };
    const { execute } = await import("@/commands/novelai/generate/image");

    await execute({} as Client, interaction, createUserRow(), "en-US");

    expect(resolveCredentials).not.toHaveBeenCalled();
    expect(getOptionalKey).toHaveBeenCalledWith(serverState.server_id, "novelai");
    expect(checkQuota).toHaveBeenCalledWith(serverState.server_id, interaction.user.id);
    expect(modal).toHaveBeenCalledTimes(1);
  });

  it("uses the failing NovelAI credential source for authentication tips", async () => {
    const { execute } = await import("@/commands/novelai/generate/image");
    modalResult = {
      outcome: "submit",
      interaction,
      values: { nai_image_prompt: "A moonlit garden", nai_image_orientation: "portrait" },
      attachments: {},
    };

    activeConfigs = { image_nai: personalNaiConfig };
    await execute({} as Client, interaction, createUserRow(), "en-US");
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "personal-nai-key" }));
    expect(replyInfo.mock.calls.at(-1)?.[2]).toMatchObject({ tipKeys: ["genai.tips.verify_api_key_personal"] });

    activeConfigs = { image: personalStandardConfig };
    await execute({} as Client, interaction, createUserRow(), "en-US");
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "server-nai-key" }));
    expect(replyInfo.mock.calls.at(-1)?.[2]).toMatchObject({ tipKeys: ["genai.tips.verify_api_key"] });
  });

  it("rejects a V5 character reference before generation and preserves submitted input", async () => {
    resolvedModelCodename = "nai-diffusion-5-full";
    modalResult = {
      outcome: "submit",
      interaction,
      values: { nai_image_prompt: "A moonlit garden", nai_image_orientation: "portrait" },
      attachments: {
        nai_image_character_reference: {
          id: "reference-1",
          filename: "character.png",
          size: 1024,
          url: "https://cdn.discordapp.com/attachments/reference-1/character.png",
          proxy_url: "https://media.discordapp.net/attachments/reference-1/character.png",
          content_type: "image/png",
        },
      },
    };
    const { execute } = await import("@/commands/novelai/generate/image");

    await execute({} as Client, interaction, createUserRow(), "en-US");

    expect(generateImage).not.toHaveBeenCalled();
    expect(replyInfo.mock.calls.at(-1)?.[2]).toMatchObject({
      titleKey: "commands.novelai.generate.image.character_reference_requires_v4_title",
      files: [expect.objectContaining({ name: "image_generation_input.txt" })],
    });
  });
});

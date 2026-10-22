import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { useEnvSandbox } from "../../helpers/env";
import * as managedProvider from "@/modules/supporter-billing/runtime/managedProvider";
import { supporterSponsorshipRepository } from "@/modules/supporter-billing/db";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import {
  embeddingModelSchema,
  savedProviderConfigSchema,
  type SavedProviderConfigRow,
  type UserSavedProviderConfigRow,
} from "@/types/db/schema";
import * as realRepositories from "@/utils/db/repositories";
import { createScopedModuleMocker, overrideMembers } from "../../helpers/mockSurface";
import * as realCrypto from "@/utils/security/crypto";
import { resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";

let rows: UserSavedProviderConfigRow[] = [];
let serverSaved: SavedProviderConfigRow | null = null;

function makeSavedProviderConfigRow(
  overrides: Partial<UserSavedProviderConfigRow> & { provider: string; user_id?: number },
): UserSavedProviderConfigRow {
  return {
    user_saved_config_id: 1,
    user_id: overrides.user_id ?? 1,
    api_key: overrides.api_key ?? null,
    key_version: overrides.key_version ?? 1,
    credential_revision: overrides.credential_revision ?? 1,
    llm_id: overrides.llm_id ?? null,
    diffusion_model_id: overrides.diffusion_model_id ?? null,
    embedding_model_id: overrides.embedding_model_id ?? null,
    nai_diffusion_model_id: overrides.nai_diffusion_model_id ?? null,
    video_model_id: overrides.video_model_id ?? null,
    vision_llm_id: overrides.vision_llm_id ?? null,
    nai_preset_name: overrides.nai_preset_name ?? null,
    llm_temperature: overrides.llm_temperature ?? null,
    llm_top_p: overrides.llm_top_p ?? null,
    llm_top_k: overrides.llm_top_k ?? null,
    llm_frequency_penalty: overrides.llm_frequency_penalty ?? null,
    llm_presence_penalty: overrides.llm_presence_penalty ?? null,
    llm_min_p: overrides.llm_min_p ?? null,
    llm_max_output_tokens: overrides.llm_max_output_tokens ?? null,
    llm_disabled_params: overrides.llm_disabled_params ?? [],
    llm_logit_biases: overrides.llm_logit_biases ?? [],
    thinking_level: overrides.thinking_level ?? "auto",
    enabled_capabilities: overrides.enabled_capabilities ?? [],
    assigned_capabilities: overrides.assigned_capabilities ?? [],
    saved_at: overrides.saved_at ?? new Date(),
    updated_at: overrides.updated_at ?? new Date(),
    ...overrides,
  };
}

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/db/repositories": realRepositories,
  "@/utils/security/crypto": realCrypto,
});

scopedMock.module("@/utils/security/crypto", () => ({
  ...realCrypto,
  decryptApiKey: async (buf: Buffer | null) => (buf ? buf.toString("utf8") : ""),
}));

scopedMock.module("@/utils/db/repositories", () => ({
  ...realRepositories,
  configRepository: overrideMembers(realRepositories.configRepository, {
    loadModelCapabilityIds: async () => ({
      user_byok_mode: false,
      llm_id: 1,
      embedding_model_id: 2,
      diffusion_model_id: 3,
      nai_diffusion_model_id: 4,
      video_model_id: 5,
      vision_llm_id: 6,
    }),
  }),
  llmModelRepo: overrideMembers(realRepositories.llmModelRepo, {
    loadEmbeddingModelById: async () =>
      embeddingModelSchema.parse({
        embedding_model_id: 2,
        provider: "openrouter",
        codename: "test/embedding",
        model_family: "openai",
      }),
    loadDiffusionModelById: async (id: number) => ({
      id,
      codename: `model-${id}`,
      provider: id === 99 ? "novelai" : "server-img-provider",
    }),
  }),
  llmProviderRepo: overrideMembers(realRepositories.llmProviderRepo, {
    loadUserSavedProviderConfigs: async () => rows,
    loadSavedProviderConfig: async () => serverSaved,
  }),
}));

describe("personal credential resolution for capability split", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);
  beforeEach(() => {
    rows = [];
    serverSaved = null;
  });

  it("preserves personal BYOK priority for every shared capability while billing is enabled", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    rows = [
      makeSavedProviderConfigRow({
        provider: "openrouter",
        api_key: Buffer.from("synthetic-personal-byok"),
        enabled_capabilities: ["text", "vision", "embedding", "image", "video"],
        assigned_capabilities: ["text", "vision", "embedding", "image", "video"],
        llm_id: 1,
        vision_llm_id: 1,
        embedding_model_id: 2,
        diffusion_model_id: 3,
        video_model_id: 5,
      }),
    ];
    const memberKey = spyOn(managedProvider, "resolveSupporterCapabilityCredentials").mockRejectedValue(
      new Error("Unexpected member lookup"),
    );
    try {
      for (const capability of ["text", "vision", "embedding", "image-standard", "video"] as const) {
        const resolved = await resolveCapabilityCredentials(1, capability, { userId: 1 });
        expect(resolved.apiKey).toBe("synthetic-personal-byok");
        expect(resolved.source).toBe("personal");
        expect(resolved.supporterFunding).toBeUndefined();
      }
      expect(memberKey).not.toHaveBeenCalled();
    } finally {
      memberKey.mockRestore();
    }
  });

  it("retains a server BYOK embedding key when the sponsor tier does not enable embedding billing", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    serverSaved = savedProviderConfigSchema.parse({
      ...makeSavedProviderConfigRow({ provider: "openrouter", api_key: Buffer.from("server-fixture-key") }),
      server_id: 1,
      fallback_model_refs: [],
    });
    const sponsor = spyOn(supporterSponsorshipRepository, "loadActiveSponsorshipForServer").mockResolvedValue({
      sponsorship_id: 1,
      server_id: 1,
      server_disc_id: "guild_1",
      sponsor_identity_id: 1,
      status: "active",
      created_by_disc_id: "sponsor_1",
      created_at: new Date(),
      updated_at: new Date(),
      revoked_at: null,
    });
    const funding = spyOn(managedProvider, "resolveSupporterCapabilityCredentials").mockRejectedValue(
      new SupporterRequestDeniedError("model_not_allowed", undefined, "embedding", "server"),
    );
    try {
      const resolved = await resolveCapabilityCredentials(1, "embedding");
      expect(resolved).toMatchObject({ provider: "openrouter", apiKey: "server-fixture-key", source: "server" });
      expect(resolved.supporterFunding).toBeUndefined();
      funding.mockRejectedValue(new SupporterRequestDeniedError("model_unavailable", undefined, "embedding", "server"));
      await expect(resolveCapabilityCredentials(1, "embedding")).rejects.toMatchObject({ reason: "model_unavailable" });
    } finally {
      sponsor.mockRestore();
      funding.mockRestore();
    }
  });

  it("distinguishes Standard and NovelAI Image credentials on different provider rows", async () => {
    rows = [
      makeSavedProviderConfigRow({
        user_id: 1,
        provider: "openrouter",
        api_key: Buffer.from("openrouter-personal-key", "utf8"),
        key_version: 1,
        credential_revision: 1,
        enabled_capabilities: ["image"],
        assigned_capabilities: ["image"],
        diffusion_model_id: 10,
        nai_diffusion_model_id: null,
      }),
      makeSavedProviderConfigRow({
        user_id: 1,
        provider: "novelai",
        api_key: Buffer.from("novelai-personal-key", "utf8"),
        key_version: 1,
        credential_revision: 1,
        enabled_capabilities: ["image_nai"],
        assigned_capabilities: ["image_nai"],
        diffusion_model_id: null,
        nai_diffusion_model_id: 20,
      }),
    ];

    const standardCreds = await resolveCapabilityCredentials(1, "image-standard", { userId: 1 });
    expect(standardCreds).not.toBeNull();
    expect(standardCreds.provider).toBe("openrouter");
    expect(standardCreds.apiKey).toBe("openrouter-personal-key");
    expect(standardCreds.source).toBe("personal");

    const naiCreds = await resolveCapabilityCredentials(1, "image-nai", { userId: 1 });
    expect(naiCreds).not.toBeNull();
    expect(naiCreds.provider).toBe("novelai");
    expect(naiCreds.apiKey).toBe("novelai-personal-key");
    expect(naiCreds.source).toBe("personal");
  });

  it("resolves only the enabled capability when one image capability is disabled", async () => {
    rows = [
      makeSavedProviderConfigRow({
        user_id: 1,
        provider: "openrouter",
        api_key: Buffer.from("openrouter-personal-key", "utf8"),
        key_version: 1,
        credential_revision: 1,
        enabled_capabilities: ["image"],
        assigned_capabilities: ["image"],
        diffusion_model_id: 10,
        nai_diffusion_model_id: null,
      }),
      makeSavedProviderConfigRow({
        user_id: 1,
        provider: "novelai",
        api_key: Buffer.from("novelai-personal-key", "utf8"),
        key_version: 1,
        credential_revision: 1,
        enabled_capabilities: [],
        assigned_capabilities: ["image_nai"],
        diffusion_model_id: null,
        nai_diffusion_model_id: 20,
      }),
    ];

    const standardCreds = await resolveCapabilityCredentials(1, "image-standard", { userId: 1 });
    expect(standardCreds.provider).toBe("openrouter");
    expect(standardCreds.source).toBe("personal");

    await expect(resolveCapabilityCredentials(1, "image-nai", { userId: 1 })).rejects.toThrow(
      "No usable credentials for server-img-provider (image-nai, server): no_saved_config",
    );
  });

  it("does not resolve NovelAI personal row for image-standard even if image capability was enabled", async () => {
    rows = [
      makeSavedProviderConfigRow({
        user_id: 1,
        provider: "novelai",
        api_key: Buffer.from("novelai-personal-key", "utf8"),
        key_version: 1,
        credential_revision: 1,
        enabled_capabilities: ["image"],
        assigned_capabilities: ["image"],
        diffusion_model_id: 10,
        nai_diffusion_model_id: null,
      }),
    ];

    await expect(resolveCapabilityCredentials(1, "image-standard", { userId: 1 })).rejects.toThrow(
      "No usable credentials for server-img-provider (image-standard, server): no_saved_config",
    );
  });

  it("rejects server image-standard resolution when server diffusion model belongs to novelai", async () => {
    scopedMock.module("@/utils/db/repositories", () => ({
      ...realRepositories,
      configRepository: overrideMembers(realRepositories.configRepository, {
        loadModelCapabilityIds: async () => ({
          user_byok_mode: false,
          llm_id: 1,
          embedding_model_id: 2,
          diffusion_model_id: 99,
          nai_diffusion_model_id: 4,
          video_model_id: 5,
          vision_llm_id: 6,
        }),
      }),
      llmModelRepo: overrideMembers(realRepositories.llmModelRepo, {
        loadDiffusionModelById: async (id: number) => ({
          id,
          codename: `model-${id}`,
          provider: id === 99 ? "novelai" : "server-img-provider",
        }),
      }),
      llmProviderRepo: overrideMembers(realRepositories.llmProviderRepo, {
        loadUserSavedProviderConfigs: async () => [],
        loadSavedProviderConfig: async () => null,
      }),
    }));

    await expect(resolveCapabilityCredentials(1, "image-standard")).rejects.toThrow(
      "No usable credentials for novelai (image-standard, server): missing_model_id",
    );
  });
});

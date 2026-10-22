import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { describe, expect, it } from "bun:test";
import { customEndpointSchema, type FallbackEntry, type LlmRow, type TomoriState } from "@/types/db/schema";
import type { LLMProvider, ProviderConfig } from "@/types/provider/interfaces";
import {
  buildSupporterFallbackTomoriState,
  buildSupporterPrimaryTomoriState,
  resolveSupporterManagedProviderConfig,
  type SupporterManagedModelLoader,
  type SupporterFundingContext,
} from "@/modules/supporter-billing/runtime";

function makeLlm(overrides: Partial<LlmRow> = {}): LlmRow {
  return createLlmRow({
    llm_provider: "openrouter",
    llm_codename: "openrouter/allowed-model",
    ...overrides,
  });
}

function makeTomoriState(overrides: Partial<TomoriState> = {}): TomoriState {
  return createPersona({
    server_id: 50,
    persona_id: 60,
    persona_nickname: "Tomori",
    config: {
      api_key: Buffer.from("encrypted-server-key"),
      key_version: 7,
      custom_endpoint_url: "https://custom.example.test",
      custom_model_name: "custom-model",
      llm_temperature: 1.1,
    },
    llm: makeLlm({ llm_provider: "google", llm_codename: "gemini-pro" }),
    ...overrides,
  });
}

function makeFundingContext(
  overrides: Partial<Extract<SupporterFundingContext, { fundingScope: "server" }>> = {},
): SupporterFundingContext {
  return {
    credentialSource: "supporter",

    fundingScope: "server" as const,
    capability: "text" as const,
    personalUserId: null,
    provider: "openrouter",
    modelCodename: "openrouter/allowed-model",

    tierKey: "test_tier",
    sponsorshipId: 40,
    serverId: 1,
    sponsorIdentityId: 10,
    sponsorDiscordUserId: "sponsor_disc_1",
    entitlementId: 20,
    renewalAt: null,
    ...overrides,
  };
}

function customEndpointEntry(): FallbackEntry {
  return {
    kind: "custom_endpoint",
    endpoint: customEndpointSchema.parse({
      connection_id: 1,
      server_id: 50,
      user_id: null,
      capability: "text",
      api_style: "openai-compatible",
      label: "my-endpoint",
      endpoint_url: "https://custom.example.test",
      model_name: "custom-model",
      extra_config: {},
      has_tools: false,
      sees_images: false,
      sees_videos: false,
      supports_structoutput: false,
    }),
  };
}

describe("Supporter managed text routing policy", () => {
  it("refuses a custom endpoint as a managed-key attempt", () => {
    expect(buildSupporterFallbackTomoriState(makeTomoriState(), customEndpointEntry())).toBeNull();
  });

  describe("managed primary state nulling", () => {
    it("swaps in the selected model and nulls every server-owned credential field", async () => {
      const funding = makeFundingContext();
      const catalogModel = makeLlm({ llm_provider: "openrouter", llm_codename: "openrouter/allowed-model" });
      const loadModel: SupporterManagedModelLoader = async (provider, codename) => {
        expect(provider).toBe("openrouter");
        expect(codename).toBe("openrouter/allowed-model");
        return catalogModel;
      };

      const state = await buildSupporterPrimaryTomoriState({
        baseState: makeTomoriState(),
        funding,
        loadModel,
      });

      expect(state.llm).toBe(catalogModel);
      expect(state.config.api_key).toBeNull();
      expect(state.config.key_version).toBe(1);
      expect(state.config.custom_endpoint_url).toBeNull();
      expect(state.config.custom_model_name).toBeNull();
      expect(state.config.llm_temperature).toBe(1.1);
    });

    it("throws when the funding is missing", async () => {
      await expect(
        buildSupporterPrimaryTomoriState({
          baseState: makeTomoriState(),
          funding: null,
          loadModel: async () => makeLlm(),
        }),
      ).rejects.toThrow("Supporter text credential source is missing funding context.");
    });

    it("throws when the selected model is absent from the catalog", async () => {
      await expect(
        buildSupporterPrimaryTomoriState({
          baseState: makeTomoriState(),
          funding: makeFundingContext(),
          loadModel: async () => null,
        }),
      ).rejects.toThrow("Supporter managed OpenRouter model is not present in the model catalog.");
    });

    it("nulls only api_key/key_version for failover llm entries (not custom_* fields)", () => {
      const baseState = makeTomoriState();
      baseState.config = {
        ...baseState.config,
        api_key: Buffer.from("managed-base"),
        key_version: 1,
        custom_endpoint_url: null,
        custom_model_name: null,
      };
      const failoverModel = makeLlm({ llm_codename: "openrouter/allowed-secondary" });

      const state = buildSupporterFallbackTomoriState(baseState, { kind: "llm", model: failoverModel });

      expect(state).not.toBeNull();
      expect(state?.llm).toBe(failoverModel);
      expect(state?.config.api_key).toBeNull();
      expect(state?.config.key_version).toBe(1);
    });
  });

  describe("managed-key injection", () => {
    it("builds the provider config with the resolved managed key", async () => {
      const tomoriState = makeTomoriState();
      let capturedKey: string | undefined;
      const provider: Pick<LLMProvider, "createConfig"> = {
        createConfig: async (_state, apiKey) => {
          capturedKey = apiKey;
          return { apiKey } as unknown as ProviderConfig;
        },
      };

      const config = await resolveSupporterManagedProviderConfig(provider, tomoriState, {
        funding: makeFundingContext(),
        resolveMemberKey: async () => "member-key-123",
      });

      expect(capturedKey).toBe("member-key-123");
      expect(config).toMatchObject({ apiKey: "member-key-123" });
    });

    it("throws with the resolver reason when managed credentials are unavailable", async () => {
      const provider: Pick<LLMProvider, "createConfig"> = {
        createConfig: async () => {
          throw new Error("createConfig should not be called");
        },
      };

      await expect(
        resolveSupporterManagedProviderConfig(provider, makeTomoriState(), {
          funding: makeFundingContext(),
          resolveMemberKey: async () => {
            throw new Error("unavailable");
          },
        }),
      ).rejects.toThrow();
    });
  });
});

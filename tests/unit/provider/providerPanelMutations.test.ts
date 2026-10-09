import * as dbClient from "@/utils/db/client";
import { describe, expect, it, spyOn } from "bun:test";
import type { LlmRow, SavedProviderConfigUpsert, TomoriState } from "@/types/db/schema";
import {
  addCustomEndpointConnection,
  addServerProvider,
  providerPanelOperations,
  saveProviderModel,
  type AddCustomEndpointConnectionDependencies,
  type AddServerProviderDependencies,
} from "@/utils/provider/providerPanelOperations";
import { registerCustomEndpoint } from "@/utils/provider/customEndpointService";
import { llmProviderRepo } from "@/utils/db/repositories/LlmProviderRepository";
import { llmModelRepo } from "@/utils/db/repositories/LlmModelRepository";
import { readCachedLlm, replaceCachedLlms } from "@/utils/cache/llmCacheStore";
import * as crypto from "@/utils/security/crypto";

function state(): TomoriState {
  return { server_id: 7, config: {}, llm: { llm_provider: "google" } } as TomoriState;
}

function dependencies(calls: string[]): AddServerProviderDependencies {
  return {
    validateElevenLabs: async () => ({ success: true }),
    validateBrave: async () => true,
    registerEndpoint: async (input) => {
      calls.push(`register:${input.capability}`);
      return {
        provider: `custom:${input.capability === "speech" ? 42 : 41}`,
        customEndpoint: {
          connection_id: input.capability === "speech" ? 42 : 41,
          custom_endpoint_id: input.capability === "speech" ? 52 : 51,
        },
        modelId: null,
      } as never;
    },
    storeOptionalKey: async () => {
      calls.push("store-optional");
      return true;
    },
    getProvider: async () =>
      ({
        validateApiKey: async () => {
          calls.push("validate-curated");
          return { valid: true };
        },
      }) as never,
    encrypt: async () => {
      calls.push("encrypt");
      return { encrypted: Buffer.from("encrypted"), version: 2 };
    },
    buildSavedConfig: async (input) => {
      calls.push("build-config");
      return {
        server_id: input.serverId,
        provider: input.provider,
        api_key: input.apiKey,
        key_version: input.keyVersion,
        llm_id: 91,
      } as SavedProviderConfigUpsert;
    },
    loadSavedConfig: async () => null,
    upsertSavedConfig: async () => {
      calls.push("upsert");
      return true;
    },
    activateText: async () => {
      calls.push("activate-text");
      return { status: "activated", modelName: "model-one" };
    },
    refresh: () => {
      calls.push("refresh");
    },
  };
}

describe("provider panel mutations", () => {
  it("validates, saves, and auto-activates a curated provider", async () => {
    const calls: string[] = [];
    const result = await addServerProvider(
      { serverDiscId: "guild", state: state(), provider: "google", apiKey: "valid-api-key" },
      dependencies(calls),
    );

    expect(result).toEqual({
      status: "success",
      entryId: "provider:google",
      displayName: "Google Gemini",
      modelName: "model-one",
      updated: false,
    });
    expect(calls).toEqual(["validate-curated", "encrypt", "build-config", "upsert", "activate-text"]);
  });

  it("registers both ElevenLabs capabilities and returns their stable panel entry", async () => {
    const calls: string[] = [];
    const result = await addServerProvider(
      { serverDiscId: "guild", state: state(), provider: "elevenlabs", apiKey: "valid-api-key" },
      dependencies(calls),
    );

    expect(result).toEqual({
      status: "success",
      entryId: "endpoint:41",
      displayName: "elevenlabs",
      updated: false,
    });
    expect(calls).toEqual(["register:speech", "register:transcription", "refresh"]);
  });

  it("validates and stores Brave without creating a model", async () => {
    const calls: string[] = [];
    const result = await addServerProvider(
      { serverDiscId: "guild", state: state(), provider: "brave", apiKey: "valid-api-key" },
      dependencies(calls),
    );

    expect(result).toEqual({
      status: "success",
      entryId: "brave",
      displayName: "Brave Search",
      updated: false,
    });
    expect(calls).toEqual(["store-optional", "refresh"]);
  });

  it("rejects short keys before any validation or write", async () => {
    const calls: string[] = [];
    const result = await addServerProvider(
      { serverDiscId: "guild", state: state(), provider: "google", apiKey: "short" },
      dependencies(calls),
    );

    expect(result).toEqual({ status: "invalid-key" });
    expect(calls).toEqual([]);
  });

  it("creates compatible capability connections with zero model registrations", async () => {
    const calls: string[] = [];
    const connectionIds = new Map([
      ["text", 73],
      ["embedding", 74],
      ["image", 75],
      ["video", 76],
    ]);
    const endpointDependencies: AddCustomEndpointConnectionDependencies = {
      validateReachability: async () => {
        calls.push("validate");
        return { ok: true };
      },
      loadConnections: async () => [],
      upsertConnection: async (input) => {
        calls.push(`connection:${input.capability}`);
        return connectionIds.get(input.capability) ?? null;
      },
      deleteConnections: async () => true,
      encrypt: async () => {
        calls.push("encrypt");
        return { encrypted: Buffer.from("encrypted"), version: 2 };
      },
      buildSavedConfig: async (input) => {
        calls.push(`config:${input.provider}`);
        return {
          server_id: input.serverId,
          provider: input.provider,
          api_key: input.apiKey,
          key_version: input.keyVersion,
          llm_id: null,
        } as SavedProviderConfigUpsert;
      },
      upsertSavedConfig: async () => {
        calls.push("upsert-config");
        return true;
      },
      refresh: () => {
        calls.push("refresh");
      },
    };
    const result = await addCustomEndpointConnection(
      {
        serverDiscId: "guild",
        state: state(),
        label: " Juno ",
        endpointUrl: "https://models.example.com/",
        apiStyle: "openai-compatible",
        authToken: "valid-api-key",
      },
      endpointDependencies,
    );

    expect(result).toEqual({ status: "success", entryId: "endpoint:73", label: "juno" });
    expect(calls).toEqual([
      "validate",
      "encrypt",
      "connection:text",
      "config:custom:73",
      "upsert-config",
      "connection:embedding",
      "config:custom:74",
      "upsert-config",
      "connection:image",
      "config:custom:75",
      "upsert-config",
      "connection:video",
      "config:custom:76",
      "upsert-config",
      "refresh",
    ]);
  });

  it("rejects a label already grouped under another URL before probing", async () => {
    const calls: string[] = [];
    const result = await addCustomEndpointConnection(
      {
        serverDiscId: "guild",
        state: state(),
        label: "juno",
        endpointUrl: "https://images.example.com",
        apiStyle: "comfyui",
        authToken: "",
      },
      {
        loadConnections: async () => [
          {
            connection_id: 72,
            server_id: 1,
            user_id: null,
            label: "juno",
            capability: "text",
            api_style: "openai-compatible",
            endpoint_url: "https://models.example.com",
            requires_auth: false,
          },
        ],
        validateReachability: async () => {
          calls.push("validate");
          return { ok: true };
        },
        upsertConnection: async () => null,
        deleteConnections: async () => true,
        encrypt: async () => ({ encrypted: Buffer.from(""), version: 1 }),
        buildSavedConfig: async () =>
          ({
            server_id: 1,
            provider: "unused",
            api_key: null,
            key_version: 1,
            llm_id: null,
          }) as SavedProviderConfigUpsert,
        upsertSavedConfig: async () => true,
        refresh: () => undefined,
      },
    );

    expect(result).toEqual({ status: "label-url-conflict" });
    expect(calls).toEqual([]);
  });

  it("preserves the reachability failure reason for the panel receipt", async () => {
    const result = await addCustomEndpointConnection(
      {
        serverDiscId: "guild",
        state: state(),
        label: "juno",
        endpointUrl: "http://localhost:11434",
        apiStyle: "ollama-native",
        authToken: "",
      },
      {
        loadConnections: async () => [],
        validateReachability: async () => ({ ok: false, reason: "HTTP 404 Not Found" }),
        upsertConnection: async () => null,
        deleteConnections: async () => true,
        encrypt: async () => ({ encrypted: Buffer.from(""), version: 1 }),
        buildSavedConfig: async () =>
          ({
            server_id: 1,
            provider: "unused",
            api_key: null,
            key_version: 1,
            llm_id: null,
          }) as SavedProviderConfigUpsert,
        upsertSavedConfig: async () => true,
        refresh: () => undefined,
      },
    );

    expect(result).toEqual({ status: "unreachable", reason: "HTTP 404 Not Found", credentialsWithheld: false });
  });

  it("rejects an unsupported API format before probing", async () => {
    const calls: string[] = [];
    const result = await addCustomEndpointConnection(
      {
        serverDiscId: "guild",
        state: state(),
        label: "juno",
        endpointUrl: "https://models.example.com",
        apiStyle: "elevenlabs" as never,
        authToken: "",
      },
      {
        validateReachability: async () => {
          calls.push("validate");
          return { ok: true };
        },
        upsertConnection: async () => null,
        deleteConnections: async () => true,
        loadConnections: async () => [],
        encrypt: async () => ({ encrypted: Buffer.from(""), version: 1 }),
        buildSavedConfig: async () =>
          ({
            server_id: 1,
            provider: "unused",
            api_key: null,
            key_version: 1,
            llm_id: null,
          }) as SavedProviderConfigUpsert,
        upsertSavedConfig: async () => true,
        refresh: () => undefined,
      },
    );

    expect(result).toEqual({ status: "invalid-style" });
    expect(calls).toEqual([]);
  });

  it("rejects invalid model fields before any provider lookup", async () => {
    expect(
      await saveProviderModel({
        serverDiscId: "guild",
        state: state(),
        entryId: "provider:google",
        capability: "text",
        codeName: " ",
      }),
    ).toEqual({ status: "invalid-model" });
    expect(
      await saveProviderModel({
        serverDiscId: "guild",
        state: state(),
        entryId: "provider:google",
        capability: "text",
        codeName: "google/model",
        numCtx: 128,
      }),
    ).toEqual({ status: "invalid-model" });
  });

  it("persists declared image capabilities on the endpoint row", async () => {
    const connection = {
      connection_id: 73,
      label: "juno",
      capability: "image" as const,
      api_style: "comfyui" as const,
      endpoint_url: "https://comfy.example.com",
      requires_auth: false,
      server_id: 7,
      user_id: null,
    };
    const spies = [
      spyOn(llmProviderRepo, "loadCustomEndpointConnectionById").mockResolvedValue(connection as never),
      spyOn(llmProviderRepo, "loadCustomEndpointConnectionsForServerResult").mockResolvedValue({
        connections: [connection],
        endpoints: [],
      } as never),
      spyOn(llmProviderRepo, "upsertCustomEndpointConnection").mockResolvedValue(73 as never),
      spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(null as never),
      spyOn(llmProviderRepo, "loadCustomEndpointsByConnectionId").mockResolvedValue([] as never),
      spyOn(llmModelRepo, "upsertSyntheticCustomDiffusionModel").mockResolvedValue(900 as never),
    ];
    const upsert = spyOn(llmProviderRepo, "upsertCustomEndpoint").mockResolvedValue(null as never);

    await saveProviderModel({
      serverDiscId: "guild",
      state: state(),
      entryId: "endpoint:73",
      capability: "image",
      codeName: "flux",
      imageSupportValues: ["txt2img", "inpaint"],
      workflow: { nodes: {} },
    });

    expect(upsert).toHaveBeenCalled();
    expect(upsert.mock.calls[0]?.[0].extraConfig).toEqual({
      workflow: { nodes: {} },
      workflow_supports: { txt2img: true, img2img: false, inpaint: true, negative_prompt: false },
    });

    upsert.mockRestore();
    for (const spy of spies) spy.mockRestore();
  });

  it("persists the verbatim tool-calling opt-in on both the endpoint and its synthetic model", async () => {
    const connection = {
      connection_id: 73,
      label: "juno",
      capability: "text" as const,
      api_style: "openai-compatible" as const,
      endpoint_url: "https://models.example.com/v1",
      requires_auth: false,
      server_id: 7,
      user_id: null,
    };
    const spies = [
      spyOn(llmProviderRepo, "loadCustomEndpointConnectionById").mockResolvedValue(connection as never),
      spyOn(llmProviderRepo, "loadCustomEndpointConnectionsForServerResult").mockResolvedValue({
        connections: [connection],
        endpoints: [],
      } as never),
      spyOn(llmProviderRepo, "upsertCustomEndpointConnection").mockResolvedValue(73 as never),
      spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(null as never),
      spyOn(llmProviderRepo, "loadCustomEndpointsByConnectionId").mockResolvedValue([] as never),
    ];
    const synthetic = spyOn(llmModelRepo, "upsertSyntheticCustomLlm").mockResolvedValue(900 as never);
    const upsert = spyOn(llmProviderRepo, "upsertCustomEndpoint").mockResolvedValue(null as never);

    await saveProviderModel({
      serverDiscId: "guild",
      state: state(),
      entryId: "endpoint:73",
      capability: "text",
      codeName: "mirri-local",
      hasTools: true,
      verbatimToolCalling: true,
    });

    // The runtime reads the synthetic llms row while the panel reads the endpoint row, so both must
    // carry the same value or an edit would show one state and generate with another.
    expect(synthetic).toHaveBeenCalled();
    expect(synthetic.mock.calls[0]?.[0].verbatimToolCalling).toBe(true);
    expect(upsert).toHaveBeenCalled();
    expect(upsert.mock.calls[0]?.[0].verbatimToolCalling).toBe(true);

    upsert.mockRestore();
    synthetic.mockRestore();
    for (const spy of spies) spy.mockRestore();
  });

  it("declares a curated image model's capabilities without the ComfyUI inpaint gate", async () => {
    const load = spyOn(llmModelRepo, "loadDiffusionModelByProviderAndCodename").mockResolvedValue(null as never);
    const upsert = spyOn(llmModelRepo, "upsertScopedDiffusionModel").mockResolvedValue(null as never);

    await saveProviderModel({
      serverDiscId: "guild",
      state: state(),
      entryId: "provider:google",
      capability: "image",
      codeName: "gemini-example-image",
      imageSupportValues: ["txt2img", "img2img", "inpaint"],
    });

    expect(upsert).toHaveBeenCalled();
    expect(upsert.mock.calls[0]?.slice(0, 3)).toEqual([
      "gemini-example-image",
      "google",
      { txt2img: true, img2img: true, inpaint: true, negative_prompt: false },
    ]);

    upsert.mockRestore();
    load.mockRestore();
  });

  it("leaves a curated image model undeclared when the modal submitted nothing", async () => {
    const load = spyOn(llmModelRepo, "loadDiffusionModelByProviderAndCodename").mockResolvedValue(null as never);
    const upsert = spyOn(llmModelRepo, "upsertScopedDiffusionModel").mockResolvedValue(null as never);

    await saveProviderModel({
      serverDiscId: "guild",
      state: state(),
      entryId: "provider:google",
      capability: "image",
      codeName: "gemini-example-image",
    });

    // Undeclared must stay NULL so the model keeps following its provider's defaults.
    expect(upsert.mock.calls[0]?.[2]).toBeUndefined();

    upsert.mockRestore();
    load.mockRestore();
  });

  it("refuses to remove the entry supplying the active text model", async () => {
    const result = await providerPanelOperations.removeServerProviderEntry({
      serverDiscId: "guild",
      state: state(),
      entry: {
        id: "provider:google",
        kind: "provider",
        provider: "google",
        displayName: "Google Gemini",
        savedAt: null,
        rotationKeyCount: 0,
        capabilities: [],
      },
    });

    expect(result).toEqual({ status: "active" });
  });

  it("removes a personal provider only from user-owned storage", async () => {
    const load = spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockResolvedValue([]);
    const removeUser = spyOn(llmProviderRepo, "deleteUserProviderRegistration").mockResolvedValue(true);
    const removeServer = spyOn(llmProviderRepo, "deleteServerProviderRegistration").mockResolvedValue(true);
    try {
      const result = await providerPanelOperations.removeServerProviderEntry({
        serverDiscId: "guild",
        scopeKind: "personal",
        ownerId: 77,
        state: state(),
        entry: {
          id: "provider:google",
          kind: "provider",
          provider: "google",
          displayName: "Google Gemini",
          savedAt: null,
          rotationKeyCount: 0,
          capabilities: [],
        },
      });

      expect(result).toEqual({
        status: "success",
        entryId: "provider:google",
        displayName: "Google Gemini",
      });
      expect(removeUser).toHaveBeenCalledWith(77, "google");
      expect(removeServer).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
      removeUser.mockRestore();
      removeServer.mockRestore();
    }
  });

  describe("synthetic text model cache refresh", () => {
    function editingEndpointRow(capability: "text" | "image" = "text") {
      return {
        connection_id: 73,
        custom_endpoint_id: 501,
        model_ref_id: 900,
        capability,
        label: "juno",
        api_style: "openai-compatible" as const,
        endpoint_url: "https://models.example.com/v1",
        requires_auth: false,
        server_id: 7,
        user_id: null,
        model_name: "mirri-local",
      };
    }

    function makeLlmRow(verbatimToolCalling: boolean): LlmRow {
      return {
        llm_id: 900,
        llm_provider: "custom:73",
        llm_codename: "mirri-local",
        verbatim_tool_calling: verbatimToolCalling,
      } as LlmRow;
    }

    it("refuses foreign-owner and wrong-capability endpoint edits before any writes", async () => {
      const original = editingEndpointRow();
      const lookup = spyOn(llmProviderRepo, "loadCustomEndpointsByIds");
      const write = spyOn(dbClient, "sql").mockImplementation((async () => []) as unknown as typeof dbClient.sql);
      const encrypted = spyOn(crypto, "encryptApiKey");
      try {
        for (const [kind, ownerId, row] of [
          ["server", 8, original],
          ["server", 7, { ...original, user_id: 9 }],
          ["personal", 8, { ...original, server_id: null, user_id: 9 }],
          ["personal", 9, original],
          ["server", 7, { ...original, capability: "image" }],
        ] as const) {
          lookup.mockResolvedValue([row] as never);
          const result = await registerCustomEndpoint({
            scope: { kind, ownerId, baseConfig: { fallback_model_refs: [] } as never },
            label: "juno",
            capability: "text",
            apiStyle: "openai-compatible",
            endpointUrl: "https://models.example.com/v1",
            modelName: "mirri-local",
            editingEndpointId: 501,
          });
          expect(result).toBeNull();
        }
        expect(write).not.toHaveBeenCalled();
        expect(encrypted).not.toHaveBeenCalled();
      } finally {
        lookup.mockRestore();
        write.mockRestore();
        encrypted.mockRestore();
      }
    });

    /**
     * Rebuilding TomoriState reads the model through `llmModelRepo.loadById`, which is cache-first,
     * so invalidating the server snapshot alone leaves the rebuilt state carrying the pre-edit
     * capability flags. The repository read that follows a write is what this pins.
     */
    it("drops the edited model from the LLM cache so the next read is not the stale row", async () => {
      replaceCachedLlms([makeLlmRow(false)]);
      expect(readCachedLlm(900)?.verbatim_tool_calling).toBe(false);

      const row = editingEndpointRow();
      const spyList = [
        spyOn(llmProviderRepo, "loadCustomEndpointsByIds").mockResolvedValue([row] as never),
        spyOn(llmProviderRepo, "loadCustomEndpointsByConnectionId").mockResolvedValue([row] as never),
        spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(null as never),
        spyOn(llmProviderRepo, "upsertCustomEndpoint").mockResolvedValue(row as never),
        spyOn(llmProviderRepo, "upsertSavedProviderConfig").mockResolvedValue(true as never),
        spyOn(llmModelRepo, "updateSyntheticCustomCapabilityModelById").mockResolvedValue(undefined as never),
        // The stored credential is encrypted through pgcrypto, which needs a live connection.
        spyOn(crypto, "encryptApiKey").mockResolvedValue({ encrypted: Buffer.from(""), version: 1 } as never),
      ];
      try {
        const result = await registerCustomEndpoint({
          scope: { kind: "server", ownerId: 7, baseConfig: { fallback_model_refs: [] } as never },
          label: "juno",
          capability: "text",
          apiStyle: "openai-compatible",
          endpointUrl: "https://models.example.com/v1",
          modelName: "mirri-local",
          hasTools: true,
          verbatimToolCalling: true,
          editingEndpointId: 501,
        });

        expect(result?.modelId).toBe(900);
        expect(readCachedLlm(900)).toBeUndefined();
      } finally {
        for (const spy of spyList) spy.mockRestore();
        replaceCachedLlms([]);
      }
    });

    /**
     * A non-text endpoint's `model_ref_id` is an id in its own capability table, so the same number
     * can name an unrelated llms row. Evicting it would push that model onto the database path until
     * the next restart.
     */
    it("leaves the LLM cache alone when a non-text endpoint's model is edited", async () => {
      replaceCachedLlms([makeLlmRow(false)]);

      const row = editingEndpointRow("image");
      const spyList = [
        spyOn(llmProviderRepo, "loadCustomEndpointsByIds").mockResolvedValue([row] as never),
        spyOn(llmProviderRepo, "loadCustomEndpointsByConnectionId").mockResolvedValue([row] as never),
        spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(null as never),
        spyOn(llmProviderRepo, "upsertCustomEndpoint").mockResolvedValue(row as never),
        spyOn(llmProviderRepo, "upsertSavedProviderConfig").mockResolvedValue(true as never),
        spyOn(llmModelRepo, "updateSyntheticCustomCapabilityModelById").mockResolvedValue(undefined as never),
        spyOn(crypto, "encryptApiKey").mockResolvedValue({ encrypted: Buffer.from(""), version: 1 } as never),
      ];
      try {
        const result = await registerCustomEndpoint({
          scope: { kind: "server", ownerId: 7, baseConfig: { fallback_model_refs: [] } as never },
          label: "juno",
          capability: "image",
          apiStyle: "openai-compatible",
          endpointUrl: "https://models.example.com/v1",
          modelName: "mirri-local",
          editingEndpointId: 501,
        });

        expect(result?.modelId).toBe(900);
        expect(readCachedLlm(900)?.llm_codename).toBe("mirri-local");
      } finally {
        for (const spy of spyList) spy.mockRestore();
        replaceCachedLlms([]);
      }
    });
  });
});

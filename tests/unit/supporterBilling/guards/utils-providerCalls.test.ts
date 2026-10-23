import { beforeAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { createLlmRow, createPersona } from "../../../helpers/fixtures";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import * as managedProvider from "@/modules/supporter-billing/runtime/managedProvider";
import { OpenrouterProvider } from "@/providers/openrouter/openrouterProvider";
import { ToolRegistry } from "@/tools/toolRegistry";
import { embeddingModelSchema, speechModelSchema } from "@/types/db/schema";
import { ContextItemTag } from "@/types/misc/context";
import * as prompts from "@/utils/cache/channelPromptCache";
import * as personas from "@/utils/cache/tomoriStateCache";
import { llmModelRepo, ragRepository, serverMemoryRepository } from "@/utils/db/repositories";
import * as ragAvailability from "@/utils/db/ragAvailability";
import { log } from "@/utils/misc/logger";
import * as credentials from "@/utils/provider/credentialResolver";
import { runHiddenImageTurn, type HiddenImageTurnParams } from "@/utils/provider/hiddenImageTurn";
import * as factory from "@/utils/provider/providerFactory";
import type { SpeechTargetResult } from "@/utils/provider/speechEndpointResolver";
import { analyzeImageWithVisionModel } from "@/utils/provider/visionCaption";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy, localizedProse } from "../../../helpers/localeCases";
import { memoryGuard } from "@/utils/security/rateLimiter";
import * as remoteFetch from "@/utils/security/userRemoteFetch";
import { synthesizeVoiceMessage } from "@/utils/speech/voiceMessageSynthesis";
import * as context from "@/utils/text/contextBuilder";
import * as mediaResolver from "@/utils/text/context/mediaResolver";
import { buildServerDocumentContextItem } from "@/utils/text/context/rag";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import * as participants from "@/utils/text/participants/preparation";
import {
  captureUsageRecords,
  createResolvedCredentials,
  createServerFunding,
  fundingContext,
  renderReturnedDenial,
  installSpendHarness,
  produceFundedDenial,
  settleUsage,
} from "./utils-fundingFixtures";

beforeAll(async () => initializeLocalizer());

async function expectReturnedDenial(result: object, funding: ReturnType<typeof createServerFunding> | null = null) {
  const copy = await renderReturnedDenial(result, funding);
  expect(copy?.titleKey).toBe("commands.subscribe.request.allowance_title");
  expect(copy?.description).toMatch(localizedProse("en-US", "commands.subscribe.request.exhausted"));
  expect(copy?.description).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
}

const cleanups: Array<() => void> = [];

interface Restorable {
  mockRestore(): void;
}

function trackSpy<T extends Restorable>(spy: T): T {
  cleanups.push(() => spy.mockRestore());
  return spy;
}

function trackCleanup(cleanup: () => void): void {
  cleanups.push(cleanup);
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const VISION_MODEL_ID = 9;
const visionLlm = createLlmRow({
  llm_id: VISION_MODEL_ID,
  llm_provider: "openrouter",
  llm_codename: "fixture/vision",
});

function installVisionCredentials(funding: ReturnType<typeof createServerFunding> | null): void {
  trackSpy(
    spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
      createResolvedCredentials(funding, { modelId: VISION_MODEL_ID }),
    ),
  );
  trackSpy(spyOn(llmModelRepo, "loadById").mockResolvedValue(visionLlm));
}

function visionResponse(): Response {
  return Response.json({
    choices: [{ message: { content: "A round blue lantern." } }],
    usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.05 },
  });
}

function visionLimitResponse(): Response {
  return Response.json({ error: { metadata: { limit_source: "openrouter_key_limit" } } }, { status: 402 });
}

describe("vision caption usage recording", () => {
  it("records one usage row for a funded success", async () => {
    const funding = createServerFunding({ capability: "vision", modelCodename: "fixture/vision" });
    const capture = captureUsageRecords();
    trackCleanup(capture.restore);
    installVisionCredentials(funding);
    trackSpy(spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(visionResponse()));

    const result = await analyzeImageWithVisionModel({
      serverId: funding.serverId ?? 7,
      image: { data: "Zml4dHVyZS1pbWFnZQ==", mimeType: "image/png" },
      prompt: "Describe the image.",
    });
    await settleUsage();

    expect(result).toMatchObject({
      ok: true,
      text: "A round blue lantern.",
      provider: "openrouter",
      model: "fixture/vision",
    });
    expect(capture.rows).toHaveLength(1);
    expect(capture.rows[0]).toMatchObject({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "server",
      serverId: funding.serverId,
      capability: "vision",
      modelCodename: "fixture/vision",
      costUsd: 0.05,
      inputTokens: 12,
      outputTokens: 3,
    });
  });

  it("records no usage row for an unfunded success", async () => {
    const capture = captureUsageRecords();
    trackCleanup(capture.restore);
    installVisionCredentials(null);
    trackSpy(spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(visionResponse()));

    const result = await analyzeImageWithVisionModel({
      serverId: 7,
      image: { data: "Zml4dHVyZS1pbWFnZQ==", mimeType: "image/png" },
      prompt: "Describe the image.",
    });
    await settleUsage();

    expect(result).toMatchObject({ ok: true, text: "A round blue lantern." });
    expect(capture.rows).toHaveLength(0);
  });

  it("surfaces a key-limit rejection as localized subscription copy", async () => {
    const funding = createServerFunding({ capability: "vision", modelCodename: "fixture/vision" });
    const capture = captureUsageRecords();
    trackCleanup(capture.restore);
    installVisionCredentials(funding);
    trackSpy(spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(visionLimitResponse()));

    const result = await analyzeImageWithVisionModel({
      serverId: funding.serverId ?? 7,
      image: { data: "Zml4dHVyZS1pbWFnZQ==", mimeType: "image/png" },
      prompt: "Describe the image.",
    });
    await settleUsage();

    expect(result.ok).toBe(false);
    await expectReturnedDenial(result, funding);
    expect(capture.rows).toHaveLength(0);
  });

  it("keeps a spend-guard denial when credential resolution fails", async () => {
    const harness = installSpendHarness();
    trackCleanup(() => harness.restore());
    const { denial, funding } = await produceFundedDenial(harness);
    if (!(denial instanceof SupporterRequestDeniedError)) throw new Error("Expected the spend guard to deny");
    trackSpy(spyOn(credentials, "resolveCapabilityCredentials").mockRejectedValue(denial));
    const fetchSpy = trackSpy(spyOn(remoteFetch, "fetchUserRemoteUrl"));

    const result = await analyzeImageWithVisionModel({
      serverId: 7,
      image: { data: "Zml4dHVyZS1pbWFnZQ==", mimeType: "image/png" },
      prompt: "Describe the image.",
    });

    expect(result.ok).toBe(false);
    await expectReturnedDenial(result, funding);
    expect(result.failure?.reason).toBe("credentials_unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function preparedParticipantContext(): Awaited<ReturnType<typeof participants.prepareParticipantContext>> {
  return {
    discoveryPlan: {
      seeds: [],
      evidence: [],
      rejections: [],
      aliasReferenceDiagnostics: {
        evaluatedAliasCount: 0,
        acceptedAliasCount: 0,
        ambiguousAliasCount: 0,
        unmatchedAliasCount: 0,
      },
    },
    matrixUsers: new Map(),
    syntheticUsers: new Map(),
    messageProxyUsers: new Map(),
    publicPersonaProfiles: [],
    referencedUserRows: new Map(),
    referencedUserIds: new Set(),
    diagnostics: {
      discoveryCacheHit: false,
      discoveryDurationMs: 0,
      candidateCount: 0,
      includedCount: 0,
      rejectionCounts: {
        ineligible_state: 0,
        bot: 0,
        non_member: 0,
        ambiguous_alias: 0,
        existing_participant: 0,
        blocked_source: 0,
        missing_guild: 0,
      },
      externalCalls: {
        candidateSourceReads: 0,
        memberCacheHits: 0,
        memberFetches: 0,
        messageProxyIdentityReads: 0,
      },
      sourceContributions: [],
    },
  };
}

function installHiddenTurnHarness(funding: ReturnType<typeof createServerFunding> | null) {
  const state = createPersona({
    llm: createLlmRow({ llm_provider: "openrouter", llm_codename: "fixture/text-model", has_tools: true }),
  });
  const resolved = createResolvedCredentials(funding);
  const provider = new OpenrouterProvider();
  const stream = trackSpy(
    spyOn(provider, "streamToDiscord").mockResolvedValue({
      status: "function_call",
      data: { name: "generate_image", args: {} },
      usage: { inputTokens: 120, outputTokens: 30, costUsd: 0.08 },
    }),
  );
  trackSpy(
    spyOn(provider, "createConfig").mockResolvedValue({
      model: state.llm.llm_codename,
      apiKey: resolved.apiKey,
      temperature: 1,
    }),
  );
  trackSpy(spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(resolved));
  trackSpy(spyOn(factory, "getProviderForTomori").mockResolvedValue(provider));
  trackSpy(spyOn(prompts, "getCachedChannelPrompt").mockResolvedValue(null));
  trackSpy(spyOn(personas, "getCachedAllPersonas").mockResolvedValue([state]));
  trackSpy(
    spyOn(context, "buildContext").mockResolvedValue({
      contextItems: [],
      tailDirectives: [],
      lowerPriorityTailDirectives: [],
      messageIdMap: new MessageIdMap(),
    }),
  );
  trackSpy(spyOn(participants, "prepareParticipantContext").mockResolvedValue(preparedParticipantContext()));
  trackSpy(spyOn(mediaResolver, "resolveMediaForModel").mockImplementation(async (items) => items));
  trackSpy(spyOn(ToolRegistry, "executeTool").mockResolvedValue({ success: true, endTurn: true }));
  return { state, stream };
}

function hiddenTurnParams(state: ReturnType<typeof createPersona>): HiddenImageTurnParams {
  return {
    channel: {
      id: "fixture-channel",
      name: "fixture-channel",
      topic: null,
      messages: { fetch: async () => new Map() },
    } as unknown as HiddenImageTurnParams["channel"],
    client: { user: { id: "fixture-bot" } } as unknown as Client,
    guild: null,
    tomoriState: state,
    locale: "en-US",
    interactingUserId: "fixture-user",
    internalUserId: 1,
    backend: "current_provider",
    presetLabel: "Portrait",
    presetInstruction: "A close portrait of the current speaker.",
    aspectRatio: "1:1",
    naiOrientation: "square",
  };
}

describe("hidden image turn usage recording", () => {
  it("records one usage row for a funded turn", async () => {
    const funding = createServerFunding();
    const capture = captureUsageRecords();
    trackCleanup(capture.restore);
    const { state, stream } = installHiddenTurnHarness(funding);

    const result = await runHiddenImageTurn(hiddenTurnParams(state));
    await settleUsage();

    expect(result).toEqual({ success: true });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(capture.rows).toHaveLength(1);
    expect(capture.rows[0]).toMatchObject({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "server",
      serverId: funding.serverId,
      capability: "text",
      modelCodename: "fixture/text-model",
      costUsd: 0.08,
      inputTokens: 120,
      outputTokens: 30,
    });
  });

  it("records no usage row for an unfunded turn", async () => {
    const capture = captureUsageRecords();
    trackCleanup(capture.restore);
    const { state } = installHiddenTurnHarness(null);

    const result = await runHiddenImageTurn(hiddenTurnParams(state));
    await settleUsage();

    expect(result).toEqual({ success: true });
    expect(capture.rows).toHaveLength(0);
  });
});

const VOICE_MODEL_CODENAME = "bytedance-seed/seed-audio-1-0";

function createVoiceTarget(
  apiKey: string,
  funding: ReturnType<typeof createServerFunding> | null,
): Extract<SpeechTargetResult, { kind: "hosted-model" }> {
  return {
    kind: "hosted-model",
    endpoint: null,
    owner: { kind: "server", ownerId: 7 },
    credentialId: 11,
    credentialRevision: 1,
    apiKey,
    ...fundingContext(funding),
    model: speechModelSchema.parse({
      speech_model_id: 5,
      provider: "openrouter",
      codename: VOICE_MODEL_CODENAME,
      voice_mode: "design",
    }),
  };
}

function createVoiceRequest(target: ReturnType<typeof createVoiceTarget>) {
  return {
    target,
    endpoint: null,
    endpointApiKey: "",
    elevenLabsApiKey: "",
    source: { kind: "design" as const, designPrompt: "A warm narrator with a measured pace.", personaId: 1 },
    script: "Hello from the fixture voice.",
  };
}

// A silent 128 kbps MPEG-1 Layer III frame, repeated so the hosted audio validator reads a duration.
function fixtureMp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x64;
  return Buffer.concat(Array.from({ length: 10 }, () => frame));
}

function installVoiceHttp() {
  return trackSpy(
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0]) => {
          const url = String(input);
          if (url.endsWith("/audio/speech")) {
            return new Response(new Uint8Array(fixtureMp3()), {
              status: 200,
              headers: { "content-type": "audio/mpeg", "x-generation-id": "fixture-generation" },
            });
          }
          if (url.includes("/generation?id=fixture-generation")) {
            return Response.json({ data: { total_cost: 0.03 } });
          }
          throw new Error(`Unexpected provider request: ${url}`);
        },
        { preconnect: () => undefined },
      ),
    ),
  );
}

describe("hosted speech usage recording", () => {
  it("records one usage row for a funded speech success", async () => {
    const funding = createServerFunding({ capability: "voice", modelCodename: VOICE_MODEL_CODENAME });
    const resolved = createResolvedCredentials(funding);
    const capture = captureUsageRecords();
    trackCleanup(capture.restore);
    trackSpy(
      spyOn(managedProvider, "resolveSupporterCapabilityCredentials").mockResolvedValue({
        apiKey: resolved.apiKey,
        funding,
      }),
    );
    const fetchSpy = installVoiceHttp();

    const result = await synthesizeVoiceMessage(createVoiceRequest(createVoiceTarget(resolved.apiKey, funding)));
    await settleUsage();

    expect(result).toMatchObject({
      success: true,
      backendKey: "openrouter-speech",
      contentType: "audio/mpeg",
      extension: "mp3",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(capture.rows).toHaveLength(1);
    expect(capture.rows[0]).toMatchObject({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "server",
      serverId: funding.serverId,
      capability: "voice",
      modelCodename: VOICE_MODEL_CODENAME,
      costUsd: 0.03,
      providerRequestId: "fixture-generation",
    });
  });

  it("records no usage for a successful BYOK speech request", async () => {
    const resolved = createResolvedCredentials(null);
    const capture = captureUsageRecords();
    trackCleanup(capture.restore);
    const fetchSpy = installVoiceHttp();

    const result = await synthesizeVoiceMessage(createVoiceRequest(createVoiceTarget(resolved.apiKey, null)));
    await settleUsage();

    expect(result).toMatchObject({
      success: true,
      backendKey: "openrouter-speech",
      contentType: "audio/mpeg",
      extension: "mp3",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(capture.rows).toHaveLength(0);
  });

  it("surfaces a spend-guard denial as localized subscription copy", async () => {
    const harness = installSpendHarness();
    trackCleanup(() => harness.restore());
    const key = harness.register({
      appliedLimit: 0,
      funding: createServerFunding({ capability: "voice", modelCodename: VOICE_MODEL_CODENAME }),
    });
    const capture = captureUsageRecords();
    trackCleanup(capture.restore);
    trackSpy(
      spyOn(managedProvider, "resolveSupporterCapabilityCredentials").mockResolvedValue({
        apiKey: key.apiKey,
        funding: key.funding,
      }),
    );
    trackSpy(spyOn(log, "error").mockImplementation(async () => {}));
    const fetchSpy = trackSpy(
      spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(
          async () => {
            throw new Error("Unexpected provider request");
          },
          { preconnect: () => undefined },
        ),
      ),
    );

    const result = await synthesizeVoiceMessage(createVoiceRequest(createVoiceTarget(key.apiKey, key.funding)));
    await settleUsage();

    expect(result.success).toBe(false);
    await expectReturnedDenial(result, key.funding);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(capture.rows).toHaveLength(0);
  });
});

const EMBEDDING_MODEL_ID = 5;
const embeddingModel = embeddingModelSchema.parse({
  embedding_model_id: EMBEDDING_MODEL_ID,
  provider: "openrouter",
  codename: "fixture/embedding",
  model_family: "fixture",
});

const retrievedChunk = {
  document_id: 3,
  document_name: "Server notes",
  chunk_index: 0,
  content: "Mirri likes jasmine tea.",
  similarity: 0.91,
};

function installRagHarness(funding: ReturnType<typeof createServerFunding> | null) {
  const state = createPersona({ config: { embedding_model_id: EMBEDDING_MODEL_ID } });
  trackSpy(spyOn(ragAvailability, "isRagAvailable").mockReturnValue(true));
  trackSpy(spyOn(memoryGuard, "getStatus").mockReturnValue("safe"));
  trackSpy(spyOn(serverMemoryRepository, "hasDocumentInScope").mockResolvedValue(true));
  trackSpy(
    spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
      createResolvedCredentials(funding, { modelId: EMBEDDING_MODEL_ID }),
    ),
  );
  trackSpy(spyOn(llmModelRepo, "loadEmbeddingModelById").mockResolvedValue(embeddingModel));
  const retrieve = trackSpy(
    spyOn(ragRepository, "retrieveRelevantChunks").mockImplementation(async (params) => {
      params.onUsage?.({ inputTokens: 8, outputTokens: 0, costUsd: 0.004 });
      return [retrievedChunk];
    }),
  );
  const history: SimplifiedMessageForContext[] = [
    {
      id: "fixture-message",
      authorId: "fixture-user",
      authorName: "Juno",
      authorType: "user",
      content: "What does Mirri like?",
      imageAttachments: [],
      videoAttachments: [],
    },
  ];
  return { state, history, retrieve };
}

describe("server document context usage recording", () => {
  it("records one usage row from the embedding callback and still builds the context item", async () => {
    const funding = createServerFunding({ capability: "embedding", modelCodename: "fixture/embedding" });
    const capture = captureUsageRecords();
    trackCleanup(capture.restore);
    const { state, history } = installRagHarness(funding);

    const item = await buildServerDocumentContextItem({
      tomoriState: state,
      simplifiedMessageHistory: history,
      channelId: "fixture-channel",
    });
    await settleUsage();

    expect(item?.role).toBe("user");
    expect(item?.metadataTag).toBe(ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS);
    const part = item?.parts[0];
    expect(part?.type).toBe("text");
    expect(part?.type === "text" ? part.text : "").toContain(retrievedChunk.content);
    expect(capture.rows).toHaveLength(1);
    expect(capture.rows[0]).toMatchObject({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "server",
      serverId: funding.serverId,
      capability: "embedding",
      modelCodename: "fixture/embedding",
      costUsd: 0.004,
      inputTokens: 8,
      outputTokens: 0,
    });
  });

  it("passes no usage reporter and records nothing when the embedding credentials are unfunded", async () => {
    const capture = captureUsageRecords();
    trackCleanup(capture.restore);
    const { state, history, retrieve } = installRagHarness(null);

    const item = await buildServerDocumentContextItem({
      tomoriState: state,
      simplifiedMessageHistory: history,
      channelId: "fixture-channel",
    });
    await settleUsage();

    expect(item?.metadataTag).toBe(ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS);
    const part = item?.parts[0];
    expect(part?.type === "text" ? part.text : "").toContain(retrievedChunk.content);
    expect(retrieve.mock.calls[0]?.[0].onUsage).toBeUndefined();
    expect(capture.rows).toHaveLength(0);
  });
});

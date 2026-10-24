import * as realCrypto from "@/utils/security/crypto";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { OpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { Client, EmbedBuilder, TextChannel } from "discord.js";
import { savedProviderConfigSchema } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import type { StreamProvider } from "@/types/stream/interfaces";
import * as realCredentials from "@/utils/provider/credentialResolver";
import * as realRemoteFetch from "@/utils/security/userRemoteFetch";
import * as realImages from "@/utils/image/imageExtractor";
import {
  ProviderRequestDeniedError,
  registerProviderRequestDenialTranslator,
  registerProviderUsageReporter,
  type ProviderUsageContext,
  type ProviderUsageReport,
} from "@/utils/provider/providerUsage";
import { buildStreamContext } from "@/utils/provider/streamContext";
import { StreamErrorUi } from "@/utils/discord/stream/errorUi";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

interface RequestContext extends ProviderUsageContext {
  requestId: string;
}

const firstContext: RequestContext = { requestId: "first" };
const otherContext: RequestContext = { requestId: "other" };
const model = createLlmRow({ llm_provider: "openrouter", llm_codename: "fixture-vision" });
const savedConfig = savedProviderConfigSchema.parse({
  server_id: 1,
  provider: "openrouter",
  api_key: Buffer.from("fixture-encrypted-key"),
  llm_id: null,
  diffusion_model_id: null,
  embedding_model_id: null,
  nai_diffusion_model_id: null,
  nai_preset_name: null,
  llm_disabled_params: [],
  llm_logit_biases: [],
  fallback_model_refs: [],
});
let requestContext: ProviderUsageContext | undefined = firstContext;
let credentialFailure: Error | undefined;
let providerFailure: Error | undefined;
let providerResponse: Response | undefined;
const remoteFetch = mock(async () => {
  if (providerFailure) throw providerFailure;
  if (providerResponse) return providerResponse;
  return Response.json({
    choices: [{ message: { content: "fixture caption" } }],
    usage: { prompt_tokens: 19, completion_tokens: 7, cost: 0.02 },
  });
});
const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/provider/credentialResolver": realCredentials,
  "@/utils/security/userRemoteFetch": realRemoteFetch,
  "@/utils/image/imageExtractor": realImages,
  "@/utils/security/crypto": realCrypto,
});
scopedMock.module("@/utils/provider/credentialResolver", () => ({
  ...realCredentials,
  resolveCapabilityCredentials: async (): Promise<realCredentials.ResolvedCredentials> => {
    if (credentialFailure) throw credentialFailure;
    return {
      provider: "openrouter",
      apiKey: "fixture-key",
      keyVersion: 1,
      source: "server",
      savedConfig,
      usageContext: requestContext,
    };
  },
}));
scopedMock.module("@/utils/security/userRemoteFetch", () => ({
  ...realRemoteFetch,
  fetchUserRemoteUrl: remoteFetch,
}));
scopedMock.module("@/utils/image/imageExtractor", () => ({
  ...realImages,
  resolveMessageImageUrls: async () => ({
    sourceMessageId: "123456789012345678",
    imageUrls: [{ url: "https://example.com/image.png", mimeType: "image/png", source: "attachment" }],
  }),
  downloadDiscoveredImage: async () => ({ success: true, buffer: Buffer.from("fixture image") }),
}));
scopedMock.module("@/utils/security/crypto", () => ({ ...realCrypto, decryptApiKey: async () => "fixture-key" }));
const { OpenRouterEngine } = await import("@/tools/webSearch/openrouterEngine");
const { AnalyzeImageTool } = await import("@/tools/functionCalls/analyzeImageTool");
const { analyzeImageWithVisionModel } = await import("@/utils/provider/visionCaption");
const restores: Array<() => void> = [];

function hasOpenRouterLimitError(error: unknown): boolean {
  return error instanceof OpenRouterLimitError || (error instanceof Error && hasOpenRouterLimitError(error.cause));
}

function denial(context: ProviderUsageContext | undefined, deferNotice = false) {
  return new ProviderRequestDeniedError(
    context,
    (locale) => ({
      titleKey: "general.errors.api_key_error_title",
      description: localizer(locale, "general.errors.api_key_error_description"),
    }),
    { deferNotice },
  );
}

function toolFixture() {
  const send = mock(async (_payload: { embeds?: EmbedBuilder[] }) => ({ id: "fixture-notice" }));
  const context: ToolContext = {
    channel: { id: "usage-integration", send } as unknown as TextChannel,
    client: {} as Client,
    tomoriState: createPersona({ vision_llm: model }),
    provider: "openrouter",
    locale: "en-US",
    suppressProgressNotices: true,
    usageContext: firstContext,
  };
  return { send, context };
}

beforeAll(() => initializeLocalizer());
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
  remoteFetch.mockClear();
  requestContext = firstContext;
  credentialFailure = undefined;
  providerFailure = undefined;
  providerResponse = undefined;
});

describe("provider usage and denial request integration", () => {
  test("reports each successful vision request once with its own resolved context", async () => {
    const reports: Array<{ context: ProviderUsageContext; report: ProviderUsageReport }> = [];
    restores.push(
      registerProviderUsageReporter((context, report) => {
        reports.push({ context, report });
      }),
    );
    const { context, send } = toolFixture();
    for (const usageContext of [firstContext, otherContext]) {
      requestContext = usageContext;
      const result = await new AnalyzeImageTool().execute({ media_id: "123456789012345678" }, context);
      expect(result.success).toBe(true);
    }
    expect(remoteFetch).toHaveBeenCalledTimes(2);
    expect(reports).toHaveLength(2);
    expect(reports[0].context).toBe(firstContext);
    expect(reports[1].context).toBe(otherContext);
    for (const { report } of reports) {
      expect(report).toEqual({ modelCodename: model.llm_codename, inputTokens: 19, outputTokens: 7, costUsd: 0.02 });
    }
    expect(send).not.toHaveBeenCalled();
  });

  test("reporter storage failures cannot fail successful inference", async () => {
    restores.push(
      registerProviderUsageReporter(async () => {
        throw new Error("fixture storage failure");
      }),
    );
    const { context } = toolFixture();
    const result = await new AnalyzeImageTool().execute({ media_id: "123456789012345678" }, context);
    expect(result.success).toBe(true);
  });

  test("without registration, successful and ordinary failed requests retain their normal result", async () => {
    const { context, send } = toolFixture();
    expect((await new AnalyzeImageTool().execute({ media_id: "123456789012345678" }, context)).success).toBe(true);
    providerFailure = new Error("fixture transport failure");
    const failed = await new AnalyzeImageTool().execute({ media_id: "123456789012345678" }, context);
    expect(failed.success).toBe(false);
    expect(failed.error).not.toBe(localizedCopy(context.locale, "general.errors.api_key_error_description"));
    expect(send).not.toHaveBeenCalled();
  });

  test("translates a request failure before generic handling and sends the tool notice as well as returning its text", async () => {
    providerResponse = Response.json(
      { error: { metadata: { limit_source: "openrouter_key_limit" } } },
      { status: 403 },
    );
    const translate = mock((error: unknown, context: ProviderUsageContext) =>
      hasOpenRouterLimitError(error) ? denial(context) : null,
    );
    restores.push(registerProviderRequestDenialTranslator(translate));
    const { context, send } = toolFixture();
    const result = await new AnalyzeImageTool().execute({ media_id: "123456789012345678" }, context);
    expect(result.success).toBe(false);
    expect(result.error).toBe(localizedCopy(context.locale, "general.errors.api_key_error_description"));
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0][1]).toBe(firstContext);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].embeds?.[0].toJSON().description).toBe(result.error);
  });

  test("search translates a provider HTTP limit and returns its denial text with the channel notice", async () => {
    restores.push(
      registerProviderRequestDenialTranslator((error, context) =>
        hasOpenRouterLimitError(error) ? denial(context) : null,
      ),
    );
    const fetchStub = stubGlobalFetch(() =>
      Response.json({ error: { metadata: { limit_source: "openrouter_key_limit" } } }, { status: 403 }),
    );
    restores.push(() => fetchStub.mockRestore());
    const { context, send } = toolFixture();
    context.tomoriState.config.api_key = Buffer.from("fixture-encrypted-key");
    for (const suppressFailureNotices of [false, true]) {
      context.suppressFailureNotices = suppressFailureNotices;
      send.mockClear();
      const result = await new OpenRouterEngine().search("fixture query", "text", context);
      expect(result.success).toBe(false);
      expect(result.error).toBe(localizedCopy(context.locale, "general.errors.api_key_error_description"));
      expect(send).toHaveBeenCalledTimes(suppressFailureNotices ? 0 : 1);
      if (!suppressFailureNotices) {
        expect(send.mock.calls[0][0].embeds?.[0].toJSON().description).toBe(result.error);
      }
    }
  });

  test("renders a denial nested in a credential failure before the credential error result", async () => {
    credentialFailure = Object.assign(new realCredentials.PersonalProviderRequiredError("vision"), {
      cause: denial(undefined),
    });
    const { context, send } = toolFixture();
    const result = await new AnalyzeImageTool().execute({ media_id: "123456789012345678" }, context);
    expect(result.error).toBe(localizedCopy(context.locale, "general.errors.api_key_error_description"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  test("does not attribute another request's nested denial to the current request or translate it again", async () => {
    providerFailure = new Error("nested request failed", { cause: denial(otherContext) });
    const translate = mock((_error: unknown, context: ProviderUsageContext) => denial(context));
    restores.push(registerProviderRequestDenialTranslator(translate));
    for (const usageContext of [firstContext, undefined]) {
      requestContext = usageContext;
      const result = await analyzeImageWithVisionModel({
        serverId: 1,
        image: { data: "aW1hZ2U=", mimeType: "image/png" },
        prompt: "fixture",
        cachedVisionLlm: model,
      });
      expect(result.ok).toBe(false);
      expect(result.requestDenied).toBeUndefined();
    }
    expect(translate).not.toHaveBeenCalled();
  });

  test("returns denial copy during user impersonation without posting a channel notice", async () => {
    providerFailure = denial(firstContext);
    const { context, send } = toolFixture();
    context.isUserImpersonation = true;
    const result = await new AnalyzeImageTool().execute({ media_id: "123456789012345678" }, context);
    expect(result.error).toBe(localizedCopy(context.locale, "general.errors.api_key_error_description"));
    expect(send).not.toHaveBeenCalled();
  });

  test("stream rendering preserves request context and chooses denial copy ahead of the provider's generic formatter", async () => {
    const { context, send } = toolFixture();
    const streamContext = buildStreamContext({
      ...context,
      contextItems: [],
      currentTurnModelParts: [],
      streamingContext: { disableYouTubeProcessing: false, usageContext: firstContext },
    });
    const genericDescription = mock(() => null);
    const provider = {
      createErrorDescription: genericDescription,
      getProviderInfo: () => ({ name: "openrouter" }),
    } as unknown as StreamProvider;
    const error = {
      type: "api_error",
      message: "fixture failure",
      retryable: false,
      originalError: new Error("wrapped", { cause: denial(firstContext) }),
    };
    await new StreamErrorUi().handleProviderError(error, provider, streamContext);
    expect(streamContext.usageContext).toBe(firstContext);
    expect(genericDescription).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].embeds?.[0].toJSON().description).toBe(
      localizedCopy(context.locale, "general.errors.api_key_error_description"),
    );
  });
});

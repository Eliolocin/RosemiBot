import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Client, ModalBuilder, TextChannel } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { ProviderError, StreamContext, StreamProvider } from "@/types/stream/interfaces";
import { StreamErrorUi } from "@/utils/discord/stream/errorUi";
import { localizedCopy } from "../../helpers/localeCases";
import { useEnvSandbox } from "../../helpers/env";
import { supporterIdentityRepository, supporterSponsorshipRepository } from "@/modules/supporter-billing/db";

type SendMock = ReturnType<typeof mock>;

function makeContext(
  send: SendMock,
  textCredentialSource: StreamContext["textCredentialSource"],
  fallbackChain: unknown[] = [],
  inGuild = true,
): StreamContext {
  return {
    channel: { id: "channel_1", send, ...(inGuild ? { guild: { id: "guild_1" } } : {}) } as unknown as TextChannel,
    client: {} as Client,
    tomoriState: {
      server_id: 1,
      llm: { llm_provider: "openrouter" },
      persona_nickname: "Tomori",
      trigger_words: [],
      config: {},
      fallback_chain: fallbackChain,
      fallback_llms: [],
    } as unknown as TomoriState,
    contextItems: [],
    currentTurnModelParts: [],
    provider: "openrouter",
    locale: "en-US",
    textCredentialSource,
  };
}

function makeProvider(name = "openrouter"): StreamProvider {
  return {
    async *startStream() {},
    processChunk() {
      return { type: "text", content: "" };
    },
    handleProviderError(error: unknown) {
      return {
        type: "api_error",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      };
    },
    createErrorDescription() {
      return "The provider rejected this request.";
    },
    getProviderInfo() {
      return { name, version: "test", supportsStreaming: true, supportsFunctionCalling: true };
    },
  } as unknown as StreamProvider;
}

async function renderTips(
  error: ProviderError,
  textCredentialSource: StreamContext["textCredentialSource"],
  options: { providerName?: string; fallbackChain?: unknown[]; userDiscId?: string; locale?: string } = {},
): Promise<string> {
  let modal: ReturnType<ModalBuilder["toJSON"]> | undefined;
  const tipClick = {
    customId: "error_tip_details",
    user: { bot: false },
    showModal: async (builtModal: ModalBuilder) => {
      modal = builtModal.toJSON();
    },
  };
  const makeCollector = (filter: (interaction: typeof tipClick) => boolean) => {
    const collector = {
      on(event: string, listener: (interaction: unknown) => Promise<void>) {
        if (event === "collect" && filter(tipClick)) void listener(tipClick);
        return collector;
      },
    };
    return collector;
  };
  const send = mock(async (_payload: unknown) => ({
    createMessageComponentCollector: (options: { filter: (interaction: typeof tipClick) => boolean }) =>
      makeCollector(options.filter),
  }));
  await new StreamErrorUi().handleProviderError(error, makeProvider(options.providerName), {
    ...makeContext(send, textCredentialSource, options.fallbackChain ?? []),
    triggererDiscId: options.userDiscId,
    locale: options.locale ?? "en-US",
  });
  await Promise.resolve();
  return (
    modal?.components
      ?.map((component) => ("content" in component ? component.content : ""))
      .filter(Boolean)
      .join("") ?? ""
  );
}

const RATE_LIMIT_ERROR: ProviderError = {
  type: "rate_limit",
  message: "HTTP 429: rate limit exceeded",
  code: "429",
  retryable: true,
};

describe("provider error subscription guidance", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);
  const spies: Array<{ mockRestore(): void }> = [];
  beforeEach(() => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    spies.push(
      spyOn(supporterIdentityRepository, "loadByDiscordUserId").mockResolvedValue(null),
      spyOn(supporterSponsorshipRepository, "loadActiveSponsorshipForServer").mockResolvedValue(null),
    );
  });
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it("adds localized guidance to BYOK reliability tips while retaining existing recovery actions", async () => {
    for (const locale of ["en-US", "ja"]) {
      for (const credentialSource of ["personal", "server"] as const) {
        const tips = await renderTips(RATE_LIMIT_ERROR, credentialSource, {
          userDiscId: "123456789012345678",
          locale,
        });
        expect(tips).toContain(localizedCopy(locale, "commands.subscribe.conversion_nudge"));
        expect(tips).toContain(
          localizedCopy(
            locale,
            credentialSource === "personal" ? "genai.tips.model_fallback_personal" : "genai.tips.model_fallback",
          ),
        );
      }
    }
  });

  it("does not promote subscriptions for the same OpenRouter transport when the member key paid", async () => {
    const tips = await renderTips(RATE_LIMIT_ERROR, "supporter", { userDiscId: "123456789012345678" });
    expect(tips).not.toContain(localizedCopy("en-US", "commands.subscribe.conversion_nudge"));
  });

  it("keeps subscription guidance and recovery actions in repeated error modals", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tips = await renderTips(RATE_LIMIT_ERROR, "server", { userDiscId: "123456789012345678" });
      expect(tips).toContain(localizedCopy("en-US", "commands.subscribe.conversion_nudge"));
      expect(tips).toContain(localizedCopy("en-US", "genai.tips.model_fallback"));
    }
  });
});

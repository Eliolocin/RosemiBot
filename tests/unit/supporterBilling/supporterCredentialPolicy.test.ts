import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";
import { describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { PersonalProviderRequiredError, type ResolvedCredentials } from "@/utils/provider/credentialResolver";
import { resolveTextCredentialPolicy, type TextCredentialPolicyDependencies } from "@/utils/chat/turnPlanner";
import type { SupporterFundingContext } from "@/modules/supporter-billing";

function makeTomoriState(overrides: Partial<TomoriState> = {}): TomoriState {
  return createPersona({
    server_id: 50,
    persona_id: 60,
    persona_nickname: "Tomori",
    config: {
      user_byok_mode: false,
    },
    llm: createLlmRow({ llm_provider: "user-byok", llm_codename: "None" }),
    ...overrides,
  });
}

function makeUserRow(overrides: Partial<UserRow> = {}): UserRow {
  return createUserRow({
    user_id: 70,
    user_disc_id: "user_disc_1",
    user_nickname: "User",
    language_pref: "en-US",
    registration_locale: "en-US",
    ...overrides,
  });
}

function makeResolvedCredentials(source: "server" | "personal"): ResolvedCredentials {
  return {
    provider: source === "personal" ? "openrouter" : "google",
    apiKey: "test-key",
    keyVersion: 1,
    savedConfig: null,
    source,
  };
}

function makeSupporterContext(): SupporterFundingContext {
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
  };
}

function makeBaseParams(dependencies: Partial<TextCredentialPolicyDependencies>) {
  const message = {
    id: "message_1",
    channelId: "channel_1",
    content: "hello",
    channel: { id: "channel_1" },
  } as Message;

  return {
    tomoriState: makeTomoriState(),
    isSelfMessage: false,
    isPersonaJob: false,
    isManuallyTriggered: true,
    isUserImpersonation: false,
    borrowsTriggerMessage: false,
    userRow: makeUserRow(),
    message,
    serverDiscId: "guild_1",
    userDiscId: "user_disc_1",
    channel: message.channel,
    locale: "en-US",
    isDMChannel: false,
    shouldSurfaceUserErrors: true,
    retryCount: 0,
    dependencies: {
      resolveServerTextModel: async (state: TomoriState) => state.persona_llm ?? state.llm,
      ...dependencies,
    },
  };
}

describe("supporter-aware text credential policy", () => {
  it("admits an explicitly selected personal subscription in a DM without resolving server credentials", async () => {
    const context: SupporterFundingContext = {
      ...makeSupporterContext(),
      fundingScope: "personal",
      personalUserId: 70,
      sponsorshipId: null,
      serverId: null,
    };
    const credentials = { ...makeResolvedCredentials("personal"), supporterFunding: context };
    let scope: unknown;
    const params = makeBaseParams({
      resolvePersonalCapabilityCredentials: async () => credentials,
      resolveSupporterFunding: async (input) => {
        scope = input.scope;
        return { ok: true, context };
      },
      resolveCapabilityCredentials: async () => {
        throw new Error("Unexpected server credential resolution");
      },
    });
    const result = await resolveTextCredentialPolicy({ ...params, isDMChannel: true });
    expect(result?.source).toBe("supporter");
    expect(result?.supporterFunding?.fundingScope).toBe("personal");
    expect(scope).toBeUndefined();
  });
  it("uses valid personal text credentials before Supporter admission", async () => {
    let supporterCalled = false;
    let serverCalled = false;

    const result = await resolveTextCredentialPolicy(
      makeBaseParams({
        resolvePersonalCapabilityCredentials: async () => makeResolvedCredentials("personal"),
        resolveSupporterFunding: async () => {
          supporterCalled = true;
          return { ok: false, reason: "missing_sponsorship" };
        },
        resolveCapabilityCredentials: async () => {
          serverCalled = true;
          return makeResolvedCredentials("server");
        },
      }),
    );

    expect(result).toMatchObject({
      source: "personal",
      personalTextProvider: "openrouter",
      supporterFunding: null,
    });
    expect(supporterCalled).toBe(false);
    expect(serverCalled).toBe(false);
  });

  it("falls back to the existing server credential path when no sponsorship applies", async () => {
    const result = await resolveTextCredentialPolicy(
      makeBaseParams({
        resolvePersonalCapabilityCredentials: async () => null,
        resolveSupporterFunding: async () => ({ ok: false, reason: "missing_sponsorship" }),
        resolveCapabilityCredentials: async () => makeResolvedCredentials("server"),
      }),
    );

    expect(result).toMatchObject({
      source: "server",
      personalTextProvider: null,
      supporterFunding: null,
    });
  });

  it("preserves BYOK personal-provider-required behavior when Supporter does not apply", async () => {
    const result = await resolveTextCredentialPolicy(
      makeBaseParams({
        resolvePersonalCapabilityCredentials: async () => null,
        resolveSupporterFunding: async () => ({ ok: false, reason: "missing_sponsorship" }),
        resolveCapabilityCredentials: async () => {
          throw new PersonalProviderRequiredError("text");
        },
        sendStandardEmbed: async () => undefined,
      }),
    );

    expect(result).toBeNull();
  });

  it("uses subscription funding only when credential resolution selects that entry", async () => {
    let serverCalled = false;
    const supporterContext = makeSupporterContext();

    const result = await resolveTextCredentialPolicy(
      makeBaseParams({
        resolvePersonalCapabilityCredentials: async () => null,
        resolveSupporterFunding: async () => ({
          ok: true,
          context: supporterContext,
        }),
        resolveCapabilityCredentials: async () => {
          serverCalled = true;
          return { ...makeResolvedCredentials("server"), supporterFunding: supporterContext };
        },
      }),
    );

    expect(result).toMatchObject({
      source: "supporter",
      supporterFunding: supporterContext,
    });
    expect(serverCalled).toBe(true);
  });

  it("surfaces an unavailable selected server subscription without borrowing BYOK credentials", async () => {
    let embedCount = 0;
    let serverCalled = false;

    const result = await resolveTextCredentialPolicy(
      makeBaseParams({
        resolvePersonalCapabilityCredentials: async () => null,
        resolveSupporterFunding: async () => ({ ok: false, reason: "inactive_entitlement" }),
        resolveCapabilityCredentials: async () => {
          serverCalled = true;
          throw new SupporterRequestDeniedError("inactive_entitlement");
        },
        sendStandardEmbed: async () => {
          embedCount++;
        },
      }),
    );

    expect(result).toBeNull();
    expect(embedCount).toBe(1);
    expect(serverCalled).toBe(true);
  });
  it("keeps an inactive personal subscription route for its personal fallback pool", async () => {
    let serverCalled = false;
    const result = await resolveTextCredentialPolicy(
      makeBaseParams({
        resolvePersonalCapabilityCredentials: async () => {
          throw new SupporterRequestDeniedError("inactive_entitlement", undefined, "text", "personal");
        },
        resolveCapabilityCredentials: async () => {
          serverCalled = true;
          return makeResolvedCredentials("server");
        },
      }),
    );
    expect(result).toMatchObject({ source: "personal", personalTextProvider: "supporter", personalRoutingUserId: 70 });
    expect(serverCalled).toBe(false);
  });

  it("passes the effective persona model to credential admission without sponsorship substitution", async () => {
    const model = createLlmRow({ llm_id: 2, llm_provider: "google", llm_codename: "synthetic-override" });
    let admittedModel: unknown;
    let supporterCalled = false;
    const params = makeBaseParams({
      resolvePersonalCapabilityCredentials: async () => null,
      resolveServerTextModel: async () => model,
      resolveCapabilityCredentials: async (_serverId, _capability, options) => {
        admittedModel = options?.textModel;
        return makeResolvedCredentials("server");
      },
      resolveSupporterFunding: async () => {
        supporterCalled = true;
        return { ok: true, context: makeSupporterContext() };
      },
    });
    expect((await resolveTextCredentialPolicy(params))?.source).toBe("server");
    expect(admittedModel).toBe(model);
    expect(supporterCalled).toBe(false);
  });
});

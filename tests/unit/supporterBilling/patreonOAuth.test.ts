import type { OAuthStateRow } from "@/utils/db/repositories/OAuthStateRepository";
import { beforeAll, describe, expect, it } from "bun:test";
import { clearHealthServerRoutesForTests, isHealthServerRouteRegistered } from "@/init/healthServer";
import {
  initializeSupporterBilling,
  type SupporterBillingConfig,
  type SupporterEntitlementRow,
  type SupporterIdentityRow,
} from "@/modules/supporter-billing";
import { handlePatreonOAuthCallbackUrl } from "@/modules/supporter-billing/patreon/callback";
import { mapPatreonIdentityToEligibleSupporter } from "@/modules/supporter-billing/patreon/mapping";
import {
  buildPatreonOAuthAuthorizationUrl,
  createPatreonOAuthUrlForDiscordUser,
} from "@/modules/supporter-billing/patreon/oauth";
import {
  createAndPersistOAuthState,
  createSignedOAuthState,
  hashOAuthNonce,
  type OAuthStateNonceRepository,
  validateAndConsumeOAuthState,
  validateSignedOAuthState,
} from "@/utils/oauth/state";
import { persistEligiblePatreonSupporter } from "@/modules/supporter-billing/patreon/persistence";
import { initializePatreonRoutes } from "@/modules/supporter-billing/patreon/routes";
import { PATREON_OAUTH_CALLBACK_PATH, PATREON_WEBHOOK_PATH } from "@/modules/supporter-billing/patreon/settings";
import { initializeLocalizer } from "@/utils/text/localizer";
import { patreonTokenTransport } from "@/modules/supporter-billing/patreon/tokenTransport";
import { OAuthTokenError, requestOAuthToken } from "@/utils/oauth/tokenEndpoint";

const now = new Date("2026-01-15T00:00:00.000Z");
const signerSecret = "test_signer_secret";

beforeAll(async () => {
  await initializeLocalizer();
});

it("persists Patreon body backoff through the shared token error contract", async () => {
  for (const retryAfter of [undefined, "180"]) {
    const started = Date.now();
    let failure: unknown;
    try {
      await requestOAuthToken({
        endpoint: "https://www.patreon.com/api/oauth2/token",
        allowedOrigins: ["https://www.patreon.com"],
        authentication: { method: "none", clientId: "fixture-client" },
        parameters: new URLSearchParams({ grant_type: "refresh_token" }),
        fetchImpl: patreonTokenTransport(async () =>
          Response.json(
            { errors: [{ retry_after_seconds: 120 }] },
            { status: 429, headers: retryAfter ? { "Retry-After": retryAfter } : undefined },
          ),
        ),
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(OAuthTokenError);
    expect((failure as OAuthTokenError).disposition).toBe("retry");
    expect((failure as OAuthTokenError).retryAt.getTime()).toBeGreaterThanOrEqual(
      started + (retryAfter ? 180_000 : 120_000),
    );
  }
});

const validSupporterConfig: SupporterBillingConfig = {
  patreon: {
    campaignId: "campaign_test",
    oauthClientIdEnv: "TOMORI_SUPPORTER_PATREON_CLIENT_ID",
    oauthClientSecretEnv: "TOMORI_SUPPORTER_PATREON_CLIENT_SECRET",
    webhookSecretEnv: "TOMORI_SUPPORTER_PATREON_WEBHOOK_SECRET",
    creatorRefreshTokenEnv: "TOMORI_SUPPORTER_PATREON_CREATOR_REFRESH_TOKEN",
    manageUrl: "https://www.patreon.com/test",
  },
  jobs: {
    reconcileIntervalSeconds: 300,
    manualRefreshCooldownSeconds: 30,
  },
  tiers: {
    test_tier: {
      displayNameKey: "supporter.tiers.test",
      patreonTierIds: ["tier_test"],
      monthlyBudgetMicros: 100000,
      defaultModelByCapability: { text: "test/provider-model" },
    },
  },
};

function createEnabledEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    TOMORI_PUBLIC_BASE_URL: "https://bot.example.test",
    TOMORI_SUPPORTER_BILLING_ENABLED: "true",
    TOMORI_SUPPORTER_CONFIG_JSON: JSON.stringify(validSupporterConfig),
    TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY: "synthetic-management-key",
    TOMORI_SUPPORTER_PATREON_CLIENT_ID: "test-patreon-client-id",
    TOMORI_SUPPORTER_PATREON_CLIENT_SECRET: signerSecret,
    TOMORI_SUPPORTER_PATREON_WEBHOOK_SECRET: "test-patreon-webhook-secret",
    TOMORI_SUPPORTER_PATREON_CREATOR_REFRESH_TOKEN: "test-patreon-creator-access-token",
    ...overrides,
  };
}

class MemoryOAuthStateRepository implements OAuthStateNonceRepository {
  public readonly rows = new Map<string, OAuthStateRow>();
  private nextId = 1;

  async recordStateNonce(params: {
    nonceHash: string;
    flow: string;
    subject: string;
    expiresAt: Date;
    createdAt?: Date;
  }): Promise<OAuthStateRow> {
    const row: OAuthStateRow = {
      oauth_state_id: this.nextId,
      nonce_hash: params.nonceHash,
      flow: params.flow,
      subject: params.subject,
      expires_at: params.expiresAt,
      consumed_at: null,
      created_at: params.createdAt ?? now,
    };
    this.nextId += 1;
    this.rows.set(params.nonceHash, row);
    return row;
  }

  async consumeStateNonce(params: {
    nonceHash: string;
    flow: string;
    subject: string;
    consumedAt?: Date;
  }): Promise<OAuthStateRow | null> {
    const consumedAt = params.consumedAt ?? now;
    const row = this.rows.get(params.nonceHash);
    if (!row || row.subject !== params.subject || row.consumed_at || row.expires_at.getTime() <= consumedAt.getTime()) {
      return null;
    }

    const consumedRow = {
      ...row,
      consumed_at: consumedAt,
    };
    this.rows.set(params.nonceHash, consumedRow);
    return consumedRow;
  }
}

function makePatreonIdentityResponse(
  overrides: {
    campaignId?: string;
    patronStatus?: string | null;
    tierIds?: string[];
    lastChargeDate?: string | null;
    lastChargeStatus?: string | null;
    nextChargeDate?: string | null;
    includeMembership?: boolean;
  } = {},
): unknown {
  const tierIds = overrides.tierIds ?? ["tier_test"];
  const memberAttributes: Record<string, string | null> = {
    patron_status: overrides.patronStatus === undefined ? "active_patron" : overrides.patronStatus,
    last_charge_date: overrides.lastChargeDate === undefined ? "2026-01-01T00:00:00.000Z" : overrides.lastChargeDate,
    last_charge_status: overrides.lastChargeStatus ?? null,
    next_charge_date: overrides.nextChargeDate === undefined ? "2026-02-01T00:00:00.000Z" : overrides.nextChargeDate,
  };

  return {
    data: {
      id: "patreon_user_test",
      type: "user",
      relationships: {
        memberships:
          overrides.includeMembership === false ? { data: [] } : { data: [{ id: "member_test", type: "member" }] },
      },
    },
    included:
      overrides.includeMembership === false
        ? []
        : [
            {
              id: "member_test",
              type: "member",
              attributes: memberAttributes,
              relationships: {
                campaign: {
                  data: {
                    id: overrides.campaignId ?? "campaign_test",
                    type: "campaign",
                  },
                },
                currently_entitled_tiers: {
                  data: tierIds.map((tierId) => ({ id: tierId, type: "tier" })),
                },
              },
            },
            {
              id: overrides.campaignId ?? "campaign_test",
              type: "campaign",
              attributes: {
                creation_name: "Test Campaign",
              },
            },
            ...tierIds.map((tierId) => ({
              id: tierId,
              type: "tier",
              attributes: {
                title: `Tier ${tierId}`,
              },
            })),
          ],
  };
}

describe("Patreon OAuth state", () => {
  it("signs state, enforces expiry, and rejects replay", async () => {
    const repository = new MemoryOAuthStateRepository();
    const createdState = await createAndPersistOAuthState({
      flow: "patreon",
      subject: "discord_user_1",
      signerSecret,
      ttlSeconds: 60,
      now,
      nonce: "nonce_for_signed_state_test_123456",
      stateRepository: repository,
    });

    const validation = validateSignedOAuthState(createdState.state, signerSecret, now);
    expect(validation.valid).toBe(true);

    const consumed = await validateAndConsumeOAuthState(createdState.state, signerSecret, repository, now);
    expect(consumed.valid).toBe(true);

    const replay = await validateAndConsumeOAuthState(createdState.state, signerSecret, repository, now);
    expect(replay).toEqual({ valid: false, reason: "replay" });

    const expired = validateSignedOAuthState(createdState.state, signerSecret, new Date(now.getTime() + 61_000));
    expect(expired).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects invalid signatures and state rows tied to another Discord user", async () => {
    const repository = new MemoryOAuthStateRepository();
    const createdState = createSignedOAuthState({
      flow: "patreon",
      subject: "discord_user_1",
      signerSecret,
      ttlSeconds: 60,
      now,
      nonce: "nonce_for_mismatched_user_state_123456",
    });
    await repository.recordStateNonce({
      nonceHash: hashOAuthNonce(createdState.payload.nonce),
      flow: "patreon",
      subject: "discord_user_2",
      expiresAt: new Date(createdState.payload.expiresAt),
      createdAt: now,
    });

    const [payloadPart] = createdState.state.split(".");
    expect(validateSignedOAuthState(`${payloadPart}.bad-signature`, signerSecret, now)).toEqual({
      valid: false,
      reason: "invalid_signature",
    });

    const mismatchedState = await validateAndConsumeOAuthState(createdState.state, signerSecret, repository, now);
    expect(mismatchedState).toEqual({ valid: false, reason: "replay" });
  });
});

describe("Patreon OAuth URL generation", () => {
  it("builds an authorization URL with configured credentials, callback URL, scopes, and state", async () => {
    const repository = new MemoryOAuthStateRepository();
    const oauthUrl = await createPatreonOAuthUrlForDiscordUser("discord_user_1", {
      config: validSupporterConfig,
      env: createEnabledEnv({ TOMORI_SUPPORTER_OAUTH_STATE_TTL_SECONDS: "120" }),
      stateRepository: repository,
      locale: "ja",
      now,
    });
    const parsedUrl = new URL(oauthUrl);

    expect(parsedUrl.origin).toBe("https://www.patreon.com");
    expect(parsedUrl.pathname).toBe("/oauth2/authorize");
    expect(parsedUrl.searchParams.get("client_id")).toBe("test-patreon-client-id");
    expect(parsedUrl.searchParams.get("redirect_uri")).toBe("https://bot.example.test/oauth/callback");
    expect(parsedUrl.searchParams.get("scope")).toBe("identity identity.memberships");
    const state = parsedUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    const validation = validateSignedOAuthState(state ?? "", signerSecret, now);
    expect(validation.valid).toBe(true);
    if (validation.valid) {
      expect(validation.payload.locale).toBe("ja");
    }
    expect(repository.rows.size).toBe(1);
  });

  it("keeps the pure URL builder deterministic for tests", () => {
    const oauthUrl = buildPatreonOAuthAuthorizationUrl({
      clientId: "client_from_config_env",
      state: "state_123",
    });

    expect(new URL(oauthUrl).searchParams.get("client_id")).toBe("client_from_config_env");
    expect(new URL(oauthUrl).searchParams.get("state")).toBe("state_123");
  });
});

describe("Patreon membership mapping", () => {
  it("admits only successful charge receipts for renewal and rejects failed or refunded entitlement", () => {
    for (const status of ["Paid", null, "Declined", "Refunded", "Pending"]) {
      const result = mapPatreonIdentityToEligibleSupporter({
        discordUserId: "discord_user_1",
        config: validSupporterConfig,
        identityResponse: makePatreonIdentityResponse({ lastChargeStatus: status }),
        now,
        fallbackHours: 24,
      });
      expect(result.eligible).toBe(status === "Paid" || status === null);
      if (result.eligible) {
        expect(result.snapshot.lastSuccessfulChargeAt).toEqual(status === "Paid" ? new Date("2026-01-01") : null);
        expect(result.snapshot.nextChargeAt).toEqual(new Date("2026-02-01"));
      }
    }
    const fallback = mapPatreonIdentityToEligibleSupporter({
      discordUserId: "discord_user_1",
      config: validSupporterConfig,
      identityResponse: makePatreonIdentityResponse({
        lastChargeStatus: "Paid",
        lastChargeDate: "2026-02-01",
        nextChargeDate: null,
      }),
      now,
      fallbackHours: 24,
    });
    expect(fallback.eligible).toBe(true);
    if (fallback.eligible) {
      expect(fallback.snapshot.lastSuccessfulChargeAt).toBeNull();
      expect(fallback.snapshot.nextChargeAt).toBeNull();
    }
  });

  it("maps active configured membership to an eligible supporter snapshot", () => {
    const result = mapPatreonIdentityToEligibleSupporter({
      discordUserId: "discord_user_1",
      config: validSupporterConfig,
      identityResponse: makePatreonIdentityResponse(),
      now,
      fallbackHours: 24,
    });

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.snapshot).toMatchObject({
        discordUserId: "discord_user_1",
        patreonUserId: "patreon_user_test",
        patreonMemberId: "member_test",
        patreonCampaignId: "campaign_test",
        tierKey: "test_tier",
        patreonTierId: "tier_test",
        patronStatus: "active_patron",
        periodDateSource: "patreon",
      });
      expect(result.snapshot.periodStart.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(result.snapshot.periodEnd.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    }
  });

  it("rejects wrong-campaign, inactive, unlinked, and unconfigured-tier memberships", () => {
    expect(
      mapPatreonIdentityToEligibleSupporter({
        discordUserId: "discord_user_1",
        config: validSupporterConfig,
        identityResponse: makePatreonIdentityResponse({ campaignId: "campaign_other" }),
        now,
        fallbackHours: 24,
      }),
    ).toEqual({ eligible: false, reason: "wrong_campaign" });
    expect(
      mapPatreonIdentityToEligibleSupporter({
        discordUserId: "discord_user_1",
        config: validSupporterConfig,
        identityResponse: makePatreonIdentityResponse({ patronStatus: "declined_patron" }),
        now,
        fallbackHours: 24,
      }),
    ).toEqual({ eligible: false, reason: "inactive" });
    expect(
      mapPatreonIdentityToEligibleSupporter({
        discordUserId: "discord_user_1",
        config: validSupporterConfig,
        identityResponse: makePatreonIdentityResponse({ includeMembership: false }),
        now,
        fallbackHours: 24,
      }),
    ).toEqual({ eligible: false, reason: "unlinked_membership" });
    expect(
      mapPatreonIdentityToEligibleSupporter({
        discordUserId: "discord_user_1",
        config: validSupporterConfig,
        identityResponse: makePatreonIdentityResponse({ tierIds: ["unknown_tier"] }),
        now,
        fallbackHours: 24,
      }),
    ).toEqual({ eligible: false, reason: "unconfigured_tier" });
  });

  it("uses a conservative fallback usage period when Patreon omits renewal dates", () => {
    const result = mapPatreonIdentityToEligibleSupporter({
      discordUserId: "discord_user_1",
      config: validSupporterConfig,
      identityResponse: makePatreonIdentityResponse({
        lastChargeDate: null,
        nextChargeDate: null,
      }),
      now,
      fallbackHours: 24,
    });

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.snapshot.periodDateSource).toBe("fallback");
      expect(result.snapshot.periodStart.toISOString()).toBe(now.toISOString());
      expect(result.snapshot.periodEnd.toISOString()).toBe(new Date(now.getTime() + 86_400_000).toISOString());
    }
  });
});

describe("Patreon OAuth callback", () => {
  it("validates state, fetches Patreon identity, persists entitlement", async () => {
    const repository = new MemoryOAuthStateRepository();
    const createdState = await createAndPersistOAuthState({
      flow: "patreon",
      subject: "discord_user_1",
      signerSecret,
      ttlSeconds: 60,
      locale: "ja",
      now,
      nonce: "nonce_for_callback_success_state_123456",
      stateRepository: repository,
    });
    const captured: {
      exchangedCode?: string;
      fetchedToken?: string;
      persistedOptions?: Parameters<
        NonNullable<Parameters<typeof handlePatreonOAuthCallbackUrl>[1]["persistSupporter"]>
      >[0];
    } = {};

    const response = await handlePatreonOAuthCallbackUrl(
      new URL(`https://bot.example.test/oauth/callback?code=oauth_code&state=${createdState.state}`),
      {
        config: validSupporterConfig,
        env: createEnabledEnv(),
        stateRepository: repository,
        now,
        fallbackHours: 24,
        exchangeCodeForToken: async (code) => {
          captured.exchangedCode = code;
          return {
            accessToken: "patreon_access_token",
            tokenType: "Bearer",
            expiresIn: 3600,
            scope: "identity identity.memberships",
          };
        },
        fetchIdentity: async (accessToken) => {
          captured.fetchedToken = accessToken;
          return makePatreonIdentityResponse();
        },
        persistSupporter: async (options) => {
          captured.persistedOptions = options;
          return {
            identity: { supporter_identity_id: 1 } as SupporterIdentityRow,
            entitlement: { supporter_entitlement_id: 2 } as SupporterEntitlementRow,
          };
        },
      },
    );

    expect(response.status).toBe("success");
    expect(response.body).toContain("Patreonリンクが完了しました");
    expect(captured.exchangedCode).toBe("oauth_code");
    expect(captured.fetchedToken).toBe("patreon_access_token");
    expect(captured.persistedOptions?.snapshot.tierKey).toBe("test_tier");
    expect(captured.persistedOptions?.snapshot.discordUserId).toBe("discord_user_1");

    const replayResponse = await handlePatreonOAuthCallbackUrl(
      new URL(`https://bot.example.test/oauth/callback?code=oauth_code&state=${createdState.state}`),
      {
        config: validSupporterConfig,
        env: createEnabledEnv(),
        stateRepository: repository,
        now,
      },
    );
    expect(replayResponse.status).toBe("state_replay");
  });

  it("fails closed before side effects for invalid state and rejects wrong-campaign membership", async () => {
    const repository = new MemoryOAuthStateRepository();
    const createdState = await createAndPersistOAuthState({
      flow: "patreon",
      subject: "discord_user_1",
      signerSecret,
      ttlSeconds: 60,
      now,
      nonce: "nonce_for_callback_rejection_state_123456",
      stateRepository: repository,
    });
    const [payloadPart] = createdState.state.split(".");
    let exchangeCount = 0;
    let persistCount = 0;

    const invalidStateResponse = await handlePatreonOAuthCallbackUrl(
      new URL(`https://bot.example.test/oauth/callback?code=oauth_code&state=${payloadPart}.bad`),
      {
        config: validSupporterConfig,
        env: createEnabledEnv(),
        stateRepository: repository,
        now,
        exchangeCodeForToken: async () => {
          exchangeCount += 1;
          throw new Error("should not exchange");
        },
      },
    );

    expect(invalidStateResponse.status).toBe("invalid_state");
    expect(exchangeCount).toBe(0);

    const wrongCampaignResponse = await handlePatreonOAuthCallbackUrl(
      new URL(`https://bot.example.test/oauth/callback?code=oauth_code&state=${createdState.state}`),
      {
        config: validSupporterConfig,
        env: createEnabledEnv(),
        stateRepository: repository,
        now,
        exchangeCodeForToken: async () => ({
          accessToken: "patreon_access_token",
          tokenType: "Bearer",
          expiresIn: 3600,
          scope: "identity identity.memberships",
        }),
        fetchIdentity: async () => makePatreonIdentityResponse({ campaignId: "campaign_other" }),
        persistSupporter: async () => {
          persistCount += 1;
          throw new Error("should not persist");
        },
      },
    );

    expect(wrongCampaignResponse.status).toBe("wrong_campaign");
    expect(persistCount).toBe(0);
  });
});

describe("Patreon entitlement persistence", () => {
  it("writes identity and entitlement with membership dates", async () => {
    const identityParams: unknown[] = [];
    const entitlementParams: unknown[] = [];

    const result = await persistEligiblePatreonSupporter({
      config: validSupporterConfig,
      verifiedAt: now,
      snapshot: {
        discordUserId: "discord_user_1",
        patreonUserId: "patreon_user_test",
        patreonMemberId: "member_test",
        patreonCampaignId: "campaign_test",
        tierKey: "test_tier",
        patreonTierId: "tier_test",
        patronStatus: "active_patron",
        periodStart: new Date("2026-01-01T00:00:00.000Z"),
        periodEnd: new Date("2026-02-01T00:00:00.000Z"),
        periodDateSource: "patreon",
        lastSuccessfulChargeAt: null,
        nextChargeAt: new Date("2026-02-01T00:00:00.000Z"),
      },
      repositories: {
        identityRepository: {
          upsertIdentity: async (params) => {
            identityParams.push(params);
            return {
              supporter_identity_id: 10,
              discord_user_id: params.discordUserId,
              patreon_user_id: params.patreonUserId,
              patreon_member_id: params.patreonMemberId,
              patreon_campaign_id: params.patreonCampaignId,
              linked_at: now,
              last_oauth_at: now,
              created_at: now,
              updated_at: now,
            };
          },
        },
        entitlementRepository: {
          loadByIdentityId: async () => null,
          upsertSnapshot: async (params) => {
            entitlementParams.push(params);
            return {
              supporter_entitlement_id: 20,
              supporter_identity_id: params.supporterIdentityId,
              tier_key: params.tierKey,
              patreon_tier_id: params.patreonTierId,
              patron_status: params.patronStatus,
              is_active: params.isActive,
              cancel_at_period_end: params.cancelAtPeriodEnd ?? false,
              period_start: params.periodStart,
              period_end: params.periodEnd,
              last_verified_at: params.lastVerifiedAt,
              last_successful_charge_at: null,
              next_charge_at: null,
              source: params.source,
              created_at: now,
              updated_at: now,
            };
          },
        },
      },
    });

    expect(result.identity.supporter_identity_id).toBe(10);
    expect(identityParams).toHaveLength(1);
    expect(entitlementParams).toMatchObject([
      {
        supporterIdentityId: 10,
        tierKey: "test_tier",
        patreonTierId: "tier_test",
        isActive: true,
        source: "oauth",
      },
    ]);
  });
});

describe("Patreon route gating", () => {
  it("registers the callback route only through the enabled billing startup path", async () => {
    clearHealthServerRoutesForTests();

    const disabledResult = await initializeSupporterBilling({
      environment: "production",
      env: createEnabledEnv({ TOMORI_SUPPORTER_BILLING_ENABLED: "false" }),
      initializeBillingSchema: async () => ({ initializedTables: [] }),
      startPatreonReconcileJob: () => ({ stop: () => undefined }),
    });

    expect(disabledResult.enabled).toBe(false);
    expect(isHealthServerRouteRegistered("GET", PATREON_OAUTH_CALLBACK_PATH)).toBe(false);
    expect(isHealthServerRouteRegistered("POST", PATREON_WEBHOOK_PATH)).toBe(false);

    initializePatreonRoutes({ config: validSupporterConfig, env: createEnabledEnv() });
    expect(isHealthServerRouteRegistered("GET", PATREON_OAUTH_CALLBACK_PATH)).toBe(true);
    expect(isHealthServerRouteRegistered("POST", PATREON_WEBHOOK_PATH)).toBe(true);
    clearHealthServerRoutesForTests();
  });
});

import { describe, expect, it } from "bun:test";
import {
  resolveSupporterFunding,
  type SupporterBillingConfig,
  type SupporterEntitlementRow,
  type SupporterIdentityRow,
  type SupporterServerSponsorshipRow,
  type SupporterFundingRepositories,
} from "@/modules/supporter-billing";

const now = new Date("2026-01-15T00:00:00.000Z");
const enabledEnv = { TOMORI_SUPPORTER_BILLING_ENABLED: "true" };

const config: SupporterBillingConfig = {
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
      defaultModelByCapability: { text: "openrouter/allowed-model" },
    },
  },
};

function makeIdentity(overrides: Partial<SupporterIdentityRow> = {}): SupporterIdentityRow {
  return {
    supporter_identity_id: 10,
    discord_user_id: "sponsor_discord_1",
    patreon_user_id: "patreon_user_1",
    patreon_member_id: "patreon_member_1",
    patreon_campaign_id: "campaign_test",
    linked_at: now,
    last_oauth_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeEntitlement(overrides: Partial<SupporterEntitlementRow> = {}): SupporterEntitlementRow {
  return {
    supporter_entitlement_id: 20,
    supporter_identity_id: 10,
    tier_key: "test_tier",
    patreon_tier_id: "tier_test",
    patron_status: "active_patron",
    is_active: true,
    cancel_at_period_end: false,
    period_start: new Date("2026-01-01T00:00:00.000Z"),
    period_end: new Date("2026-02-01T00:00:00.000Z"),
    last_verified_at: now,
    last_successful_charge_at: null,
    next_charge_at: null,
    source: "oauth",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeSponsorship(overrides: Partial<SupporterServerSponsorshipRow> = {}): SupporterServerSponsorshipRow {
  return {
    sponsorship_id: 40,
    server_id: 50,
    server_disc_id: "guild_1",
    sponsor_identity_id: 10,
    status: "active",
    created_by_disc_id: "sponsor_discord_1",
    created_at: now,
    revoked_at: null,
    updated_at: now,
    ...overrides,
  };
}

function makeRepositories(params: {
  identity?: SupporterIdentityRow | null;
  entitlement?: SupporterEntitlementRow | null;
  sponsorship?: SupporterServerSponsorshipRow | null;
}): SupporterFundingRepositories {
  return {
    identityRepository: {
      loadById: async () => params.identity ?? null,
      loadByUserId: async () => params.identity ?? null,
    },
    entitlementRepository: {
      loadByIdentityId: async () => params.entitlement ?? null,
    },
    sponsorshipRepository: {
      loadActiveSponsorshipForServer: async () => params.sponsorship ?? null,
    },
  };
}

function resolveFunding(
  repositories: SupporterFundingRepositories,
  overrides: Partial<Parameters<typeof resolveSupporterFunding>[0]> = {},
) {
  return resolveSupporterFunding({
    scope: { kind: "server", serverId: 50 },
    capability: "text",
    environment: "production",
    env: enabledEnv,
    config,
    repositories,
    at: now,
    ...overrides,
  });
}

describe("supporter funding resolution", () => {
  it("funds registered non-default voice models and resolves a design-only default", async () => {
    const configured = structuredClone(config);
    configured.tiers.test_tier.defaultModelByCapability.voice = { design: "bytedance-seed/seed-audio-1-0" };
    const repositories = makeRepositories({
      identity: makeIdentity(),
      entitlement: makeEntitlement(),
      sponsorship: makeSponsorship(),
    });
    for (const requestedModelCodename of [undefined, "fish-audio/s2.1-pro"])
      expect(
        await resolveFunding(repositories, { config: configured, capability: "voice", requestedModelCodename }),
      ).toMatchObject({
        ok: true,
        context: { modelCodename: requestedModelCodename ?? "bytedance-seed/seed-audio-1-0" },
      });
  });
  it("validates feature/config state and missing sponsorships before funding resolution", async () => {
    await expect(
      resolveFunding(makeRepositories({ sponsorship: makeSponsorship() }), {
        env: { TOMORI_SUPPORTER_BILLING_ENABLED: "false" },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "billing_unavailable" });

    await expect(
      resolveFunding(makeRepositories({ sponsorship: makeSponsorship() }), {
        config: undefined,
        env: { TOMORI_SUPPORTER_BILLING_ENABLED: "true" },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "billing_unavailable" });

    await expect(
      resolveFunding(
        makeRepositories({
          sponsorship: null,
        }),
      ),
    ).resolves.toMatchObject({ ok: false, reason: "missing_sponsorship" });
  });

  it("fails closed for inactive and unconfigured sponsor state", async () => {
    await expect(
      resolveFunding(
        makeRepositories({
          sponsorship: makeSponsorship(),
          identity: makeIdentity(),
          entitlement: makeEntitlement({ is_active: false }),
        }),
      ),
    ).resolves.toMatchObject({ ok: false, reason: "inactive_entitlement" });

    await expect(
      resolveFunding(
        makeRepositories({
          sponsorship: makeSponsorship(),
          identity: makeIdentity(),
          entitlement: makeEntitlement({ tier_key: "missing_tier" }),
        }),
      ),
    ).resolves.toMatchObject({ ok: false, reason: "unconfigured_tier" });
  });

  it("checks entitlement dates without consulting local accounting", async () => {
    for (const [changes, ok] of [
      [{ period_start: now }, true],
      [{ period_start: new Date(now.getTime() + 1) }, false],
      [{ period_end: now }, false],
      [{ period_end: new Date(now.getTime() + 1) }, true],
      [{ period_start: null, period_end: null }, true],
    ] as const) {
      const result = await resolveFunding(
        makeRepositories({
          sponsorship: makeSponsorship(),
          identity: makeIdentity(),
          entitlement: makeEntitlement(changes),
        }),
      );
      expect(result.ok).toBe(ok);
      if (!result.ok) expect(result.reason).toBe("inactive_entitlement");
    }
  });

  it("permits model selection without a tier allowlist", async () => {
    await expect(
      resolveFunding(
        makeRepositories({
          sponsorship: makeSponsorship(),
          identity: makeIdentity(),
          entitlement: makeEntitlement(),
        }),
        { requestedModelCodename: "openrouter/not-allowed" },
      ),
    ).resolves.toMatchObject({ ok: true, context: { modelCodename: "openrouter/not-allowed" } });
  });

  it("resolves personal access against the subscriber identity without requiring server sponsorship", async () => {
    let sponsorshipReads = 0;
    const repositories = makeRepositories({
      identity: makeIdentity(),
      entitlement: makeEntitlement(),
    });
    repositories.sponsorshipRepository = {
      loadActiveSponsorshipForServer: async () => {
        sponsorshipReads++;
        return null;
      },
    };
    const result = await resolveFunding(repositories, { scope: { kind: "personal", userId: 70 } });
    expect(result).toMatchObject({
      ok: true,
      context: {
        fundingScope: "personal",
        personalUserId: 70,
        sponsorshipId: null,
        capability: "text",
      },
    });
    expect(sponsorshipReads).toBe(0);
  });
});

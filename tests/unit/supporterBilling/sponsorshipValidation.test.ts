import { describe, expect, it } from "bun:test";
import {
  validateSupporterSponsorshipRequest,
  type SupporterSponsorshipRepositories,
} from "@/modules/supporter-billing/discord/sponsorship";
import type {
  SupporterBillingConfig,
  SupporterEntitlementRow,
  SupporterIdentityRow,
  SupporterServerSponsorshipRow,
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
      defaultModelByCapability: { text: "openrouter/test-model" },
    },
  },
};

function makeIdentity(overrides: Partial<SupporterIdentityRow> = {}): SupporterIdentityRow {
  return {
    supporter_identity_id: 10,
    discord_user_id: "discord_user_1",
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
    created_by_disc_id: "discord_user_1",
    created_at: now,
    revoked_at: null,
    updated_at: now,
    ...overrides,
  };
}

function makeRepositories(params: {
  identity?: SupporterIdentityRow | null;
  entitlement?: SupporterEntitlementRow | null;
  activeSponsorship?: SupporterServerSponsorshipRow | null;
}): SupporterSponsorshipRepositories {
  return {
    identityRepository: {
      loadByDiscordUserId: async () => params.identity ?? null,
    },
    entitlementRepository: {
      loadByIdentityId: async () => params.entitlement ?? null,
    },
    sponsorshipRepository: {
      loadActiveSponsorshipForServer: async () => params.activeSponsorship ?? null,
      startActiveSponsorship: async () => makeSponsorship(),
    },
  };
}

function validate(repositories: SupporterSponsorshipRepositories, serverId: number | null = 50) {
  return validateSupporterSponsorshipRequest({
    discordUserId: "discord_user_1",
    serverId,
    serverDiscId: "guild_1",
    environment: "production",
    env: enabledEnv,
    config,
    repositories,
    at: now,
  });
}

describe("supporter sponsorship validation", () => {
  it("accepts an active linked supporter without local accounting", async () => {
    const result = await validate(
      makeRepositories({
        identity: makeIdentity(),
        entitlement: makeEntitlement(),
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("rejects unlinked, inactive, unconfigured, inconsistent states", async () => {
    await expect(validate(makeRepositories({ identity: null }))).resolves.toMatchObject({
      ok: false,
      reason: "unlinked",
    });
    await expect(
      validate(
        makeRepositories({
          identity: makeIdentity(),
          entitlement: makeEntitlement({ is_active: false }),
        }),
      ),
    ).resolves.toMatchObject({ ok: false, reason: "inactive" });
    await expect(
      validate(
        makeRepositories({
          identity: makeIdentity(),
          entitlement: makeEntitlement({ tier_key: "missing_tier" }),
        }),
      ),
    ).resolves.toMatchObject({ ok: false, reason: "unconfigured_tier" });
  });

  it("admits additional sponsored servers and replacement within the shared allowance", async () => {
    await expect(
      validate(
        makeRepositories({
          identity: makeIdentity(),
          entitlement: makeEntitlement(),
        }),
      ),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      validate(
        makeRepositories({
          identity: makeIdentity(),
          entitlement: makeEntitlement(),

          activeSponsorship: makeSponsorship(),
        }),
      ),
    ).resolves.toMatchObject({ ok: true });
  });
});

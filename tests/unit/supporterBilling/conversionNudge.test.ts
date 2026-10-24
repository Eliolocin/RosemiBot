import { beforeEach, describe, expect, it, mock } from "bun:test";
import { resolveSupporterNudgeKey } from "@/modules/supporter-billing/discord/conversionNudge";
import type { SupporterEntitlementRow, SupporterIdentityRow } from "@/modules/supporter-billing/db";
import { useEnvSandbox } from "../../helpers/env";

const now = new Date();
const identity: SupporterIdentityRow = {
  supporter_identity_id: 1,
  discord_user_id: "123456789012345678",
  patreon_user_id: "test-patron",
  patreon_member_id: "test-member",
  patreon_campaign_id: "test-campaign",
  linked_at: now,
  last_oauth_at: now,
  created_at: now,
  updated_at: now,
};
const entitlement: SupporterEntitlementRow = {
  supporter_entitlement_id: 1,
  supporter_identity_id: 1,
  tier_key: "mochi",
  patreon_tier_id: "test-tier",
  patron_status: "active_patron",
  is_active: true,
  cancel_at_period_end: false,
  period_start: now,
  period_end: new Date(now.getTime() + 86_400_000),
  last_verified_at: now,
  last_successful_charge_at: now,
  next_charge_at: null,
  source: "oauth",
  created_at: now,
  updated_at: now,
};
const context = {
  userDiscId: identity.discord_user_id,
  serverId: 10,
  credentialSource: "server" as const,
};

function dependencies() {
  return {
    identities: { loadByDiscordUserId: mock(async (): Promise<SupporterIdentityRow | null> => null) },
    entitlements: { loadByIdentityId: mock(async (): Promise<SupporterEntitlementRow | null> => null) },
    sponsorships: { loadActiveSponsorshipForServer: mock(async () => null) },
  };
}

describe("subscription conversion eligibility", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);
  beforeEach(() => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
  });

  it("skips storage entirely outside enabled production billing", async () => {
    for (const [environment, enabled] of [
      ["development", "true"],
      ["production", "false"],
    ]) {
      process.env.RUN_ENV = environment;
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = enabled;
      const deps = dependencies();
      expect(await resolveSupporterNudgeKey(context, deps)).toBeNull();
      expect(deps.identities.loadByDiscordUserId).not.toHaveBeenCalled();
      expect(deps.sponsorships.loadActiveSponsorshipForServer).not.toHaveBeenCalled();
    }
  });

  it("requires an identified user and a known BYOK funding source", async () => {
    for (const credentialSource of ["supporter", undefined] as const) {
      const deps = dependencies();
      expect(await resolveSupporterNudgeKey({ ...context, credentialSource }, deps)).toBeNull();
      expect(deps.identities.loadByDiscordUserId).not.toHaveBeenCalled();
    }
    const deps = dependencies();
    expect(await resolveSupporterNudgeKey({ ...context, userDiscId: undefined }, deps)).toBeNull();
    expect(deps.identities.loadByDiscordUserId).not.toHaveBeenCalled();
  });

  it("does not promote subscriptions to active members or already sponsored servers", async () => {
    const memberDeps = dependencies();
    memberDeps.identities.loadByDiscordUserId.mockResolvedValue(identity);
    memberDeps.entitlements.loadByIdentityId.mockResolvedValue(entitlement);
    expect(await resolveSupporterNudgeKey(context, memberDeps)).toBeNull();
    const serverDeps = dependencies();
    const sponsored = {
      ...serverDeps,
      sponsorships: {
        loadActiveSponsorshipForServer: async () => ({
          sponsorship_id: 1,
          server_id: 10,
          server_disc_id: "223456789012345678",
          sponsor_identity_id: 2,
          status: "active" as const,
          created_by_disc_id: "323456789012345678",
          created_at: now,
          revoked_at: null,
          updated_at: now,
        }),
      },
    };
    expect(await resolveSupporterNudgeKey(context, sponsored)).toBeNull();
  });

  it("admits lapsed members but suppresses uncertain membership and storage failures", async () => {
    const deps = dependencies();
    deps.identities.loadByDiscordUserId.mockResolvedValue(identity);
    expect(await resolveSupporterNudgeKey(context, deps)).toBeNull();
    deps.entitlements.loadByIdentityId.mockResolvedValue({ ...entitlement, is_active: false });
    expect(await resolveSupporterNudgeKey(context, deps)).not.toBeNull();
    deps.identities.loadByDiscordUserId.mockRejectedValue(new Error("Storage unavailable"));
    expect(await resolveSupporterNudgeKey(context, deps)).toBeNull();
  });

  it("keeps guidance available across repeated calls", async () => {
    const deps = dependencies();
    for (const credentialSource of ["server", "personal", "server", "personal"] as const) {
      expect(await resolveSupporterNudgeKey({ ...context, credentialSource }, deps)).toBe(
        "commands.subscribe.conversion_nudge",
      );
    }
  });
});

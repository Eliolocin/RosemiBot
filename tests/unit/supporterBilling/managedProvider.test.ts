import { describe, expect, it } from "bun:test";
import {
  resolveSupporterMemberKey,
  SupporterRequestDeniedError,
  type SupporterFundingContext,
} from "@/modules/supporter-billing/runtime";
import { supporterIdentitySchema, supporterServerSponsorshipSchema } from "@/modules/supporter-billing/db";

function owners() {
  return {
    identities: {
      loadByUserId: async (id: number) =>
        supporterIdentitySchema.parse({
          supporter_identity_id: id,
          discord_user_id: `member-${id}`,
          patreon_user_id: `patron-${id}`,
          patreon_member_id: `patron-member-${id}`,
          patreon_campaign_id: "campaign",
          linked_at: new Date(),
          last_oauth_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        }),
    },
    sponsorships: {
      loadActiveSponsorshipById: async (id: number) =>
        supporterServerSponsorshipSchema.parse({
          sponsorship_id: id,
          server_id: id,
          server_disc_id: `server-${id}`,
          sponsor_identity_id: id,
          status: "active",
          revoked_at: null,
          created_by_disc_id: `member-${id}`,
          created_at: new Date(),
          updated_at: new Date(),
        }),
    },
  };
}

function funding(identityId: number, personal: boolean): SupporterFundingContext {
  return {
    credentialSource: "supporter",
    provider: "openrouter",
    capability: "text",
    modelCodename: "example/text",
    tierKey: "test",
    sponsorIdentityId: identityId,
    sponsorDiscordUserId: `member-${identityId}`,
    entitlementId: identityId,
    renewalAt: null,
    ...(personal
      ? { fundingScope: "personal", personalUserId: identityId, sponsorshipId: null, serverId: null }
      : { fundingScope: "server", personalUserId: null, sponsorshipId: identityId, serverId: identityId }),
  };
}

describe("Member credential resolution", () => {
  it("shares a member credential across funding scopes and isolates other members", async () => {
    const at = new Date();
    const repository = {
      ...owners(),
      memberKeys: {
        loadCredential: async (id: number, now: Date, onLoad?: (hash: string) => void) => {
          expect(now).toBe(at);
          onLoad?.(`synthetic-hash-${id}`);
          return `synthetic-member-${id}`;
        },
      },
    };
    expect(await resolveSupporterMemberKey(funding(1, true), repository, at)).toBe("synthetic-member-1");
    expect(await resolveSupporterMemberKey(funding(1, false), repository, at)).toBe("synthetic-member-1");
    expect(await resolveSupporterMemberKey(funding(2, false), repository, at)).toBe("synthetic-member-2");
  });

  it("denies missing credentials and sanitizes storage failures without a fallback credential", async () => {
    for (const failure of [null, new Error("synthetic-private-secret")]) {
      const repository = {
        ...owners(),
        memberKeys: {
          loadCredential: async () => {
            if (failure) throw failure;
            return null;
          },
        },
      };
      const result = await resolveSupporterMemberKey(funding(1, true), repository).catch((error: unknown) => error);
      expect(result).toBeInstanceOf(SupporterRequestDeniedError);
      expect(result).toMatchObject({
        reason: failure ? "billing_unavailable" : "inactive_entitlement",
        fundingScope: "personal",
      });
      expect(JSON.stringify(result)).not.toContain("synthetic-private-secret");
      expect(String(result)).not.toContain("synthetic-private-secret");
    }
  });

  it("rejects a replaced personal identity or revoked sponsorship before loading a key", async () => {
    for (const personal of [false, true]) {
      let loaded = false;
      const repositories = {
        memberKeys: {
          loadCredential: async () => {
            loaded = true;
            return "synthetic-key";
          },
        },
        identities: { loadByUserId: async () => null },
        sponsorships: { loadActiveSponsorshipById: async () => null },
      };
      await expect(resolveSupporterMemberKey(funding(1, personal), repositories)).rejects.toBeInstanceOf(
        SupporterRequestDeniedError,
      );
      expect(loaded).toBe(false);
    }
  });
});

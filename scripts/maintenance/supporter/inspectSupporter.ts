import { SupporterEntitlementRepository, SupporterIdentityRepository } from "@/modules/supporter-billing";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { getOptionalNumber, getOptionalString, parseArgs, printJson, requireIdentifier } from "./billingOps";

async function main(): Promise<void> {
  const args = parseArgs();
  requireIdentifier(args, ["discord-user-id", "supporter-identity-id"]);

  const identityRepository = new SupporterIdentityRepository(sql);
  const supporterIdentityId = getOptionalNumber(args, "supporter-identity-id");
  const discordUserId = getOptionalString(args, "discord-user-id");
  const identity =
    supporterIdentityId !== null
      ? await identityRepository.loadById(supporterIdentityId)
      : discordUserId
        ? await identityRepository.loadByDiscordUserId(discordUserId)
        : null;

  if (!identity) {
    throw new Error("Supporter identity was not found");
  }

  const entitlementRepository = new SupporterEntitlementRepository(sql);
  const entitlement = await entitlementRepository.loadByIdentityId(identity.supporter_identity_id);

  printJson({
    identity: {
      supporterIdentityId: identity.supporter_identity_id,
      discordUserId: identity.discord_user_id,
      patreonMemberId: identity.patreon_member_id,
    },
    entitlement: entitlement
      ? {
          tierKey: entitlement.tier_key,
          patronStatus: entitlement.patron_status,
          isActive: entitlement.is_active,
          periodEnd: entitlement.period_end?.toISOString() ?? null,
          lastVerifiedAt: entitlement.last_verified_at.toISOString(),
        }
      : null,
  });
}

main()
  .catch((error) => {
    void log.error("Supporter inspection failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  });

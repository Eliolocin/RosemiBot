/**
 * Refresh supporter entitlement state from Patreon.
 *
 * Usage:
 *   bun run scripts/maintenance/supporter/refreshEntitlement.ts --discord-user-id 123
 *   bun run scripts/maintenance/supporter/refreshEntitlement.ts --supporter-identity-id 42
 *   bun run scripts/maintenance/supporter/refreshEntitlement.ts --all
 */
import { SupporterIdentityRepository } from "@/modules/supporter-billing";
import {
  refreshPatreonEntitlementForIdentity,
  runPatreonEntitlementReconcile,
} from "@/modules/supporter-billing/patreon/reconcile";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { loadInitializedKeyManager } from "../../lib/keyManagerBootstrap";

async function main(): Promise<void> {
  await loadInitializedKeyManager();
  const { getOptionalNumber, getOptionalString, parseArgs, printJson, requireIdentifier, requireSupporterConfig } =
    await import("./billingOps");
  const args = parseArgs();
  const config = requireSupporterConfig({ validateSecrets: true });

  if (args.flags.has("all")) {
    const result = await runPatreonEntitlementReconcile({ config });
    printJson({ mode: "all", result });
    return;
  }

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

  const result = await refreshPatreonEntitlementForIdentity({
    config,
    identity,
  });

  printJson({
    mode: "single",
    supporterIdentityId: identity.supporter_identity_id,
    discordUserId: identity.discord_user_id,
    fetchedMembers: result.fetchedMembers,
    matchedMember: result.matchedMember,
    active: result.persistResult.entitlement.is_active,
    cancelAtPeriodEnd: result.persistResult.entitlement.cancel_at_period_end,
    tierKey: result.persistResult.entitlement.tier_key,
    patronStatus: result.persistResult.entitlement.patron_status,
    periodStart: result.persistResult.entitlement.period_start?.toISOString() ?? null,
    periodEnd: result.persistResult.entitlement.period_end?.toISOString() ?? null,
  });
}

main()
  .catch((error) => {
    void log.error("Supporter entitlement refresh failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  });

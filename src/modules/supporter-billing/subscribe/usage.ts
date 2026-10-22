import type { SupporterEntitlementRow, SupporterIdentityRow } from "@/modules/supporter-billing/db";
import { MemberKeyRepository } from "@/modules/supporter-billing/db/repositories/memberKeys";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db";
import { createMemberKeyProvider } from "@/modules/supporter-billing/openrouter/management";
import type { MemberKeyProvider } from "@/modules/supporter-billing/openrouter/management";
import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";

export interface SubscriptionAllowance {
  allowance: number;
  used: number;
  remaining: number;
  start: Date;
  end: Date;
}

export interface SubscriptionAllowanceDependencies {
  memberKeys: Pick<MemberKeyRepository, "loadByIdentityId">;
  statistics: Pick<typeof supporterUsageStatisticsRepository, "totalSince">;
  provider(): Pick<MemberKeyProvider, "get">;
  observedSpend(hash: string): number;
}

/** @returns The locale key explaining why this allowance cannot fund a new sponsorship, or null when it can. */
export function getSubscriptionAllowanceBlockKey(allowance: SubscriptionAllowance | null): string | null {
  if (!allowance) return "commands.subscription.incomplete";
  return allowance.remaining > 0 ? null : "commands.subscribe.sponsorship.errors.exhausted";
}

export async function loadSubscriptionAllowance(
  identity: SupporterIdentityRow,
  entitlement: SupporterEntitlementRow,
  dependencies: SubscriptionAllowanceDependencies = {
    memberKeys: new MemberKeyRepository(),
    statistics: supporterUsageStatisticsRepository,
    provider: createMemberKeyProvider,
    observedSpend: (hash: string) => supporterSpendGuard.observedSpend(hash),
  },
): Promise<SubscriptionAllowance | null> {
  const key = await dependencies.memberKeys.loadByIdentityId(identity.supporter_identity_id);
  if (
    !key?.key_hash ||
    key.disabled ||
    key.pending_action ||
    !key.applied_allowance ||
    key.applied_limit === null ||
    !key.key_created_at ||
    !entitlement.period_start ||
    !entitlement.period_end
  )
    return null;
  const [remote, logged] = await Promise.all([
    dependencies.provider().get(key.key_hash),
    dependencies.statistics.totalSince(identity.supporter_identity_id, key.key_created_at),
  ]);
  if (!remote || remote.disabled || remote.limit === null) return null;
  const usage = Math.max(remote.usage, logged, dependencies.observedSpend(key.key_hash));
  const remaining = Math.min(remote.limit, key.applied_limit) - usage;
  return {
    allowance: key.applied_allowance,
    used: Math.max(0, key.applied_allowance - remaining),
    remaining: Math.max(0, Math.min(key.applied_allowance, remaining)),
    start: key.funded_period_start ?? entitlement.period_start,
    end: key.funded_period_end ?? entitlement.period_end,
  };
}

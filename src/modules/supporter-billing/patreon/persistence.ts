import type { SQL } from "bun";
import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";
import {
  SupporterEntitlementRepository,
  SupporterIdentityRepository,
  type SupporterEntitlementRow,
  type SupporterEntitlementSource,
  type SupporterIdentityRow,
  type UpsertSupporterEntitlementParams,
} from "@/modules/supporter-billing/db";
import type {
  EligiblePatreonSupporterSnapshot,
  PatreonMemberStateSnapshot,
} from "@/modules/supporter-billing/patreon/mapping";
import { sql as defaultSql } from "@/utils/db/client";
import { MemberKeyRepository, withMemberKeyLock } from "@/modules/supporter-billing/db/repositories/memberKeys";
import {
  cleanupDetachedMemberKeysLocked,
  syncMemberKeyLocked,
} from "@/modules/supporter-billing/openrouter/memberKeys";
import {
  createMemberKeyProvider,
  MemberKeyError,
  type MemberKeyProvider,
} from "@/modules/supporter-billing/openrouter/management";

export interface PatreonSupporterPersistenceRepositories {
  identityRepository: Pick<SupporterIdentityRepository, "upsertIdentity">;
  entitlementRepository: Pick<SupporterEntitlementRepository, "loadByIdentityId" | "upsertSnapshot">;
}

export interface PatreonMemberStatePersistenceRepositories {
  identityRepository: Pick<SupporterIdentityRepository, "updatePatreonSnapshot">;
  entitlementRepository: Pick<SupporterEntitlementRepository, "loadByIdentityId" | "upsertSnapshot">;
}

export interface PersistEligiblePatreonSupporterOptions {
  config: SupporterBillingConfig;
  snapshot: EligiblePatreonSupporterSnapshot;
  verifiedAt?: Date;
  client?: SQL;
  repositories?: PatreonSupporterPersistenceRepositories;
  env?: Readonly<Record<string, string | undefined>>;
  memberKeyProvider?: MemberKeyProvider;
}

export interface PersistEligiblePatreonSupporterResult {
  identity: SupporterIdentityRow;
  entitlement: SupporterEntitlementRow;
}

export interface PersistPatreonMemberStateOptions {
  config: SupporterBillingConfig;
  identity: SupporterIdentityRow;
  snapshot: PatreonMemberStateSnapshot;
  source: Extract<SupporterEntitlementSource, "webhook" | "reconcile">;
  verifiedAt?: Date;
  client?: SQL;
  repositories?: PatreonMemberStatePersistenceRepositories;
  env?: Readonly<Record<string, string | undefined>>;
  memberKeyProvider?: MemberKeyProvider;
}

export interface PersistPatreonMemberStateResult {
  identity: SupporterIdentityRow;
  entitlement: SupporterEntitlementRow;
}

const INACTIVE_UNKNOWN_TIER_KEY = "unknown";
const INACTIVE_UNKNOWN_PATREON_TIER_ID = "unknown";

function entitlementSnapshot(
  snapshot: PatreonMemberStateSnapshot,
  previous: SupporterEntitlementRow | null,
  supporterIdentityId: number,
  source: SupporterEntitlementSource,
  verifiedAt: Date,
): UpsertSupporterEntitlementParams {
  const cancelAtPeriodEnd = snapshot.cancelAtPeriodEnd ?? previous?.cancel_at_period_end ?? false;
  const sameCharge =
    previous &&
    (!snapshot.lastSuccessfulChargeAt ||
      (previous.last_successful_charge_at && snapshot.lastSuccessfulChargeAt <= previous.last_successful_charge_at));
  const preservePeriod = (cancelAtPeriodEnd || previous?.cancel_at_period_end) && sameCharge;
  const unverifiedCancellation = cancelAtPeriodEnd && snapshot.periodDateSource === "fallback";
  const sameBillingPeriod =
    previous?.period_start &&
    previous.period_end &&
    snapshot.nextChargeAt?.getTime() === previous.period_end.getTime() &&
    snapshot.lastSuccessfulChargeAt &&
    snapshot.lastSuccessfulChargeAt >= previous.period_start &&
    snapshot.lastSuccessfulChargeAt < previous.period_end;
  const periodStart =
    preservePeriod || sameBillingPeriod ? previous.period_start : unverifiedCancellation ? null : snapshot.periodStart;
  const periodEnd = preservePeriod ? previous.period_end : unverifiedCancellation ? null : snapshot.periodEnd;
  const boundedCancellation =
    preservePeriod || (snapshot.periodDateSource !== "fallback" && snapshot.periodDateSource !== "none");
  const isActive =
    (snapshot.isActive ||
      ((snapshot.inactiveReason === "cancelled" ||
        (snapshot.inactiveReason === "not_found" && previous?.cancel_at_period_end === true)) &&
        previous?.is_active === true)) &&
    (!cancelAtPeriodEnd || (!!boundedCancellation && !!periodEnd && periodEnd > verifiedAt));
  return {
    supporterIdentityId,
    tierKey: preservePeriod ? previous.tier_key : (snapshot.tierKey ?? previous?.tier_key ?? INACTIVE_UNKNOWN_TIER_KEY),
    patreonTierId: preservePeriod
      ? previous.patreon_tier_id
      : (snapshot.patreonTierId ?? previous?.patreon_tier_id ?? INACTIVE_UNKNOWN_PATREON_TIER_ID),
    patronStatus: snapshot.patronStatus,
    isActive,
    cancelAtPeriodEnd,
    periodStart: periodStart ?? previous?.period_start ?? null,
    periodEnd: periodEnd ?? previous?.period_end ?? null,
    lastVerifiedAt: verifiedAt,
    lastSuccessfulChargeAt: preservePeriod ? previous.last_successful_charge_at : snapshot.lastSuccessfulChargeAt,
    nextChargeAt: cancelAtPeriodEnd ? null : preservePeriod ? previous.period_end : snapshot.nextChargeAt,
    source,
  };
}

async function persistWithRepositories(
  options: PersistEligiblePatreonSupporterOptions,
  repositories: PatreonSupporterPersistenceRepositories,
): Promise<PersistEligiblePatreonSupporterResult> {
  const tierConfig = options.config.tiers[options.snapshot.tierKey];
  if (!tierConfig) {
    throw new Error(`Supporter tier "${options.snapshot.tierKey}" is not configured`);
  }

  const verifiedAt = options.verifiedAt ?? new Date();
  const identity = await repositories.identityRepository.upsertIdentity({
    discordUserId: options.snapshot.discordUserId,
    patreonUserId: options.snapshot.patreonUserId,
    patreonMemberId: options.snapshot.patreonMemberId,
    patreonCampaignId: options.snapshot.patreonCampaignId,
    linkedAt: verifiedAt,
    lastOauthAt: verifiedAt,
  });
  const previous = await repositories.entitlementRepository.loadByIdentityId(identity.supporter_identity_id);
  const entitlement = await repositories.entitlementRepository.upsertSnapshot(
    entitlementSnapshot(
      { ...options.snapshot, isActive: true, inactiveReason: null },
      previous,
      identity.supporter_identity_id,
      "oauth",
      verifiedAt,
    ),
  );
  return { identity, entitlement };
}

export async function persistEligiblePatreonSupporter(
  options: PersistEligiblePatreonSupporterOptions,
): Promise<PersistEligiblePatreonSupporterResult> {
  if (options.repositories) {
    return await persistWithRepositories(options, options.repositories);
  }

  const client = options.client ?? defaultSql;
  return await withMemberKeyLock(client, async (connection) => {
    const result = await connection.begin(async (tx: SQL) => {
      const identities = new SupporterIdentityRepository(tx);
      const byDiscord = await identities.loadByDiscordUserId(options.snapshot.discordUserId);
      const byMember = await identities.loadByPatreonMemberId(options.snapshot.patreonMemberId);
      for (const identity of [byDiscord, byMember]) {
        if (
          identity &&
          (identity.discord_user_id !== options.snapshot.discordUserId ||
            identity.patreon_member_id !== options.snapshot.patreonMemberId)
        ) {
          await new MemberKeyRepository(tx).detach(identity.supporter_identity_id, options.verifiedAt ?? new Date());
        }
      }
      return await persistWithRepositories(options, {
        identityRepository: identities,
        entitlementRepository: new SupporterEntitlementRepository(tx),
      });
    });
    const provider = options.memberKeyProvider ?? createMemberKeyProvider(options.env);
    await cleanupDetachedMemberKeysLocked(connection, provider, options.verifiedAt ?? new Date());
    await syncMemberKeyLocked({
      config: options.config,
      client: connection,
      provider,
      supporterIdentityId: result.identity.supporter_identity_id,
      now: options.verifiedAt ?? new Date(),
    });
    return result;
  });
}

async function persistMemberStateWithRepositories(
  options: PersistPatreonMemberStateOptions,
  repositories: PatreonMemberStatePersistenceRepositories,
): Promise<PersistPatreonMemberStateResult> {
  const verifiedAt = options.verifiedAt ?? new Date();
  const identity = await repositories.identityRepository.updatePatreonSnapshot({
    supporterIdentityId: options.identity.supporter_identity_id,
    patreonUserId: options.snapshot.patreonUserId,
    patreonMemberId: options.snapshot.patreonMemberId,
    patreonCampaignId: options.snapshot.patreonCampaignId,
  });

  const previous = await repositories.entitlementRepository.loadByIdentityId(identity.supporter_identity_id);
  const next = entitlementSnapshot(
    options.snapshot,
    previous,
    identity.supporter_identity_id,
    options.source,
    verifiedAt,
  );
  if (next.isActive && (!next.periodStart || !next.periodEnd || !options.config.tiers[next.tierKey])) {
    throw new Error("Active Patreon supporter snapshot is missing configured tier or membership-period data");
  }
  const entitlement = await repositories.entitlementRepository.upsertSnapshot(next);
  return { identity, entitlement };
}

export async function persistPatreonMemberState(
  options: PersistPatreonMemberStateOptions,
): Promise<PersistPatreonMemberStateResult> {
  if (options.repositories) {
    return await persistMemberStateWithRepositories(options, options.repositories);
  }

  const client = options.client ?? defaultSql;
  return await withMemberKeyLock(client, async (connection) => {
    const current = await new SupporterIdentityRepository(connection).loadById(options.identity.supporter_identity_id);
    if (
      !current ||
      current.discord_user_id !== options.identity.discord_user_id ||
      current.patreon_member_id !== options.snapshot.patreonMemberId ||
      current.patreon_user_id !== options.snapshot.patreonUserId
    )
      throw new MemberKeyError();
    const result = await connection.begin(async (tx: SQL) =>
      persistMemberStateWithRepositories(options, {
        identityRepository: new SupporterIdentityRepository(tx),
        entitlementRepository: new SupporterEntitlementRepository(tx),
      }),
    );
    await syncMemberKeyLocked({
      config: options.config,
      client: connection,
      provider: options.memberKeyProvider ?? createMemberKeyProvider(options.env),
      supporterIdentityId: result.identity.supporter_identity_id,
      now: options.verifiedAt ?? new Date(),
    });
    return result;
  });
}

import type { SQL } from "bun";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";
import {
  SupporterEntitlementRepository,
  SupporterIdentityRepository,
} from "@/modules/supporter-billing/db/repositories";
import { isSupporterEntitlementActive } from "@/modules/supporter-billing/db/types";
import {
  MemberKeyRepository,
  withMemberKeyLock,
  type MemberKeyRow,
} from "@/modules/supporter-billing/db/repositories/memberKeys";
import { sql as defaultSql } from "@/utils/db/client";
import {
  createMemberKeyProvider,
  MemberKeyError,
  type MemberKeyProvider,
  MICROS_PER_DOLLAR,
  normalizeMemberKeyLimit,
} from "@/modules/supporter-billing/openrouter/management";
import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";

async function observedUsage(row: MemberKeyRow, repository: MemberKeyRepository, usage: number): Promise<number> {
  if (!row.key_hash || !row.key_created_at || row.supporter_identity_id === null) throw new MemberKeyError();
  return Math.max(usage, await repository.loggedSpend(row), supporterSpendGuard.observedSpend(row.key_hash));
}

function operationName(row: MemberKeyRow): string {
  if (!row.operation_id) throw new MemberKeyError();
  return `tomoribot-member-${row.operation_id}`;
}

async function removeRemoteKey(provider: MemberKeyProvider, hash: string): Promise<void> {
  if (await provider.get(hash)) await provider.update(hash, { disabled: true });
  await provider.delete(hash);
}

async function drain(
  row: MemberKeyRow,
  repository: MemberKeyRepository,
  provider: MemberKeyProvider,
  enable = true,
): Promise<MemberKeyRow> {
  if (row.pending_action === "delete") {
    if (row.key_hash) await removeRemoteKey(provider, row.key_hash);
    if (row.operation_id) {
      for (const key of await provider.findByName(operationName(row))) await removeRemoteKey(provider, key.hash);
    }
    if (row.retired_hash) await removeRemoteKey(provider, row.retired_hash);
    return await repository.save({
      ...row,
      key_hash: null,
      api_key: null,
      key_version: null,
      disabled: true,
      pending_action: null,
      operation_id: null,
      retired_hash: null,
      applied_charge_at: null,
      renewal_due_at: null,
      applied_limit: null,
      applied_allowance: null,
      key_created_at: null,
      target_limit: null,
      target_allowance: null,
      target_charge_at: null,
      target_period_end: null,
    });
  }
  if (row.pending_action === "disable") {
    if (row.key_hash && (await provider.get(row.key_hash))) await provider.update(row.key_hash, { disabled: true });
    row = await repository.save({ ...row, pending_action: null, disabled: true });
  }
  if (row.pending_action === "rotate") {
    if (!row.key_hash) throw new MemberKeyError();
    await provider.update(row.key_hash, { disabled: true });
    const remote = await provider.get(row.key_hash);
    if (!remote || row.applied_limit === null) throw new MemberKeyError();
    row = await repository.save({
      ...row,
      pending_action: "create",
      retired_hash: row.key_hash,
      key_hash: null,
      api_key: null,
      key_version: null,
      target_limit: normalizeMemberKeyLimit(
        Math.max(
          0,
          row.applied_limit -
            (await observedUsage(row, repository, remote.usage)) -
            supporterSpendGuard.pendingSpend(row.supporter_identity_id ?? 0),
        ),
      ),
      target_charge_at: row.applied_charge_at,
      target_allowance: row.applied_allowance,
      target_period_end: row.renewal_due_at,
    });
  }
  if (row.pending_action === "create") {
    // A lost POST response cannot recover plaintext, so remove its zero-limit key before retrying creation.
    for (const key of await provider.findByName(operationName(row))) await removeRemoteKey(provider, key.hash);
    const created = await provider.create(operationName(row));
    row = await repository.storeCreated(row, created.hash, created.key);
  }
  if (row.pending_action === "activate" || row.pending_action === "renew") {
    if (!row.key_hash || row.target_limit === null) throw new MemberKeyError();
    await provider.update(row.key_hash, { disabled: !enable, limit: row.target_limit });
    row = await repository.save({
      ...row,
      pending_action: null,
      disabled: !enable,
      applied_charge_at: row.target_charge_at,
      renewal_due_at: row.target_period_end,
      applied_limit: row.target_limit,
      applied_allowance: row.target_allowance,
    });
  }
  if (row.retired_hash) {
    await removeRemoteKey(provider, row.retired_hash);
    row = await repository.save({ ...row, retired_hash: null });
  }
  return row;
}

export async function syncMemberKeyLocked(options: {
  config: SupporterBillingConfig;
  supporterIdentityId: number;
  client: SQL;
  provider: MemberKeyProvider;
  now: Date;
}): Promise<void> {
  const { client, provider, config, now } = options;
  const repository = new MemberKeyRepository(client);
  const identity = await new SupporterIdentityRepository(client).loadById(options.supporterIdentityId);
  if (!identity) return;
  const entitlement = await new SupporterEntitlementRepository(client).loadByIdentityId(identity.supporter_identity_id);
  let row = await repository.load(identity.patreon_member_id);
  if (row && row.supporter_identity_id === null) {
    row = await drain({ ...row, pending_action: "delete" }, repository, provider);
    await repository.reattach(identity);
  }
  row = await repository.initialize(identity);
  if (!entitlement || !isSupporterEntitlementActive(entitlement, now) || !config.tiers[entitlement.tier_key]) {
    row = await repository.save({ ...row, disabled: true, pending_action: row.pending_action ?? "disable" });
    await drain(row, repository, provider, false);
    return;
  }
  row = await drain(row, repository, provider);
  const allowance = config.tiers[entitlement.tier_key].monthlyBudgetMicros / MICROS_PER_DOLLAR;
  if (!row.key_hash) {
    row = await repository.save({
      ...row,
      disabled: true,
      pending_action: "create",
      operation_id: randomUUID(),
      target_limit: allowance,
      target_allowance: allowance,
      target_charge_at: entitlement.last_successful_charge_at,
      target_period_end: entitlement.next_charge_at,
    });
  } else {
    const charge = entitlement.last_successful_charge_at;
    const isRenewal =
      charge &&
      (!row.applied_charge_at || charge > row.applied_charge_at) &&
      row.renewal_due_at &&
      charge >= row.renewal_due_at;
    if (isRenewal) {
      const remote = await provider.get(row.key_hash);
      if (!remote) throw new MemberKeyError();
      row = await repository.save({
        ...row,
        disabled: true,
        pending_action: "renew",
        target_limit: normalizeMemberKeyLimit((await observedUsage(row, repository, remote.usage)) + allowance),
        target_allowance: allowance,
        target_charge_at: charge,
        target_period_end: entitlement.next_charge_at,
      });
    } else if (row.disabled) {
      const remote = await provider.get(row.key_hash);
      if (!remote || remote.limit === null) throw new MemberKeyError();
      row = await repository.save({
        ...row,
        pending_action: "activate",
        target_limit: remote.limit,
        target_allowance: row.applied_allowance,
        target_charge_at: row.applied_charge_at,
        target_period_end: row.renewal_due_at ?? entitlement.next_charge_at,
      });
    }
    if (!row.renewal_due_at && entitlement.next_charge_at && !row.pending_action) {
      row = await repository.save({ ...row, renewal_due_at: entitlement.next_charge_at });
    }
  }
  await drain(row, repository, provider);
  await repository.loadCredential(identity.supporter_identity_id, now);
}

export interface MemberKeyLifecycleOptions {
  config: SupporterBillingConfig;
  client?: SQL;
  env?: Readonly<Record<string, string | undefined>>;
  provider?: MemberKeyProvider;
  now?: Date;
}

export async function cleanupDetachedMemberKeysLocked(client: SQL, provider: MemberKeyProvider): Promise<void> {
  const repository = new MemberKeyRepository(client);
  let failed = false;
  for (const row of await repository.listDetachedForCleanup()) {
    try {
      await drain(await repository.save({ ...row, disabled: true, pending_action: "delete" }), repository, provider);
    } catch {
      failed = true;
    }
  }
  if (failed) throw new MemberKeyError();
}

export async function reconcileMemberKeys(options: MemberKeyLifecycleOptions): Promise<void> {
  await withMemberKeyLock(options.client ?? defaultSql, async (client) => {
    const provider = options.provider ?? createMemberKeyProvider(options.env);
    let failed = false;
    try {
      await cleanupDetachedMemberKeysLocked(client, provider);
    } catch {
      failed = true;
    }
    for (const identity of await new SupporterIdentityRepository(client).listIdentitiesForPatreonReconcile()) {
      try {
        await syncMemberKeyLocked({
          ...options,
          client,
          provider,
          now: options.now ?? new Date(),
          supporterIdentityId: identity.supporter_identity_id,
        });
      } catch {
        failed = true;
      }
    }
    if (failed) throw new MemberKeyError();
  });
}

export async function unlinkSupporterIdentity(
  options: MemberKeyLifecycleOptions & { discordUserId: string },
): Promise<void> {
  await withMemberKeyLock(options.client ?? defaultSql, async (client) => {
    const identity = await new SupporterIdentityRepository(client).loadByDiscordUserId(options.discordUserId);
    if (identity)
      await client.begin(async (tx: SQL) => new MemberKeyRepository(tx).detach(identity.supporter_identity_id));
    const provider = options.provider ?? createMemberKeyProvider(options.env);
    await cleanupDetachedMemberKeysLocked(client, provider);
  });
}

export async function rotateSupporterMemberKey(
  options: MemberKeyLifecycleOptions & {
    supporterIdentityId: number;
    requestId: string;
  },
): Promise<void> {
  z.uuid().parse(options.requestId);
  await withMemberKeyLock(options.client ?? defaultSql, async (client) => {
    const provider = options.provider ?? createMemberKeyProvider(options.env);
    const repository = new MemberKeyRepository(client);
    await syncMemberKeyLocked({ ...options, client, provider, now: options.now ?? new Date() });
    const identity = await new SupporterIdentityRepository(client).loadById(options.supporterIdentityId);
    if (!identity) throw new MemberKeyError();
    let row = await repository.load(identity.patreon_member_id);
    if (!row?.key_hash) throw new MemberKeyError();
    if (row.operation_id === options.requestId) return;
    const enable = !row.disabled;
    row = await repository.save({ ...row, disabled: true, pending_action: "rotate", operation_id: options.requestId });
    await drain(row, repository, provider, enable);
  });
}

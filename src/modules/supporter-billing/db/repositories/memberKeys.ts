import type { SQL } from "bun";
import { z } from "zod";
import { sql as defaultSql } from "@/utils/db/client";
import { keyManager } from "@/utils/security/keyManager";
import { lazyRotateEncryptedRow } from "@/utils/security/encryptedColumns";
import { MemberKeyError } from "@/modules/supporter-billing/openrouter/management";
import type { SupporterIdentityRow } from "@/modules/supporter-billing/db/types";
import { SupporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";

// One lock serializes lifecycle work because relinks span members; use per-member locks if administrative volume delays reconciliation.
const MEMBER_KEY_LOCK_ID = 1_176_514_635;
const DETACHED_ACCOUNTING_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const dateSchema = z.coerce.date().nullable();
const memberKeySchema = z.object({
  member_key_id: z.number().int().positive(),
  patreon_member_id: z.string().min(1),
  patreon_user_id: z.string().min(1).nullable(),
  patreon_campaign_id: z.string().min(1).nullable(),
  carried_allowance: z.number().finite().nonnegative().nullable(),
  funded_period_start: dateSchema,
  funded_period_end: dateSchema,
  retained_cost: z.number().finite().nonnegative(),
  supporter_identity_id: z.number().int().positive().nullable(),
  detached_retention_started_at: dateSchema,
  retention_hold: z.boolean(),
  key_hash: z.string().min(1).nullable(),
  api_key: z.instanceof(Buffer).nullable(),
  key_version: z.number().int().positive().nullable(),
  disabled: z.boolean(),
  applied_charge_at: dateSchema,
  renewal_due_at: dateSchema,
  applied_limit: z.number().finite().nonnegative().nullable(),
  applied_allowance: z.number().finite().positive().nullable(),
  key_created_at: dateSchema,
  pending_action: z.enum(["create", "activate", "renew", "disable", "delete", "rotate"]).nullable(),
  operation_id: z.string().nullable(),
  target_limit: z.number().finite().nonnegative().nullable(),
  target_allowance: z.number().finite().positive().nullable(),
  target_charge_at: dateSchema,
  target_period_end: dateSchema,
  retired_hash: z.string().nullable(),
});
export type MemberKeyRow = z.infer<typeof memberKeySchema>;

let memberKeyWork: Promise<unknown> = Promise.resolve();

export async function withMemberKeyLock<T>(client: SQL, run: (client: SQL) => Promise<T>): Promise<T> {
  const previous = memberKeyWork;
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const connection = await client.reserve();
      try {
        await connection`SELECT pg_advisory_lock(${MEMBER_KEY_LOCK_ID})`;
        return await run(connection as SQL);
      } catch {
        throw new MemberKeyError();
      } finally {
        try {
          await connection`SELECT pg_advisory_unlock(${MEMBER_KEY_LOCK_ID})`;
        } finally {
          connection.release();
        }
      }
    });
  memberKeyWork = operation;
  return await operation;
}

export class MemberKeyRepository {
  constructor(private readonly client: SQL = defaultSql) {}

  async load(memberId: string): Promise<MemberKeyRow | null> {
    const [row] = await this.client`SELECT * FROM supporter_member_keys WHERE patreon_member_id = ${memberId}`;
    return row ? memberKeySchema.parse(row) : null;
  }

  async loadByIdentityId(identityId: number): Promise<MemberKeyRow | null> {
    const [row] = await this.client`SELECT * FROM supporter_member_keys WHERE supporter_identity_id = ${identityId}`;
    return row ? memberKeySchema.parse(row) : null;
  }

  async loggedSpend(row: MemberKeyRow): Promise<number> {
    if (!row.key_created_at) throw new MemberKeyError();
    if (!row.supporter_identity_id) return row.retained_cost;
    return new SupporterUsageStatisticsRepository(this.client).totalSince(
      row.supporter_identity_id,
      row.key_created_at,
    );
  }

  async initialize(identity: SupporterIdentityRow): Promise<MemberKeyRow> {
    await this.assertOwner(identity);
    await this.client`INSERT INTO supporter_member_keys
      (patreon_member_id, supporter_identity_id, patreon_user_id, patreon_campaign_id)
      VALUES (${identity.patreon_member_id}, ${identity.supporter_identity_id},
        ${identity.patreon_user_id}, ${identity.patreon_campaign_id}) ON CONFLICT DO NOTHING`;
    const row = await this.load(identity.patreon_member_id);
    if (!row || row.supporter_identity_id !== identity.supporter_identity_id) throw new MemberKeyError();
    return row;
  }

  async assertOwner(
    identity: Pick<SupporterIdentityRow, "patreon_user_id" | "patreon_campaign_id" | "patreon_member_id">,
  ): Promise<void> {
    const rows = await this.client<{ patreon_member_id: string }[]>`SELECT patreon_member_id FROM supporter_member_keys
      WHERE patreon_user_id = ${identity.patreon_user_id} AND patreon_campaign_id = ${identity.patreon_campaign_id}`;
    if (rows.some((row) => row.patreon_member_id !== identity.patreon_member_id)) throw new MemberKeyError();
    const row = await this.load(identity.patreon_member_id);
    if (
      row &&
      (row.patreon_user_id !== identity.patreon_user_id || row.patreon_campaign_id !== identity.patreon_campaign_id)
    )
      throw new MemberKeyError();
  }

  async save(row: MemberKeyRow): Promise<MemberKeyRow> {
    const { member_key_id, retained_cost: _retainedCost, ...values } = row;
    const [saved] = await this.client`UPDATE supporter_member_keys SET ${this.client(values)}
      WHERE member_key_id = ${member_key_id} RETURNING *`;
    return memberKeySchema.parse(saved);
  }

  async captureAllowance(row: MemberKeyRow, remaining: number, usage: number): Promise<MemberKeyRow> {
    const [saved] = await this.client`UPDATE supporter_member_keys
      SET carried_allowance = LEAST(COALESCE(carried_allowance, ${remaining}), ${remaining}),
        retained_cost = CASE WHEN supporter_identity_id IS NULL THEN GREATEST(retained_cost, ${usage}) ELSE retained_cost END
      WHERE member_key_id = ${row.member_key_id} RETURNING *`;
    return memberKeySchema.parse(saved);
  }

  async storeCreated(row: MemberKeyRow, hash: string, key: string): Promise<MemberKeyRow> {
    const version = keyManager.getCurrentVersion();
    const masterKey = keyManager.getCurrentKey();
    const [saved] = await this.client`UPDATE supporter_member_keys
      SET key_hash = ${hash}, api_key = pgp_sym_encrypt(${key}, ${masterKey}, 'compress-algo=1, cipher-algo=aes256'),
        key_version = ${version}, pending_action = 'activate', key_created_at = NOW(), applied_limit = NULL, retained_cost = 0, carried_allowance = NULL
      WHERE member_key_id = ${row.member_key_id} RETURNING *`;
    return memberKeySchema.parse(saved);
  }

  async detach(identityId: number, now: Date): Promise<void> {
    await this.client`UPDATE supporter_member_keys SET supporter_identity_id = NULL, disabled = true,
      pending_action = 'delete', retained_cost = retained_cost + (SELECT COALESCE(SUM(cost_usd), 0)
        FROM supporter_usage_statistics WHERE supporter_identity_id = ${identityId} AND recorded_at >= key_created_at),
      detached_retention_started_at = GREATEST(${now}, renewal_due_at, target_period_end,
        (SELECT period_end FROM supporter_entitlements WHERE supporter_identity_id = ${identityId}))
      WHERE supporter_identity_id = ${identityId}`;
    await this.client`DELETE FROM supporter_identities WHERE supporter_identity_id = ${identityId}`;
  }

  async listDetachedForCleanup(memberId?: string): Promise<MemberKeyRow[]> {
    const rows = await this.client<unknown[]>`SELECT * FROM supporter_member_keys
      WHERE supporter_identity_id IS NULL AND (${memberId ?? null}::text IS NULL OR patreon_member_id = ${memberId ?? null})
        AND (pending_action IS NOT NULL OR key_hash IS NOT NULL
        OR operation_id IS NOT NULL OR retired_hash IS NOT NULL)`;
    return rows.map((row) => memberKeySchema.parse(row));
  }

  async reattach(identity: SupporterIdentityRow): Promise<void> {
    await this.client`UPDATE supporter_member_keys SET supporter_identity_id = ${identity.supporter_identity_id},
      detached_retention_started_at = NULL
      WHERE patreon_member_id = ${identity.patreon_member_id} AND supporter_identity_id IS NULL
        AND key_hash IS NULL AND pending_action IS NULL AND retired_hash IS NULL`;
  }

  async purgeDetachedAccounting(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - DETACHED_ACCOUNTING_RETENTION_MS);
    const rows = await this.client`DELETE FROM supporter_member_keys
      WHERE supporter_identity_id IS NULL AND disabled AND NOT retention_hold
        AND detached_retention_started_at <= ${cutoff}
        AND key_hash IS NULL AND api_key IS NULL AND key_version IS NULL
        AND pending_action IS NULL AND operation_id IS NULL AND retired_hash IS NULL
      RETURNING member_key_id`;
    return rows.length;
  }

  async loadCredential(identityId: number, at: Date, onLoad?: (keyHash: string) => void): Promise<string | null> {
    try {
      const [value] = await this.client`SELECT keys.* FROM supporter_member_keys keys
        JOIN supporter_identities identity ON identity.supporter_identity_id = keys.supporter_identity_id
          AND identity.patreon_member_id = keys.patreon_member_id
        JOIN supporter_entitlements entitlement ON entitlement.supporter_identity_id = keys.supporter_identity_id
        WHERE keys.supporter_identity_id = ${identityId} AND NOT keys.disabled AND keys.pending_action IS NULL
          AND entitlement.is_active AND (entitlement.period_start IS NULL OR entitlement.period_start <= ${at})
          AND (entitlement.period_end IS NULL OR entitlement.period_end > ${at})`;
      if (!value) return null;
      const row = memberKeySchema.parse(value);
      if (!row.api_key || !row.key_version || !row.key_hash) return null;
      const [decrypted] = await this.client<{ credential: string }[]>`SELECT pgp_sym_decrypt(${row.api_key},
        ${keyManager.getKey(row.key_version)}) AS credential`;
      if (!decrypted?.credential) throw new MemberKeyError();
      await lazyRotateEncryptedRow(this.client, "supporter_member_keys", {
        id: row.member_key_id,
        ciphertext: row.api_key,
        key_version: row.key_version,
      });
      onLoad?.(row.key_hash);
      return decrypted.credential;
    } catch {
      throw new MemberKeyError();
    }
  }
}

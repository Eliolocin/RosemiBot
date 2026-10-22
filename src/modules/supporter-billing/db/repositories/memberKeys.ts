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
export const memberKeySchema = z.object({
  member_key_id: z.number().int().positive(),
  patreon_member_id: z.string().min(1),
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

export async function withMemberKeyLock<T>(client: SQL, run: (client: SQL) => Promise<T>): Promise<T> {
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
    if (!row.supporter_identity_id || !row.key_created_at) throw new MemberKeyError();
    return new SupporterUsageStatisticsRepository(this.client).totalSince(
      row.supporter_identity_id,
      row.key_created_at,
    );
  }

  async initialize(identity: SupporterIdentityRow): Promise<MemberKeyRow> {
    await this.client`INSERT INTO supporter_member_keys (patreon_member_id, supporter_identity_id)
      VALUES (${identity.patreon_member_id}, ${identity.supporter_identity_id}) ON CONFLICT DO NOTHING`;
    const row = await this.load(identity.patreon_member_id);
    if (!row || row.supporter_identity_id !== identity.supporter_identity_id) throw new MemberKeyError();
    return row;
  }

  async save(row: MemberKeyRow): Promise<MemberKeyRow> {
    const { member_key_id, ...values } = row;
    const [saved] = await this.client`UPDATE supporter_member_keys SET ${this.client(values)}
      WHERE member_key_id = ${member_key_id} RETURNING *`;
    return memberKeySchema.parse(saved);
  }

  async storeCreated(row: MemberKeyRow, hash: string, key: string): Promise<MemberKeyRow> {
    const version = keyManager.getCurrentVersion();
    const masterKey = keyManager.getCurrentKey();
    const [saved] = await this.client`UPDATE supporter_member_keys
      SET key_hash = ${hash}, api_key = pgp_sym_encrypt(${key}, ${masterKey}, 'compress-algo=1, cipher-algo=aes256'),
        key_version = ${version}, pending_action = 'activate', key_created_at = NOW(), applied_limit = NULL, retained_cost = 0
      WHERE member_key_id = ${row.member_key_id} RETURNING *`;
    return memberKeySchema.parse(saved);
  }

  async detach(identityId: number, now: Date): Promise<void> {
    await this.client`UPDATE supporter_member_keys SET supporter_identity_id = NULL, disabled = true,
      pending_action = 'delete', detached_retention_started_at = GREATEST(${now}, renewal_due_at, target_period_end,
        (SELECT period_end FROM supporter_entitlements WHERE supporter_identity_id = ${identityId}))
      WHERE supporter_identity_id = ${identityId}`;
    await this.client`DELETE FROM supporter_identities WHERE supporter_identity_id = ${identityId}`;
  }

  async listDetachedForCleanup(): Promise<MemberKeyRow[]> {
    const rows = await this.client<unknown[]>`SELECT * FROM supporter_member_keys
      WHERE supporter_identity_id IS NULL AND (pending_action IS NOT NULL OR key_hash IS NOT NULL
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

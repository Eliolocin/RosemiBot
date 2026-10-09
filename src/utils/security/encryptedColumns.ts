import type { SQL } from "bun";
import { log } from "@/utils/misc/logger";
import { keyManager } from "@/utils/security/keyManager";

/** The legacy mirror remains recoverable until its credential column is removed by migration. */
export const ENCRYPTED_COLUMNS = [
  { table: "saved_provider_configs", id: "saved_config_id", column: "api_key" },
  { table: "user_saved_provider_configs", id: "user_saved_config_id", column: "api_key" },
  { table: "api_key_rotation", id: "rotation_key_id", column: "api_key" },
  { table: "opt_api_keys", id: "opt_api_key_id", column: "api_key" },
  { table: "guild_mcp_servers", id: "guild_mcp_id", column: "auth_token" },
  { table: "discord_managed_webhooks", id: "managed_webhook_id", column: "webhook_token" },
  { table: "server_model_configs", id: "server_id", column: "api_key" },
] as const;

export type EncryptedColumn = (typeof ENCRYPTED_COLUMNS)[number];
export interface EncryptedRow {
  id: number;
  ciphertext: Buffer;
  key_version: number | null;
}

const SCAN_BATCH_SIZE = 100;

/** Null tags predate versioning and contain V1 ciphertext, even when the current key is newer. */
export function storedKeyVersion(version: number | null): number {
  const effective = version ?? 1;
  if (!Number.isSafeInteger(effective) || effective < 1) throw new Error("Invalid stored encryption version.");
  return effective;
}

/** Missing canonical columns fail the scan; only a removed legacy mirror can be omitted. */
export async function* scanEncryptedRows(client: SQL): AsyncGenerator<{
  target: EncryptedColumn;
  row: EncryptedRow;
}> {
  for (const target of ENCRYPTED_COLUMNS) {
    try {
      if (target.table === "server_model_configs") {
        const columns = await client`
          SELECT 1 FROM pg_attribute
          WHERE attrelid = to_regclass(${`public.${target.table}`}) AND attname = ${target.column}
            AND NOT attisdropped AND attnum > 0
        `;
        if (columns.length === 0) continue;
      }
      let lastId = 0;
      while (true) {
        const rows = await client<EncryptedRow[]>`
          SELECT ${client(target.id)} AS id, ${client(target.column)} AS ciphertext, key_version
          FROM ${client(`public.${target.table}`)}
          WHERE ${client(target.column)} IS NOT NULL AND ${client(target.id)} > ${lastId}
            AND ${target.table === "api_key_rotation" ? client`is_main_key_pointer IS NOT TRUE` : client`TRUE`}
          ORDER BY ${client(target.id)} LIMIT ${SCAN_BATCH_SIZE}
        `;
        for (const row of rows) yield { target, row };
        if (rows.length < SCAN_BATCH_SIZE) break;
        lastId = rows[rows.length - 1].id;
      }
    } catch {
      // Database exceptions may contain bound master secrets or ciphertext.
      throw new Error(`Encrypted-column scan incomplete: ${target.table}.`);
    }
  }
}

/** Checks actual pgcrypto decryption without returning plaintext to the script process. */
export async function verifyCiphertext(client: SQL, ciphertext: Buffer, version: number): Promise<void> {
  try {
    const key = keyManager.getKey(version);
    const [result] = await client<{ valid: boolean }[]>`
      SELECT length(pgp_sym_decrypt(${ciphertext}, ${key})) > 0 AS valid
    `;
    if (!result?.valid) throw new Error("Empty credential.");
  } catch {
    throw new Error(`Credential recovery failed for V${version}. Check separately retained keys.`);
  }
}

/** A conditional update preserves a credential replaced after the scan and keeps its tag atomic. */
export async function rotateEncryptedRow(client: SQL, target: EncryptedColumn, row: EncryptedRow): Promise<void> {
  try {
    const oldKey = keyManager.getKey(storedKeyVersion(row.key_version));
    const currentKey = keyManager.getCurrentKey();
    const version = keyManager.getCurrentVersion();
    const updated = await client`
      UPDATE ${client(`public.${target.table}`)}
      SET ${client(target.column)} = pgp_sym_encrypt(pgp_sym_decrypt(${row.ciphertext}, ${oldKey}),
          ${currentKey}, 'compress-algo=1, cipher-algo=aes256'), key_version = ${version}
      WHERE ${client(target.id)} = ${row.id} AND ${client(target.column)} = ${row.ciphertext}
        AND key_version IS NOT DISTINCT FROM ${row.key_version}
        AND ${target.table === "api_key_rotation" ? client`is_main_key_pointer IS NOT TRUE` : client`TRUE`}
      RETURNING ${client(target.id)}
    `;
    if (updated.length !== 1) throw new Error("Concurrent credential replacement.");
  } catch {
    throw new Error(`Rotation failed or row changed: ${target.table}, row ${row.id}.`);
  }
}

/**
 * Re-encrypts a row that a running instance just decrypted under an older key. The row may have
 * been replaced since that read, so this reuses the conditional update and skips the row instead
 * of writing the stale credential back; a skipped row stays readable and rotates on a later read.
 */
export async function lazyRotateEncryptedRow(
  client: SQL,
  table: EncryptedColumn["table"],
  row: EncryptedRow,
): Promise<void> {
  if (storedKeyVersion(row.key_version) === keyManager.getCurrentVersion()) return;
  const target = ENCRYPTED_COLUMNS.find((column) => column.table === table) as EncryptedColumn;
  try {
    await rotateEncryptedRow(client, target, row);
  } catch (error) {
    log.warn(`Lazy key rotation skipped. ${(error as Error).message}`);
  }
}

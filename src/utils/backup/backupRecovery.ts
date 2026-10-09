import type { SQL } from "bun";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  ENCRYPTED_COLUMNS,
  type EncryptedColumn,
  storedKeyVersion,
  verifyCiphertext,
} from "@/utils/security/encryptedColumns";

/**
 * Validates pg_dump's default COPY format before destructive restore. Credential INSERT dumps
 * need a separate parser before they can be admitted; the backup command never produces them.
 */
async function* scanBackupCredentials(dumpPath: string): AsyncGenerator<{ ciphertext: Buffer; version: number }> {
  const input = createReadStream(dumpPath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let copy: { target?: EncryptedColumn; columns: string[] } | undefined;
  try {
    for await (const line of lines) {
      if (copy) {
        if (line === "\\.") {
          copy = undefined;
          continue;
        }
        if (!copy.target) continue;
        const fields = line.split("\t");
        if (fields.length !== copy.columns.length) throw new Error("Malformed COPY row.");
        const ciphertext = fields[copy.columns.indexOf(copy.target.column)];
        const pointerIndex = copy.columns.indexOf("is_main_key_pointer");
        if (ciphertext === "\\N" || (copy.target.table === "api_key_rotation" && fields[pointerIndex] === "t"))
          continue;
        // COPY escapes the bytea backslash, so pg_dump writes two backslashes before x.
        if (!/^\\\\x(?:[0-9a-fA-F]{2})+$/.test(ciphertext)) throw new Error("Unsupported ciphertext encoding.");
        const versionIndex = copy.columns.indexOf("key_version");
        const tag = versionIndex < 0 || fields[versionIndex] === "\\N" ? null : Number(fields[versionIndex]);
        const version = storedKeyVersion(tag);
        yield { ciphertext: Buffer.from(ciphertext.slice(3), "hex"), version };
        continue;
      }
      const match = line.match(/^COPY public\."?([a-z_]+)"? \((.+)\) FROM stdin;$/);
      if (match) {
        const columns = match[2].split(", ").map((column) => column.replaceAll('"', ""));
        const target = ENCRYPTED_COLUMNS.find((entry) => entry.table === match[1] && columns.includes(entry.column));
        copy = { target, columns };
      } else if (
        /^(?:COPY|INSERT INTO) /i.test(line) &&
        ENCRYPTED_COLUMNS.some((entry) => line.includes(entry.table))
      ) {
        throw new Error("Unsupported encrypted-table dump format.");
      }
    }
    if (copy) throw new Error("Truncated COPY data.");
  } catch {
    throw new Error("Backup credential inventory failed. Check that this is a complete default COPY-format pg_dump.");
  } finally {
    lines.close();
    input.destroy();
  }
}

/** Capture the dump's actual version tags without making data preservation depend on decryption. */
export async function inspectBackupKeyVersions(dumpPath: string): Promise<number[]> {
  const versions = new Set<number>();
  for await (const credential of scanBackupCredentials(dumpPath)) versions.add(credential.version);
  return [...versions].sort((a, b) => a - b);
}

/** Prove that separately provisioned keys recover every credential before destructive SQL runs. */
export async function verifyBackupRecovery(client: SQL, dumpPath: string): Promise<number[]> {
  // Fresh targets need decryption before the dump can install its own extensions.
  try {
    await client`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  } catch {
    throw new Error(
      "Recovery preflight could not enable pgcrypto. Install the extension on the target server and allow its creation, or have a database administrator enable it before retrying.",
    );
  }
  const versions = new Set<number>();
  for await (const { ciphertext, version } of scanBackupCredentials(dumpPath)) {
    await verifyCiphertext(client, ciphertext, version);
    versions.add(version);
  }
  return [...versions].sort((a, b) => a - b);
}

import { loadInitializedKeyManager } from "../lib/keyManagerBootstrap";
import { scanEncryptedRows, storedKeyVersion, verifyCiphertext } from "@/utils/security/encryptedColumns";

async function auditKeyVersions(): Promise<void> {
  const manager = await loadInitializedKeyManager();
  const { sql } = await import("@/utils/db/client");
  try {
    const counts = new Map<string, number>();
    let scanned = 0;
    let failed = 0;
    let incompleteQuery = false;
    try {
      for await (const { target, row } of scanEncryptedRows(sql)) {
        scanned++;
        let version: number | undefined;
        try {
          version = storedKeyVersion(row.key_version);
          const label = `${target.table}.${target.column} V${version}`;
          counts.set(label, (counts.get(label) ?? 0) + 1);
          await verifyCiphertext(sql, row.ciphertext, version);
        } catch {
          failed++;
          const reason =
            version === undefined
              ? "invalid version tag"
              : manager.getAvailableVersions().includes(version)
                ? `V${version} recovery failed`
                : `V${version} key unavailable`;
          console.error(`Credential check failed: ${target.table}.${target.column}, row ${row.id}, ${reason}.`);
        }
      }
    } catch (error) {
      incompleteQuery = true;
      // The inventory sanitizes query failures before they reach this boundary.
      console.error(error instanceof Error ? error.message : "Encrypted-column scan failed.");
    }
    console.log(`Current encryption version: V${manager.getCurrentVersion()}`);
    console.log(`Scanned: ${scanned}; failed recovery: ${failed}. Version tags include failed recovery:`);
    for (const [label, count] of counts) console.log(`${label}: ${count}`);
    if (failed > 0 || incompleteQuery) throw new Error("Incomplete audit.");
    console.log("Audit complete: every live credential scanned is decryptable.");
    console.log(
      "Live-row counts do not prove backup recovery. Keep a separate protected key archive for retained backups.",
    );
  } finally {
    await sql.close();
  }
}

await auditKeyVersions().catch(() => {
  console.error(
    "Audit incomplete: a query or credential recovery failed. Keep all encryption versions and check the selected secret source.",
  );
  process.exitCode = 1;
});

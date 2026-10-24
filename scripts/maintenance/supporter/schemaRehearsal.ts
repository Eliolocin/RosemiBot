/**
 * Rehearse the gated supporter billing schema initializer against a scratch
 * database (ideally a restored production snapshot) before enabling billing.
 *
 * Mirrors the release procedure in
 * plans/tomori_monetization/07-ci-cd-and-release-ops.md:
 *   1. Report whether supporter_% tables are present BEFORE init (they should be
 *      absent on a normal/disabled deployment that only ran shared migrations).
 *   2. Run the billing schema initializer twice to prove idempotency.
 *   3. Verify every expected supporter_% table is present afterwards.
 *
 * SAFETY: this CREATEs supporter_% tables, so it must only run against a scratch
 * database. The --confirm-scratch-db flag is required to proceed.
 *
 * Optionally validate production-shaped config/secrets with --validate-config.
 *
 * Usage:
 *   bun run scripts/maintenance/supporter/schemaRehearsal.ts --confirm-scratch-db
 *   bun run scripts/maintenance/supporter/schemaRehearsal.ts --confirm-scratch-db --validate-config
 */
import {
  checkSupporterBillingTablesExist,
  initializeSupporterBillingSchema,
  SUPPORTER_BILLING_TABLE_NAMES,
} from "@/modules/supporter-billing";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { parseArgs, printJson, requireSupporterConfig } from "./billingOps";

function summarizePresence(presence: Record<string, boolean>): { present: string[]; absent: string[] } {
  const present: string[] = [];
  const absent: string[] = [];
  for (const table of SUPPORTER_BILLING_TABLE_NAMES) {
    (presence[table] ? present : absent).push(table);
  }
  return { present, absent };
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.flags.has("confirm-scratch-db")) {
    throw new Error(
      "Refusing to run: this creates supporter_% tables. Re-run with --confirm-scratch-db against a scratch database only.",
    );
  }

  let configValidated = false;
  if (args.flags.has("validate-config")) {
    requireSupporterConfig({ validateSecrets: true });
    configValidated = true;
  }

  const before = summarizePresence(await checkSupporterBillingTablesExist(sql));

  // Run the initializer twice: the second pass must be a clean no-op, which is what proves idempotency.
  await initializeSupporterBillingSchema(sql);
  await initializeSupporterBillingSchema(sql);

  const after = summarizePresence(await checkSupporterBillingTablesExist(sql));
  const allPresent = after.absent.length === 0;

  printJson({
    configValidated,
    expectedTables: SUPPORTER_BILLING_TABLE_NAMES,
    before,
    after,
    idempotentInitRuns: 2,
    rehearsalOk: allPresent,
  });

  if (!allPresent) {
    throw new Error(`Schema rehearsal incomplete: missing tables ${after.absent.join(", ")}`);
  }
  log.success("Supporter billing schema rehearsal completed");
}

main()
  .catch((error) => {
    void log.error("Supporter billing schema rehearsal failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  });

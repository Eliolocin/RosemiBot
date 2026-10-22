import { inspectPatreonCreatorAuthorization, replacePatreonCreatorAuthorization } from "@/modules/supporter-billing/db";
import { getPatreonOAuthCredentials } from "@/modules/supporter-billing/patreon/settings";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { loadInitializedKeyManager } from "../../lib/keyManagerBootstrap";

async function main(): Promise<void> {
  await loadInitializedKeyManager();
  const { parseArgs, printJson, requireSupporterConfig } = await import("./billingOps");
  const args = parseArgs();
  const config = requireSupporterConfig({ validateSecrets: true });
  if (!args.flags.has("execute")) {
    printJson({
      dryRun: true,
      action: "replace_creator_authorization",
      status: await inspectPatreonCreatorAuthorization(config.patreon.campaignId),
    });
    return;
  }
  const credentials = getPatreonOAuthCredentials(config);
  const refreshToken = process.env[config.patreon.creatorRefreshTokenEnv]?.trim();
  if (!refreshToken) throw new Error("Creator refresh token bootstrap secret is required.");
  await replacePatreonCreatorAuthorization(config.patreon.campaignId, credentials.clientId, refreshToken);
  printJson({ replaced: true, restartRequired: true });
}

main()
  .catch(() => {
    log.warn("Patreon creator reauthorization failed; check the configured secrets and database.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  });

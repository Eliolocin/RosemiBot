import { loadInitializedKeyManager } from "../../lib/keyManagerBootstrap";

async function main(): Promise<void> {
  await loadInitializedKeyManager();
  const { getOptionalString, parseArgs, printJson, requireSupporterConfig } = await import("./billingOps");
  const { isSupporterBillingEnabled } = await import("@/modules/supporter-billing/config");
  const { resolveEnvironment } = await import("@/types/config");
  if (!isSupporterBillingEnabled(resolveEnvironment())) throw new Error("Production billing must be enabled");
  const args = parseArgs();
  const modes = ["rotate", "unlink", "reconcile"].filter((mode) => args.flags.has(mode));
  if (modes.length !== 1) throw new Error("Specify exactly one mode: --rotate, --unlink, or --reconcile");
  const mode = modes[0];
  const discordUserId = getOptionalString(args, "discord-user-id");
  const requestId = getOptionalString(args, "request-id");
  if (mode !== "reconcile" && !discordUserId) throw new Error("--discord-user-id is required");
  if (mode === "rotate" && !requestId)
    throw new Error("--request-id must be a UUID reused for every retry of this incident");
  const config = requireSupporterConfig();
  if (!args.flags.has("execute")) {
    printJson({ dryRun: true, mode, discordUserId, requestId });
    return;
  }
  const { sql } = await import("@/utils/db/client");
  try {
    const { reconcileMemberKeys, rotateSupporterMemberKey, unlinkSupporterIdentity } = await import(
      "@/modules/supporter-billing/openrouter/memberKeys"
    );
    if (mode === "reconcile") await reconcileMemberKeys({ config });
    else if (mode === "unlink" && discordUserId) await unlinkSupporterIdentity({ config, discordUserId });
    else if (discordUserId && requestId) {
      const { SupporterIdentityRepository } = await import("@/modules/supporter-billing/db/repositories");
      const identity = await new SupporterIdentityRepository(sql).loadByDiscordUserId(discordUserId);
      if (!identity) throw new Error("Supporter identity was not found");
      await rotateSupporterMemberKey({ config, supporterIdentityId: identity.supporter_identity_id, requestId });
    }
    printJson({ completed: true, mode, discordUserId, requestId });
  } finally {
    await sql.close();
  }
}

await main().catch(() => {
  console.error(
    "Member-key maintenance failed. Check arguments, production secrets, provider availability, and database recovery; retry with the same request ID.",
  );
  process.exitCode = 1;
});

import { isSupporterBillingEnabled } from "@/modules/supporter-billing/config";
import {
  isSupporterEntitlementActive,
  supporterEntitlementRepository,
  supporterIdentityRepository,
  supporterSponsorshipRepository,
} from "@/modules/supporter-billing/db";
import { resolveEnvironment } from "@/types/config";
import type { StreamContext, ProviderError } from "@/types/stream/interfaces";
import { log } from "@/utils/misc/logger";
import {
  isAccountBalanceExhaustedError,
  isCreditAffordabilityError,
} from "@/utils/provider/providerErrorClassification";

type NudgeContext = {
  userDiscId?: string;
  serverId?: number | null;
  credentialSource: StreamContext["textCredentialSource"];
} & ({ event: "provider-error"; error: ProviderError } | { event: "completion" });

interface NudgeDependencies {
  identities: Pick<typeof supporterIdentityRepository, "loadByDiscordUserId">;
  entitlements: Pick<typeof supporterEntitlementRepository, "loadByIdentityId">;
  sponsorships: Pick<typeof supporterSponsorshipRepository, "loadActiveSponsorshipForServer">;
}

export async function resolveSupporterNudgeKey(
  context: NudgeContext,
  dependencies: NudgeDependencies = {
    identities: supporterIdentityRepository,
    entitlements: supporterEntitlementRepository,
    sponsorships: supporterSponsorshipRepository,
  },
): Promise<string | null> {
  if (
    !isSupporterBillingEnabled(resolveEnvironment()) ||
    !context.userDiscId ||
    (context.credentialSource !== "server" && context.credentialSource !== "personal")
  ) {
    return null;
  }
  if (context.event === "provider-error") {
    const error = context.error;
    if (
      error.type !== "rate_limit" &&
      error.type !== "provider_overloaded" &&
      error.code !== "503" &&
      !isAccountBalanceExhaustedError(error) &&
      !isCreditAffordabilityError(error)
    ) {
      return null;
    }
  }
  try {
    if (context.serverId && (await dependencies.sponsorships.loadActiveSponsorshipForServer(context.serverId))) {
      return null;
    }
    const identity = await dependencies.identities.loadByDiscordUserId(context.userDiscId);
    if (identity) {
      const entitlement = await dependencies.entitlements.loadByIdentityId(identity.supporter_identity_id);
      if (!entitlement || isSupporterEntitlementActive(entitlement)) return null;
    }
    return "commands.subscribe.conversion_nudge";
  } catch {
    log.warn("Subscription conversion eligibility could not be checked", {
      metadata: { event: context.event, credentialSource: context.credentialSource },
    });
    return null;
  }
}

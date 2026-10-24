import { isSupporterBillingEnabled } from "@/modules/supporter-billing/config";
import {
  isSupporterEntitlementActive,
  supporterEntitlementRepository,
  supporterIdentityRepository,
  supporterSponsorshipRepository,
} from "@/modules/supporter-billing/db";
import { resolveEnvironment } from "@/types/config";
import type { StreamContext } from "@/types/stream/interfaces";
import { log } from "@/utils/misc/logger";

export interface SupporterNudgeContext {
  userDiscId?: string;
  serverId?: number | null;
  credentialSource: StreamContext["textCredentialSource"];
}

interface NudgeDependencies {
  identities: Pick<typeof supporterIdentityRepository, "loadByDiscordUserId">;
  entitlements: Pick<typeof supporterEntitlementRepository, "loadByIdentityId">;
  sponsorships: Pick<typeof supporterSponsorshipRepository, "loadActiveSponsorshipForServer">;
}

export async function resolveSupporterNudgeKey(
  context: SupporterNudgeContext,
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
      metadata: { credentialSource: context.credentialSource },
    });
    return null;
  }
}

/** Appends the subscription tip to a failure's recovery tips when the user is eligible for it. */
export async function withSupporterNudge(tipKeys: string[], context: SupporterNudgeContext): Promise<string[]> {
  const nudgeKey = await resolveSupporterNudgeKey(context);
  return nudgeKey ? [...tipKeys, nudgeKey] : tipKeys;
}

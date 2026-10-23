import type { AppEnvironment } from "@/types/config";
import { resolveEnvironment } from "@/types/config";
import {
  isSupporterBillingEnabled,
  parseSupporterBillingConfigJson,
  type SupporterBillingConfig,
  type SupporterCapability,
} from "@/modules/supporter-billing/config";
import {
  supporterEntitlementRepository,
  supporterIdentityRepository,
  supporterSponsorshipRepository,
  isSupporterEntitlementActive,
  type SupporterEntitlementRepository,
  type SupporterIdentityRepository,
  type SupporterSponsorshipRepository,
} from "@/modules/supporter-billing/db";
import type {
  SupporterFundingContext,
  SupporterFundingFailureDetails,
  SupporterFundingResult,
  SupporterFundingScope,
  SupporterRequestDenialFacts,
} from "@/modules/supporter-billing/runtime/types";
import { getSupporterUsageContext } from "@/modules/supporter-billing/runtime/types";
import { getSupporterRequestFailureCopy } from "@/modules/supporter-billing/discord/requestFailure";
import { ProviderRequestDeniedError } from "@/utils/provider/providerUsage";
import { log } from "@/utils/misc/logger";
import { findOpenRouterLimitError, type OpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";

type EnvRecord = Readonly<Record<string, string | undefined>>;

export interface SupporterFundingRepositories {
  identityRepository?: Pick<SupporterIdentityRepository, "loadById" | "loadByUserId">;
  entitlementRepository?: Pick<SupporterEntitlementRepository, "loadByIdentityId">;
  sponsorshipRepository?: Pick<SupporterSponsorshipRepository, "loadActiveSponsorshipForServer">;
}

export async function resolveSupporterFunding(params: {
  scope: SupporterFundingScope;
  capability: SupporterCapability;
  requestedModelCodename?: string | null;
  at?: Date;
  environment?: AppEnvironment;
  env?: EnvRecord;
  config?: SupporterBillingConfig;
  repositories?: SupporterFundingRepositories;
}): Promise<SupporterFundingResult> {
  const env = params.env ?? process.env;
  if (!isSupporterBillingEnabled(params.environment ?? resolveEnvironment(), env))
    return { ok: false, reason: "billing_unavailable" };
  const identityRepository = params.repositories?.identityRepository ?? supporterIdentityRepository;
  const entitlementRepository = params.repositories?.entitlementRepository ?? supporterEntitlementRepository;
  const sponsorshipRepository = params.repositories?.sponsorshipRepository ?? supporterSponsorshipRepository;
  try {
    const config = params.config ?? parseSupporterBillingConfigJson(env.TOMORI_SUPPORTER_CONFIG_JSON);
    const sponsorship =
      params.scope.kind === "server"
        ? await sponsorshipRepository.loadActiveSponsorshipForServer(params.scope.serverId)
        : null;
    const fundingScope =
      params.scope.kind === "personal"
        ? {
            fundingScope: "personal" as const,
            sponsorshipId: null,
            serverId: null,
            personalUserId: params.scope.userId,
          }
        : sponsorship
          ? {
              fundingScope: "server" as const,
              sponsorshipId: sponsorship.sponsorship_id,
              serverId: sponsorship.server_id,
              personalUserId: null,
            }
          : null;
    if (!fundingScope) return { ok: false, reason: "missing_sponsorship" };
    const sponsorIdentity =
      params.scope.kind === "personal"
        ? await identityRepository.loadByUserId(params.scope.userId)
        : sponsorship
          ? await identityRepository.loadById(sponsorship.sponsor_identity_id)
          : null;
    if (!sponsorIdentity)
      return { ok: false, reason: params.scope.kind === "personal" ? "missing_subscription" : "inconsistent" };
    const entitlement = await entitlementRepository.loadByIdentityId(sponsorIdentity.supporter_identity_id);
    if (!entitlement) return { ok: false, reason: "inconsistent" };
    if (!isSupporterEntitlementActive(entitlement, params.at)) return { ok: false, reason: "inactive_entitlement" };
    const tier = config.tiers[entitlement.tier_key];
    if (!tier) return { ok: false, reason: "unconfigured_tier" };
    const configuredDefault =
      params.capability === "voice"
        ? (tier.defaultModelByCapability.voice?.clone ?? tier.defaultModelByCapability.voice?.design)
        : tier.defaultModelByCapability[params.capability];
    const modelCodename = params.requestedModelCodename?.trim() || configuredDefault;
    if (!modelCodename || !tier.defaultModelByCapability[params.capability])
      return { ok: false, reason: "model_not_allowed" };
    const base = {
      credentialSource: "supporter" as const,
      provider: "openrouter" as const,
      capability: params.capability,
      modelCodename,
      tierKey: entitlement.tier_key,
      sponsorIdentityId: sponsorIdentity.supporter_identity_id,
      sponsorDiscordUserId: sponsorIdentity.discord_user_id,
      entitlementId: entitlement.supporter_entitlement_id,
      renewalAt: entitlement.next_charge_at,
    };
    const context: SupporterFundingContext = { ...base, ...fundingScope };
    return { ok: true, context, config, tier, state: { sponsorship, sponsorIdentity, entitlement } };
  } catch {
    log.warn("Supporter funding resolution failed", {
      metadata: { fundingScope: params.scope.kind, capability: params.capability },
    });
    return { ok: false, reason: "billing_unavailable" };
  }
}

export class SupporterRequestDeniedError extends ProviderRequestDeniedError {
  constructor(
    public readonly reason: SupporterRequestDenialFacts["reason"],
    public readonly details?: SupporterFundingFailureDetails,
    public readonly capability: SupporterCapability = "text",
    public readonly fundingScope: "personal" | "server" = "server",
    funding?: SupporterFundingContext,
  ) {
    const facts: SupporterRequestDenialFacts = { reason, details, capability, fundingScope };
    super(
      funding ? getSupporterUsageContext(funding) : undefined,
      (locale, forFallback) => getSupporterRequestFailureCopy(facts, locale, forFallback),
      { deferNotice: reason === "allowance_exhausted" || reason === "capacity_unavailable" },
    );
    this.name = "SupporterRequestDeniedError";
  }
}

const alertedCapacityFailures = new WeakSet<OpenRouterLimitError>();

/**
 * With the funding that paid for the failed request, an OpenRouter limit rejection is also translated,
 * because the member key's own cap means a spent allowance while the account balance and in-flight
 * budget are operator capacity that no member caused.
 */
export function findSupporterRequestDeniedError(
  error: unknown,
  funding?: SupporterFundingContext | null,
): SupporterRequestDeniedError | null {
  const usageContext = funding ? getSupporterUsageContext(funding) : undefined;
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if (current instanceof SupporterRequestDeniedError) {
      if (!funding) return current;
      // A denial another request already owns must not be reattributed to this one.
      if (current.usageContext && current.usageContext !== usageContext) return null;
      return new SupporterRequestDeniedError(
        current.reason,
        current.reason === "allowance_exhausted"
          ? { ...current.details, periodEnd: funding.renewalAt ?? current.details?.periodEnd }
          : current.details,
        funding.capability,
        funding.fundingScope,
        funding,
      );
    }
    current = "originalError" in current ? current.originalError : "cause" in current ? current.cause : null;
  }
  const limit = funding ? findOpenRouterLimitError(error) : null;
  if (!funding || !limit) return null;
  if (limit.limitSource === "openrouter_key_limit") {
    return new SupporterRequestDeniedError(
      "allowance_exhausted",
      {
        periodEnd: funding.renewalAt ?? undefined,
        minimumBalanceUsd: limit.minimumBalanceUsd,
        modelCodename: funding.modelCodename,
      },
      funding.capability,
      funding.fundingScope,
      funding,
    );
  }
  if (!alertedCapacityFailures.has(limit)) {
    alertedCapacityFailures.add(limit);
    void log.error("OpenRouter operator capacity rejected a subscription request", limit, {
      errorType: "SupporterOperatorCapacity",
      metadata: {
        limitSource: limit.limitSource,
        status: limit.status,
        retryAfterMs: limit.retryAfterMs,
        capability: funding.capability,
        fundingScope: funding.fundingScope,
      },
    });
  }
  return new SupporterRequestDeniedError(
    "capacity_unavailable",
    limit.limitSource === "openrouter_credits"
      ? { retryable: false }
      : limit.retryAfterMs === null
        ? { retryable: true }
        : { retryable: true, retryAt: new Date(Date.now() + limit.retryAfterMs) },
    funding.capability,
    funding.fundingScope,
    funding,
  );
}

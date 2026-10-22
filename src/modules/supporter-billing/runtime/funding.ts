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
  SupporterFundingFailureDetails,
  SupporterFundingFailureReason,
  SupporterFundingContext,
  SupporterFundingResult,
  SupporterFundingScope,
} from "@/modules/supporter-billing/runtime/types";
import { log } from "@/utils/misc/logger";
import { findOpenRouterLimitError, type OpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";

type EnvRecord = Readonly<Record<string, string | undefined>>;

export interface SupporterFundingRepositories {
  identityRepository?: Pick<SupporterIdentityRepository, "loadById" | "loadByUserId">;
  entitlementRepository?: Pick<SupporterEntitlementRepository, "loadByIdentityId">;
  sponsorshipRepository?: Pick<SupporterSponsorshipRepository, "loadActiveSponsorshipForServer">;
}

const SUPPORTER_TEXT_FAILURE_DESCRIPTION_KEYS: Record<SupporterFundingFailureReason, string> = {
  billing_unavailable: "commands.subscribe.sponsorship.errors.billing_unavailable",
  missing_sponsorship: "commands.subscribe.sponsorship.errors.missing_sponsorship",
  missing_subscription: "commands.subscribe.sponsorship.errors.unlinked",
  inconsistent: "commands.subscribe.sponsorship.errors.inconsistent",
  inactive_entitlement: "commands.subscribe.sponsorship.errors.inactive",
  unconfigured_tier: "commands.subscribe.sponsorship.errors.unconfigured_tier",
  allowance_exhausted: "commands.subscribe.sponsorship.errors.exhausted",
  model_not_allowed: "commands.subscribe.sponsorship.errors.model_not_allowed",
};

function formatDiscordTimestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:D>`;
}

export function getSupporterFundingFailureDescriptionKey(
  reason: SupporterFundingFailureReason,
  details?: SupporterFundingFailureDetails,
): string {
  if (details?.periodEnd && reason === "allowance_exhausted") {
    return "commands.subscribe.sponsorship.errors.exhausted_generation";
  }

  return SUPPORTER_TEXT_FAILURE_DESCRIPTION_KEYS[reason];
}

export function getSupporterFundingFailureDescriptionVars(
  details?: SupporterFundingFailureDetails,
): Record<string, string> {
  return {
    period_end: details?.periodEnd ? formatDiscordTimestamp(details.periodEnd) : "",
  };
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

export class SupporterRequestDeniedError extends Error {
  constructor(
    public readonly reason:
      | "unsupported_capability"
      | "model_unavailable"
      | "capacity_unavailable"
      | SupporterFundingFailureReason,
    public readonly details?: SupporterFundingFailureDetails,
    public readonly capability: SupporterCapability = "text",
    public readonly fundingScope: "personal" | "server" = "server",
  ) {
    super(`Supporter request denied: ${reason}`);
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
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if (current instanceof SupporterRequestDeniedError) {
      return funding
        ? new SupporterRequestDeniedError(
            current.reason,
            current.reason === "allowance_exhausted"
              ? { ...current.details, periodEnd: funding.renewalAt ?? current.details?.periodEnd }
              : current.details,
            funding.capability,
            funding.fundingScope,
          )
        : current;
    }
    current = "originalError" in current ? current.originalError : "cause" in current ? current.cause : null;
  }
  const limit = funding ? findOpenRouterLimitError(error) : null;
  if (!funding || !limit) return null;
  if (limit.limitSource === "openrouter_key_limit") {
    return new SupporterRequestDeniedError(
      "allowance_exhausted",
      funding.renewalAt ? { periodEnd: funding.renewalAt } : undefined,
      funding.capability,
      funding.fundingScope,
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
  );
}

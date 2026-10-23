import type {
  SupporterEntitlementRow,
  SupporterIdentityRow,
  SupporterServerSponsorshipRow,
} from "@/modules/supporter-billing/db";
import type {
  SupporterBillingConfig,
  SupporterBillingTierConfig,
  SupporterCapability,
} from "@/modules/supporter-billing/config";
import type { ProviderUsageContext } from "@/utils/provider/providerUsage";

declare module "@/utils/provider/providerUsage" {
  interface ProviderUsageContext {
    /** Request ownership for a member-funded provider call; absent on server-key calls. */
    readonly supporterFunding?: SupporterFundingContext;
  }
}

export type SupporterFundingFailureReason =
  | "billing_unavailable"
  | "missing_sponsorship"
  | "missing_subscription"
  | "inconsistent"
  | "inactive_entitlement"
  | "unconfigured_tier"
  | "allowance_exhausted"
  | "model_not_allowed";

interface SupporterFundingBase {
  credentialSource: "supporter";
  provider: "openrouter";
  capability: SupporterCapability;
  modelCodename: string;
  tierKey: string;
  sponsorIdentityId: number;
  sponsorDiscordUserId: string;
  entitlementId: number;
  renewalAt: Date | null;
}

export type SupporterFundingScope = { kind: "server"; serverId: number } | { kind: "personal"; userId: number };

export type SupporterFundingContext = SupporterFundingBase &
  (
    | { fundingScope: "server"; sponsorshipId: number; serverId: number; personalUserId: null }
    | { fundingScope: "personal"; sponsorshipId: null; serverId: null; personalUserId: number }
  );

export interface SupporterFundingLoadedState {
  sponsorship: SupporterServerSponsorshipRow | null;
  sponsorIdentity: SupporterIdentityRow;
  entitlement: SupporterEntitlementRow;
}

export interface SupporterFundingFailureDetails {
  periodEnd?: Date;
  retryAt?: Date;
  /** False when capacity returns only after the operator adds credit, so retrying cannot help. */
  retryable?: boolean;
}

export interface SupporterProviderFailure {
  reason: "allowance_exhausted" | "capacity_unavailable";
  funding: SupporterFundingContext;
  details?: SupporterFundingFailureDetails;
}

export type SupporterFundingResult =
  | {
      ok: true;
      context: SupporterFundingContext;
      state: SupporterFundingLoadedState;
      config: SupporterBillingConfig;
      tier: SupporterBillingTierConfig;
    }
  | {
      ok: false;
      reason: Exclude<SupporterFundingFailureReason, "allowance_exhausted">;
    };

export interface SupporterRequestDenialFacts {
  reason: SupporterFundingFailureReason | "unsupported_capability" | "model_unavailable" | "capacity_unavailable";
  details?: SupporterFundingFailureDetails;
  capability: SupporterCapability;
  fundingScope: "personal" | "server";
}

export interface SupporterUsageContext extends ProviderUsageContext {
  readonly supporterFunding: SupporterFundingContext;
}

const usageContexts = new WeakMap<SupporterFundingContext, SupporterUsageContext>();

/**
 * One canonical context per funding object, because request ownership is compared by identity
 * between credentials, spend refusals, the denial translator and stream presentation.
 */
export function getSupporterUsageContext(funding: SupporterFundingContext): SupporterUsageContext {
  const existing = usageContexts.get(funding);
  if (existing) return existing;
  const context: SupporterUsageContext = { supporterFunding: funding };
  usageContexts.set(funding, context);
  return context;
}

export function getSupporterFundingFromUsageContext(
  context: ProviderUsageContext | null | undefined,
): SupporterFundingContext | null {
  return context?.supporterFunding ?? null;
}

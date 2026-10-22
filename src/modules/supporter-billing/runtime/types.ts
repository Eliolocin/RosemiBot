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

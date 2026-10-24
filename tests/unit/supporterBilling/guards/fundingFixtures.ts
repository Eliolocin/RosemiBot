import { OpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import type { SupporterCapability } from "@/modules/supporter-billing/config";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import type {
  SupporterFundingContext,
  SupporterFundingFailureDetails,
} from "@/modules/supporter-billing/runtime/types";
import { getSupporterUsageContext } from "@/modules/supporter-billing/runtime/types";
import type { VoiceMessageSynthesisResult } from "@/utils/speech/voiceMessageSynthesis";
import type { VisionCallResult } from "@/utils/provider/visionCaption";
import type { ToolContext } from "@/types/tool/interfaces";
import type { ResolvedCredentials } from "@/utils/provider/credentialResolver";

const BASE_FUNDING = {
  credentialSource: "supporter",
  provider: "openrouter",
  capability: "text",
  modelCodename: "synthetic/guard-model",
  tierKey: "synthetic-tier",
  sponsorIdentityId: 41,
  sponsorDiscordUserId: "synthetic-sponsor",
  entitlementId: 17,
  renewalAt: null,
} as const;

// Keep request ownership and failure shapes here so guard assertions survive provider hook changes.
type FundingOverrides = Partial<
  Omit<SupporterFundingContext, "fundingScope" | "sponsorshipId" | "serverId" | "personalUserId">
> &
  (
    | { fundingScope?: "server"; sponsorshipId?: number; serverId?: number; personalUserId?: null }
    | { fundingScope: "personal"; sponsorshipId?: null; serverId?: null; personalUserId?: number }
  );

type CredentialOverrides = Partial<Omit<ResolvedCredentials, "supporterFunding" | "usageContext">>;

export function createSupporterFunding(overrides: FundingOverrides = {}): SupporterFundingContext {
  if (overrides.fundingScope === "personal") {
    return {
      ...BASE_FUNDING,
      sponsorshipId: null,
      serverId: null,
      personalUserId: 1,
      ...overrides,
    };
  }
  return {
    ...BASE_FUNDING,
    fundingScope: "server",
    sponsorshipId: 9,
    serverId: 3,
    personalUserId: null,
    ...overrides,
  };
}

export function createSupporterCredentials({
  funding = createSupporterFunding(),
  ...overrides
}: CredentialOverrides & { funding?: SupporterFundingContext } = {}): ResolvedCredentials {
  return {
    provider: "openrouter",
    apiKey: "synthetic-supporter-key",
    keyVersion: 1,
    savedConfig: null,
    source: funding.fundingScope,
    modelId: 12,
    supporterFunding: funding,
    usageContext: getSupporterUsageContext(funding),
    ...overrides,
  };
}

export function createUnfundedCredentials(overrides: CredentialOverrides = {}): ResolvedCredentials {
  return {
    provider: "openrouter",
    apiKey: "synthetic-byok-key",
    keyVersion: 1,
    savedConfig: null,
    source: "server",
    modelId: 12,
    ...overrides,
  };
}

export function withSupporterFunding(context: ToolContext, funding: SupporterFundingContext): ToolContext {
  return { ...context, usageContext: getSupporterUsageContext(funding) };
}

export function withResolvedSupporterFunding(context: ToolContext, credentials: ResolvedCredentials): ToolContext {
  if (!credentials.usageContext) throw new Error("Expected funded credentials from the resolver");
  return { ...context, usageContext: credentials.usageContext };
}

export function createSupporterDenial(
  overrides: {
    funding?: SupporterFundingContext;
    reason?: SupporterRequestDeniedError["reason"];
    details?: SupporterFundingFailureDetails;
    capability?: SupporterCapability;
    fundingScope?: "personal" | "server";
  } = {},
): SupporterRequestDeniedError {
  return new SupporterRequestDeniedError(
    overrides.reason ?? "allowance_exhausted",
    overrides.details,
    overrides.funding?.capability ?? overrides.capability ?? "text",
    overrides.funding?.fundingScope ?? overrides.fundingScope ?? "server",
    overrides.funding,
  );
}

export function createVisionSupporterFailure(
  overrides: Parameters<typeof createSupporterDenial>[0] = {},
): VisionCallResult {
  return {
    ok: false,
    requestDenied: createSupporterDenial({ capability: "vision", fundingScope: "server", ...overrides }),
    failure: { reason: "request_failed" },
  };
}

export function createVoiceSupporterFailure(
  overrides: Parameters<typeof createSupporterDenial>[0] = {},
): VoiceMessageSynthesisResult {
  return {
    success: false,
    backendKey: "tts-clone",
    requestDenied: createSupporterDenial({ capability: "voice", fundingScope: "server", ...overrides }),
  };
}

export function createProviderLimitFailure(): Error {
  return new OpenRouterLimitError("openrouter_key_limit", 402, null);
}

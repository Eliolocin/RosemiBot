import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import { readOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import {
  SupporterRequestDeniedError,
  findSupporterRequestDeniedError,
} from "@/modules/supporter-billing/runtime/funding";
import { getSupporterUsageContext, type SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import { findProviderRequestDeniedError, reportProviderUsage } from "@/utils/provider/providerUsage";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

const REVIEW_AT = new Date("2027-01-01T00:00:00Z");

function createFunding(overrides: Partial<SupporterFundingContext> = {}): SupporterFundingContext {
  return {
    credentialSource: "supporter",
    provider: "openrouter",
    capability: "text",
    modelCodename: "fixture/model",
    tierKey: "fixture-tier",
    sponsorIdentityId: 41,
    sponsorDiscordUserId: "fixture-sponsor",
    entitlementId: 17,
    renewalAt: REVIEW_AT,
    fundingScope: "server",
    sponsorshipId: 9,
    serverId: 3,
    personalUserId: null,
    ...overrides,
  } as SupporterFundingContext;
}

function keyLimitFailure(): Error {
  return new Error("OpenRouter rejected the request", {
    cause:
      readOpenRouterLimitError(
        402,
        new Headers(),
        JSON.stringify({ error: { code: 402, metadata: { limit_source: "openrouter_key_limit" } } }),
      ) ?? undefined,
  });
}

describe("supporter usage context identity", () => {
  it("converts one funding object to one stable context", () => {
    const funding = createFunding();

    expect(getSupporterUsageContext(funding)).toBe(getSupporterUsageContext(funding));
    expect(getSupporterUsageContext(funding).supporterFunding).toBe(funding);
    expect(getSupporterUsageContext(createFunding())).not.toBe(getSupporterUsageContext(funding));
  });
});

describe("supporter usage reporter", () => {
  it("records the report against the funding the context owns", () => {
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    try {
      const funding = createFunding({ capability: "image", modelCodename: "fixture/image" });
      reportProviderUsage(getSupporterUsageContext(funding), {
        modelCodename: "fixture/image",
        costUsd: 0.02,
        inputTokens: 10,
        outputTokens: 2,
        providerRequestId: "fixture-job",
      });

      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0]?.[0]).toMatchObject({
        supporterIdentityId: funding.sponsorIdentityId,
        fundingScope: "server",
        serverId: funding.serverId,
        capability: "image",
        modelCodename: "fixture/image",
        costUsd: 0.02,
        inputTokens: 10,
        outputTokens: 2,
        providerRequestId: "fixture-job",
      });
    } finally {
      record.mockRestore();
    }
  });

  it("records nothing for a generic context with no funding", () => {
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    try {
      reportProviderUsage({}, { modelCodename: "fixture/byok", costUsd: 0.02 });
      expect(record).not.toHaveBeenCalled();
    } finally {
      record.mockRestore();
    }
  });
});

describe("supporter denial translation", () => {
  it("translates a provider key limit against the request's own funding", () => {
    const funding = createFunding();
    const context = getSupporterUsageContext(funding);

    const denied = findProviderRequestDeniedError(keyLimitFailure(), context);

    expect(denied).toBeInstanceOf(SupporterRequestDeniedError);
    expect(denied?.usageContext).toBe(context);
    expect(denied?.deferNotice).toBe(true);
    expect(denied).toMatchObject({
      reason: "allowance_exhausted",
      details: { periodEnd: REVIEW_AT },
      capability: "text",
      fundingScope: "server",
    });
  });

  it("rejects a nested denial owned by another request instead of reattributing it", () => {
    const first = getSupporterUsageContext(createFunding());
    const secondFunding = createFunding({ sponsorIdentityId: 99, sponsorshipId: 12 });
    const second = getSupporterUsageContext(secondFunding);
    const owned = findProviderRequestDeniedError(keyLimitFailure(), first);
    if (!owned) throw new Error("Expected the key limit to translate");

    expect(findProviderRequestDeniedError(owned, first)).toBe(owned);
    expect(findProviderRequestDeniedError(owned, second)).toBeNull();
    expect(findProviderRequestDeniedError(new Error("nested", { cause: owned }), second)).toBeNull();
    expect(findSupporterRequestDeniedError(new Error("nested", { cause: owned }), secondFunding)).toBeNull();
  });

  it("propagates an unscoped credential refusal and defers only fallback-owned reasons", () => {
    const unscoped = new SupporterRequestDeniedError("inactive_entitlement");

    expect(findProviderRequestDeniedError(unscoped)).toBe(unscoped);
    expect(findProviderRequestDeniedError(new Error("wrapped", { cause: unscoped }), undefined)).toBe(unscoped);
    expect(unscoped.usageContext).toBeUndefined();
    expect(unscoped.deferNotice).toBe(false);
    expect(new SupporterRequestDeniedError("allowance_exhausted").deferNotice).toBe(true);
    expect(new SupporterRequestDeniedError("capacity_unavailable").deferNotice).toBe(true);
  });

  it("renders localized renewal-aware copy through the generic renderer", () => {
    const context = getSupporterUsageContext(createFunding());
    const denied = findProviderRequestDeniedError(keyLimitFailure(), context);
    if (!denied) throw new Error("Expected the key limit to translate");

    const copy = denied.render("en-US", false);
    expect(copy.titleKey).toBe("commands.subscribe.request.allowance_title");
    expect(copy.description.length).toBeGreaterThan(0);
  });
});

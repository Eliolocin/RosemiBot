import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import {
  getSupporterRequestFailureCopy,
  notifySupporterToolFailure,
} from "@/modules/supporter-billing/discord/requestFailure";
import * as embedHelper from "@/utils/discord/embedHelper";
import type { ToolContext } from "@/types/tool/interfaces";
import {
  findSupporterRequestDeniedError,
  SupporterRequestDeniedError,
} from "@/modules/supporter-billing/runtime/funding";
import { recordSupporterUsage } from "@/modules/supporter-billing/runtime/usageStatistics";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import {
  OpenRouterLimitError,
  findOpenRouterLimitError,
  readOpenRouterLimitError,
  readOpenRouterLimitResponse,
} from "@/providers/openrouter/openrouterLimit";
import { log } from "@/utils/misc/logger";
import { hasLocaleKey, initializeLocalizer } from "@/utils/text/localizer";
import { expectForEveryLocale, localizedCopy, localizedProse } from "../../helpers/localeCases";

const renewalAt = new Date("2026-11-01T00:00:00Z");

function funding(fundingScope: "personal" | "server" = "server"): SupporterFundingContext {
  const base = {
    credentialSource: "supporter" as const,
    provider: "openrouter" as const,
    capability: "image" as const,
    modelCodename: "example/image-model",
    tierKey: "test_tier",
    sponsorIdentityId: 10,
    sponsorDiscordUserId: "sponsor_disc_1",
    entitlementId: 20,
    renewalAt,
  };
  return fundingScope === "server"
    ? { ...base, fundingScope, sponsorshipId: 40, serverId: 7, personalUserId: null }
    : { ...base, fundingScope, sponsorshipId: null, serverId: null, personalUserId: 70 };
}

function limitBody(limitSource: string): string {
  return JSON.stringify({
    error: {
      code: 402,
      message: "Request rejected by a spending limit.",
      metadata: { limit_source: limitSource, remedy_hint: "Provider prose that callers must not branch on." },
    },
  });
}

/** The HTTP failure shape a transport wraps, with the parsed limit kept as its cause. */
function transportFailure(status: number, body: string, headers: Record<string, string> = {}): Error {
  return new Error(`HTTP ${status}`, {
    cause: readOpenRouterLimitError(status, new Headers(headers), body) ?? undefined,
  });
}

let errorSpy: ReturnType<typeof spyOn> | null = null;

afterEach(() => {
  errorSpy?.mockRestore();
  errorSpy = null;
});

describe("OpenRouter limit responses", () => {
  it("uses the request funding context when a shared member key was last resolved for another scope", () => {
    const error = new SupporterRequestDeniedError("allowance_exhausted", undefined, "voice", "server");
    expect(findSupporterRequestDeniedError(error, funding("personal"))).toMatchObject({
      reason: "allowance_exhausted",
      capability: "image",
      fundingScope: "personal",
      details: { periodEnd: renewalAt },
    });
  });
  it("identifies each limit by metadata, for both documented key-limit statuses", () => {
    for (const status of [402, 403]) {
      expect(readOpenRouterLimitError(status, new Headers(), limitBody("openrouter_key_limit"))).toMatchObject({
        limitSource: "openrouter_key_limit",
        status,
      });
    }
    expect(
      readOpenRouterLimitError(402, new Headers({ "Retry-After": "12" }), limitBody("openrouter_in_flight_budget")),
    ).toMatchObject({ limitSource: "openrouter_in_flight_budget", retryAfterMs: 12_000 });
  });

  it("does not treat a status code alone as a spending limit", () => {
    const affordability = JSON.stringify({
      error: { code: 402, message: "This request requires more credits, or fewer max_tokens." },
    });
    expect(readOpenRouterLimitError(402, new Headers(), affordability)).toBeNull();
    expect(readOpenRouterLimitError(402, new Headers(), "not json")).toBeNull();
    expect(readOpenRouterLimitError(403, new Headers(), limitBody("openrouter_guardrail_budget"))).toBeNull();
    expect(readOpenRouterLimitError(429, new Headers(), limitBody("openrouter_key_limit"))).toBeNull();
  });

  it("reads the limit from a failed response body", async () => {
    const limited = await readOpenRouterLimitResponse(new Response(limitBody("openrouter_key_limit"), { status: 403 }));
    expect(limited?.limitSource).toBe("openrouter_key_limit");
    expect(await readOpenRouterLimitResponse(new Response("server error", { status: 500 }))).toBeNull();
  });

  it("finds the limit through provider and SDK error wrappers", () => {
    const failure = transportFailure(402, limitBody("openrouter_key_limit"));
    expect(findOpenRouterLimitError({ originalError: failure })).toBeInstanceOf(OpenRouterLimitError);
    expect(findOpenRouterLimitError(new Error("Provider failed"))).toBeNull();
  });
});

describe("subscription provider failures", () => {
  beforeAll(async () => initializeLocalizer());

  it("maps the member key cap to exhaustion with the renewal date for the funded scope", () => {
    for (const scope of ["personal", "server"] as const) {
      const denied = findSupporterRequestDeniedError(
        { originalError: transportFailure(403, limitBody("openrouter_key_limit")) },
        funding(scope),
      );
      expect(denied).toMatchObject({
        reason: "allowance_exhausted",
        capability: "image",
        fundingScope: scope,
        details: { periodEnd: renewalAt },
      });
    }
  });

  it("keeps BYOK and unlabelled 402 failures out of subscription handling", () => {
    const minimum = findSupporterRequestDeniedError(
      transportFailure(
        402,
        JSON.stringify({
          error: {
            message: "This request requires at least $1.00 in balance for image or video output",
            metadata: { limit_source: "openrouter_key_limit" },
          },
        }),
      ),
      funding(),
    );
    expect(minimum).toMatchObject({
      reason: "allowance_exhausted",
      details: { minimumBalanceUsd: 1, modelCodename: "example/image-model" },
    });
    expect(findSupporterRequestDeniedError(transportFailure(402, limitBody("openrouter_key_limit")))).toBeNull();
    expect(findSupporterRequestDeniedError(transportFailure(402, "{}"), funding())).toBeNull();
  });

  it("reports operator capacity separately from exhaustion and alerts once per rejection", () => {
    errorSpy = spyOn(log, "error").mockResolvedValue(undefined);
    const inFlight = transportFailure(402, limitBody("openrouter_in_flight_budget"), { "Retry-After": "30" });
    const before = Date.now();
    const first = findSupporterRequestDeniedError(inFlight, funding());
    findSupporterRequestDeniedError(inFlight, funding());
    expect(first?.reason).toBe("capacity_unavailable");
    expect(first?.details?.retryAt?.getTime()).toBeGreaterThanOrEqual(before + 30_000);
    const credits = findSupporterRequestDeniedError(transportFailure(402, limitBody("openrouter_credits")), funding());
    expect(credits).toMatchObject({ reason: "capacity_unavailable", details: { retryable: false } });
    expect(credits?.details?.retryAt).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy.mock.calls.map((call: unknown[]) => (call[2] as { errorType?: string }).errorType)).toEqual([
      "SupporterOperatorCapacity",
      "SupporterOperatorCapacity",
    ]);
  });

  it("renders retryable and unretryable capacity notices in every locale", () => {
    errorSpy = spyOn(log, "error").mockResolvedValue(undefined);
    const withRetry = findSupporterRequestDeniedError(
      transportFailure(402, limitBody("openrouter_in_flight_budget"), { "Retry-After": "60" }),
      funding("personal"),
    );
    const withoutRetry = findSupporterRequestDeniedError(
      transportFailure(402, limitBody("openrouter_in_flight_budget")),
      funding(),
    );
    const credits = findSupporterRequestDeniedError(transportFailure(402, limitBody("openrouter_credits")), funding());
    if (!withRetry || !withoutRetry || !credits) throw new Error("Capacity failures were not mapped");
    const retryAt = `<t:${Math.ceil((withRetry.details?.retryAt?.getTime() ?? 0) / 1000)}:R>`;
    expectForEveryLocale((locale) => {
      const copyLocale = hasLocaleKey(locale, "commands.subscribe.request.capacity") ? locale : "en-US";
      const timed = getSupporterRequestFailureCopy(withRetry, locale).description;
      expect(timed).toContain(localizedCopy(copyLocale, "commands.subscribe.request.retry_at", { retry_at: retryAt }));
      expect(timed).toContain(localizedCopy(copyLocale, "commands.subscribe.request.scope.personal"));
      expect(timed).not.toMatch(/\{\w+\}/);
      const untimed = getSupporterRequestFailureCopy(withoutRetry, locale).description;
      expect(untimed).toContain(localizedCopy(copyLocale, "commands.subscribe.request.retry_later"));
      expect(untimed).not.toContain(localizedCopy(copyLocale, "commands.subscribe.request.renewal_unknown"));
      const unretryable = getSupporterRequestFailureCopy(credits, locale).description;
      expect(unretryable).toMatch(localizedProse(copyLocale, "commands.subscribe.request.capacity_unavailable"));
      expect(unretryable).not.toContain(localizedCopy(copyLocale, "commands.subscribe.request.retry_later"));
      expect(unretryable).not.toMatch(/\{\w+\}/);
    });
  });
});

describe("subscription tool failures", () => {
  beforeAll(async () => initializeLocalizer());

  it("tells the channel directly because a tool error reaches only the model", async () => {
    const send = spyOn(embedHelper, "sendStandardEmbed").mockResolvedValue(undefined);
    try {
      const denied = findSupporterRequestDeniedError(
        transportFailure(402, limitBody("openrouter_key_limit")),
        funding(),
      );
      if (!denied) throw new Error("Key limit was not mapped");
      const channel = {} as ToolContext["channel"];
      const copy = getSupporterRequestFailureCopy(denied, "en-US");
      expect(await notifySupporterToolFailure({ channel, locale: "en-US" }, denied)).toBe(copy.description);
      expect(send).toHaveBeenCalledWith(channel, "en-US", expect.objectContaining(copy));
      expect(await notifySupporterToolFailure({ channel, locale: "en-US", isUserImpersonation: true }, denied)).toBe(
        copy.description,
      );
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockRestore();
    }
  });
});

describe("subscription usage statistics", () => {
  it("records member-funded cost with its funding scope, server, and model", async () => {
    const rows: unknown[] = [];
    const repository = {
      record: async (row: unknown) => {
        rows.push(row);
        return true;
      },
    };
    recordSupporterUsage(funding(), { modelCodename: "example/image-model", costUsd: 0.04 }, repository);
    recordSupporterUsage(
      funding("personal"),
      { modelCodename: "example/video-model", costUsd: 0.5, providerRequestId: "job_1" },
      repository,
    );
    await Promise.resolve();
    expect(rows).toEqual([
      {
        supporterIdentityId: 10,
        fundingScope: "server",
        serverId: 7,
        capability: "image",
        modelCodename: "example/image-model",
        costUsd: 0.04,
        providerRequestId: null,
        inputTokens: null,
        outputTokens: null,
      },
      {
        supporterIdentityId: 10,
        fundingScope: "personal",
        serverId: null,
        capability: "image",
        modelCodename: "example/video-model",
        costUsd: 0.5,
        providerRequestId: "job_1",
        inputTokens: null,
        outputTokens: null,
      },
    ]);
  });

  it("skips BYOK and unreported cost, and never surfaces a storage failure", async () => {
    const warn = spyOn(log, "warn").mockImplementation(() => undefined);
    try {
      let calls = 0;
      const failing = {
        record: async () => {
          calls++;
          throw new Error("database unavailable");
        },
      };
      recordSupporterUsage(null, { modelCodename: "example/model", costUsd: 0.01 }, failing);
      for (const costUsd of [undefined, null, -1, Number.NaN])
        recordSupporterUsage(funding(), { modelCodename: "example/model", costUsd }, failing);
      expect(calls).toBe(0);
      expect(() =>
        recordSupporterUsage(funding(), { modelCodename: "example/model", costUsd: 0.01 }, failing),
      ).not.toThrow();
      await Bun.sleep(0);
      expect(calls).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

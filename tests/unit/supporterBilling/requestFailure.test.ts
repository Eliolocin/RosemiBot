import { beforeAll, describe, expect, it } from "bun:test";
import { getSupporterRequestFailureCopy } from "@/modules/supporter-billing/discord/requestFailure";
import {
  SupporterRequestDeniedError,
  findSupporterRequestDeniedError,
} from "@/modules/supporter-billing/runtime/funding";
import { SUPPORTER_CAPABILITIES } from "@/modules/supporter-billing/config";
import { readOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { hasLocaleKey, initializeLocalizer } from "@/utils/text/localizer";
import { expectForEveryLocale, localizedCopy, localizedProse } from "../../helpers/localeCases";

describe("subscription request failures", () => {
  beforeAll(async () => initializeLocalizer());
  it("explains provider media minimums without suggesting the allowance is exhausted", () => {
    const providerError = readOpenRouterLimitError(
      402,
      new Headers(),
      JSON.stringify({
        error: {
          message: "This request requires at least $1.00 in balance for image or video output",
          metadata: { limit_source: "openrouter_key_limit" },
        },
      }),
    );
    expect(providerError?.minimumBalanceUsd).toBe(1);
    expectForEveryLocale((locale) => {
      for (const scope of ["personal", "server"] as const) {
        for (const forFallback of [false, true]) {
          const copy = getSupporterRequestFailureCopy(
            new SupporterRequestDeniedError(
              "allowance_exhausted",
              { minimumBalanceUsd: providerError?.minimumBalanceUsd, modelCodename: "example/image-model" },
              "image",
              scope,
            ),
            locale,
            forFallback,
          );
          expect(copy.titleKey).toBe("commands.subscribe.request.minimum_balance_title");
          const key = forFallback ? "minimum_balance_reason" : "minimum_balance";
          const copyLocale = hasLocaleKey(locale, `commands.subscribe.request.${key}`) ? locale : "en-US";
          expect(copy.description).toBe(
            localizedCopy(copyLocale, `commands.subscribe.request.${key}`, {
              model: "`example/image-model`",
              config: scope === "personal" ? "`/personal config`" : "`/config`",
              fallback: localizedCopy(locale, "commands.subscribe.request.fallback_failed"),
            }),
          );
          expect(copy.description).not.toMatch(/\{\w+\}/);
          expect(copy.description).not.toContain("$");
          expect(copy.description).toContain("`example/image-model`");
        }
      }
    });
  });
  it("renders terminal guidance and concise fallback reasons in every locale", () => {
    expectForEveryLocale((locale) => {
      const copyLocale = hasLocaleKey(locale, "commands.subscribe.request.exhausted") ? locale : "en-US";
      for (const scope of ["personal", "server"] as const) {
        for (const capability of SUPPORTER_CAPABILITIES) {
          for (const forFallback of [false, true]) {
            const exhausted = getSupporterRequestFailureCopy(
              new SupporterRequestDeniedError(
                "allowance_exhausted",
                { periodEnd: new Date("2026-02-01") },
                capability,
                scope,
              ),
              locale,
              forFallback,
            );
            expect(exhausted.titleKey).toBe("commands.subscribe.request.allowance_title");
            expect(exhausted.description).toContain("<t:1769904000:D>");
            expect(exhausted.description).toContain(
              localizedCopy(copyLocale, `commands.subscribe.request.scope.${scope}`),
            );
            if (forFallback) {
              expect(exhausted.description).toMatch(
                localizedProse(copyLocale, "commands.subscribe.request.allowance_reason"),
              );
              expect(exhausted.description).not.toContain("/providers");
            } else {
              expect(exhausted.description).toContain(
                localizedCopy(copyLocale, "commands.subscribe.request.fallback_failed"),
              );
              expect(exhausted.description).toContain(scope === "personal" ? "/personal providers" : "/providers");
            }
            expect(exhausted.description).not.toMatch(/\{\w+\}/);
            const unsupported = getSupporterRequestFailureCopy(
              new SupporterRequestDeniedError("model_not_allowed", undefined, capability, scope),
              locale,
            );
            expect(unsupported.titleKey).toBe("commands.subscribe.request.title");
            expect(unsupported.description).toContain(
              localizedCopy(copyLocale, `commands.subscribe.request.capabilities.${capability}`),
            );
          }
        }
      }
    });
  });

  it("retains the structured denial through provider and SDK error wrappers", () => {
    const denied = new SupporterRequestDeniedError("allowance_exhausted");
    expect(findSupporterRequestDeniedError({ originalError: new Error("Transport failed", { cause: denied }) })).toBe(
      denied,
    );
    expect(findSupporterRequestDeniedError(new Error("Provider failed"))).toBeNull();
  });
});

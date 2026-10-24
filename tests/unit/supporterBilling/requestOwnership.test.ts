import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import * as managedProvider from "@/modules/supporter-billing/runtime/managedProvider";
import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";
import { getSupporterUsageContext } from "@/modules/supporter-billing/runtime/types";
import { OpenRouterEngine } from "@/tools/webSearch/openrouterEngine";
import type { ToolContext } from "@/types/tool/interfaces";
import * as notices from "@/utils/discord/toolProgressNotice";
import { beginProviderRequest } from "@/utils/provider/providerRequestHook";
import { findProviderRequestDeniedError, withProviderUsageContext } from "@/utils/provider/providerUsage";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { localizedProse } from "../../helpers/localeCases";
import { createServerFunding, installSpendHarness } from "./guards/utils-fundingFixtures";

beforeAll(initializeLocalizer);

describe("supporter request ownership", () => {
  it("keeps a funded credential refusal scoped to its resolved funding", async () => {
    const funding = createServerFunding();
    const refusal: unknown = await managedProvider
      .resolveSupporterMemberKey(funding, {
        sponsorships: { loadActiveSponsorshipById: async () => null },
      })
      .catch((error: unknown) => error);
    const denied = findProviderRequestDeniedError(refusal, getSupporterUsageContext(funding));
    expect(denied?.usageContext).toBe(getSupporterUsageContext(funding));
    expect(denied).toMatchObject({ reason: "inconsistent" });
  });

  it("keeps interleaved scopes on their own refusal when both use one member key", async () => {
    const harness = installSpendHarness();
    try {
      const first = harness.register({ appliedLimit: 0 });
      const secondFunding = createServerFunding({ ...first.funding, serverId: 8, sponsorshipId: 41 });
      const firstContext = getSupporterUsageContext(first.funding);
      const secondContext = getSupporterUsageContext(secondFunding);
      const gate = Promise.withResolvers<void>();
      const begin = () =>
        beginProviderRequest({ apiKey: first.apiKey, path: "/chat/completions", body: {} }).catch(
          (error: unknown) => error,
        );
      const firstRequest = withProviderUsageContext(firstContext, async () => {
        await gate.promise;
        return begin();
      });
      const secondRequest = withProviderUsageContext(secondContext, async () => {
        supporterSpendGuard.registerCredential(first.apiKey, secondFunding, first.keyHash);
        gate.resolve();
        return begin();
      });
      const [firstError, secondError] = await Promise.all([firstRequest, secondRequest]);
      expect(findProviderRequestDeniedError(firstError, firstContext)?.usageContext).toBe(firstContext);
      expect(findProviderRequestDeniedError(firstError, secondContext)).toBeNull();
      expect(findProviderRequestDeniedError(secondError, secondContext)?.usageContext).toBe(secondContext);
      expect(findProviderRequestDeniedError(secondError, firstContext)).toBeNull();
      expect(harness.pending(first.identityId)).toBe(0);
    } finally {
      harness.restore();
    }
  });

  it("renders the search refusal after another scope resolves its shared key during the progress notice", async () => {
    const harness = installSpendHarness();
    const key = harness.register({ appliedLimit: 0 });
    const otherFunding = createServerFunding({ ...key.funding, serverId: 8, sponsorshipId: 41 });
    const member = spyOn(managedProvider, "resolveSupporterMemberKey").mockImplementation(async (funding) => {
      supporterSpendGuard.registerCredential(key.apiKey, funding, key.keyHash);
      return key.apiKey;
    });
    const notice = spyOn(notices, "sendToolNotice").mockImplementation(async () => {
      supporterSpendGuard.registerCredential(key.apiKey, otherFunding, key.keyHash);
    });
    const fetch = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected provider request"));
    try {
      const context: ToolContext = {
        channel: { id: "fixture-channel" } as ToolContext["channel"],
        client: {} as ToolContext["client"],
        provider: "openrouter",
        locale: "en-US",
        suppressProgressNotices: true,
        isUserImpersonation: true,
        usageContext: getSupporterUsageContext(key.funding),
        tomoriState: createPersona({ llm: createLlmRow({ llm_provider: "openrouter" }), config: { api_key: null } }),
      };
      const result = await new OpenRouterEngine().search("fixture", "text", context);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(localizedProse("en-US", "commands.subscribe.request.exhausted"));
      expect(fetch).not.toHaveBeenCalled();
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      fetch.mockRestore();
      notice.mockRestore();
      member.mockRestore();
      harness.restore();
    }
  });
});

import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import * as managedProvider from "@/modules/supporter-billing/runtime/managedProvider";
import * as usageStatistics from "@/modules/supporter-billing/runtime/usageStatistics";
import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import { getSupporterUsageContext } from "@/modules/supporter-billing/runtime/types";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { OpenRouterEngine } from "@/tools/webSearch/openrouterEngine";
import type { ToolContext } from "@/types/tool/interfaces";
import * as crypto from "@/utils/security/crypto";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    channel: { id: "fixture-channel" } as ToolContext["channel"],
    client: {} as ToolContext["client"],
    tomoriState: createPersona(),
    locale: "en-US",
    provider: "google",
    suppressProgressNotices: true,
    ...overrides,
  };
}

function openRouterContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return makeContext({
    provider: "openrouter",
    tomoriState: createPersona({
      llm: createLlmRow({ llm_provider: "openrouter", llm_codename: "openai/gpt-4.1-nano" }),
      config: { api_key: Buffer.from("encrypted-fixture"), key_version: 2 },
    }),
    ...overrides,
  });
}

beforeAll(async () => {
  await initializeLocalizer();
});

describe("OpenRouter engine funded searches", () => {
  const engine = new OpenRouterEngine();
  let restore: Array<{ mockRestore(): void }> = [];

  afterEach(() => {
    for (const spy of restore) spy.mockRestore();
    restore = [];
  });

  it("funds keyless searches in both scopes, records reported costs before citation validation, and refuses exhausted keys", async () => {
    const member = spyOn(managedProvider, "resolveSupporterMemberKey").mockResolvedValue("synthetic-member-key");
    const decrypt = spyOn(crypto, "decryptApiKey").mockResolvedValue("synthetic-byok-key");
    const record = spyOn(usageStatistics, "recordSupporterUsage").mockImplementation(() => {});
    const begin = spyOn(supporterSpendGuard, "begin").mockResolvedValue(undefined);
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () =>
          Response.json({
            id: "synthetic-search",
            usage: { cost: 0.0072, prompt_tokens: 100, completion_tokens: 1 },
            choices: [{ message: { annotations: [] } }],
          }),
        { preconnect: fetch.preconnect },
      ),
    );
    restore.push(member, decrypt, record, begin, request);
    for (const scope of ["personal", "server"] as const) {
      const supporterFunding: SupporterFundingContext = {
        credentialSource: "supporter",
        provider: "openrouter",
        capability: "text",
        modelCodename: "openai/gpt-4.1-nano",
        tierKey: "mochi",
        sponsorIdentityId: 1,
        sponsorDiscordUserId: "synthetic-member",
        entitlementId: 1,
        renewalAt: null,
        ...(scope === "personal"
          ? { fundingScope: "personal", personalUserId: 1, serverId: null, sponsorshipId: null }
          : { fundingScope: "server", personalUserId: null, serverId: 1, sponsorshipId: 1 }),
      };
      const context = openRouterContext({ usageContext: getSupporterUsageContext(supporterFunding) });
      context.tomoriState.config.api_key = null;
      expect(await engine.available(context)).toBe(true);
      expect((await engine.search("fixture", "text", context)).success).toBe(false);
      expect(record).toHaveBeenLastCalledWith(
        supporterFunding,
        expect.objectContaining({
          costUsd: 0.0072,
          inputTokens: 100,
          outputTokens: 1,
          providerRequestId: "synthetic-search",
        }),
      );
      expect(new Headers(request.mock.calls.at(-1)?.[1]?.headers).get("Authorization")).toBe(
        "Bearer synthetic-member-key",
      );
      begin.mockRejectedValueOnce(
        new SupporterRequestDeniedError("allowance_exhausted", undefined, "text", scope, supporterFunding),
      );
      const sent = request.mock.calls.length;
      expect((await engine.search("fixture", "text", context)).success).toBe(false);
      expect(request.mock.calls).toHaveLength(sent);
    }
    expect(decrypt).not.toHaveBeenCalled();
    const writes = record.mock.calls.length;
    await engine.search("fixture", "text", openRouterContext());
    expect(new Headers(request.mock.calls.at(-1)?.[1]?.headers).get("Authorization")).toBe("Bearer synthetic-byok-key");
    expect(record.mock.calls).toHaveLength(writes);
    expect(record.mock.calls.every(([funding]) => funding !== undefined)).toBe(true);
  });
});

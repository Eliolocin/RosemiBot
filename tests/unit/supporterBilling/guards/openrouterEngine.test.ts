import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";
import * as managedProvider from "@/modules/supporter-billing/runtime/managedProvider";
import type { ToolContext } from "@/types/tool/interfaces";
import { OpenRouterEngine } from "@/tools/webSearch/openrouterEngine";
import * as toolProgressNotice from "@/utils/discord/toolProgressNotice";
import * as crypto from "@/utils/security/crypto";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona } from "../../../helpers/fixtures";
import { localizedCopy } from "../../../helpers/localeCases";
import { createSupporterDenial, createSupporterFunding, withSupporterFunding } from "./fundingFixtures";

const MODEL = "synthetic/guard-model";
const citation = (url: string) => ({
  type: "url_citation" as const,
  url_citation: { url, title: "Fixture title", content: "Fixture excerpt" },
});

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    channel: { id: "synthetic-channel" } as ToolContext["channel"],
    client: {} as ToolContext["client"],
    provider: "openrouter",
    locale: "en-US",
    suppressProgressNotices: true,
    tomoriState: createPersona({
      llm: createLlmRow({ llm_provider: "openrouter", llm_codename: MODEL }),
      config: { api_key: null },
    }),
    ...overrides,
  };
}

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

beforeAll(initializeLocalizer);

describe("OpenRouter web search billing guards", () => {
  it("records one usage entry against the funding that paid for a successful search", async () => {
    const funding = createSupporterFunding({ modelCodename: MODEL });
    spies.push(spyOn(managedProvider, "resolveSupporterMemberKey").mockResolvedValue("synthetic-member-key"));
    spies.push(spyOn(toolProgressNotice, "sendToolNotice").mockResolvedValue(undefined));
    spies.push(
      spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(
          async () =>
            Response.json({
              id: "synthetic-search",
              usage: { cost: 0.0072, prompt_tokens: 100, completion_tokens: 1 },
              choices: [{ message: { annotations: [citation("https://example.com/guard")] } }],
            }),
          { preconnect: () => undefined },
        ),
      ),
    );
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    const result = await new OpenRouterEngine().search("fixture", "text", withSupporterFunding(makeContext(), funding));

    expect(result.success).toBe(true);
    expect(record.mock.calls).toHaveLength(1);
    expect(record.mock.calls[0]?.[0]).toEqual({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "server",
      serverId: funding.serverId,
      capability: "text",
      modelCodename: MODEL,
      costUsd: 0.0072,
      providerRequestId: "synthetic-search",
      inputTokens: 100,
      outputTokens: 1,
    });
  });

  it("records nothing for a search paid for by the server's own key", async () => {
    spies.push(spyOn(crypto, "decryptApiKey").mockResolvedValue("synthetic-byok-key"));
    spies.push(spyOn(toolProgressNotice, "sendToolNotice").mockResolvedValue(undefined));
    spies.push(
      spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(
          async () =>
            Response.json({
              usage: { cost: 0.0072 },
              choices: [{ message: { annotations: [citation("https://example.com/guard")] } }],
            }),
          { preconnect: () => undefined },
        ),
      ),
    );
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);
    const context = makeContext();
    context.tomoriState.config.api_key = Buffer.from("synthetic-encrypted-key");

    const result = await new OpenRouterEngine().search("fixture", "text", context);

    expect(result.success).toBe(true);
    expect(record).not.toHaveBeenCalled();
  });

  it("returns the subscription copy, not a generic search failure, when the funded key is refused", async () => {
    const funding = createSupporterFunding({ modelCodename: MODEL });
    spies.push(spyOn(managedProvider, "resolveSupporterMemberKey").mockResolvedValue("synthetic-member-key"));
    spies.push(spyOn(toolProgressNotice, "sendToolNotice").mockResolvedValue(undefined));
    const begin = spyOn(supporterSpendGuard, "begin").mockRejectedValue(createSupporterDenial({ funding }));
    spies.push(begin);

    const result = await new OpenRouterEngine().search("fixture", "text", withSupporterFunding(makeContext(), funding));

    expect(result.success).toBe(false);
    expect(result.error).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
  });
});

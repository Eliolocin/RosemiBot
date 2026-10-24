import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { createLlmRow, createPersona } from "../../../helpers/fixtures";
import { localizedCopy } from "../../../helpers/localeCases";
import { ContextItemTag } from "@/types/misc/context";
import type { ChatTurnContext } from "@/utils/chat/types";
import {
  createResponseReviewState,
  reviewResponseCandidate,
  type DraftReviewResult,
} from "@/utils/chat/responseReview";
import * as embedHelper from "@/utils/discord/embedHelper";
import { initializeLocalizer } from "@/utils/text/localizer";
import { readOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import {
  captureUsageRecords,
  fundingContext,
  embeddingModel,
  produceFundedDenial,
  renderReturnedDenial,
  runChunkEdit,
  createServerFunding,
  createPersonalFunding,
  installSpendHarness,
  settleUsage,
  type SpendHarness,
  type UsageCapture,
} from "./utils-fundingFixtures";

const persona = createPersona({
  llm: createLlmRow({ supports_structoutput: true, context_window: 64_000 }),
  config: {
    response_drafting_enabled: true,
    response_reviewer_prompt: "fixture rubric",
    response_review_items: ["persona"],
  },
});

function createReviewContext(funding: ReturnType<typeof createServerFunding> | null): ChatTurnContext {
  const channel = {
    id: "fixture-channel",
    isSendable: () => true,
    partial: false,
    send: async () => ({ id: "sent" }),
  };
  const context = {
    currentPersona: persona,
    tomoriState: persona,
    streamingContext: { suppressTextOutput: false },
    channel,
    message: { id: "trigger" },
    textCredentialSource: funding ? "supporter" : "server",
    ...fundingContext(funding),
    locale: "en-US",
    shouldSurfaceUserErrors: true,
    isUserImpersonation: false,
    contextItems: [
      { role: "system", metadataTag: ContextItemTag.SYSTEM_PERSONALITY, parts: [{ type: "text", text: "persona" }] },
      { role: "user", messageId: "trigger", parts: [{ type: "text", text: "hello" }] },
    ],
  } as unknown as ChatTurnContext;
  context.responseReview = createResponseReviewState(context);
  if (!context.responseReview) throw new Error("response review state was not created");
  context.responseReview.pending = [{ text: "draft", retainedBytes: 5, segments: 1 }] as never;
  return context;
}

function keyLimitFailure(): Error {
  const body = JSON.stringify({
    error: {
      code: 402,
      message: "Request rejected by a spending limit.",
      metadata: { limit_source: "openrouter_key_limit" },
    },
  });
  return new Error("HTTP 402", { cause: readOpenRouterLimitError(402, new Headers(), body) ?? undefined });
}

function reviewAuthor(options: { costUsd?: number; denial?: unknown } = {}) {
  return {
    callStructuredJSON: async (request: { onUsage?: (usage: unknown) => void }) => {
      request.onUsage?.({ inputTokens: 11, outputTokens: 4, costUsd: options.costUsd });
      if (options.denial) return { success: false, failure: "transport", cause: options.denial };
      return { success: true, data: { status: "pass" } satisfies DraftReviewResult };
    },
  } as never;
}

let usage: UsageCapture | null = null;
let spend: SpendHarness | null = null;
const restore: Array<() => void> = [];

afterEach(() => {
  usage?.restore();
  usage = null;
  spend?.restore();
  spend = null;
  for (const undo of restore.splice(0)) undo();
});

describe("response review usage and denial", () => {
  beforeAll(async () => initializeLocalizer());

  it("records exactly one reviewer usage entry for the funded turn", async () => {
    usage = captureUsageRecords();
    const funding = createServerFunding({ capability: "text", modelCodename: "fixture/reviewer" });
    const result = await reviewResponseCandidate(createReviewContext(funding), reviewAuthor({ costUsd: 0.02 }), {
      apiKey: "fixture",
    } as never);
    await settleUsage();
    expect(result.status).toBe("pass");
    expect(usage.rows).toHaveLength(1);
    expect(usage.rows[0]).toMatchObject({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "server",
      serverId: funding.serverId,
      capability: "text",
      modelCodename: persona.llm.llm_codename,
      costUsd: 0.02,
      inputTokens: 11,
      outputTokens: 4,
    });
  });

  it("records nothing when the reviewer runs on the server's own key", async () => {
    usage = captureUsageRecords();
    const result = await reviewResponseCandidate(createReviewContext(null), reviewAuthor({ costUsd: 0.02 }), {
      apiKey: "fixture",
    } as never);
    await settleUsage();
    expect(result.status).toBe("pass");
    expect(usage.rows).toHaveLength(0);
  });

  it("shows a spend-guard denial as subscription copy ahead of generic review handling", async () => {
    spend = installSpendHarness();
    const send = spyOn(embedHelper, "sendStandardEmbed").mockResolvedValue(undefined);
    restore.push(() => send.mockRestore());
    const { denial, funding } = await produceFundedDenial(spend);
    const result = await reviewResponseCandidate(createReviewContext(funding), reviewAuthor({ denial }), {
      apiKey: "fixture",
    } as never);
    expect(result).toEqual({ status: "unavailable" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[2]).toMatchObject({ titleKey: "commands.subscribe.request.allowance_title" });
  });

  it("attributes a key-limit failure to the reviewer's own funding", async () => {
    const send = spyOn(embedHelper, "sendStandardEmbed").mockResolvedValue(undefined);
    restore.push(() => send.mockRestore());
    const result = await reviewResponseCandidate(
      createReviewContext(createServerFunding({ capability: "text" })),
      reviewAuthor({ denial: keyLimitFailure() }),
      { apiKey: "fixture" } as never,
    );
    expect(result).toEqual({ status: "unavailable" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[2]).toMatchObject({ titleKey: "commands.subscribe.request.allowance_title" });
  });
});

describe("memories document embedding usage and denial", () => {
  it("records exactly one embedding usage entry for the funded chunk edit", async () => {
    usage = captureUsageRecords();
    const funding = createServerFunding({ capability: "embedding", modelCodename: embeddingModel.codename });
    expect(await runChunkEdit(funding)).toEqual({ status: "success" });
    await settleUsage();
    expect(usage.rows).toHaveLength(1);
    expect(usage.rows[0]).toMatchObject({
      supporterIdentityId: funding.sponsorIdentityId,
      capability: "embedding",
      modelCodename: embeddingModel.codename,
      costUsd: 0.01,
    });
  });

  it("records nothing for a BYOK embedding key", async () => {
    usage = captureUsageRecords();
    expect(await runChunkEdit(null)).toEqual({ status: "success" });
    await settleUsage();
    expect(usage.rows).toHaveLength(0);
  });

  it("turns a spend-guard denial into the subscription result instead of a generic write failure", async () => {
    spend = installSpendHarness();
    const { denial, funding } = await produceFundedDenial(spend, "embedding");
    const result = await runChunkEdit(funding, denial);
    expect((await renderReturnedDenial(result, funding))?.titleKey).toBe("commands.subscribe.request.allowance_title");
  });

  it("scopes a key-limit failure to the embedding request's own funding", async () => {
    const funding = createPersonalFunding({ capability: "embedding" });
    const result = await runChunkEdit(funding, keyLimitFailure());
    const copy = await renderReturnedDenial(result, funding);
    expect(copy?.titleKey).toBe("commands.subscribe.request.allowance_title");
    expect(copy?.description).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.personal"));
  });
});

import { afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { BraveEngine } from "@/tools/webSearch/braveEngine";
import { executeWebSearchWithFallback } from "@/tools/webSearch/dispatcher";
import { DuckDuckGoEngine } from "@/tools/webSearch/duckduckgoEngine";
import { OpenRouterEngine } from "@/tools/webSearch/openrouterEngine";
import { SearxngEngine } from "@/tools/webSearch/searxngEngine";
import type { WebSearchEngineFailure } from "@/tools/webSearch/types";
import type { ToolContext } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { stubLogMembers } from "../../helpers/mockSurface";

stubLogMembers({ warn: () => {}, info: () => {}, success: () => {} });

const context = {
  channel: { id: "fixture-channel" },
  client: {},
  tomoriState: createPersona(),
  locale: "en-US",
  provider: "google",
  suppressProgressNotices: true,
} as unknown as ToolContext;

describe("web search dispatch failures", () => {
  const spies: Array<{ mockRestore(): void }> = [];
  let errorSpy: ReturnType<typeof spyOn<typeof log, "error">>;
  let failure: WebSearchEngineFailure;

  beforeAll(async () => {
    await initializeLocalizer();
  });

  beforeEach(() => {
    failure = { failure: "http_error", status: 503 };
    for (const engine of [BraveEngine, SearxngEngine, OpenRouterEngine]) {
      spies.push(spyOn(engine.prototype, "available").mockResolvedValue(false));
    }
    spies.push(
      spyOn(DuckDuckGoEngine.prototype, "available").mockResolvedValue(true),
      spyOn(DuckDuckGoEngine.prototype, "search").mockImplementation(async () => ({
        success: false,
        error: `DuckDuckGo search failed: ${failure.failure} (HTTP ${failure.status})`,
        data: failure,
      })),
    );
    errorSpy = spyOn(log, "error").mockResolvedValue(undefined);
    spies.push(errorSpy);
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it("logs an outage when every attempted engine fails", async () => {
    const result = await executeWebSearchWithFallback("harbor tides", "text", context);
    expect(result.success).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, , errorContext] = errorSpy.mock.calls[0];
    expect(message).toContain("HTTP 503");
    expect(errorContext?.metadata).toMatchObject({ category: "text", attempted: 1 });
  });

  it("keeps a chain that only met rate limits or challenges out of error logs", async () => {
    for (const refusal of ["challenge", "rate_limited"]) {
      failure = { failure: refusal, status: 202 };
      expect((await executeWebSearchWithFallback("harbor tides", "text", context)).success).toBe(false);
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("keeps a category no available engine serves out of error logs", async () => {
    const result = await executeWebSearchWithFallback("harbor tides", "papers", context);
    expect(result.success).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

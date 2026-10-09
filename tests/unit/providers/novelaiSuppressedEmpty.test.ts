import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { NovelaiProvider } from "@/providers/novelai/novelaiProvider";
import { NovelaiStreamAdapter } from "@/providers/novelai/novelaiStreamAdapter";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { createPersona } from "../../helpers/fixtures";

describe("NovelAI suppressed retry", () => {
  const restoreSpies: Array<() => void> = [];
  afterEach(() => {
    for (const restore of restoreSpies.splice(0)) restore();
  });

  it("retries a truly empty suppressed tool turn with its continuation prefill", async () => {
    const stream = spyOn(StreamOrchestrator.prototype, "streamToDiscord").mockResolvedValue({
      status: "completed",
      accumulatedText: "",
    });
    const prefill = spyOn(NovelaiStreamAdapter.prototype, "getPendingContinuationPrefill").mockReturnValue(
      "unfinished",
    );
    restoreSpies.push(
      () => stream.mockRestore(),
      () => prefill.mockRestore(),
    );
    const provider = new NovelaiProvider();
    const state = createPersona();

    const result = await provider.streamToDiscord(
      { id: "test-channel" } as Parameters<NovelaiProvider["streamToDiscord"]>[0],
      {} as Parameters<NovelaiProvider["streamToDiscord"]>[1],
      state,
      { model: state.llm.llm_codename, apiKey: "test-key", temperature: 1 },
      [],
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      { suppressTextOutput: true, disableAllTools: true, disableYouTubeProcessing: false },
    );

    expect(result.status).toBe("empty_response");
    expect(result.naiContinuationPrefill).toBe("unfinished");
  });

  it("keeps hidden image turns completed when their text is intentionally suppressed", async () => {
    const stream = spyOn(StreamOrchestrator.prototype, "streamToDiscord").mockResolvedValue({
      status: "completed",
      accumulatedText: "",
    });
    restoreSpies.push(() => stream.mockRestore());
    const provider = new NovelaiProvider();
    const state = createPersona();

    const result = await provider.streamToDiscord(
      { id: "test-channel" } as Parameters<NovelaiProvider["streamToDiscord"]>[0],
      {} as Parameters<NovelaiProvider["streamToDiscord"]>[1],
      state,
      { model: state.llm.llm_codename, apiKey: "test-key", temperature: 1 },
      [],
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      {
        suppressTextOutput: true,
        disableAllTools: true,
        disableYouTubeProcessing: false,
        endTurnAfterTools: ["generate_image_nai"],
      },
    );

    expect(result.status).toBe("completed");
  });

  it("does not retry suppressed text that the model actually produced", async () => {
    const stream = spyOn(StreamOrchestrator.prototype, "streamToDiscord").mockResolvedValue({
      status: "completed",
      accumulatedText: "A follow-up after the tool error.",
    });
    restoreSpies.push(() => stream.mockRestore());
    const provider = new NovelaiProvider();
    const state = createPersona();

    const result = await provider.streamToDiscord(
      { id: "test-channel" } as Parameters<NovelaiProvider["streamToDiscord"]>[0],
      {} as Parameters<NovelaiProvider["streamToDiscord"]>[1],
      state,
      { model: state.llm.llm_codename, apiKey: "test-key", temperature: 1 },
      [],
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      { suppressTextOutput: true, disableAllTools: true, disableYouTubeProcessing: false },
    );

    expect(result.status).toBe("completed");
  });
});

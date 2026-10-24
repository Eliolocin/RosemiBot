import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { AnalyzeImageTool } from "@/tools/functionCalls/analyzeImageTool";
import * as visionCaption from "@/utils/provider/visionCaption";
import * as imageExtractor from "@/utils/image/imageExtractor";
import * as notices from "@/utils/discord/toolProgressNotice";
import type { ToolContext } from "@/types/tool/interfaces";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona } from "../../../helpers/fixtures";
import { localizedCopy } from "../../../helpers/localeCases";
import { createVisionSupporterFailure } from "./fundingFixtures";

const MESSAGE_ID = "12345678901234567";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    channel: { id: "synthetic-channel" } as ToolContext["channel"],
    client: {} as Client,
    provider: "openrouter",
    locale: "en-US",
    tomoriState: createPersona({
      llm: createLlmRow({ llm_provider: "openrouter", sees_images: false }),
      vision_llm: createLlmRow({ llm_id: 2, llm_provider: "openrouter", llm_codename: "synthetic/vision" }),
    }),
    ...overrides,
  };
}

function noticeChannel(): { channel: ToolContext["channel"]; sends: string[] } {
  const sends: string[] = [];
  const channel = {
    id: "synthetic-notice-channel",
    send: async (payload: unknown) => {
      sends.push(JSON.stringify(payload));
      return { id: `synthetic-notice-${sends.length}` };
    },
  } as unknown as ToolContext["channel"];
  return { channel, sends };
}

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

beforeAll(initializeLocalizer);

describe("analyze image tool billing guards", () => {
  function stubImage(): void {
    spies.push(
      spyOn(imageExtractor, "resolveMessageImageUrls").mockResolvedValue({
        imageUrls: [
          { url: "https://example.com/guard.png", proxyUrl: undefined, mimeType: "image/png", source: "attachment" },
        ],
        sourceMessageId: MESSAGE_ID,
      }),
    );
    spies.push(
      spyOn(imageExtractor, "downloadDiscoveredImage").mockResolvedValue({
        success: true,
        buffer: Buffer.from("synthetic-image"),
      }),
    );
    spies.push(spyOn(notices, "sendToolProgressNotice").mockResolvedValue(undefined));
  }

  it("returns the subscription copy and posts one channel notice when the funded vision call is refused", async () => {
    stubImage();
    const analyze = spyOn(visionCaption, "analyzeImageWithVisionModel").mockResolvedValue(
      createVisionSupporterFailure(),
    );
    spies.push(analyze);
    const { channel, sends } = noticeChannel();

    const result = await new AnalyzeImageTool().execute({ media_id: MESSAGE_ID }, makeContext({ channel }));

    expect(result.success).toBe(false);
    expect(result.error).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
    expect(sends).toHaveLength(1);
    expect(sends[0]).toContain(localizedCopy("en-US", "commands.subscribe.request.allowance_title"));
  });

  it("returns the subscription copy without a notice for user impersonation", async () => {
    stubImage();
    spies.push(spyOn(visionCaption, "analyzeImageWithVisionModel").mockResolvedValue(createVisionSupporterFailure()));
    const { channel, sends } = noticeChannel();

    const result = await new AnalyzeImageTool().execute(
      { media_id: MESSAGE_ID },
      makeContext({ channel, isUserImpersonation: true }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
    expect(sends).toHaveLength(0);
  });
});

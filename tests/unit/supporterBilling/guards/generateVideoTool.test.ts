import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import * as openrouterVideo from "@/providers/openrouter/openrouterVideoGeneration";
import { GenerateVideoTool } from "@/tools/functionCalls/generateVideoTool";
import { videoGenerationModelSchema } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import { llmModelRepo, statRepository } from "@/utils/db/repositories";
import * as credentials from "@/utils/provider/credentialResolver";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona } from "../../../helpers/fixtures";
import { localizedCopy } from "../../../helpers/localeCases";
import {
  createSupporterCredentials,
  createSupporterDenial,
  createSupporterFunding,
  createUnfundedCredentials,
} from "./fundingFixtures";

const VIDEO_MODEL = videoGenerationModelSchema.parse({
  video_model_id: 12,
  provider: "openrouter",
  codename: "synthetic/video",
});

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    channel: { id: "synthetic-channel" } as ToolContext["channel"],
    client: {} as Client,
    provider: "openrouter",
    locale: "en-US",
    userId: "synthetic-user",
    internalUserId: 1,
    suppressProgressNotices: true,
    tomoriState: createPersona({
      llm: createLlmRow({ llm_provider: "openrouter", llm_codename: "synthetic/text" }),
      config: { videogen_enabled: true },
    }),
    ...overrides,
  };
}

function noticeChannel(): { channel: ToolContext["channel"]; sends: string[] } {
  const sends: string[] = [];
  const channel = {
    id: "synthetic-notice-channel",
    isThread: () => false,
    send: async (payload: unknown) => {
      sends.push(JSON.stringify(payload));
      return { id: `synthetic-message-${sends.length}` };
    },
  } as unknown as ToolContext["channel"];
  return { channel, sends };
}

const personalFunding = () =>
  createSupporterFunding({
    capability: "video",
    modelCodename: "synthetic/video",
    fundingScope: "personal",
    personalUserId: 1,
    serverId: null,
    sponsorshipId: null,
  });

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

beforeAll(initializeLocalizer);

describe("generate video tool billing guards", () => {
  function stubCredentials(creds: ReturnType<typeof createSupporterCredentials>): void {
    spies.push(spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(creds));
    spies.push(spyOn(llmModelRepo, "loadVideoGenerationModelById").mockResolvedValue(VIDEO_MODEL));
    spies.push(spyOn(statRepository, "recordStat").mockImplementation(() => undefined));
  }

  it("records one usage entry against the funding that paid for a successful generation", async () => {
    const funding = personalFunding();
    stubCredentials(
      createSupporterCredentials({ source: "personal", modelId: VIDEO_MODEL.video_model_id, funding: funding }),
    );
    const generate = spyOn(openrouterVideo, "generateOpenRouterNativeVideo").mockResolvedValue({
      videoData: Buffer.from("synthetic-video"),
      mimeType: "video/mp4",
      filename: "guard.mp4",
      costUsd: 0.25,
      providerRequestId: "synthetic-video-job",
    });
    spies.push(generate);
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);
    const { channel } = noticeChannel();

    const result = await new GenerateVideoTool().execute({ prompt: "a fixture video" }, makeContext({ channel }));

    expect(result.success).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(record.mock.calls).toHaveLength(1);
    expect(record.mock.calls[0]?.[0]).toEqual({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "personal",
      serverId: null,
      capability: "video",
      modelCodename: "synthetic/video",
      costUsd: 0.25,
      providerRequestId: "synthetic-video-job",
      inputTokens: null,
      outputTokens: null,
    });
  });

  it("records nothing when the server's own key pays for a generation", async () => {
    stubCredentials(createUnfundedCredentials({ source: "personal", modelId: VIDEO_MODEL.video_model_id }));
    spies.push(
      spyOn(openrouterVideo, "generateOpenRouterNativeVideo").mockResolvedValue({
        videoData: Buffer.from("synthetic-video"),
        mimeType: "video/mp4",
        filename: "guard.mp4",
        costUsd: 0.25,
      }),
    );
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);
    const { channel } = noticeChannel();

    const result = await new GenerateVideoTool().execute({ prompt: "a fixture video" }, makeContext({ channel }));

    expect(result.success).toBe(true);
    expect(record).not.toHaveBeenCalled();
  });

  it("returns the subscription copy and posts one channel notice when the funded request is refused", async () => {
    const funding = personalFunding();
    stubCredentials(
      createSupporterCredentials({
        source: "personal",
        modelId: VIDEO_MODEL.video_model_id,
        funding,
      }),
    );
    spies.push(
      spyOn(openrouterVideo, "generateOpenRouterNativeVideo").mockRejectedValue(createSupporterDenial({ funding })),
    );
    const { channel, sends } = noticeChannel();

    const result = await new GenerateVideoTool().execute({ prompt: "a fixture video" }, makeContext({ channel }));

    expect(result.success).toBe(false);
    expect(result.error).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.personal"));
    expect(sends).toHaveLength(1);
    expect(sends[0]).toContain(localizedCopy("en-US", "commands.subscribe.request.allowance_title"));
  });

  it("returns the subscription copy without a notice for user impersonation", async () => {
    const funding = personalFunding();
    stubCredentials(
      createSupporterCredentials({
        source: "personal",
        modelId: VIDEO_MODEL.video_model_id,
        funding,
      }),
    );
    spies.push(
      spyOn(openrouterVideo, "generateOpenRouterNativeVideo").mockRejectedValue(createSupporterDenial({ funding })),
    );
    const { channel, sends } = noticeChannel();

    const result = await new GenerateVideoTool().execute(
      { prompt: "a fixture video" },
      makeContext({ channel, isUserImpersonation: true }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.personal"));
    expect(sends).toHaveLength(0);
  });
});

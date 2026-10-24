import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import { GenerateImageTool } from "@/tools/functionCalls/generateImageTool";
import { diffusionModelSchema } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import { llmModelRepo, statRepository } from "@/utils/db/repositories";
import * as credentials from "@/utils/provider/credentialResolver";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona } from "../../../helpers/fixtures";
import { localizedCopy } from "../../../helpers/localeCases";
import { createSupporterCredentials, createSupporterFunding, createUnfundedCredentials } from "./fundingFixtures";

const DIFFUSION_MODEL = diffusionModelSchema.parse({
  diffusion_model_id: 12,
  provider: "openrouter",
  codename: "synthetic/image",
});
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
      config: { imagegen_enabled: true },
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

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

beforeAll(initializeLocalizer);

describe("generate image tool billing guards", () => {
  function stubCredentials(creds: ReturnType<typeof createSupporterCredentials>): void {
    spies.push(spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(creds));
    spies.push(spyOn(llmModelRepo, "loadDiffusionModelById").mockResolvedValue(DIFFUSION_MODEL));
    spies.push(spyOn(statRepository, "recordStat").mockImplementation(() => undefined));
  }

  it("records one usage entry against the funding that paid for a successful generation", async () => {
    const funding = createSupporterFunding({
      capability: "image",
      modelCodename: "synthetic/image",
      fundingScope: "personal",
      personalUserId: 1,
      serverId: null,
      sponsorshipId: null,
    });
    stubCredentials(
      createSupporterCredentials({ source: "personal", modelId: DIFFUSION_MODEL.diffusion_model_id, funding: funding }),
    );
    spies.push(
      spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(
          async () =>
            Response.json({
              data: [{ b64_json: ONE_PIXEL_PNG }],
              usage: { cost: 0.0321 },
            }),
          { preconnect: () => undefined },
        ),
      ),
    );
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);
    const { channel } = noticeChannel();

    const result = await new GenerateImageTool().execute({ prompt: "a fixture image" }, makeContext({ channel }));

    expect(result.success).toBe(true);
    expect(record.mock.calls).toHaveLength(1);
    expect(record.mock.calls[0]?.[0]).toEqual({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "personal",
      serverId: null,
      capability: "image",
      modelCodename: "synthetic/image",
      costUsd: 0.0321,
      providerRequestId: null,
      inputTokens: null,
      outputTokens: null,
    });
  });

  it("records nothing when the server's own key pays for a generation", async () => {
    stubCredentials(createUnfundedCredentials({ source: "personal", modelId: DIFFUSION_MODEL.diffusion_model_id }));
    spies.push(
      spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(async () => Response.json({ data: [{ b64_json: ONE_PIXEL_PNG }], usage: { cost: 0.0321 } }), {
          preconnect: () => undefined,
        }),
      ),
    );
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);
    const { channel } = noticeChannel();

    const result = await new GenerateImageTool().execute({ prompt: "a fixture image" }, makeContext({ channel }));

    expect(result.success).toBe(true);
    expect(record).not.toHaveBeenCalled();
  });

  it("returns the subscription copy and posts one channel notice when the funded key is refused", async () => {
    const funding = createSupporterFunding({
      capability: "image",
      modelCodename: "synthetic/image",
      fundingScope: "personal",
      personalUserId: 1,
      serverId: null,
      sponsorshipId: null,
    });
    stubCredentials(
      createSupporterCredentials({ source: "personal", modelId: DIFFUSION_MODEL.diffusion_model_id, funding: funding }),
    );
    spies.push(
      spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(
          async () => Response.json({ error: { metadata: { limit_source: "openrouter_key_limit" } } }, { status: 402 }),
          { preconnect: () => undefined },
        ),
      ),
    );
    const { channel, sends } = noticeChannel();

    const result = await new GenerateImageTool().execute({ prompt: "a fixture image" }, makeContext({ channel }));

    expect(result.success).toBe(false);
    expect(result.error).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.personal"));
    expect(sends).toHaveLength(1);
    expect(sends[0]).toContain(localizedCopy("en-US", "commands.subscribe.request.allowance_title"));
  });

  it("returns the subscription copy without a notice for user impersonation", async () => {
    const funding = createSupporterFunding({
      capability: "image",
      modelCodename: "synthetic/image",
      fundingScope: "personal",
      personalUserId: 1,
      serverId: null,
      sponsorshipId: null,
    });
    stubCredentials(
      createSupporterCredentials({ source: "personal", modelId: DIFFUSION_MODEL.diffusion_model_id, funding: funding }),
    );
    spies.push(
      spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(
          async () => Response.json({ error: { metadata: { limit_source: "openrouter_key_limit" } } }, { status: 402 }),
          { preconnect: () => undefined },
        ),
      ),
    );
    const { channel, sends } = noticeChannel();

    const result = await new GenerateImageTool().execute(
      { prompt: "a fixture image" },
      makeContext({ channel, isUserImpersonation: true }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.personal"));
    expect(sends).toHaveLength(0);
  });
});

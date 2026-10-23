import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import * as credentials from "@/utils/provider/credentialResolver";
import * as avatars from "@/utils/discord/avatarResolver";
import * as notices from "@/utils/discord/toolProgressNotice";
import * as remote from "@/utils/security/userRemoteFetch";
import { PeekProfilePictureTool } from "@/tools/functionCalls/peekProfilePictureTool";
import type { ToolContext } from "@/types/tool/interfaces";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona } from "../../../helpers/fixtures";
import { localizedCopy } from "../../../helpers/localeCases";
import { createSupporterCredentials, createSupporterFunding, createUnfundedCredentials } from "./fundingFixtures";

const VISION_MODEL = createLlmRow({
  llm_id: 2,
  llm_provider: "openrouter",
  llm_codename: "synthetic/vision",
  sees_images: true,
});

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    channel: { id: "synthetic-channel" } as ToolContext["channel"],
    client: {} as Client,
    provider: "openrouter",
    locale: "en-US",
    userId: "synthetic-user",
    internalUserId: 1,
    tomoriState: createPersona({ llm: createLlmRow({ sees_images: false }), vision_llm: VISION_MODEL }),
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

describe("profile picture vision billing guards", () => {
  function stubAvatar(): void {
    spies.push(
      spyOn(avatars, "resolveAvatarByIdentity").mockResolvedValue({
        sourceType: "user",
        username: "Juno",
        avatarUrl: "data:image/png;base64,aW1hZ2U=",
      }),
    );
    spies.push(spyOn(notices, "sendToolProgressNotice").mockResolvedValue(undefined));
  }

  it("records vision usage against the funding that paid for the caption", async () => {
    const funding = createSupporterFunding({ capability: "vision", modelCodename: "synthetic/vision" });
    stubAvatar();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({ modelId: VISION_MODEL.llm_id, funding: funding }),
      ),
    );
    spies.push(
      spyOn(remote, "fetchUserRemoteUrl").mockResolvedValue(
        Response.json({
          choices: [{ message: { content: "a caption" } }],
          usage: { cost: 0.004, prompt_tokens: 40, completion_tokens: 12 },
        }),
      ),
    );
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    const result = await new PeekProfilePictureTool().execute({ target_identity: "Juno" }, makeContext());

    expect(result.success).toBe(true);
    expect(record.mock.calls).toHaveLength(1);
    expect(record.mock.calls[0]?.[0]).toEqual({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "server",
      serverId: funding.serverId,
      capability: "vision",
      modelCodename: "synthetic/vision",
      costUsd: 0.004,
      providerRequestId: null,
      inputTokens: 40,
      outputTokens: 12,
    });
  });

  it("records nothing when the server's own key pays for the caption", async () => {
    stubAvatar();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createUnfundedCredentials({ modelId: VISION_MODEL.llm_id }),
      ),
    );
    spies.push(
      spyOn(remote, "fetchUserRemoteUrl").mockResolvedValue(
        Response.json({ choices: [{ message: { content: "a caption" } }], usage: { cost: 0.004 } }),
      ),
    );
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    const result = await new PeekProfilePictureTool().execute({ target_identity: "Juno" }, makeContext());

    expect(result.success).toBe(true);
    expect(record).not.toHaveBeenCalled();
  });

  it("returns the subscription copy and posts one channel notice when the funded key is refused", async () => {
    const funding = createSupporterFunding({ capability: "vision", modelCodename: "synthetic/vision" });
    stubAvatar();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({ modelId: VISION_MODEL.llm_id, funding: funding }),
      ),
    );
    spies.push(
      spyOn(remote, "fetchUserRemoteUrl").mockResolvedValue(
        Response.json(
          { error: { code: 402, message: "Key limit exceeded", metadata: { limit_source: "openrouter_key_limit" } } },
          { status: 402 },
        ),
      ),
    );
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);
    const { channel, sends } = noticeChannel();

    const result = await new PeekProfilePictureTool().execute({ target_identity: "Juno" }, makeContext({ channel }));

    expect(result.success).toBe(false);
    expect(result.error).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
    expect(sends).toHaveLength(1);
    expect(sends[0]).toContain(localizedCopy("en-US", "commands.subscribe.request.allowance_title"));
    expect(record).not.toHaveBeenCalled();
  });

  it("returns the subscription copy without a notice for user impersonation", async () => {
    const funding = createSupporterFunding({ capability: "vision", modelCodename: "synthetic/vision" });
    stubAvatar();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({ modelId: VISION_MODEL.llm_id, funding: funding }),
      ),
    );
    spies.push(
      spyOn(remote, "fetchUserRemoteUrl").mockResolvedValue(
        Response.json({ error: { metadata: { limit_source: "openrouter_key_limit" } } }, { status: 402 }),
      ),
    );
    const { channel, sends } = noticeChannel();

    const result = await new PeekProfilePictureTool().execute(
      { target_identity: "Juno" },
      makeContext({ channel, isUserImpersonation: true }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
    expect(sends).toHaveLength(0);
  });
});

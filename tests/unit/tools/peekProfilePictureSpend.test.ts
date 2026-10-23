import { describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { PeekProfilePictureTool } from "@/tools/functionCalls/peekProfilePictureTool";
import type { ToolContext } from "@/types/tool/interfaces";
import * as credentials from "@/utils/provider/credentialResolver";
import * as avatars from "@/utils/discord/avatarResolver";
import * as notices from "@/utils/discord/toolProgressNotice";
import * as remote from "@/utils/security/userRemoteFetch";
import { llmModelRepo } from "@/utils/db/repositories";
import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

describe("profile vision spend admission", () => {
  it("gates subscription avatar analysis and preserves BYOK transport", async () => {
    const vision = createLlmRow({
      llm_id: 2,
      llm_provider: "openrouter",
      llm_codename: "synthetic/vision",
      sees_images: true,
    });
    const context: ToolContext = {
      channel: { id: "synthetic-channel" } as ToolContext["channel"],
      client: {} as Client,
      provider: "openrouter",
      locale: "en-US",
      userId: "synthetic-user",
      internalUserId: 1,
      isUserImpersonation: true,
      tomoriState: createPersona({ llm: createLlmRow({ sees_images: false }), vision_llm: vision }),
    };
    const admission = spyOn(supporterSpendGuard, "begin").mockRejectedValue(
      new SupporterRequestDeniedError("allowance_exhausted"),
    );
    const transport = spyOn(remote, "fetchUserRemoteUrl").mockResolvedValue(
      Response.json({ choices: [{ message: { content: "caption" } }] }),
    );
    const spies = [
      admission,
      transport,
      spyOn(avatars, "resolveAvatarByIdentity").mockResolvedValue({
        sourceType: "user",
        username: "Juno",
        avatarUrl: "data:image/png;base64,aW1hZ2U=",
      }),
      spyOn(notices, "sendToolProgressNotice").mockResolvedValue(undefined),
      spyOn(llmModelRepo, "loadById").mockResolvedValue(vision),
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
        provider: "openrouter",
        apiKey: "synthetic-member",
        keyVersion: 1,
        savedConfig: null,
        source: "server",
        modelId: 2,
      }),
    ];
    try {
      const tool = new PeekProfilePictureTool();
      expect((await tool.execute({ target_identity: "Juno" }, context)).success).toBe(false);
      expect(admission.mock.calls[0]?.[0]).toBe("synthetic-member");
      expect(transport).not.toHaveBeenCalled();
      admission.mockResolvedValue(undefined);
      expect((await tool.execute({ target_identity: "Juno" }, context)).success).toBe(true);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(String(transport.mock.calls[0]?.[0])).toBe("https://openrouter.ai/api/v1/chat/completions");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

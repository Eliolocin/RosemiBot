import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import type { Client } from "discord.js";
import { speechModelSchema } from "@/types/db/schema";
import * as realTargets from "@/utils/provider/speechEndpointResolver";
import * as realSynthesis from "@/utils/speech/voiceMessageSynthesis";
import { GenerateVoiceMessageTool } from "@/tools/functionCalls/generateVoiceMessageTool";
import type { ToolContext } from "@/types/tool/interfaces";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../../helpers/fixtures";
import { localizedCopy } from "../../../helpers/localeCases";
import { createScopedModuleMocker } from "../../../helpers/mockSurface";
import { createVoiceSupporterFailure } from "./fundingFixtures";

const hostedTarget: realTargets.SpeechTargetResult = {
  kind: "hosted-model",
  endpoint: null,
  owner: { kind: "server", ownerId: 1 },
  credentialId: 10,
  credentialRevision: 1,
  apiKey: "synthetic-key",
  model: speechModelSchema.parse({
    speech_model_id: 2,
    provider: "openrouter",
    voice_mode: "clone",
    codename: "fish-audio/s2.1-pro",
  }),
};

let synthesisResult: realSynthesis.VoiceMessageSynthesisResult = createVoiceSupporterFailure();
const requests: realSynthesis.VoiceMessageSynthesisRequest[] = [];

const scoped = createScopedModuleMocker(mock, {
  "@/utils/provider/speechEndpointResolver": realTargets,
  "@/utils/speech/voiceMessageSynthesis": realSynthesis,
});
scoped.module("@/utils/provider/speechEndpointResolver", () => ({
  ...realTargets,
  resolveSpeechTargets: async () => ({ design: null, clone: hostedTarget }),
}));
scoped.module("@/utils/speech/voiceMessageSynthesis", () => ({
  ...realSynthesis,
  synthesizeVoiceMessage: async (request: realSynthesis.VoiceMessageSynthesisRequest) => {
    requests.push(request);
    return synthesisResult;
  },
}));

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    channel: { id: "synthetic-channel" } as ToolContext["channel"],
    client: {} as Client,
    provider: "openrouter",
    locale: "en-US",
    tomoriState: createPersona({
      speech_voice_sample_id: 12,
      speech_voice_design_prompt: null,
      speech_voice_id: null,
      voice_source_priority: "clone",
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

beforeAll(initializeLocalizer);
afterAll(() => {
  requests.length = 0;
});

describe("generate voice message tool billing guards", () => {
  it("returns the subscription copy and posts one channel notice when funded speech is refused", async () => {
    synthesisResult = createVoiceSupporterFailure();
    requests.length = 0;
    const { channel, sends } = noticeChannel();

    const result = await new GenerateVoiceMessageTool().execute(
      { title: "greeting", script: "Hello there" },
      makeContext({ channel }),
    );

    expect(requests).toHaveLength(1);
    expect(result.success).toBe(false);
    expect(result.error).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
    expect(sends).toHaveLength(1);
    expect(sends[0]).toContain(localizedCopy("en-US", "commands.subscribe.request.allowance_title"));
  });

  it("returns the subscription copy without a notice for user impersonation", async () => {
    synthesisResult = createVoiceSupporterFailure();
    requests.length = 0;
    const { channel, sends } = noticeChannel();

    const result = await new GenerateVoiceMessageTool().execute(
      { title: "greeting", script: "Hello there" },
      makeContext({ channel, isUserImpersonation: true }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
    expect(sends).toHaveLength(0);
  });
});

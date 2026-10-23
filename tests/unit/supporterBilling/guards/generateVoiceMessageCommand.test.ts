import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { ChannelType, type ChatInputCommandInteraction, type Client } from "discord.js";
import { execute as generateVoiceMessage } from "@/commands/generate/voice-message";
import { speechModelSchema } from "@/types/db/schema";
import { personaRepository, statRepository } from "@/utils/db/repositories";
import { cooldownRepository } from "@/utils/db/repositories/CooldownRepository";
import * as realSamples from "@/utils/db/repositories/SpeechRepository";
import * as realTargets from "@/utils/provider/speechEndpointResolver";
import * as realSynthesis from "@/utils/speech/voiceMessageSynthesis";
import * as realDelivery from "@/utils/discord/webhook/voiceMessageDelivery";
import * as realMetadata from "@/utils/audio/voiceMessageMetadata";
import * as realModals from "@/utils/discord/ui/modals";
import * as realWhitelist from "@/utils/cache/channelWhitelistCache";
import * as realSpotlight from "@/utils/cache/personalSpotlightCache";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../../helpers/fixtures";
import { makeFakeInteraction } from "../../../helpers/fakeInteraction";
import { createScopedModuleMocker } from "../../../helpers/mockSurface";
import { localizedCopy } from "../../../helpers/localeCases";
import { createVoiceSupporterFailure } from "./fundingFixtures";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import * as realCrypto from "@/utils/security/crypto";

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

let persona = createPersona({
  speech_voice_sample_id: 12,
  speech_voice_design_prompt: null,
  speech_voice_id: null,
  voice_source_priority: "clone",
  config: { voice_message_enabled: true },
});
let modal = makeFakeInteraction();
let synthesisResult: realSynthesis.VoiceMessageSynthesisResult = createVoiceSupporterFailure();
const requests: realSynthesis.VoiceMessageSynthesisRequest[] = [];
let targetResolution: Awaited<ReturnType<typeof realTargets.resolveSpeechTargets>> = {
  design: null,
  clone: hostedTarget,
};
let revokeOnSubmit = false;

const scoped = createScopedModuleMocker(mock, {
  "@/utils/db/repositories/SpeechRepository": realSamples,
  "@/utils/provider/speechEndpointResolver": realTargets,
  "@/utils/speech/voiceMessageSynthesis": realSynthesis,
  "@/utils/discord/webhook/voiceMessageDelivery": realDelivery,
  "@/utils/audio/voiceMessageMetadata": realMetadata,
  "@/utils/discord/ui/modals": realModals,
  "@/utils/cache/channelWhitelistCache": realWhitelist,
  "@/utils/cache/personalSpotlightCache": realSpotlight,
  "@/utils/security/crypto": realCrypto,
});
scoped.module("@/utils/db/repositories/SpeechRepository", () => ({
  ...realSamples,
  loadSpeechRoutingPolicy: async () => ({ serverAllowed: true, fallbackEnabled: true }),
  loadVoiceSamples: async () => [
    {
      sample_id: 12,
      name: "Fixture sample",
      file_path: "fixture.wav",
      server_id: 1,
      ref_text: null,
      duration_ms: 1000,
    },
  ],
}));
scoped.module("@/utils/provider/speechEndpointResolver", () => ({
  ...realTargets,
  resolveSpeechTargets: async () => targetResolution,
}));
scoped.module("@/utils/security/crypto", () => ({ ...realCrypto, getOptApiKey: async () => null }));
scoped.module("@/utils/speech/voiceMessageSynthesis", () => ({
  ...realSynthesis,
  synthesizeVoiceMessage: async (request: realSynthesis.VoiceMessageSynthesisRequest) => {
    requests.push(request);
    return synthesisResult;
  },
}));
scoped.module("@/utils/discord/webhook/voiceMessageDelivery", () => ({
  ...realDelivery,
  deliverVoiceMessage: async () => "synthetic-message-id",
}));
scoped.module("@/utils/audio/voiceMessageMetadata", () => ({
  ...realMetadata,
  generateVoiceMessageMetadata: async () => null,
}));
scoped.module("@/utils/discord/ui/modals", () => ({
  ...realModals,
  promptWithRawModal: async () => {
    if (revokeOnSubmit)
      targetResolution = {
        design: null,
        clone: null,
        denials: { clone: new SupporterRequestDeniedError("missing_sponsorship", undefined, "voice", "server") },
      };
    await modal.interaction.deferReply();
    return { outcome: "submit", interaction: modal.interaction, values: { voice_message_script: "Hello there" } };
  },
}));
scoped.module("@/utils/cache/channelWhitelistCache", () => ({
  ...realWhitelist,
  getCachedWhitelistStatus: async () => null,
}));
scoped.module("@/utils/cache/personalSpotlightCache", () => ({
  ...realSpotlight,
  getCachedPersonalSpotlightStatus: async () => null,
}));

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  targetResolution = { design: null, clone: hostedTarget };
  revokeOnSubmit = false;
});

beforeAll(initializeLocalizer);

function replyPayloads(): string {
  return JSON.stringify(modal.calls.filter((call) => ["reply", "editReply", "followUp"].includes(call.method)));
}

async function run(upload = false): Promise<ReturnType<typeof makeFakeInteraction>> {
  requests.length = 0;
  modal = makeFakeInteraction({ deferred: true, replied: true });
  spies.push(spyOn(personaRepository, "loadAllForServer").mockImplementation(async () => [persona]));
  spies.push(spyOn(statRepository, "recordStat").mockImplementation(() => undefined));
  spies.push(
    spyOn(cooldownRepository, "checkMessageTriggerCooldownWithWhitelist").mockResolvedValue({
      isOnCooldown: false,
      remainingSeconds: 0,
      cooldownType: 0,
    }),
  );
  const command = makeFakeInteraction({
    guildId: "synthetic-guild",
    channel: { id: "synthetic-channel", type: ChannelType.GuildText, isThread: () => false },
  });
  Object.assign(command.interaction.options, {
    getAttachment: () =>
      upload
        ? {
            url: "https://cdn.discordapp.com/attachments/1/2/sample.wav",
            name: "sample.wav",
            contentType: "audio/wav",
            size: 1000,
          }
        : null,
  });
  await generateVoiceMessage(
    {} as Client,
    command.interaction as unknown as ChatInputCommandInteraction,
    createUserRow(),
    "en-US",
  );
  return command;
}

describe("generate voice message command billing guards", () => {
  it("reports revoked funding before source compatibility checks and after modal submission", async () => {
    for (const scenario of ["no-source", "upload", "modal"] as const) {
      persona = createPersona({
        speech_voice_sample_id: scenario === "modal" ? 12 : null,
        speech_voice_design_prompt: null,
        speech_voice_id: null,
        voice_source_priority: "clone",
        config: { voice_message_enabled: true },
      });
      targetResolution =
        scenario === "modal"
          ? { design: null, clone: hostedTarget }
          : {
              design: null,
              clone: null,
              denials: { clone: new SupporterRequestDeniedError("missing_sponsorship", undefined, "voice", "server") },
            };
      revokeOnSubmit = scenario === "modal";
      const command = await run(scenario === "upload");
      const payload = scenario === "modal" ? replyPayloads() : JSON.stringify(command.calls);
      expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.sponsorship.errors.missing_sponsorship"));
      expect(requests).toHaveLength(0);
    }
  });

  it("reports a subscription denial from synthesis as the subscription copy", async () => {
    persona = createPersona({
      speech_voice_sample_id: 12,
      speech_voice_design_prompt: null,
      speech_voice_id: null,
      voice_source_priority: "clone",
      config: { voice_message_enabled: true },
    });
    synthesisResult = createVoiceSupporterFailure();
    await run();

    expect(requests).toHaveLength(1);
    const payload = replyPayloads();
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.request.allowance_title"));
  });
});

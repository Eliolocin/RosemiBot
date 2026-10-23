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

const scoped = createScopedModuleMocker(mock, {
  "@/utils/db/repositories/SpeechRepository": realSamples,
  "@/utils/provider/speechEndpointResolver": realTargets,
  "@/utils/speech/voiceMessageSynthesis": realSynthesis,
  "@/utils/discord/webhook/voiceMessageDelivery": realDelivery,
  "@/utils/audio/voiceMessageMetadata": realMetadata,
  "@/utils/discord/ui/modals": realModals,
  "@/utils/cache/channelWhitelistCache": realWhitelist,
  "@/utils/cache/personalSpotlightCache": realSpotlight,
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
  resolveSpeechTargets: async () => ({ design: null, clone: hostedTarget }),
}));
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
});

beforeAll(initializeLocalizer);

function replyPayloads(): string {
  return JSON.stringify(modal.calls.filter((call) => ["reply", "editReply", "followUp"].includes(call.method)));
}

async function run(): Promise<void> {
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
  Object.assign(command.interaction.options, { getAttachment: () => null });
  await generateVoiceMessage(
    {} as Client,
    command.interaction as unknown as ChatInputCommandInteraction,
    createUserRow(),
    "en-US",
  );
}

describe("generate voice message command billing guards", () => {
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

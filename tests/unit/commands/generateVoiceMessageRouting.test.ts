import { beforeAll, afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ChannelType, type ChatInputCommandInteraction, type Client } from "discord.js";
import { execute } from "@/commands/generate/voice-message";
import type { CustomEndpointRow } from "@/types/db/schema";
import { personaRepository, statRepository } from "@/utils/db/repositories";
import { cooldownRepository } from "@/utils/db/repositories/CooldownRepository";
import * as realTargets from "@/utils/provider/speechEndpointResolver";
import * as realSynthesis from "@/utils/speech/voiceMessageSynthesis";
import * as realDelivery from "@/utils/discord/webhook/voiceMessageDelivery";
import * as realMetadata from "@/utils/audio/voiceMessageMetadata";
import * as realModals from "@/utils/discord/ui/modals";
import * as realWhitelist from "@/utils/cache/channelWhitelistCache";
import * as realSpotlight from "@/utils/cache/personalSpotlightCache";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { createScopedModuleMocker } from "../../helpers/mockSurface";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";
import * as realSamples from "@/utils/db/repositories/SpeechRepository";

const design: CustomEndpointRow = {
  connection_id: 1,
  custom_endpoint_id: 1,
  server_id: 1,
  user_id: null,
  label: "Design",
  capability: "speech",
  api_style: "tts-clone",
  endpoint_url: "http://127.0.0.1:9001",
  requires_auth: false,
  extra_config: { voice_mode: "voice-design", script_markup: "plain" },
  has_tools: false,
  sees_images: false,
  sees_videos: false,
  supports_structoutput: false,
  strict_role_alternation: false,
  supports_prefix_completion: false,
  supports_assistant_prefill: false,
  verbatim_tool_calling: false,
  is_default: false,
};
const clone: CustomEndpointRow = {
  ...design,
  connection_id: 2,
  custom_endpoint_id: 2,
  label: "Clone",
  endpoint_url: "http://127.0.0.1:9002",
  extra_config: { voice_mode: "clone", script_markup: "plain" },
};
let cloneEndpoint = clone;
let persona = createPersona({
  speech_voice_sample_id: 12,
  speech_voice_design_prompt: "Warm voice",
  config: { voice_message_enabled: true },
});
let selectedSource: string | null = null;
let changeTarget = false;
let failSynthesis = false;
let failDelivery = false;
let onSubmit: (() => void) | null = null;
let modal: ReturnType<typeof makeFakeInteraction>;
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
  loadVoiceSamples: async () => [
    {
      sample_id: 12,
      name: "Test sample",
      file_path: "test.wav",
      server_id: 1,
      ref_text: null,
      duration_ms: 1000,
    },
  ],
}));
scoped.module("@/utils/provider/speechEndpointResolver", () => ({
  ...realTargets,
  resolveSpeechTargets: async () => ({
    design: { endpoint: changeTarget ? { ...design, custom_endpoint_id: 3 } : design, apiKey: "design-key" },
    clone: { endpoint: cloneEndpoint, apiKey: "clone-key" },
  }),
}));
scoped.module("@/utils/speech/voiceMessageSynthesis", () => ({
  ...realSynthesis,
  synthesizeVoiceMessage: async (request: realSynthesis.VoiceMessageSynthesisRequest) => {
    requests.push(request);
    const isElevenLabs = request.source.kind === "elevenlabs";
    return {
      success: !failSynthesis,
      backendKey: isElevenLabs ? "elevenlabs" : request.source.kind === "design" ? "tts-voice-design" : "tts-clone",
      audioBuffer: Buffer.from("audio"),
      contentType: isElevenLabs ? "audio/mpeg" : "audio/wav",
      extension: isElevenLabs ? "mp3" : "wav",
    };
  },
}));
scoped.module("@/utils/discord/webhook/voiceMessageDelivery", () => ({
  ...realDelivery,
  deliverVoiceMessage: async () => (failDelivery ? null : "message-id"),
}));
scoped.module("@/utils/audio/voiceMessageMetadata", () => ({
  ...realMetadata,
  generateVoiceMessageMetadata: async () => null,
}));
scoped.module("@/utils/discord/ui/modals", () => ({
  ...realModals,
  promptWithRawModal: async () => {
    onSubmit?.();
    await modal.interaction.deferReply();
    return {
      outcome: "submit",
      interaction: modal.interaction,
      values: {
        voice_message_script: "Hello",
        ...(selectedSource ? { voice_message_source: selectedSource } : {}),
      },
    };
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

beforeAll(initializeLocalizer);
afterEach(() => mock.restore());

async function run(
  options: {
    priority?: "design" | "clone";
    source?: string;
    stale?: boolean;
    synthesisFailure?: boolean;
    deliveryFailure?: boolean;
    elevenLabs?: boolean;
    replacementVoiceId?: string;
  } = {},
) {
  requests.length = 0;
  selectedSource = options.source ?? null;
  changeTarget = false;
  failSynthesis = options.synthesisFailure ?? false;
  failDelivery = options.deliveryFailure ?? false;
  cloneEndpoint = options.elevenLabs
    ? {
        ...clone,
        api_style: "elevenlabs",
        endpoint_url: "https://api.elevenlabs.io",
        requires_auth: true,
        extra_config: {},
      }
    : clone;
  persona = createPersona({
    speech_voice_sample_id: options.elevenLabs ? null : 12,
    speech_voice_design_prompt: options.elevenLabs ? null : "Warm voice",
    speech_voice_id: options.elevenLabs ? "voice-initial" : null,
    voice_source_priority: options.priority ?? "design",
    config: { voice_message_enabled: true },
  });
  modal = makeFakeInteraction();
  onSubmit = () => {
    if (options.stale) changeTarget = true;
    if (options.replacementVoiceId) persona = { ...persona, speech_voice_id: options.replacementVoiceId };
  };
  spyOn(statRepository, "recordStat").mockImplementation(() => undefined);
  spyOn(personaRepository, "loadAllForServer").mockImplementation(async () => [persona]);
  spyOn(cooldownRepository, "checkMessageTriggerCooldownWithWhitelist").mockResolvedValue({
    isOnCooldown: false,
    remainingSeconds: 0,
    cooldownType: 0,
  });
  const command = makeFakeInteraction({
    guildId: "guild-1",
    channel: { id: "channel-1", type: ChannelType.GuildText, isThread: () => false },
  });
  Object.assign(command.interaction.options, { getAttachment: () => null });
  await execute({} as Client, command.interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");
  return modal.calls;
}

describe("Voice message command routing", () => {
  it("synthesizes once through each matching target when personas prioritize different sources", async () => {
    for (const priority of ["design", "clone"] as const) {
      await run({ priority });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.source.kind).toBe(priority);
      expect(requests[0]?.endpoint?.custom_endpoint_id).toBe(priority === "design" ? 1 : 2);
      expect(requests[0]?.endpointApiKey).toBe(priority === "design" ? "design-key" : "clone-key");
    }
  });
  it("honors an invocation source without changing persona priority", async () => {
    await run({ source: "persona-sample" });
    expect(requests[0]?.endpoint?.custom_endpoint_id).toBe(2);
    expect(persona.voice_source_priority).toBe("design");
  });
  it("rejects a target changed while the modal was open", async () => {
    const calls = await run({ stale: true });
    expect(requests).toHaveLength(0);
    expect(JSON.stringify(calls)).toContain(
      localizedCopy("en-US", "commands.generate.voice-message.stale_description"),
    );
  });
  it("rejects an ElevenLabs voice changed while the modal was open", async () => {
    const calls = await run({ elevenLabs: true, replacementVoiceId: "voice-replacement" });
    expect(requests).toHaveLength(0);
    expect(JSON.stringify(calls)).toContain(
      localizedCopy("en-US", "commands.generate.voice-message.stale_description"),
    );
  });
  it("uses the unchanged ElevenLabs voice selected when the modal opened", async () => {
    await run({ elevenLabs: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.source).toEqual({ kind: "elevenlabs", voiceId: "voice-initial" });
  });
  it("does not retry synthesis through the other slot after synthesis or delivery failure", async () => {
    for (const options of [{ synthesisFailure: true }, { deliveryFailure: true }]) {
      await run(options);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.endpoint?.custom_endpoint_id).toBe(1);
    }
  });
});

import { beforeAll, afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ChannelType, type ChatInputCommandInteraction, type Client } from "discord.js";
import { execute } from "@/commands/generate/voice-message";
import { speechModelSchema, type CustomEndpointRow } from "@/types/db/schema";
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
let hostedTargets: Awaited<ReturnType<typeof realTargets.resolveSpeechTargets>> | null = null;
const resolvedUserIds: Array<number | undefined> = [];
function customTarget(endpoint: CustomEndpointRow): realTargets.SpeechTargetResult {
  return {
    kind: "custom-endpoint",
    owner: { kind: "server", ownerId: 1 },
    endpoint,
    apiKey: `${endpoint.label.toLowerCase()}-key`,
  };
}
function hostedTarget(mode: "design" | "clone", personal = false): realTargets.SpeechTargetResult {
  return {
    kind: "hosted-model",
    endpoint: null,
    owner: { kind: personal ? "personal" : "server", ownerId: 1 },
    credentialId: 10,
    credentialRevision: 1,
    apiKey: "synthetic-key",
    model: speechModelSchema.parse({
      speech_model_id: mode === "design" ? 1 : 2,
      provider: mode === "design" ? "google" : "openrouter",
      voice_mode: mode,
      codename: mode === "design" ? "gemini-3.8-flash-tts" : "fish-audio/s2.1-pro",
    }),
  };
}
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
let synthesisResultOverride: Partial<realSynthesis.VoiceMessageSynthesisResult> = {};

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
  resolveSpeechTargets: async (_serverId: number, userId?: number) => {
    resolvedUserIds.push(userId);
    return (
      hostedTargets ?? {
        design: customTarget(changeTarget ? { ...design, custom_endpoint_id: 3 } : design),
        clone: customTarget(cloneEndpoint),
      }
    );
  },
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
      ...synthesisResultOverride,
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
    targets?: NonNullable<typeof hostedTargets>;
    sourceOnly?: "design" | "clone";
    changeHosted?: () => void;
    synthesisResult?: Partial<realSynthesis.VoiceMessageSynthesisResult>;
  } = {},
) {
  requests.length = 0;
  synthesisResultOverride = options.synthesisResult ?? {};
  resolvedUserIds.length = 0;
  hostedTargets = options.targets ?? null;
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
    speech_voice_sample_id: options.elevenLabs || options.sourceOnly === "design" ? null : 12,
    speech_voice_design_prompt: options.elevenLabs || options.sourceOnly === "clone" ? null : "Warm voice",
    speech_voice_id: options.elevenLabs ? "voice-initial" : null,
    voice_source_priority: options.priority ?? "design",
    config: { voice_message_enabled: true },
  });
  modal = makeFakeInteraction();
  onSubmit = () => {
    options.changeHosted?.();
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
  it("renders the final target label after server fallback even when its model name is empty", async () => {
    const targetLabel = "Server fallback speech";
    const calls = await run({
      targets: { design: hostedTarget("design", true), clone: null },
      sourceOnly: "design",
      synthesisResult: {
        targetLabel,
        usedServerFallback: true,
        attempts: [
          {
            provider: "tts-clone",
            model: "",
            owner: { kind: "server", ownerId: 1 },
            source: "design",
            synthesisSuccess: true,
            operations: [],
          },
        ],
      },
    });
    const receipt = calls.findLast((call) => call.method === "editReply")?.args[0] as {
      embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }>;
    };
    const fields = receipt.embeds[0]?.toJSON().fields;
    expect(
      fields?.find(
        (field) => field.name === localizedCopy("en-US", "commands.generate.voice-message.success_target_field"),
      )?.value,
    ).toBe(targetLabel);
    expect(fields?.every((field) => field.value.trim().length > 0)).toBe(true);
  });

  it("passes independently owned hosted targets and saved source identity through opening and submission", async () => {
    for (const mode of ["design", "clone"] as const) {
      for (const personal of [false, true]) {
        const targets = { design: hostedTarget("design", personal), clone: hostedTarget("clone", !personal) };
        await run({ targets, sourceOnly: mode });
        expect(requests).toHaveLength(1);
        expect(requests[0]?.target).toEqual(targets[mode]);
        expect(requests[0]?.routing?.userId).toBe(1);
        expect(requests[0]?.routing?.sourceIsExplicit).toBe(false);
        expect(requests[0]?.source.kind).toBe(mode);
        if (mode === "design") expect(requests[0]?.source).toHaveProperty("personaId", persona.persona_id);
        expect(resolvedUserIds).toEqual([1, 1]);
      }
    }
  });
  it("rejects model, credential, owner, and target-kind changes even when numeric IDs collide", async () => {
    const initial = hostedTarget("design");
    if (initial.kind !== "hosted-model") throw new Error("Missing hosted fixture");
    const replacements: realTargets.SpeechTargetResult[] = [
      { ...initial, model: { ...initial.model, codename: "gemini-3.8-flash-lite-tts", speech_model_id: 3 } },
      { ...initial, credentialRevision: 2 },
      { ...initial, owner: { kind: "personal", ownerId: 1 } },
      customTarget(design),
    ];
    for (const replacement of replacements) {
      const calls = await run({
        targets: { design: initial, clone: null },
        sourceOnly: "design",
        changeHosted: () => {
          hostedTargets = { design: replacement, clone: null };
        },
      });
      expect(requests).toHaveLength(0);
      expect(JSON.stringify(calls)).toContain(
        localizedCopy("en-US", "commands.generate.voice-message.stale_description"),
      );
    }
    await run({
      targets: { design: customTarget(design), clone: null },
      sourceOnly: "design",
      changeHosted: () => {
        hostedTargets = { design: initial, clone: null };
      },
    });
    expect(requests).toHaveLength(0);
  });
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
  it("offers the provider detail only behind Show Full Error when synthesis fails", async () => {
    const providerDetail = "HTTP 400: synthetic provider rejection";
    const calls = await run({
      synthesisFailure: true,
      synthesisResult: {
        errorKind: "invalid_request",
        details: "Hosted speech failed: invalid_request.",
        providerDetail,
      },
    });
    const failure = calls.find((call) => call.method === "editReply");
    const payload = JSON.stringify(failure?.args[0]);
    expect(payload).toContain("error_full_detail");
    expect(payload).not.toContain(providerDetail);
  });

  it("does not retry synthesis through the other slot after synthesis or delivery failure", async () => {
    for (const options of [{ synthesisFailure: true }, { deliveryFailure: true }]) {
      await run(options);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.endpoint?.custom_endpoint_id).toBe(1);
    }
  });
});

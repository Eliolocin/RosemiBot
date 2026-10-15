import type { BaseGuildTextChannel, TextChannel } from "discord.js";
import {
  BaseTool,
  type Tool,
  type ToolAssemblyContext,
  type ToolContext,
  type ToolParameterSchema,
  type ToolResult,
} from "@/types/tool/interfaces";
import { createToolVariant } from "@/tools/assembly";
import { ELEVENLABS_SERVICE_NAME } from "@/utils/audio/elevenLabsAccount";
import { setCachedVoiceTranscript } from "@/utils/audio/voiceTranscriptCache";
import { generateVoiceMessageMetadata } from "@/utils/audio/voiceMessageMetadata";
import { getOptApiKey, hasOptApiKey } from "@/utils/security/crypto";
import {
  deliverVoiceMessage,
  postVoiceTranscriptCaption,
  type VoiceDeliveryTarget,
} from "@/utils/discord/webhook/voiceMessageDelivery";
import { resolveSpeechTargets } from "@/utils/provider/speechEndpointResolver";
import { resolveVoiceSourceCandidates } from "@/utils/speech/voiceSourceResolution";
import { resolveVoiceSourceCapabilities } from "@/utils/speech/voiceSourceCapabilities";
import { synthesizeVoiceMessage, type ResolvedVoiceSource } from "@/utils/speech/voiceMessageSynthesis";
import { statRepository } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";

/**
 * Per-endpoint description variants for the voice message tool.
 * The registry proxies the tool with the matching variant based on the server's active
 * speech endpoint's script_markup setting. Defaults to bracket-tags (ElevenLabs / no endpoint).
 */
export const VOICE_TOOL_VARIANTS = {
  "bracket-tags": {
    toolDescription:
      "Generate a spoken Discord audio message using the active persona's configured voice. " +
      "Use this only when voice delivery materially improves the reply. " +
      "You may include bracketed expression tags anywhere in the script to shape delivery " +
      "(e.g. [happy], [sad], [whispers], [laughs]). " +
      "The tool sends the audio directly to the channel with no text caption.",
    scriptDescription:
      "The exact spoken script for the voice message. Keep it concise and natural for speech. " +
      "Bracketed expression tags (emotional states like [happy], [sad], [tired] or actions like " +
      "[whispers], [laughs]) can be placed inline to shape delivery.",
  },
  plain: {
    toolDescription:
      "Generate a spoken Discord audio message using the active persona's configured voice. " +
      "Use this only when voice delivery materially improves the reply. " +
      "Write the script as natural plain speech text only; do not include any bracketed tags or special markup. " +
      "The tool sends the audio directly to the channel with no text caption.",
    scriptDescription:
      "The exact spoken script for the voice message. Keep it concise and natural for speech. " +
      "Plain text only: do not write bracketed tags or any special markup.",
  },
  emoji: {
    toolDescription:
      "Generate a spoken Discord audio message using the active persona's configured voice. " +
      "Use this only when voice delivery materially improves the reply. " +
      "You may embed emoji characters inline in the script to convey emotion " +
      "(e.g. 😊 for happy, 😢 for sad, 😮 for surprised). Do not use bracketed tags. " +
      "The tool sends the audio directly to the channel with no text caption.",
    scriptDescription:
      "The exact spoken script for the voice message. Keep it concise and natural for speech. " +
      "Embed emoji characters inline to convey emotion (e.g. 😊, 😢, 😮). No bracketed tags.",
  },
  "voice-design": {
    toolDescription:
      "Generate a spoken Discord audio message using the active persona's configured voice design prompt. " +
      "Use this only when voice delivery materially improves the reply. " +
      "Write the script as natural plain speech text. You may optionally provide extra one-off delivery instructions " +
      'such as "sound mad", "near tears", or "sleepy and quiet"; those instructions shape this message only and are not spoken aloud. ' +
      "The tool sends the audio directly to the channel with no text caption.",
    scriptDescription:
      "The exact spoken script for the voice message. Keep it concise and natural for speech. " +
      "Plain text only: put delivery direction in voice_instructions instead of in the spoken script.",
    voiceInstructionsDescription:
      "Optional one-off delivery direction for this voice message only. Examples: sound mad, about to cry, whispery and tired. " +
      "Do not repeat the spoken script here.",
  },
} as const satisfies Record<
  string,
  { toolDescription: string; scriptDescription: string; voiceInstructionsDescription?: string }
>;

export type VoiceScriptMarkup = keyof typeof VOICE_TOOL_VARIANTS;

export function buildVoiceMessageToolVariant(
  tool: Tool,
  scriptMarkup: VoiceScriptMarkup,
  options: { voiceInstructionsAvailable?: boolean } = {},
): Tool {
  const variant = VOICE_TOOL_VARIANTS[scriptMarkup] ?? VOICE_TOOL_VARIANTS["bracket-tags"];
  const voiceInstructionsAvailable = options.voiceInstructionsAvailable ?? scriptMarkup === "voice-design";
  const parameters: ToolParameterSchema = {
    ...tool.parameters,
    properties: {
      ...tool.parameters.properties,
      script: {
        ...tool.parameters.properties.script,
        description: variant.scriptDescription,
      },
      ...(voiceInstructionsAvailable
        ? {
            voice_instructions: {
              type: "string" as const,
              description: VOICE_TOOL_VARIANTS["voice-design"].voiceInstructionsDescription,
            },
          }
        : {}),
    },
  };

  return createToolVariant(tool, {
    description: variant.toolDescription,
    parameters,
  });
}

export class GenerateVoiceMessageTool extends BaseTool {
  name = "generate_voice_message";
  description = VOICE_TOOL_VARIANTS["bracket-tags"].toolDescription;
  category = "discord" as const;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          'A short descriptive title for the voice message (e.g. "greeting", "farewell", "apology"). Used as the audio filename. Keep it lowercase with no spaces.',
      },
      script: {
        type: "string",
        description: VOICE_TOOL_VARIANTS["bracket-tags"].scriptDescription,
      },
    },
    required: ["title", "script"],
  };

  async assembleForContext(context: ToolAssemblyContext): Promise<Tool | null> {
    const serverId = Number.parseInt(context.state.server_id, 10);
    const targets = Number.isInteger(serverId) ? await resolveSpeechTargets(serverId) : { design: null, clone: null };
    const candidate = resolveVoiceSourceCandidates({
      targets: { design: targets.design?.endpoint ?? null, clone: targets.clone?.endpoint ?? null },
      legacyElevenLabsAvailable: !targets.clone && (await hasOptApiKey(serverId, ELEVENLABS_SERVICE_NAME)),
      persona: {
        speech_voice_sample_id: context.state.activePersonaVoiceSampleId,
        speech_voice_id: context.state.activePersonaVoiceId,
        speech_voice_design_prompt: context.state.activePersonaVoiceDesignPrompt,
        voice_source_priority: context.state.activePersonaVoiceSourcePriority,
      },
    })[0];
    if (!candidate) return null;
    const activeSpeechEndpoint = candidate.shape === "design" ? targets.design : targets.clone;
    const scriptMarkup =
      (activeSpeechEndpoint?.endpoint?.extra_config.script_markup as string | undefined) ?? "bracket-tags";
    const voiceDesign = candidate.shape === "design";
    const cloneInstructionsAvailable = resolveVoiceSourceCapabilities(
      activeSpeechEndpoint?.endpoint,
    ).cloneInstructionsAvailable;
    const variant = voiceDesign
      ? "voice-design"
      : scriptMarkup in VOICE_TOOL_VARIANTS
        ? (scriptMarkup as VoiceScriptMarkup)
        : "bracket-tags";

    return buildVoiceMessageToolVariant(this, variant, {
      voiceInstructionsAvailable: voiceDesign || cloneInstructionsAvailable,
    });
  }

  private resolveThreadId(context: ToolContext): string | undefined {
    return "isThread" in context.channel && typeof context.channel.isThread === "function" && context.channel.isThread()
      ? context.channel.id
      : undefined;
  }

  private buildAttachmentName(title: string, extension: string): string {
    const baseName = title
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);

    const safeBaseName = baseName.length > 0 ? baseName : "voice";
    return `${safeBaseName}.${extension}`;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const validation = this.validateParameters(args);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Invalid parameters: ${validation.errors?.join(", ") || validation.missingParams?.join(", ") || "unknown validation error"}`,
      };
    }

    const title = typeof args.title === "string" ? args.title.trim() : "voice";
    const script = typeof args.script === "string" ? args.script.trim() : "";
    const voiceInstructions = typeof args.voice_instructions === "string" ? args.voice_instructions.trim() : "";
    if (!script) {
      return {
        success: false,
        error: "The voice script was empty.",
      };
    }

    const targets = await resolveSpeechTargets(context.tomoriState.server_id);
    const legacyKey = !targets.clone
      ? ((await getOptApiKey(context.tomoriState.server_id, ELEVENLABS_SERVICE_NAME)) ?? "")
      : "";
    const candidate = resolveVoiceSourceCandidates({
      targets: { design: targets.design?.endpoint ?? null, clone: targets.clone?.endpoint ?? null },
      legacyElevenLabsAvailable: Boolean(legacyKey),
      persona: context.tomoriState,
    })[0];
    if (!candidate) {
      return { success: false, error: "No configured persona voice matches the server's speech selections." };
    }
    const speechEndpoint = candidate.shape === "design" ? targets.design : targets.clone;
    const activeEndpoint = speechEndpoint?.endpoint ?? null;
    const source: ResolvedVoiceSource =
      candidate.shape === "design"
        ? { kind: "design", designPrompt: candidate.designPrompt ?? "" }
        : candidate.id === "persona-sample"
          ? { kind: "clone", voiceSampleId: candidate.sampleId ?? 0 }
          : { kind: "elevenlabs", voiceId: candidate.voiceId ?? "" };
    const elevenLabsApiKey = source.kind === "elevenlabs" ? speechEndpoint?.apiKey || legacyKey : "";
    const endpointApiKey = speechEndpoint?.apiKey ?? "";

    const synthesisResult = await synthesizeVoiceMessage({
      endpoint: activeEndpoint,
      endpointApiKey,
      elevenLabsApiKey,
      source,
      script,
      voiceInstructions,
      chatterbox: {
        turboEnabled: context.tomoriState.config.chatterbox_turbo_enabled ?? true,
        cfgWeight: context.tomoriState.config.chatterbox_cfg_weight ?? 0.5,
        exaggeration: context.tomoriState.config.chatterbox_exaggeration ?? 0.5,
      },
      ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
    });

    // /kill stops awaiting this tool but cannot stop it, so synthesis that finished before the abort
    // landed still reaches here; delivering now would post a voice message the user killed.
    if (context.abortSignal?.aborted) {
      return { success: false, error: "Voice message generation was cancelled." };
    }

    if (!synthesisResult.success || !synthesisResult.audioBuffer) {
      return {
        success: false,
        error: synthesisResult.details || "Failed to generate the voice message.",
      };
    }

    const isElevenLabs = synthesisResult.backendKey === "elevenlabs";
    const attachmentName = this.buildAttachmentName(title, synthesisResult.extension ?? (isElevenLabs ? "mp3" : "wav"));
    const threadId = this.resolveThreadId(context);
    const captionText = synthesisResult.cleanedCaptionText ?? "";
    // Strip MIME parameters, so Discord rejects waveform/duration_secs for non-bare types.
    const mimeType = (synthesisResult.contentType ?? (isElevenLabs ? "audio/mpeg" : "audio/wav")).split(";")[0].trim();
    const voiceMeta = await generateVoiceMessageMetadata(synthesisResult.audioBuffer, mimeType);

    if (!voiceMeta) {
      log.warn("[VoiceWaveform] Waveform generation returned null — falling back to plain attachment");
    }

    const target: VoiceDeliveryTarget = {
      // The tool types its channel more broadly than the delivery module, which only
      // ever reaches Discord's guild message endpoints.
      channel: context.channel as TextChannel | BaseGuildTextChannel,
      webhook: context.webhook ?? null,
      threadId,
      personaUsername: context.personaUsername,
      personaAvatarUrl: context.personaAvatarUrl,
      personaId: context.tomoriState.persona_id,
    };

    const sentMessageId = await deliverVoiceMessage({
      target,
      audioBuffer: synthesisResult.audioBuffer,
      mimeType,
      filename: attachmentName,
      voiceMeta,
    });

    if (!sentMessageId) {
      return { success: false, error: "Voice message delivery failed.", responseDelivered: false };
    }

    if (sentMessageId && captionText) {
      setCachedVoiceTranscript(sentMessageId, captionText, "tts");
      log.info(
        `[VoiceCache] SET tts (${synthesisResult.backendKey}) | msg=${sentMessageId} | chars=${captionText.length} | preview="${captionText.slice(0, 60)}${captionText.length > 60 ? "…" : ""}"`,
      );
    }

    if (sentMessageId && captionText && context.tomoriState.config.voice_transcript_chat_mode) {
      await postVoiceTranscriptCaption(target, captionText);
    }

    // Canonical audio-generation telemetry, keyed by TTS backend so the read
    // layer can break voice usage down by engine (the total stays SUM over keys).
    // tool_used already counts the call; this adds the un-backfillable backend dimension.
    if (context.internalUserId) {
      statRepository.recordStat({
        serverId: context.tomoriState.server_id,
        userId: context.internalUserId,
        lineageId: context.tomoriState.persona_lineage_id ?? 0,
        metric: "audio_generated",
        metricKey: synthesisResult.backendKey,
      });
    }

    return {
      success: true,
      message: "Voice message generated and sent to Discord.",
      data: {
        source: candidate.id,
        mode: candidate.shape === "design" ? "design" : "clone",
        target: activeEndpoint?.label ?? "ElevenLabs",
      },
      responseDelivered: true,
      endTurn: true,
    };
  }
}

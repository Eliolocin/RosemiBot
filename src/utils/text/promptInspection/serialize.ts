import type { TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { AnthropicStreamAdapter } from "@/providers/anthropic/anthropicStreamAdapter";
import { GoogleStreamAdapter } from "@/providers/google/googleStreamAdapter";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { VertexStreamAdapter } from "@/providers/vertex/vertexStreamAdapter";
import { VertexexpressStreamAdapter } from "@/providers/vertexexpress/vertexexpressStreamAdapter";
import { buildProviderStopStrings } from "@/providers/utils/stopStrings";
import { getStaticProviderInfo, normalizeProviderName } from "@/utils/provider/providerInfoRegistry";
import { buildActiveSamplingParams, selectAnthropicSamplingParams } from "@/utils/provider/samplingControl";
import {
  buildAnthropicThinkingRequest,
  buildCustomThinkingRequest,
  buildDeepSeekThinkingRequest,
  buildGoogleThinkingConfig,
  buildOpenRouterReasoningRequest,
  buildZaiThinkingRequest,
  getNovelAiThinkingDirective,
  serializeGoogleThinkingConfig,
} from "@/utils/provider/thinkingControl";

/**
 * Human-readable label (and optional command hint) for each `ContextItemTag`.
 * Rendered by `buildTextSnapshot` as `=== Title (command/system-managed) ===` blocks.
 *
 * `subsections` lets a single context item (especially composites like
 * `KNOWLEDGE_USERS_IN_CONVERSATION`: expose multiple `== SubTitle ==` markers
 * so users can see which separate data pools feed into that block.
 */
type TagLabel = {
  title: string;
  hint: string; // Slash-command reference like `/config system-prompt`, or the literal "system-managed"
  subsections?: Array<{ title: string; hint: string }>;
};

const TAG_LABELS: Readonly<Record<ContextItemTag, TagLabel>> = {
  [ContextItemTag.SYSTEM_INSTRUCTION_BLOCK]: { title: "System Instruction Block", hint: "system-managed" },
  [ContextItemTag.SYSTEM_PERSONALITY]: { title: "Persona Attributes", hint: "/persona attribute" },
  [ContextItemTag.SYSTEM_HUMANIZER_RULES]: { title: "System Prompt", hint: "/config system-prompt" },
  [ContextItemTag.SYSTEM_CHANNEL_PROMPT]: { title: "Channel Prompt", hint: "/server channel-prompt" },
  [ContextItemTag.SYSTEM_PERSONA_PROMPT]: { title: "Persona Prompt", hint: "/persona prompt" },
  [ContextItemTag.SYSTEM_FUNCTION_GUIDE]: { title: "Function Guide", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_SERVER_INFO]: { title: "Discord Server Info", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_SERVER_EMOJIS]: { title: "Server Emojis", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_SERVER_STICKERS]: { title: "Server Stickers", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_PERSONA_SPRITES]: { title: "Persona Sprites", hint: "/persona sprites" },
  [ContextItemTag.KNOWLEDGE_SERVER_MEMORIES]: { title: "Server Memories", hint: "/memories" },
  [ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS]: { title: "Server Documents", hint: "/memories" },
  [ContextItemTag.KNOWLEDGE_SERVER_CONDITIONING]: { title: "Conditioning Log", hint: "/conditioning" },
  [ContextItemTag.KNOWLEDGE_PERSONA_USER_BLOCKS]: { title: "Persona-User Blocks", hint: "/moderation" },
  [ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS]: { title: "Tool Definitions", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_USER_MEMORIES]: { title: "Personal Memories", hint: "/personal memories" },
  [ContextItemTag.KNOWLEDGE_USER_STATUS]: { title: "Discord Presence", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_CURRENT_CONTEXT]: { title: "Current Context", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION]: {
    title: "Info on Users in Context",
    hint: "composite",
    subsections: [
      { title: "Personal/Server Memories", hint: "/memories, /personal memories" },
      { title: "Discord Presence/Role/Channel", hint: "system-managed" },
      { title: "Other Personas' Public Attributes", hint: "/persona attribute" },
    ],
  },
  [ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY]: { title: "Short-Term Memory", hint: "/memories" },
  [ContextItemTag.DIALOGUE_SAMPLE]: { title: "Sample Dialogue", hint: "/persona sample-dialogue" },
  [ContextItemTag.DIALOGUE_HISTORY]: { title: "Conversation History", hint: "system-managed" },
  [ContextItemTag.CONTEXT_NOTE_INJECTION]: { title: "Context Note", hint: "/config context-note" },
};

function renderTagHeader(tag: ContextItemTag | undefined): string {
  if (!tag) return "=== Untagged (system-managed) ===";
  const label = TAG_LABELS[tag];

  const lines: string[] = [];
  if (label.hint === "composite") {
    lines.push(`=== ${label.title} ===`);
  } else if (label.hint === "system-managed") {
    lines.push(`=== ${label.title} (system-managed) ===`);
  } else {
    lines.push(`=== ${label.title} (\`${label.hint}\`) ===`);
  }
  if (label.subsections) {
    for (const sub of label.subsections) {
      if (sub.hint === "system-managed") {
        lines.push(`== ${sub.title} (system-managed) ==`);
      } else {
        lines.push(`== ${sub.title} (\`${sub.hint}\`) ==`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Serializes `contextItems` (already rearranged by preset routing, if applicable) into
 * a human-readable flat-text format that mirrors the order produced by `buildContext`.
 *
 * Each context item gets a `=== Title (/command) ===` header derived from its
 * `metadataTag`. These headers are annotations: they are NOT part of the prompt
 * actually sent to the LLM. The DM body that ships with the file explains this.
 */
export function buildTextSnapshot(contextItems: StructuredContextItem[]): string {
  const lines: string[] = [];

  for (const item of contextItems) {
    lines.push(renderTagHeader(item.metadataTag));

    for (const part of item.parts) {
      if (part.type === "text") {
        lines.push(part.text);
      } else if (part.type === "image") {
        // Estimate byte size from data URI length (base64 overhead ~1.33×)
        const byteEstimate = part.uri.startsWith("data:")
          ? Math.round(((part.uri.length - part.uri.indexOf(",") - 1) * 3) / 4)
          : 0;
        const sizeLabel = byteEstimate > 0 ? `~${byteEstimate} bytes` : "URL";
        lines.push(`[IMAGE: ${part.mimeType}, ${sizeLabel}, hidden]`);
      } else if (part.type === "video") {
        const ytSuffix = part.isYouTubeLink ? ", YouTube" : "";
        lines.push(`[VIDEO: ${part.mimeType}${ytSuffix}, hidden]`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Produces a provider-specific JSON snapshot that matches the format emitted by
 * each adapter's `logSanitizedRequest` to terminal. Base64 image data is redacted
 * to keep file sizes manageable, matching the terminal log sanitization.
 *
 * Supported providers with full native fidelity:
 *   - google            → GoogleStreamAdapter.buildTokenCountPayload
 *   - vertex            → VertexStreamAdapter.buildTokenCountPayload
 *   - vertexexpress     → VertexexpressStreamAdapter.buildTokenCountPayload
 *   - openrouter-family → OpenrouterStreamAdapter.buildProbeMessages
 *   - anthropic         → AnthropicStreamAdapter.buildProbeMessages
 *
 * All other providers (novelai, custom, etc.) fall back to a flat OpenAI-style
 * `{model, messages: [{role, content}]}` shape. Messages with media use the
 * OpenAI-vision array-content form; text-only messages use plain strings.
 *
 * Metadata (server/channel/persona/provider/preset) is NOT embedded in the file:
 * it is rendered in the DM body instead, to keep the file focused on payload.
 *
 * When `toolsData` is provided, a top-level `tools` key is appended in the same
 * shape the adapter would send to the provider.
 */
export async function buildJsonSnapshot(
  contextItems: StructuredContextItem[],
  persona: TomoriState,
  providerName: string,
  modelName: string,
  toolsData: Array<Record<string, unknown>> | null,
  requestConfig: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const activeLlm = persona.persona_llm ?? persona.llm;
  const seesImages = activeLlm.sees_images;
  const seesVideos = activeLlm.sees_videos;

  let requestData: Record<string, unknown>;
  const providerInfo = getStaticProviderInfo(providerName);
  const providerKey = providerInfo?.name ?? normalizeProviderName(providerName);
  const providerFamily = providerInfo?.apiFamily ?? "openai-compatible";
  const googleSnapshotAdapterFactories: Record<
    string,
    () => GoogleStreamAdapter | VertexStreamAdapter | VertexexpressStreamAdapter
  > = {
    google: () => new GoogleStreamAdapter(),
    vertex: () => new VertexStreamAdapter(),
    vertexexpress: () => new VertexexpressStreamAdapter(),
  };
  const googleSnapshotAdapterFactory = googleSnapshotAdapterFactories[providerKey];

  if (googleSnapshotAdapterFactory) {
    const adapter = googleSnapshotAdapterFactory();
    const payload = await adapter.buildTokenCountPayload(contextItems, modelName);

    // Sanitize: replace inlineData.data (base64) with placeholder (mirrors logSanitizedRequest)
    const sanitizedContents = payload.contents.map((content) => ({
      ...content,
      // biome-ignore lint/suspicious/noExplicitAny: Google Part type lacks index signature; cast needed for sanitization
      parts: ((content.parts ?? []) as Array<any>).map((part: Record<string, unknown>) => {
        if ("inlineData" in part && part.inlineData) {
          const inlineData = part.inlineData as Record<string, unknown>;
          return { inlineData: { mimeType: inlineData.mimeType, data: "[BASE64_HIDDEN]" } };
        }
        return part;
      }),
    }));

    requestData = {
      model: modelName,
      systemInstruction: payload.systemInstruction,
      contents: sanitizedContents,
    };
  } else if (providerFamily === "openrouter" || providerFamily === "openai-compatible") {
    const adapter = new OpenrouterStreamAdapter();
    const messages = await adapter.buildProbeMessages(contextItems, seesImages, seesVideos);

    // Sanitize: replace data-URI image_url values (mirrors logSanitizedRequest)
    const sanitized = messages.map((msg: Record<string, unknown>) => {
      if (!Array.isArray(msg.content)) return msg;
      return {
        ...msg,
        content: (msg.content as Array<Record<string, unknown>>).map((part) => {
          if (part.type === "image_url") {
            const imageUrl = (part as { image_url?: { url?: string } }).image_url;
            if (imageUrl?.url?.startsWith("data:")) {
              return { type: "image_url", image_url: { ...imageUrl, url: "[BASE64_HIDDEN]" } };
            }
          }
          return part;
        }),
      };
    });

    requestData = { model: modelName, messages: sanitized };
  } else if (providerFamily === "anthropic") {
    const adapter = new AnthropicStreamAdapter();
    const { system, messages } = await adapter.buildProbeMessages(contextItems, seesImages);

    // Sanitize: replace base64 image source.data (mirrors logSanitizedRequest)
    const sanitizedMessages = messages.map((msg: Record<string, unknown>) => {
      const content = msg.content;
      if (typeof content === "string") return msg;
      const sanitizedContent = (content as Array<Record<string, unknown>>).map((block) => {
        if (
          block.type === "image" &&
          block.source &&
          typeof (block.source as Record<string, unknown>).data === "string"
        ) {
          return { ...block, source: { ...(block.source as Record<string, unknown>), data: "[BASE64_HIDDEN]" } };
        }
        return block;
      });
      return { ...msg, content: sanitizedContent };
    });

    requestData = { model: modelName, system, messages: sanitizedMessages };
  } else {
    // Fallback for providers without a public probe builder (novelai, custom, etc.):
    // flatten `contextItems` into a plain `{model, messages: [{role, content}]}` shape.
    // Role remap: `model` → `assistant` to match OpenAI conventions.

    // OpenAI-compatible APIs accept only one leading `role: "system"` message, so the
    //    system blocks (personality, rules, knowledge) are flattened into a single entry
    //    by joining their text parts. A second system message would be rejected or, worse,
    //    silently dropped by the endpoint.
    const systemTextChunks: string[] = [];
    const nonSystemItems: StructuredContextItem[] = [];
    for (const item of contextItems) {
      if (item.role === "system") {
        const text = item.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        if (text.trim()) systemTextChunks.push(text);
      } else {
        nonSystemItems.push(item);
      }
    }

    const messagesList: Array<Record<string, unknown>> = [];
    if (systemTextChunks.length > 0) {
      messagesList.push({ role: "system", content: systemTextChunks.join("\n\n") });
    }

    for (const item of nonSystemItems) {
      const role = item.role === "model" ? "assistant" : item.role;
      const hasMedia = item.parts.some((p) => p.type !== "text");

      if (!hasMedia) {
        const text = item.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        messagesList.push({ role, content: text });
        continue;
      }

      const content = item.parts.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "image") {
          return { type: "image_url", image_url: { url: "[MEDIA_HIDDEN]" }, mime_type: part.mimeType };
        }
        return {
          type: "video_url",
          video_url: { url: "[MEDIA_HIDDEN]" },
          mime_type: part.mimeType,
          ...(part.isYouTubeLink ? { youtube: true } : {}),
        };
      });
      messagesList.push({ role, content });
    }

    requestData = { model: modelName, messages: messagesList };
  }

  // requestConfig is already provider-shaped: Google/Vertex nest samplers under
  //    `generation_config`, `safety_settings`, and friends, while Anthropic and
  //    OpenAI-compatible providers use root-level keys. Copying at the top level keeps
  //    that shape and cannot overwrite a key the adapter already set.
  for (const [key, value] of Object.entries(requestConfig)) {
    if (!(key in requestData)) requestData[key] = value;
  }

  // Append provider-formatted tools when requested, including an empty list
  //    when per-turn filtering deliberately suppresses every tool.
  if (toolsData) {
    requestData.tools = toolsData;
  }

  return requestData;
}

/**
 * Produces a provider-specific sampling/request-config block matching what each
 * adapter would actually send at runtime. UNFILTERED: does not probe OpenRouter
 * for `supportedParameters`, so params the model may reject are still shown.
 *
 * Provider shapes:
 *   - google           : `{temperature, top_k, top_p, frequency_penalty, presence_penalty, max_output_tokens, stop_sequences, safety_settings, thinking_config?}`
 *   - vertex / vertexexpress: `{temperature, top_k, top_p, max_output_tokens, stop_sequences, safety_settings, thinking_config?}`
 *   - anthropic        : `{temperature?, top_p?, top_k?, max_tokens, stop_sequences}` (Anthropic rejects sending both temp+top_p, uses `selectAnthropicSamplingParams`)
 *   - openai-compat    : `{temperature?, top_p?, top_k?, frequency_penalty?, presence_penalty?, min_p?, max_tokens?, stop}`
 *
 * Used in two places:
 *   - Baked into the JSON snapshot file at the top level (alongside `messages`/`contents`)
 *   - Rendered as a second ```json code block in the DM body (shown for BOTH text and JSON formats)
 *
 * @param maxOutputTokens - From `resolveRequestMaxOutputTokens()`; undefined omits the key, as the request does.
 */
export function buildRequestConfig(
  persona: TomoriState,
  providerName: string,
  modelName: string,
  maxOutputTokens: number | undefined,
): Record<string, unknown> {
  const activeLlm = persona.persona_llm ?? persona.llm;
  const config = persona.config;
  const disabledParams = config.llm_disabled_params ?? [];
  const providerInfo = getStaticProviderInfo(providerName);
  const providerKey = providerInfo?.name ?? normalizeProviderName(providerName);
  const providerFamily = providerInfo?.apiFamily ?? "openai-compatible";
  const supportsParam = (param: string) =>
    providerInfo?.supportedParams.some((supportedParam) => supportedParam === param) ?? true;

  if (providerFamily === "google-genai") {
    // Google/Vertex family: show raw configured values (unfiltered, mirrors provider config)
    const out: Record<string, unknown> = {
      generation_config: {
        temperature: config.llm_temperature,
        top_k: config.llm_top_k,
        top_p: config.llm_top_p,
        max_output_tokens: maxOutputTokens,
        stop_sequences: [],
      },
      safety_settings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    };
    const generationConfig = out.generation_config as Record<string, unknown>;
    if (supportsParam("frequencyPenalty")) generationConfig.frequency_penalty = config.llm_frequency_penalty;
    if (supportsParam("presencePenalty")) generationConfig.presence_penalty = config.llm_presence_penalty;
    const thinkingConfig = serializeGoogleThinkingConfig(buildGoogleThinkingConfig(modelName, config.thinking_level));
    if (thinkingConfig) out.thinking_config = thinkingConfig;
    if (disabledParams.length > 0) out.disabled_params = disabledParams;
    return out;
  }

  if (providerFamily === "anthropic") {
    const selection = selectAnthropicSamplingParams({
      temperature: config.llm_temperature,
      topP: config.llm_top_p,
      disabledParams,
    });
    const stopSequences = buildProviderStopStrings({
      providerName: "anthropic",
      model: modelName,
      personaName: persona.persona_nickname,
    });

    const thinkingRequest = buildAnthropicThinkingRequest(modelName, config.thinking_level);
    const out: Record<string, unknown> = { max_tokens: maxOutputTokens };
    if (!thinkingRequest.omitSampling) {
      if (selection.temperature !== undefined) out.temperature = selection.temperature;
      if (selection.topP !== undefined) out.top_p = selection.topP;
      if (config.llm_top_k > 0 && !disabledParams.includes("topK")) out.top_k = config.llm_top_k;
    }
    if (thinkingRequest.thinking) out.thinking = thinkingRequest.thinking;
    if (thinkingRequest.output_config) out.output_config = thinkingRequest.output_config;
    if (stopSequences) out.stop_sequences = stopSequences;
    if (disabledParams.length > 0) out.disabled_params = disabledParams;
    return out;
  }

  // OpenAI-compatible (openrouter, deepseek, zai, zaicoding, nvidia, custom, novelai):
  //    translate active sampling params to snake_case and include stop + max_tokens.
  const active = buildActiveSamplingParams(config);
  const stopStrings = buildProviderStopStrings({
    providerName,
    model: modelName,
    personaName: persona.persona_nickname,
  });

  const out: Record<string, unknown> = {};
  if (maxOutputTokens !== undefined) out.max_tokens = maxOutputTokens;
  if (active.temperature !== undefined) out.temperature = active.temperature;
  if (active.topP !== undefined) out.top_p = active.topP;
  if (active.topK !== undefined) out.top_k = active.topK;
  if (active.frequencyPenalty !== undefined) out.frequency_penalty = active.frequencyPenalty;
  if (active.presencePenalty !== undefined) out.presence_penalty = active.presencePenalty;
  if (active.minP !== undefined) out.min_p = active.minP;
  if (stopStrings) out.stop = stopStrings;
  if (disabledParams.length > 0) out.disabled_params = disabledParams;

  const requestConfigMutators: Record<string, () => void> = {
    openrouter: () => {
      const reasoningRequest = buildOpenRouterReasoningRequest(config.thinking_level);
      if (reasoningRequest.reasoning) out.reasoning = reasoningRequest.reasoning;
    },
    deepseek: () => {
      const thinkingRequest = buildDeepSeekThinkingRequest(modelName, config.thinking_level);
      if (thinkingRequest.thinking) out.thinking = thinkingRequest.thinking;
      if (thinkingRequest.omitSampling) {
        delete out.temperature;
        delete out.top_p;
        delete out.frequency_penalty;
        delete out.presence_penalty;
      }
    },
    zai: () => {
      const thinkingRequest = buildZaiThinkingRequest(config.thinking_level);
      if (thinkingRequest.thinking) out.thinking = thinkingRequest.thinking;
      if (thinkingRequest.omitSampling) {
        delete out.temperature;
        delete out.top_p;
        delete out.frequency_penalty;
        delete out.presence_penalty;
      }
    },
    zaicoding: () => {
      const thinkingRequest = buildZaiThinkingRequest(config.thinking_level);
      if (thinkingRequest.thinking) out.thinking = thinkingRequest.thinking;
      if (thinkingRequest.omitSampling) {
        delete out.temperature;
        delete out.top_p;
        delete out.frequency_penalty;
        delete out.presence_penalty;
      }
    },
    custom: () => {
      const customThinking = buildCustomThinkingRequest(config.custom_endpoint_url, config.thinking_level);
      if (customThinking.reasoning_effort) {
        out.reasoning_effort = customThinking.reasoning_effort;
      }
    },
    novelai: () => {
      out.thinking_directive = getNovelAiThinkingDirective(config.thinking_level);
    },
  };
  requestConfigMutators[providerKey]?.();

  // Acknowledge has_tools flag is mirrored from adapter runtime: informational
  if (!activeLlm.has_tools) out.tools_disabled = true;

  return out;
}

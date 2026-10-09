import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import type { Client, Guild, Message, TextBasedChannel, User } from "discord.js";
import { PrivacyLevel, type TomoriState, type UserRow } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { MCPCapableToolAdapter } from "@/types/tool/interfaces";
import { getAnthropicToolAdapter } from "@/providers/anthropic/anthropicToolAdapter";
import { getCustomToolAdapter } from "@/providers/custom/customToolAdapter";
import { getDeepseekToolAdapter } from "@/providers/deepseek/deepseekToolAdapter";
import { getGoogleToolAdapter } from "@/providers/google/googleToolAdapter";
import { getNovelaiToolAdapter } from "@/providers/novelai/novelaiToolAdapter";
import { getNvidiaToolAdapter } from "@/providers/nvidia/nvidiaToolAdapter";
import { getOpenrouterToolAdapter } from "@/providers/openrouter/openrouterToolAdapter";
import { getVertexToolAdapter } from "@/providers/vertex/vertexToolAdapter";
import { getVertexexpressToolAdapter } from "@/providers/vertexexpress/vertexexpressToolAdapter";
import { getZaiToolAdapter } from "@/providers/zai/zaiToolAdapter";
import { getZaicodingToolAdapter } from "@/providers/zaicoding/zaicodingToolAdapter";
import { type ToolStateForContext, getAvailableToolsWithMCP } from "@/tools/toolRegistry";
import { getCachedChannelContextNote } from "@/utils/cache/channelContextNoteCache";
import { getCachedChannelLlm } from "@/utils/cache/channelLlmCache";
import { getCachedChannelPrompt } from "@/utils/cache/channelPromptCache";
import { getCachedActivePreset } from "@/utils/cache/stPresetCache";
import { getCachedBlacklistStatus, getCachedPrivacyLevel, getCachedUserRow } from "@/utils/cache/userCache";
import { formatTargetEmbedForContext } from "@/utils/chat/contextEmbeds";
import {
  appendComponentMediaFromMessage,
  appendSupportedMediaFromMessage,
  getEffectiveAttachmentContentType,
  isSupportedImageAttachmentContentType,
  isSupportedVideoAttachmentContentType,
} from "@/utils/chat/contextMedia";
import { llmProviderRepo, userNamingRepository, userRepository } from "@/utils/db/repositories";
import { userPersonaNamingPairKey } from "@/utils/db/repositories/UserNamingRepository";
import { extractNoticeTextFromComponents } from "@/utils/discord/componentNoticeReader";
import { checkTargetEmbed, checkTargetEmbedTitle, processLinkEmbed } from "@/utils/discord/embedClassifier";
import { sliceMessagesAtResetMarker } from "@/utils/discord/embedDetection";
import { isMinimalTitleKind } from "@/utils/discord/embedProtocol";
import { resolveMinimalNoticeBodies } from "@/utils/discord/minimalNoticeBodies";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { normalizeRenderModifierName } from "@/utils/discord/renderModifierParser";
import { resolveWebhookPersonaAuthor } from "@/utils/discord/webhookPersonaAuthor";
import { log } from "@/utils/misc/logger";
import { resolveSelectedPersona } from "@/utils/persona/personaOptionValue";
import { type ContextBudget, resolveContextBudget } from "@/utils/provider/contextBudget";
import { resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import { getStaticProviderInfo, normalizeProviderName } from "@/utils/provider/providerInfoRegistry";
import { withSavedProviderConfig } from "@/utils/provider/savedProviderConfig";
import { buildContext } from "@/utils/text/contextBuilder";
import { truncateDialogueHistory } from "@/utils/text/contextTruncator";
import { resolveMediaForModel } from "@/utils/text/context/mediaResolver";
import { getEmojiPenaltyDirective } from "@/utils/text/emojiPenalty";
import { prepareParticipantContext } from "@/utils/text/participants/preparation";
import { resolveEffectiveUserNaming } from "@/utils/text/userNaming";
import {
  filterDeliberateToolNames,
  getAutonomousDeliberateToolNames,
  getDeliberateToolIntentResult,
  getFollowUpToolIntentResult,
  resolveDeliberateToolMode,
} from "@/utils/tools/deliberateToolMode";

const YOUTUBE_URL_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i,
];

type SnapshotToolFilter = {
  disabledByDeliberateMode: boolean;
  allowedToolNames: string[];
};

function normalizeTailDirective(text: string): string {
  let trimmed = text.trim();
  if (!trimmed) return "";
  if (/^\[System:/i.test(trimmed)) {
    trimmed = trimmed.replace(/^\[System:\s*/i, "");
    if (trimmed.endsWith("]")) trimmed = trimmed.slice(0, -1).trim();
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) trimmed = trimmed.slice(1, -1).trim();
  return trimmed;
}

function buildCombinedTailDirectiveMessage(directives: string[]): StructuredContextItem | null {
  const normalized = directives.map(normalizeTailDirective).filter((d) => d.length > 0);
  if (normalized.length === 0) return null;
  return {
    role: "user",
    parts: [{ type: "text", text: `[System: ${normalized.join("\n\n")}]` }],
    metadataTag: ContextItemTag.DIALOGUE_HISTORY,
  };
}

function insertBeforeLatestDialoguePair(
  contextSegments: StructuredContextItem[],
  injectedItem: StructuredContextItem,
): void {
  const dialogueIndexes: number[] = [];
  for (let i = contextSegments.length - 1; i >= 0; i--) {
    const item = contextSegments[i];
    if (item.metadataTag === ContextItemTag.DIALOGUE_HISTORY && (item.role === "user" || item.role === "model")) {
      dialogueIndexes.push(i);
      if (dialogueIndexes.length === 2) break;
    }
  }
  if (dialogueIndexes.length === 0) {
    contextSegments.push(injectedItem);
    return;
  }
  const insertAt = dialogueIndexes.length >= 2 ? dialogueIndexes[1] : dialogueIndexes[0];
  contextSegments.splice(insertAt, 0, injectedItem);
}

// Local mirror of contextAnnotations.insertAtDialogueDepth so the snapshot reflects
// the live STM nudge positioning. depth=0 → tail; depth=N → before the Nth dialogue
// item from the bottom (clamps to earliest dialogue turn when fewer than N exist).
function insertAtDialogueDepth(
  contextSegments: StructuredContextItem[],
  nudge: StructuredContextItem,
  depth: number,
): void {
  if (depth <= 0) {
    contextSegments.push(nudge);
    return;
  }
  let found = 0;
  let lastFoundIndex = -1;
  for (let i = contextSegments.length - 1; i >= 0; i--) {
    if (contextSegments[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY) {
      found++;
      lastFoundIndex = i;
      if (found === depth) {
        contextSegments.splice(i, 0, nudge);
        return;
      }
    }
  }
  if (lastFoundIndex !== -1) {
    contextSegments.splice(lastFoundIndex, 0, nudge);
  } else {
    contextSegments.push(nudge);
  }
}

function isSnapshotAudioAttachment(contentType: string | null | undefined): boolean {
  return Boolean(contentType?.startsWith("audio/"));
}

function getSnapshotRecentToolAffordanceNames(
  recentMessages: Message[],
  currentMessageId: string,
  clientUserId?: string | null,
): string[] {
  const toolNames: string[] = [];

  const lookbackMessages = recentMessages
    .filter((recentMessage) => recentMessage.id !== currentMessageId)
    .slice(-8)
    .reverse();

  for (const msg of lookbackMessages) {
    const isPersonaOutput = Boolean(msg.webhookId) || (Boolean(clientUserId) && msg.author.id === clientUserId);

    if (!isPersonaOutput) {
      const recentIntentResult = getDeliberateToolIntentResult(msg.content);
      toolNames.push(...recentIntentResult.allowedToolNames);
      if (toolNames.length > 0) break;
      continue;
    }

    const attachments = [...msg.attachments.values()];

    if (attachments.some((attachment) => isSnapshotAudioAttachment(attachment.contentType))) {
      toolNames.push("generate_voice_message");
    }

    if (
      attachments.some((attachment) =>
        isSupportedImageAttachmentContentType(getEffectiveAttachmentContentType(attachment)),
      )
    ) {
      toolNames.push("generate_image", "generate_image_nai");
    }

    if (
      attachments.some((attachment) =>
        isSupportedVideoAttachmentContentType(getEffectiveAttachmentContentType(attachment)),
      )
    ) {
      toolNames.push("generate_video");
    }

    if (toolNames.length === 0) {
      const componentImageAttachments: Parameters<typeof appendComponentMediaFromMessage>[1] = [];
      const componentVideoAttachments: Parameters<typeof appendComponentMediaFromMessage>[2] = [];
      const componentCounts = appendComponentMediaFromMessage(
        msg,
        componentImageAttachments,
        componentVideoAttachments,
      );
      if (componentCounts.imageCount > 0) {
        toolNames.push("generate_image", "generate_image_nai");
      }
      if (componentCounts.videoCount > 0) {
        toolNames.push("generate_video");
      }
    }

    if (toolNames.length > 0) break;
  }

  return Array.from(new Set(toolNames));
}

async function buildSnapshotToolFilter(params: {
  messagesArray: Message[];
  clientUserId?: string | null;
  persona: TomoriState;
  invokingUserData: UserRow;
}): Promise<SnapshotToolFilter | null> {
  const { messagesArray, clientUserId, persona, invokingUserData } = params;
  const latestUserMessage = [...messagesArray]
    .reverse()
    .find((message) => !message.webhookId && message.author.id !== clientUserId);

  const latestUserRow =
    latestUserMessage && latestUserMessage.author.id !== invokingUserData.user_disc_id
      ? await getCachedUserRow(latestUserMessage.author.id)
      : invokingUserData;
  const deliberateToolModeActive = resolveDeliberateToolMode(
    persona.config.deliberate_tool_mode,
    latestUserRow?.personal_deliberate_tool_mode ?? "follow",
  );

  if (!deliberateToolModeActive) return null;

  const intentText = latestUserMessage?.content ?? "";
  const directIntent = getDeliberateToolIntentResult(intentText, persona.config.deliberate_tool_triggers);
  const followUpIntent = getFollowUpToolIntentResult(
    intentText,
    latestUserMessage ? getSnapshotRecentToolAffordanceNames(messagesArray, latestUserMessage.id, clientUserId) : [],
  );
  const allowedToolNames = Array.from(
    new Set([
      ...directIntent.allowedToolNames,
      ...followUpIntent.allowedToolNames,
      ...getAutonomousDeliberateToolNames(persona),
    ]),
  );

  return {
    disabledByDeliberateMode: allowedToolNames.length === 0,
    allowedToolNames,
  };
}

async function resolveSnapshotAnsweringState(params: {
  selectedPersona: TomoriState;
  effectivePersona: TomoriState;
  userId: number | null;
}): Promise<TomoriState> {
  try {
    const textCreds = await resolveCapabilityCredentials(params.selectedPersona.server_id, "text", {
      userId: params.userId,
    });

    if (textCreds.source !== "personal") {
      return params.effectivePersona;
    }

    const overlay = await applyPersonalProviderSelectionsToTomoriState(params.selectedPersona, params.userId);
    return {
      ...overlay.tomoriState,
      persona_llm: undefined,
    };
  } catch (error) {
    log.warn("prompt snapshot: text credential resolution failed; using server/persona model view.", error as Error);
    return params.effectivePersona;
  }
}

/**
 * Resolves the tool adapter matching the given provider. Non-OpenAI providers
 * (google/vertex/vertexexpress/anthropic) have dedicated adapters; OpenAI-compatible providers
 * share the openrouter-style adapter via subclasses. NovelAI keeps its own.
 * Unknown providers fall back to the OpenRouter adapter for OpenAI-compat shape.
 */
function selectToolAdapter(providerName: string): MCPCapableToolAdapter {
  const adapterFactories: Record<string, () => MCPCapableToolAdapter> = {
    google: getGoogleToolAdapter,
    vertex: getVertexToolAdapter,
    vertexexpress: getVertexexpressToolAdapter,
    anthropic: getAnthropicToolAdapter,
    openrouter: getOpenrouterToolAdapter,
    deepseek: getDeepseekToolAdapter,
    zai: getZaiToolAdapter,
    zaicoding: getZaicodingToolAdapter,
    nvidia: getNvidiaToolAdapter,
    novelai: getNovelaiToolAdapter,
    custom: getCustomToolAdapter,
  };
  const providerKey = getStaticProviderInfo(providerName)?.name ?? normalizeProviderName(providerName);
  return (adapterFactories[providerKey] ?? getOpenrouterToolAdapter)();
}

/**
 * Mirrors the tool-list assembly that `<Provider>Provider.getTools` does at
 * runtime, including the deliberate-mode per-turn allowlist when it can be
 * reconstructed from the latest visible user message. Returns the provider's
 * native tool JSON (OpenAI function spec for OpenAI-compat, Gemini schema for
 * Google, etc.).
 */
async function fetchProviderTools(
  persona: TomoriState,
  providerName: string,
  toolFilter?: SnapshotToolFilter | null,
): Promise<Array<Record<string, unknown>>> {
  const activeLlm = persona.persona_llm ?? persona.llm;

  if (!activeLlm.has_tools || toolFilter?.disabledByDeliberateMode) {
    return [];
  }

  const toolStateForContext: ToolStateForContext = {
    server_id: persona.server_id.toString(),
    activePersonaHasElevenlabsVoice: Boolean(
      persona.speech_voice_sample_id || persona.speech_voice_design_prompt?.trim() || persona.speech_voice_id?.trim(),
    ),
    activePersonaVoiceDesignPrompt: persona.speech_voice_design_prompt?.trim() || null,
    activePersonaVoiceName: persona.speech_voice_name,
    llm: {
      llm_codename: activeLlm.llm_codename,
      has_tools: activeLlm.has_tools,
      sees_images: activeLlm.sees_images,
      sees_videos: activeLlm.sees_videos,
      sees_youtube: activeLlm.sees_youtube,
      supports_structoutput: activeLlm.supports_structoutput,
    },
    diffusion_model_id: persona.config.diffusion_model_id,
    nai_diffusion_model_id: persona.config.nai_diffusion_model_id,
    video_model_id: persona.config.video_model_id,
    config: {
      sticker_usage_enabled: persona.config.sticker_usage_enabled,
      web_search_enabled: persona.config.web_search_enabled,
      self_teaching_enabled: persona.config.self_teaching_enabled,
      manage_message_enabled: persona.config.manage_message_enabled,
      imagegen_enabled: persona.config.imagegen_enabled,
      videogen_enabled: persona.config.videogen_enabled,
      voice_message_enabled: persona.config.voice_message_enabled,
      user_blocking_enabled: persona.config.user_blocking_enabled,
      user_info_updates_enabled: persona.config.user_info_updates_enabled,
      response_rule_checker_ref: persona.config.response_rule_checker_ref,
      thread_creation_enabled: persona.config.thread_creation_enabled,
    },
  };

  let { builtInTools, mcpFunctionNames } = await getAvailableToolsWithMCP(providerName, toolStateForContext);

  if (toolFilter?.allowedToolNames.length) {
    const allowedSet = new Set(toolFilter.allowedToolNames);
    builtInTools = builtInTools.filter((tool) => allowedSet.has(tool.name));
    mcpFunctionNames = filterDeliberateToolNames(mcpFunctionNames, toolFilter.allowedToolNames);
  }

  const adapter = selectToolAdapter(providerName);
  return adapter.getAllToolsInProviderFormat(builtInTools, persona.server_id, mcpFunctionNames);
}

/**
 * Picks the persona a prompt inspection targets: the autocomplete choice when one was given, else
 * the main persona. Returns null when a given choice no longer resolves on this server.
 */
export function resolveInspectedPersona(
  personas: readonly TomoriState[],
  rawPersonaOption: string | null,
): TomoriState | null {
  if (rawPersonaOption === null) {
    return personas.find((persona) => !persona.is_alter) ?? personas[0] ?? null;
  }
  return resolveSelectedPersona(personas, rawPersonaOption);
}

export interface PromptInspectionRequest {
  client: Client;
  guild: Guild;
  channel: TextBasedChannel;
  user: User;
  /** The invoker's row, which unlocks their short-term memory in the built context. */
  userData: UserRow;
  tomoriState: TomoriState;
  personas: TomoriState[];
  selectedPersona: TomoriState;
  /** Tool schemas are fetched only on request because building them reaches MCP servers. */
  includeTools: boolean;
}

export interface PromptInspection {
  selectedPersona: TomoriState;
  answeringState: TomoriState;
  providerName: string;
  modelName: string;
  channelId: string;
  channelName: string;
  presetName: string | null;
  capturedAt: string;
  /** Media-resolved and truncated to the provider budget, as the provider would receive them. */
  contextItems: StructuredContextItem[];
  toolsData: Array<Record<string, unknown>> | null;
  budget: ContextBudget | null;
  historyPairsDropped: number;
}

/**
 * Rebuilds the prompt the live pipeline would send for a persona in this channel right now.
 *
 * Mirrors `tomoriChat.ts` and `generationTurn.ts` step for step (model routing, history slicing,
 * participant preparation, tail directives, media resolution, provider truncation), so every
 * consumer reports what the model actually sees. Returns null when the channel has no history.
 */
export async function assemblePromptInspection(request: PromptInspectionRequest): Promise<PromptInspection | null> {
  const { client, guild, channel: textChannel, user, userData, tomoriState, personas, selectedPersona } = request;

  if (!("messages" in textChannel)) return null;

  // Resolve effective LLM (persona override > channel override > global) and swap in the override
  // provider's saved key and samplers when it crosses providers. Mirrors generationTurn.ts.
  const channelLlmOverride = await getCachedChannelLlm(
    selectedPersona.server_id,
    textChannel.id,
    textChannel.isThread() ? textChannel.parentId : null,
  );
  const effectiveLlm = selectedPersona.persona_llm ?? channelLlmOverride ?? selectedPersona.llm;

  // The per-channel system prompt override (append/replace) mirrors contextPipeline.ts.
  const channelPromptOverride = await getCachedChannelPrompt(selectedPersona.server_id, textChannel.id);

  const channelContextNote = await getCachedChannelContextNote(selectedPersona.server_id, textChannel.id);

  let effectivePersona = selectedPersona;
  if (effectiveLlm !== selectedPersona.llm) {
    effectivePersona = { ...selectedPersona, llm: effectiveLlm };

    const overrideProvider = effectiveLlm.llm_provider.toLowerCase();
    if (overrideProvider !== selectedPersona.llm.llm_provider.toLowerCase()) {
      const overrideSavedConfig = await llmProviderRepo.loadSavedProviderConfig(
        selectedPersona.server_id,
        overrideProvider,
      );
      effectivePersona = withSavedProviderConfig(effectivePersona, overrideSavedConfig);
    }
  }

  const answeringState = await resolveSnapshotAnsweringState({
    selectedPersona,
    effectivePersona,
    userId: userData.user_id ?? null,
  });

  const messageFetchLimit = normalizeMessageFetchLimit(selectedPersona.config.message_fetch_limit);
  const fetchedMessages = await textChannel.messages.fetch({ limit: messageFetchLimit });
  const allMessagesArray = Array.from(fetchedMessages.values()).reverse();

  // Respect /refresh and /compact_refresh boundaries with the same slicing tomoriChat.ts uses.
  const { sliced: messagesArray } = sliceMessagesAtResetMarker(allMessagesArray);
  const snapshotToolFilter = await buildSnapshotToolFilter({
    messagesArray,
    clientUserId: client.user?.id,
    persona: answeringState,
    invokingUserData: userData,
  });

  const personaByNickname = new Map<string, TomoriState>();
  for (const p of personas) {
    if (!p.persona_nickname) continue;
    const key = normalizeRenderModifierName(p.persona_nickname);
    if (!personaByNickname.has(key)) personaByNickname.set(key, p);
  }
  const mainPersona = personas.find((p) => !p.is_alter) ?? tomoriState;

  type SimpleMsg = {
    id: string;
    authorId: string;
    authorName: string;
    authorType: "user" | "persona";
    personaName?: string | null;
    content: string | null;
    mediaSourceMessageIds?: string[];
    imageAttachments: Array<{
      url: string;
      proxyUrl: string;
      mimeType: string | null;
      filename: string;
      isEmoji?: boolean;
    }>;
    videoAttachments: Array<{
      url: string;
      proxyUrl: string;
      mimeType: string | null;
      filename: string;
      isYouTubeLink: boolean;
    }>;
  };

  const simplifiedMessages: SimpleMsg[] = [];
  const userListSet = new Set<string>();
  const syntheticUsers = new Map<string, { displayName: string; type: "persona" | "webhook" }>();
  const minimalNoticeBodies = await resolveMinimalNoticeBodies(messagesArray);

  for (const message of messagesArray) {
    // Skip fully-private and server-blacklisted users (same gates as real context building)
    if (!message.webhookId) {
      const privacyLevel = await getCachedPrivacyLevel(message.author.id);
      if (privacyLevel === PrivacyLevel.FULL) continue;
      if (!message.author.bot && (await getCachedBlacklistStatus(guild.id, message.author.id))) continue;
    }

    let effectiveAuthorId = message.author.id;
    let authorName = `<@${message.author.id}>`;
    let authorType: "user" | "persona" = "user";
    let personaName: string | null = null;

    if (message.author.id === client.user?.id) {
      authorName = mainPersona.persona_nickname ?? tomoriState.persona_nickname ?? message.author.username;
      authorType = "persona";
      personaName = authorName;
    } else if (message.webhookId) {
      const webhookName = message.author.username?.trim();
      const resolvedPersona =
        webhookName && (await verifyMessageWebhook(message))
          ? await resolveWebhookPersonaAuthor(message.id, webhookName, personaByNickname)
          : null;
      if (resolvedPersona) {
        authorName = resolvedPersona.displayName;
        authorType = "persona";
        personaName = resolvedPersona.persona.persona_nickname;
        effectiveAuthorId = String(resolvedPersona.persona.persona_id ?? resolvedPersona.persona.persona_nickname);
        syntheticUsers.set(effectiveAuthorId, { displayName: authorName, type: "persona" });
      } else if (webhookName) {
        authorName = webhookName;
      }
    }

    const imageAttachments: SimpleMsg["imageAttachments"] = [];
    const videoAttachments: SimpleMsg["videoAttachments"] = [];
    let hasLocalMedia = false;

    const directMediaCounts = appendSupportedMediaFromMessage(message, imageAttachments, videoAttachments);
    const componentMediaCounts = appendComponentMediaFromMessage(message, imageAttachments, videoAttachments);
    hasLocalMedia =
      directMediaCounts.imageCount > 0 ||
      directMediaCounts.videoCount > 0 ||
      componentMediaCounts.imageCount > 0 ||
      componentMediaCounts.videoCount > 0;

    for (const sticker of message.stickers.values()) {
      const stickerUrl = `https://cdn.discordapp.com/stickers/${sticker.id}.png`;
      imageAttachments.push({
        url: stickerUrl,
        proxyUrl: stickerUrl,
        mimeType: "image/png",
        filename: `${sticker.name}.png`,
      });
      hasLocalMedia = true;
    }

    if (message.content) {
      for (const pattern of YOUTUBE_URL_PATTERNS) {
        const match = message.content.match(pattern);
        if (!match) continue;
        videoAttachments.push({
          url: match[0],
          proxyUrl: match[0],
          mimeType: "video/youtube",
          filename: `youtube_video_${match[1]}.mp4`,
          isYouTubeLink: true,
        });
        hasLocalMedia = true;
        break;
      }
    }

    // Process embeds to match tomoriChat.ts conversion rules:
    //   a) System-produced embeds (memory_learning, reminder_set, system_injection,
    //      compact_summary/refresh, reward, punish) are wrapped as `[System: ...]`
    //      blocks and appended to message content, so this applies to ALL messages.
    //   b) Link-preview embeds (Twitter/YouTube/articles) are extracted as
    //      `[System: Link preview embed content: ...]` and their images are added
    //      to imageAttachments, so ONLY for non-Tomori-authored messages.
    const botNickname = mainPersona.persona_nickname ?? tomoriState.persona_nickname ?? null;
    const isTomoriAuthored = message.author.id === client.user?.id;
    const embedTextSegments: string[] = [];
    if (message.embeds.length > 0) {
      for (const embed of message.embeds) {
        const embedCheck = checkTargetEmbed(embed);
        if (embedCheck.isTarget && embed.description) {
          embedTextSegments.push(
            formatTargetEmbedForContext(
              { title: embed.title, description: embed.description },
              embedCheck.type,
              botNickname,
            ),
          );
        } else if (!isTomoriAuthored) {
          const linkEmbedData = processLinkEmbed(embed);
          if (linkEmbedData.isLinkPreview) {
            if (linkEmbedData.textContent) embedTextSegments.push(linkEmbedData.textContent);
            if (linkEmbedData.imageInfo) {
              imageAttachments.push({
                url: linkEmbedData.imageInfo.url,
                proxyUrl: linkEmbedData.imageInfo.proxyUrl,
                mimeType: linkEmbedData.imageInfo.mimeType,
                filename: linkEmbedData.imageInfo.filename,
              });
              hasLocalMedia = true;
            }
            if (linkEmbedData.thumbnailInfo) {
              imageAttachments.push({
                url: linkEmbedData.thumbnailInfo.url,
                proxyUrl: linkEmbedData.thumbnailInfo.proxyUrl,
                mimeType: linkEmbedData.thumbnailInfo.mimeType,
                filename: linkEmbedData.thumbnailInfo.filename,
              });
              hasLocalMedia = true;
            }
          }
        }
      }
    }

    // Components V2 notices carry no embeds, so reconstruct their text from the
    // component tree to keep snapshots identical to live chat context.
    const cv2Notice = extractNoticeTextFromComponents(message.components);
    if (cv2Notice?.title) {
      const noticeCheck = checkTargetEmbedTitle(cv2Notice.title);
      if (noticeCheck.isTarget && (cv2Notice.description || isMinimalTitleKind(noticeCheck.type))) {
        embedTextSegments.push(
          formatTargetEmbedForContext(
            {
              title: cv2Notice.title,
              description: cv2Notice.description ?? minimalNoticeBodies.get(message.id) ?? "",
            },
            noticeCheck.type,
            botNickname,
          ),
        );
      }
    }

    const baseContent = message.content?.trim() ? message.content : "";
    const combinedContent = [baseContent, ...embedTextSegments].filter((s) => s.length > 0).join("\n");
    const messageContent = combinedContent.length > 0 ? combinedContent : null;
    const mediaSourceMessageIds = hasLocalMedia ? [message.id] : undefined;

    // Merge consecutive same-author messages, mirroring the real context path
    // (buildSimplifiedHistory): collapse only when both sides are pure text if
    // either side carries media, keep separate turns so per-message media IDs stay
    // unambiguous.
    const prevMsg = simplifiedMessages[simplifiedMessages.length - 1];
    const currentHasMedia =
      imageAttachments.length > 0 || videoAttachments.length > 0 || (mediaSourceMessageIds?.length ?? 0) > 0;
    const prevHasMedia =
      !!prevMsg &&
      (prevMsg.imageAttachments.length > 0 ||
        prevMsg.videoAttachments.length > 0 ||
        (prevMsg.mediaSourceMessageIds?.length ?? 0) > 0);
    const shouldKeepSeparateMediaTurn = currentHasMedia || prevHasMedia;
    if (
      prevMsg &&
      prevMsg.authorId === effectiveAuthorId &&
      prevMsg.content &&
      messageContent &&
      !shouldKeepSeparateMediaTurn
    ) {
      prevMsg.content += `\n${messageContent}`;
    } else if (messageContent || imageAttachments.length > 0 || videoAttachments.length > 0) {
      simplifiedMessages.push({
        id: message.id,
        authorId: effectiveAuthorId,
        authorName,
        authorType,
        personaName,
        content: messageContent,
        mediaSourceMessageIds,
        imageAttachments,
        videoAttachments,
      });
    }

    userListSet.add(effectiveAuthorId);
  }

  if (client.user?.id) userListSet.add(client.user.id);

  const channelName =
    "name" in textChannel && typeof textChannel.name === "string" ? textChannel.name : "unknown-channel";
  const channelDesc = "topic" in textChannel ? (textChannel.topic as string | null) : null;

  const matrixUsers = new Map<string, string>();
  const preparedParticipantContext = await prepareParticipantContext({
    client,
    guildId: guild.id,
    simplifiedMessageHistory: simplifiedMessages,
    personas,
    activePersona: effectivePersona,
    visibleUserIds: [...userListSet],
    syntheticUsers,
    matrixUsers,
  });

  // Mirrors the naming resolution in turnPlanner, since a snapshot that shows the raw
  // Discord name is not a preview of the prompt the model actually receives.
  const snapshotDisplayName = user.displayName || user.globalName || user.username;
  const isTriggererBlacklisted = await userRepository.isBlacklisted(guild.id, user.id).catch(() => false);
  const canUsePersonalizedNaming =
    !isTriggererBlacklisted && effectivePersona.config.personal_memories_enabled !== false;
  const snapshotNamingPreference =
    canUsePersonalizedNaming && userData.user_id
      ? (
          await userNamingRepository
            .loadPreferences([{ userId: userData.user_id, personaLineageId: effectivePersona.persona_lineage_id }])
            .catch(() => null)
        )?.get(userPersonaNamingPairKey(userData.user_id, effectivePersona.persona_lineage_id))
      : undefined;
  const snapshotNaming = resolveEffectiveUserNaming({
    global: {
      userNickname: canUsePersonalizedNaming ? userData.user_nickname : null,
      prefixOverride: canUsePersonalizedNaming ? (userData.prefix_override ?? null) : null,
      suffixOverride: canUsePersonalizedNaming ? (userData.suffix_override ?? null) : null,
      addressingStyle: canUsePersonalizedNaming ? (userData.addressing_style ?? null) : null,
    },
    liveDisplayName: snapshotDisplayName,
    persona: canUsePersonalizedNaming ? effectivePersona.naming_config : undefined,
    preference: canUsePersonalizedNaming ? snapshotNamingPreference : null,
  });

  const contextBuild = await buildContext({
    guildId: guild.id,
    serverName: guild.name,
    serverDescription: guild.description || null,
    simplifiedMessageHistory: simplifiedMessages,
    preparedParticipantContext,
    channelDesc,
    channelName,
    channelId: textChannel.id,
    // Thread → parent-channel privacy inheritance (mirrors tomoriChat.ts)
    parentChannelId: textChannel.isThread() ? textChannel.parentId : null,
    client,
    triggererName: snapshotNaming.nickname,
    triggererFormattedName: snapshotNaming.formattedName,
    triggererAddressTerm: snapshotNaming.addressTerm,
    // snapshot.triggererUserRow unlocks STM context (actualTriggeringUserId guard inside buildContext)
    snapshot: {
      triggererUserRow: userData,
      tomoriState: snapshotToolFilter?.disabledByDeliberateMode
        ? { ...effectivePersona, llm: { ...effectivePersona.llm, has_tools: false } }
        : effectivePersona,
      isTriggererBlacklisted,
    },
    deliberateToolAllowedNames: snapshotToolFilter?.allowedToolNames,
    tomoriNickname: selectedPersona.persona_nickname ?? process.env.DEFAULT_BOTNAME ?? "Tomori",
    tomoriAttributes: selectedPersona.attribute_list,
    tomoriConfig: effectivePersona.config,
    channelPromptOverride,
    channelContextNote,
    personaPrompt: selectedPersona.persona_prompt ?? null,
    personaLineageId: selectedPersona.persona_lineage_id,
    isDMChannel: false,
  });

  const contextItems = [...contextBuild.contextItems];

  // Apply tail directives in the same order as the live chat pipeline so the
  //      snapshot reflects the full prompt the LLM would actually see:
  //        Lower-priority tails (STM "create" prompt, emoji penalty) inserted
  //           before the latest dialogue pair so they don't displace recent turns.
  //        Normal tails (e.g. impersonation directive) appended to the end.
  //        Uncensor directive appended last (isolated, strongest recency signal).
  const lowerPriorityTailDirectives = [...contextBuild.lowerPriorityTailDirectives];
  const emojiPenaltyDirective = getEmojiPenaltyDirective(
    contextItems,
    selectedPersona.persona_nickname ?? process.env.DEFAULT_BOTNAME ?? "Tomori",
  );
  if (emojiPenaltyDirective) lowerPriorityTailDirectives.push(emojiPenaltyDirective);

  const lowerPriorityTailMessage = buildCombinedTailDirectiveMessage(lowerPriorityTailDirectives);
  if (lowerPriorityTailMessage) insertBeforeLatestDialoguePair(contextItems, lowerPriorityTailMessage);

  // Mirror the live pipeline: inject the deferred STM content block at its depth
  // (only when content depth >= 0), before the nudge so the snapshot ordering matches.
  if (
    contextBuild.memoryInjectionItems &&
    contextBuild.memoryInjectionItems.length > 0 &&
    (contextBuild.memoryInjectionDepth ?? -1) >= 0
  ) {
    for (const memoryItem of contextBuild.memoryInjectionItems) {
      insertAtDialogueDepth(contextItems, memoryItem, contextBuild.memoryInjectionDepth ?? 0);
    }
  }

  // Mirror the live pipeline: inject the unified STM nudge at its configured depth.
  if (contextBuild.nudgeItem) {
    insertAtDialogueDepth(contextItems, contextBuild.nudgeItem, contextBuild.nudgeInjectionDepth ?? 0);
  }

  const combinedTailMessage = buildCombinedTailDirectiveMessage([...contextBuild.tailDirectives]);
  if (combinedTailMessage) contextItems.push(combinedTailMessage);

  if (contextBuild.uncensorDirective) {
    const uncensorTailMessage = buildCombinedTailDirectiveMessage([contextBuild.uncensorDirective]);
    if (uncensorTailMessage) contextItems.push(uncensorTailMessage);
  }

  const resolvedContextItems = await resolveMediaForModel(contextItems, answeringState);

  // generationTurn truncates after media resolution, so the inspection must too or it reports
  // history the model never receives once a channel outgrows the window.
  const budget = await resolveContextBudget(answeringState, guild.id);
  const truncation = budget
    ? truncateDialogueHistory(resolvedContextItems, budget.contextLength, budget.outputReserve)
    : null;

  const presetData = await getCachedActivePreset(selectedPersona.server_id);
  const providerName = normalizeProviderName(answeringState.llm.llm_provider);

  let toolsData: Array<Record<string, unknown>> | null = null;
  if (request.includeTools) {
    try {
      toolsData = await fetchProviderTools(answeringState, providerName, snapshotToolFilter);
    } catch (toolError) {
      log.warn(
        `Failed to fetch tools for prompt inspection (provider=${providerName}): ${(toolError as Error).message}`,
      );
    }
  }

  return {
    selectedPersona,
    answeringState,
    providerName,
    modelName: answeringState.llm.llm_codename,
    channelId: textChannel.id,
    channelName,
    presetName: presetData?.preset.preset_name ?? null,
    capturedAt: new Date().toISOString(),
    contextItems: truncation?.truncated ?? resolvedContextItems,
    toolsData,
    budget,
    historyPairsDropped: truncation?.historyPairsDropped ?? 0,
  };
}

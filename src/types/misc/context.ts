/**
 * A segment of context for the LLM conversation
 */
export type ContextPart =
  | { type: "text"; text: string }
  | { type: "image"; uri: string; mimeType: string; fallbackUri?: string } // URI could be a public URL or a data URI; fallbackUri tried on fetch failure
  | { type: "video"; uri: string; mimeType: string; isYouTubeLink?: boolean }; // Video support with YouTube detection

export interface MediaDescriptor {
  kind: "image" | "video";
  uri: string;
  mimeType: string | null;
  fallbackUri?: string;
  mediaId: string;
  isEmoji?: boolean;
  withinWindow: boolean;
  isYouTubeLink?: boolean;
  filename?: string;
}

export interface ConversationUserReference {
  targetId: string; // Discord snowflake or bridge user ID
  displayLabel: string;
  aliases: string[];
  mentionable: boolean; // True only when this target can be converted into a Discord mention
}

interface ContextItemSender {
  name: string;
  type: "user" | "persona";
}

export enum ContextItemTag {
  SYSTEM_INSTRUCTION_BLOCK = "system_instruction_block", // For the main consolidated system prompt
  SYSTEM_PERSONALITY = "system_personality", // Specific to bot's core personality attributes
  SYSTEM_HUMANIZER_RULES = "system_humanizer_rules", // Specific to humanization instructions
  SYSTEM_CHANNEL_PROMPT = "system_channel_prompt", // Per-channel system prompt override (append mode); injected after SYSTEM_HUMANIZER_RULES
  SYSTEM_PERSONA_PROMPT = "system_persona_prompt", // Specific to persona prompt
  SYSTEM_FUNCTION_GUIDE = "system_function_guide", // New: For instructions on using available functions

  KNOWLEDGE_SERVER_INFO = "knowledge_server_info",
  KNOWLEDGE_SERVER_EMOJIS = "knowledge_server_emojis",
  KNOWLEDGE_SERVER_STICKERS = "knowledge_server_stickers",
  KNOWLEDGE_PERSONA_SPRITES = "knowledge_persona_sprites",
  KNOWLEDGE_SERVER_MEMORIES = "knowledge_server_memories",
  KNOWLEDGE_SERVER_DOCUMENTS = "knowledge_server_documents",
  KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS = "knowledge_verbatim_tool_definitions", // Available tool JSON schemas, injected only for a model with verbatim tool calling enabled
  KNOWLEDGE_SERVER_CONDITIONING = "knowledge_server_conditioning",
  KNOWLEDGE_PERSONA_USER_BLOCKS = "knowledge_persona_user_blocks",
  KNOWLEDGE_USER_MEMORIES = "knowledge_user_memories", // For a block of multiple users' memories
  KNOWLEDGE_USER_STATUS = "knowledge_user_status", // For a block of multiple users' statuses
  KNOWLEDGE_CURRENT_CONTEXT = "knowledge_current_context", // Time, channel info
  KNOWLEDGE_USERS_IN_CONVERSATION = "knowledge_users_in_conversation", // Combined: time, channel, user status, memories, reminders
  KNOWLEDGE_SHORT_TERM_MEMORY = "knowledge_short_term_memory", // Short-term memory for recent conversations (goes to dialogue history)

  DIALOGUE_SAMPLE = "dialogue_sample", // For individual sample user/model turns
  DIALOGUE_HISTORY = "dialogue_history", // For actual conversation history turns
  CONTEXT_NOTE_INJECTION = "context_note_injection", // Author's note injected into dialogue at configurable depth
}

export type StructuredContextItem = {
  role: "system" | "user" | "model"; // 'system' for initial instructions, 'user' for user/tool inputs, 'model' for LLM responses
  parts: ContextPart[];
  mediaDescriptors?: MediaDescriptor[];
  metadataTag?: ContextItemTag; // Optional tag for internal processing
  messageId?: string; // Optional Discord message ID for tools that need to reference the original message
  sender?: ContextItemSender; // Hidden sender metadata for provider-side history normalization
  /** Visible participant fields before mention-rendering instructions are added. */
  participantReviewEvidence?: {
    participants: Array<{ name: string; fields: string[] }>;
    channel: string;
    currentTime: string;
  };
  conversationUsers?: ConversationUserReference[]; // Hidden metadata for user resolution and mention handling
  participantTargetIndex?: import("@/utils/text/participants/targetIndex").ParticipantTargetIndex;
  personaMentionMap?: Map<string, string>; // Hidden metadata for preserving known persona @trigger text
};

/**
 * Per-request snapshot of data used throughout context building.
 * Created once at the start of a request and reused across context builds/rebuilds
 * to avoid redundant database queries and ensure state consistency.
 *
 * @remarks
 * - Snapshot is per-request only (not shared globally)
 * - Provides consistency for the entire request lifecycle, including context restarts
 * - All fields are optional to maintain backward compatibility
 */
export interface RequestSnapshot {
  /** Tomori configuration and state for the server/DM */
  tomoriState?: import("@/types/db/schema").TomoriState;

  /** User row data for the message triggerer */
  triggererUserRow?: import("@/types/db/schema").UserRow | null;

  /** Whether the triggerer is blacklisted in this server */
  isTriggererBlacklisted?: boolean;

  /** Whether the triggerer has opted out of personalization */
  isTriggererOptedOut?: boolean;

  /** Privacy level of the triggerer (for efficiency) */
  triggererPrivacyLevel?: import("@/types/db/schema").PrivacyLevel;

  /**
   * Preloaded GuildMember for the triggerer (for presence lookups).
   * Null for DM channels where member data doesn't apply.
   */
  preloadedMember?: import("discord.js").GuildMember | null;
}

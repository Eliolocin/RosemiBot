/**
 * Common types and constants for the modular streaming system
 *
 * This module contains shared types, constants, and utilities used across
 * the StreamOrchestrator and all StreamProvider implementations.
 */

import { HumanizerDegree } from "../db/schema";
import type { TokenUsage } from "@/utils/text/tokenEstimate";

/**
 * Discord streaming constants extracted from the original implementation
 * These control message length limits, buffer sizes, and timing behavior
 */
export const DISCORD_STREAMING_CONSTANTS = {
  MAX_SINGLE_MESSAGE_LENGTH: 1950,

  FLUSH_BUFFER_SIZE_REGULAR: 1000, // For normal text
  FLUSH_BUFFER_SIZE_CODE_BLOCK: 15000, // For code blocks (much larger)

  BASE_TYPE_SPEED_MS_PER_CHAR: 10,
  MAX_TYPING_TIME_MS: 4000,
  MIN_VISIBLE_TYPING_DURATION_MS: 750,

  MIN_RANDOM_PAUSE_MS: 250,
  MAX_RANDOM_PAUSE_MS: 1500,
  THINKING_PAUSE_CHANCE: 0.25,

  INACTIVITY_TIMEOUT_MS: 120000, // 2 minutes
  // Hosted queues (NVIDIA NIM's free tier measured 266s, OpenRouter free models similar) can hold a
  // healthy request for minutes before the first token, so the wait for it gets a longer budget
  // than the gaps after it. Every stall detector must honor this for the pre-first-token phase,
  // or the shortest one silently caps the wait for all of them.
  FIRST_TOKEN_TIMEOUT_MS: 300000, // 5 minutes
} as const;

export enum VisibleDeliveryMode {
  AGGREGATED_PHASE = "aggregated_phase",
  STREAMING = "streaming",
}

/**
 * Sprite mapping persisted after a successful webhook send so context
 * rebuilding can recover the decorated "Name (sprite):" label even though the
 * webhook displays only the clean persona name.
 */
export interface SpriteMessageRecordInfo {
  personaId: number;
  spriteName: string;
  /**
   * Whether this sprite is a DID-alter "identity" sprite. In-memory routing context
   * only (not part of the persisted persona_sprite_messages mapping): the post-turn
   * stat recorder uses it to count identity sprites in `sprite_shown` but exclude them
   * from `sprite_emotion` (so they never reach the emotion breakdown).
   */
  isIdentity: boolean;
}

/**
 * One delivered sprite, drained from StreamState into StreamResult for the post-turn
 * stat recorder. Carries the identity flag so it can split the all-inclusive
 * `sprite_shown` count from the non-identity `sprite_emotion` count.
 */
export interface SpriteShownEntry {
  /** Sprite name : the user-given tag, used directly as the stat metric_key. */
  name: string;
  /** Identity (DID-alter) sprites count toward sprite_shown but never sprite_emotion. */
  isIdentity: boolean;
}

interface StreamRenderModifierState {
  identity: {
    username?: string;
    avatarUrl?: string;
    avatarDataUri?: string;
  };
  /** Present when the active render modifier is a persona sprite. */
  spriteRecord?: SpriteMessageRecordInfo;
  /**
   * The alter's base appearance under the decorated "Persona (neutral)" name, held after a
   * plain-label revert so the base lines that follow keep one username and still group.
   */
  isNeutralAppearance?: boolean;
}

/**
 * Stream state tracking for buffer management and code block and think block detection
 */
export interface StreamState {
  pendingResponseText?: string;
  pendingResponseSegments?: Array<{
    text: string;
    boundary?: import("@/utils/discord/stream/messageDelivery").BufferedDeliveryBoundary;
    codeBlock: boolean;
  }>;
  pendingResponseBytes?: number;
  pendingResponseTruncation?: import("@/types/stream/pendingResponse").PendingResponseTruncation;
  buffer: string;
  isInsideCodeBlock: boolean;
  isInsideThinkBlock: boolean;
  /** Accumulates raw content between <think> and </think> before routing to thoughtRawSegments. */
  thinkBlockBuffer: string;
  isInsideDetailsBlock: boolean;
  /** Accumulates raw content between <details> and </details> before routing to detailsSegments. */
  detailsBlockBuffer: string;
  /** Completed <details> block bodies (with <summary> stripped), routed to STM after stream ends. */
  detailsSegments: string[];
  hasSemanticMarkers: boolean;
  messageSentCount: number;
  hasRepliedToOriginalMessage: boolean;
  accumulatedText: string; // Track all text sent to Discord for short-term memory
  prefillTarget?: string; // Prefill text to strip from streamed output (hybrid prefix)
  prefillMatched: number; // Number of prefill chars matched/stripped so far
  prefillMatchFailed: boolean; // Whether prefill matching failed (no stripping)
  prefillHeld: string; // Segment text withheld while a partial echo match spans segments
  thoughtSummarySegments: string[];
  thoughtRawSegments: string[];
  /** OpenRouter-only: upstream serving provider/endpoint (e.g. "minimax-cn") for thought logs. */
  servingProvider?: string;
  firstReplyUrl?: string;
  /**
   * Holds orphan punctuation segments (e.g. a lone "..." flushed on its own line)
   * across flush boundaries so they can be prepended to the next non-empty segment
   * instead of being sent as standalone Discord messages. Released on final flush.
   */
  pendingOrphanPunctuation?: string;
  /** Degree-0 delivery buffer: visible text queued until a tool/final/attachment boundary. */
  pendingAggregatedText: string;
  /**
   * When true, the next queued degree-0 segment should replace the prior newline
   * flush boundary with exactly one blank line.
   */
  pendingAggregateJoinNextWithBlankLine: boolean;
  /** Active render-modifier identity for the current generated line. */
  activeRenderModifier?: StreamRenderModifierState;
  /**
   * Whether the next flushed segment begins a line. Sentence ("period") and overflow flushes
   * split mid-line, and a plain own-name label there is prose, not a return to the base persona.
   */
  nextSegmentOpensLine?: boolean;
  /**
   * Sprite labels delivered during this stream, in render order (one entry per
   * delivered sprite message, repeats kept). Drained into StreamResult.spritesShown
   * so the post-turn stat recorder can count `sprite_shown` (all) and `sprite_emotion`
   * (non-identity only) with full user scope.
   */
  spritesShown: SpriteShownEntry[];
  /**
   * Real, provider-reported token usage for this stream segment, normalized
   * (via normalizeProviderUsage) from whichever chunk's metadata carried it.
   * Captured across the whole loop: not just the terminal `done` chunk, so
   * providers that emit usage on a separate trailing chunk (OpenAI
   * `include_usage`) or clobber the done metadata (Anthropic `message_stop`)
   * are still counted. Drained into StreamResult.usage. Undefined when the
   * provider reported no usage.
   */
  usage?: TokenUsage;
}

export interface TextProcessingConfig {
  humanizerDegree: HumanizerDegree;
  visibleDeliveryMode: VisibleDeliveryMode;
  emojiUsageEnabled: boolean;
  emojiStrings: string[];
  mentionMap?: Map<string, string[]>;
  mentionIdSet?: Set<string>;
  personaMentionMap?: Map<string, string>;
  botName: string;
  /** Extra names the active persona answers to (lore/default name, trigger names) : used to strip
   *  a leaked multi-name opening label chain like "Tomori: Lilya: ..." */
  botNameAliases: string[];
  registeredSpeakerNamesLower: Set<string>;
  maxMessageLength: number;
  uncensorUnicodeSpacesEnabled?: boolean;
  uncensorSanitizeEnabled?: boolean;
}

export interface TypingSimulationConfig {
  enabled: boolean;
  baseSpeedMsPerChar: number;
  maxTypingTimeMs: number;
  minVisibleDurationMs: number;
  randomPauseEnabled: boolean;
  thinkingPauseChance: number;
}

/**
 * Stream timing metrics for monitoring and debugging
 */
export interface StreamMetrics {
  startTime: number;
  endTime?: number;
  totalChunks: number;
  totalCharacters: number;
  messagesSent: number;
  functionCalls: number;
  errors: number;
  timeouts: number;
}

export interface ChunkProcessingResult {
  shouldFlush: boolean;
  segmentToFlush?: string;
  updatedBuffer: string;
  newCodeBlockState: boolean | undefined;
  breakType?: "newline" | "period" | "code_open" | "code_close" | "overflow";
}

export function createDefaultStreamState(): StreamState {
  return {
    buffer: "",
    isInsideCodeBlock: false,
    isInsideThinkBlock: false,
    thinkBlockBuffer: "",
    isInsideDetailsBlock: false,
    detailsBlockBuffer: "",
    detailsSegments: [],
    hasSemanticMarkers: false,
    messageSentCount: 0,
    hasRepliedToOriginalMessage: false,
    accumulatedText: "", // Initialize empty for short-term memory tracking
    prefillTarget: undefined,
    prefillMatched: 0,
    prefillMatchFailed: false,
    prefillHeld: "",
    thoughtSummarySegments: [],
    thoughtRawSegments: [],
    firstReplyUrl: undefined,
    pendingOrphanPunctuation: undefined,
    pendingAggregatedText: "",
    pendingAggregateJoinNextWithBlankLine: false,
    activeRenderModifier: undefined,
    nextSegmentOpensLine: true,
    spritesShown: [],
    usage: undefined,
  };
}

export function createDefaultStreamMetrics(): StreamMetrics {
  return {
    startTime: Date.now(),
    totalChunks: 0,
    totalCharacters: 0,
    messagesSent: 0,
    functionCalls: 0,
    errors: 0,
    timeouts: 0,
  };
}

export function createTypingSimulationConfig(
  humanizerDegree: HumanizerDegree,
  customConfig?: Partial<TypingSimulationConfig>,
): TypingSimulationConfig {
  return {
    enabled: humanizerDegree >= HumanizerDegree.MEDIUM,
    baseSpeedMsPerChar: DISCORD_STREAMING_CONSTANTS.BASE_TYPE_SPEED_MS_PER_CHAR,
    maxTypingTimeMs: DISCORD_STREAMING_CONSTANTS.MAX_TYPING_TIME_MS,
    minVisibleDurationMs: DISCORD_STREAMING_CONSTANTS.MIN_VISIBLE_TYPING_DURATION_MS,
    randomPauseEnabled: humanizerDegree >= HumanizerDegree.MEDIUM,
    thinkingPauseChance: DISCORD_STREAMING_CONSTANTS.THINKING_PAUSE_CHANCE,
    ...customConfig,
  };
}

export function getVisibleDeliveryMode(humanizerDegree: HumanizerDegree): VisibleDeliveryMode {
  return humanizerDegree === HumanizerDegree.NONE
    ? VisibleDeliveryMode.AGGREGATED_PHASE
    : VisibleDeliveryMode.STREAMING;
}

/**
 * Emoji repetition penalty system to prevent excessive custom emoji usage
 * Analyzes bot's recent messages and injects guidance when threshold is exceeded
 * NOTE: Only counts custom server emojis (:name:), NOT Unicode emojis (😊, 👍)
 *
 * EMOJI_PENALTY_ENABLED and EMOJI_UNIQUE_ENABLED switch each behavior off (default: on).
 */

import type { StructuredContextItem } from "../../types/misc/context";
import { ContextItemTag } from "../../types/misc/context";
import { extractCustomEmojis, filterCustomEmojis } from "./emojiHelper";
import { log } from "../misc/logger";

const EMOJI_PENALTY_LOOKBACK_MESSAGES = 3;
// More than one custom emoji across the lookback window triggers the penalty directive.
const EMOJI_PENALTY_MAX_EMOJIS = 1;
const EMOJI_UNIQUE_LOOKBACK_MESSAGES = 5;

interface EmojiPenaltyConfig {
  /** Whether the emoji penalty system is enabled */
  readonly enabled: boolean;
  /** Number of recent bot messages to analyze */
  readonly lookbackCount: number;
  /** Maximum total emojis allowed across the lookback window */
  readonly maxEmojis: number;
}

/**
 * @returns The penalty thresholds, with the on/off switch read from EMOJI_PENALTY_ENABLED
 */
function loadEmojiPenaltyConfig(): EmojiPenaltyConfig {
  return {
    enabled: process.env.EMOJI_PENALTY_ENABLED !== "false",
    lookbackCount: EMOJI_PENALTY_LOOKBACK_MESSAGES,
    maxEmojis: EMOJI_PENALTY_MAX_EMOJIS,
  };
}

/**
 * Extract text content from a StructuredContextItem's parts
 */
function extractTextFromContextItem(item: StructuredContextItem): string {
  const textParts = item.parts.filter((part) => part.type === "text");

  return textParts.map((part) => part.text).join(" ");
}

/**
 * Analyze recent bot messages for excessive emoji usage
 * @param config - Optional threshold configuration (loads from env if not provided)
 * @returns True if emoji usage exceeds threshold, false otherwise
 */
function shouldApplyEmojiPenalty(contextItems: StructuredContextItem[], config?: EmojiPenaltyConfig): boolean {
  const penaltyConfig = config ?? loadEmojiPenaltyConfig();

  if (!penaltyConfig.enabled) {
    return false;
  }
  // Filter for bot messages in dialogue history (role: "model")
  //    We only care about actual dialogue, not system prompts or sample dialogues
  const botMessages = contextItems.filter(
    (item) => item.role === "model" && item.metadataTag === ContextItemTag.DIALOGUE_HISTORY,
  );

  if (botMessages.length === 0) {
    return false;
  }

  const messagesToCheck = Math.min(botMessages.length, penaltyConfig.lookbackCount);
  const recentBotMessages = botMessages.slice(-messagesToCheck);

  // Count total CUSTOM emojis across recent messages (ignore Unicode emojis).
  // Normalise Discord emoji mentions to shortcodes first to avoid double-counting :name: inside <:name:id>.
  let totalCustomEmojis = 0;
  for (const message of recentBotMessages) {
    const text = extractTextFromContextItem(message);
    const normalizedText = text.replace(/<a?:([a-zA-Z0-9_~]+):\d+>/g, ":$1:");
    totalCustomEmojis += extractCustomEmojis(normalizedText).length;
  }

  const shouldTrigger = totalCustomEmojis > penaltyConfig.maxEmojis;
  if (shouldTrigger) {
    log.info(
      `[Emoji Penalty] Triggering penalty (${totalCustomEmojis} custom emojis, threshold: ${penaltyConfig.maxEmojis})`,
    );
  }

  return shouldTrigger;
}

/**
 * Generate an emoji penalty message to inject into context
 * This message appears as natural user guidance to reduce emoji usage
 * @param speakerLabel - Optional speaker label for the directive subject
 */
function buildEmojiPenaltyText(speakerLabel?: string | null): string {
  const normalizedLabel = speakerLabel?.trim();
  return normalizedLabel
    ? `${normalizedLabel} has been using emojis too frequently in recent messages. Respond to this message without using any emojis to maintain natural conversation flow.`
    : "You have been using emojis too frequently in recent messages. Respond to this message without using any emojis to maintain natural conversation flow.";
}

export function getEmojiPenaltyDirective(
  contextItems: StructuredContextItem[],
  speakerLabel?: string | null,
): string | null {
  if (!shouldApplyEmojiPenalty(contextItems)) {
    return null;
  }

  return buildEmojiPenaltyText(speakerLabel);
}

interface UniqueEmojiConfig {
  /** Whether unique emoji enforcement is enabled */
  readonly enabled: boolean;
  /** Number of recent bot messages to track for unique emojis */
  readonly lookbackCount: number;
}

/**
 * @returns The unique-emoji lookback, with the on/off switch read from EMOJI_UNIQUE_ENABLED
 */
function loadUniqueEmojiConfig(): UniqueEmojiConfig {
  return {
    enabled: process.env.EMOJI_UNIQUE_ENABLED !== "false",
    lookbackCount: EMOJI_UNIQUE_LOOKBACK_MESSAGES,
  };
}

/**
 * Get set of custom emojis used in recent bot messages
 * @param config - Optional configuration (loads from env if not provided)
 * @returns Set of custom emoji strings used in recent messages (e.g., ":tomori:", ":pepehands:")
 */
function getRecentlyUsedCustomEmojis(contextItems: StructuredContextItem[], config?: UniqueEmojiConfig): Set<string> {
  const uniqueConfig = config ?? loadUniqueEmojiConfig();

  if (!uniqueConfig.enabled) {
    return new Set();
  }

  const botMessages = contextItems.filter(
    (item) => item.role === "model" && item.metadataTag === ContextItemTag.DIALOGUE_HISTORY,
  );

  if (botMessages.length === 0) {
    return new Set();
  }

  const messagesToCheck = Math.min(botMessages.length, uniqueConfig.lookbackCount);
  const recentBotMessages = botMessages.slice(-messagesToCheck);

  // Extract all custom emojis from recent messages.
  // History text stores already-converted Discord format (<:name:id>), so normalise it to
  // shortcode form first, so otherwise the `:name:` substring inside the mention is double-matched.
  const usedEmojis = new Set<string>();
  for (const message of recentBotMessages) {
    const text = extractTextFromContextItem(message);
    const normalizedText = text.replace(/<a?:([a-zA-Z0-9_~]+):\d+>/g, ":$1:");
    const customEmojis = extractCustomEmojis(normalizedText);
    for (const emoji of customEmojis) {
      usedEmojis.add(emoji.toLowerCase()); // Store lowercase for case-insensitive matching
    }
  }

  log.info(`[Unique Emoji] Found ${usedEmojis.size} unique custom emoji(s) in last ${messagesToCheck} message(s)`);

  return usedEmojis;
}

/**
 * Removes any custom emojis that were already used in recent bot messages
 * @returns Filtered text with duplicate custom emojis removed
 */
export function filterDuplicateCustomEmojis(generatedText: string, contextItems: StructuredContextItem[]): string {
  const recentlyUsed = getRecentlyUsedCustomEmojis(contextItems);

  if (recentlyUsed.size === 0) {
    return generatedText;
  }

  const emojisInGenerated = extractCustomEmojis(generatedText);

  const emojisToRemove = new Set<string>();
  for (const emoji of emojisInGenerated) {
    if (recentlyUsed.has(emoji.toLowerCase())) {
      emojisToRemove.add(emoji);
    }
  }

  if (emojisToRemove.size === 0) {
    log.info("[Unique Emoji] No duplicate custom emojis found in generated text");
    return generatedText;
  }

  const filtered = filterCustomEmojis(generatedText, emojisToRemove);

  // If filtering collapses output to punctuation only, keep the original text rather than
  // sending a lone punctuation character. An empty result is allowed instead: the segment was
  // purely duplicate emojis, and the orchestrator's empty-segment guard drops it cleanly.
  const compactFiltered = filtered.replace(/\s+/g, "");
  if (compactFiltered.length > 0 && /^[.,!?;:。！？、，]+$/.test(compactFiltered)) {
    log.info("[Unique Emoji] Skipping duplicate filter because result became punctuation-only");
    return generatedText;
  }

  log.info(`[Unique Emoji] Filtered ${emojisToRemove.size} duplicate custom emoji(s)`);

  return filtered;
}

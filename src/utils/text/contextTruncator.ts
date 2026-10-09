import type { StructuredContextItem } from "@/types/misc/context";
import { ContextItemTag } from "@/types/misc/context";

/**
 * Estimates the input token count from a list of context items.
 *
 * Uses a 4-characters-per-token approximation applied only to text parts.
 * Image and video parts are excluded, so their token cost is absorbed by the
 * 10% safety margin in {@link truncateDialogueHistory}.
 *
 */
function estimateInputTokens(items: StructuredContextItem[]): number {
  let totalChars = 0;
  for (const item of items) {
    for (const part of item.parts) {
      if (part.type === "text") {
        totalChars += part.text.length;
      }
    }
  }
  return Math.floor(totalChars / 4);
}

/**
 * The estimated input tokens history may fill before truncation starts. The 10% margin absorbs
 * tokenizer estimation error, and `/context` draws its free space against this same figure.
 */
export function computeSafeInputBudget(contextLength: number, maxCompletionTokens: number): number {
  return Math.floor((contextLength - maxCompletionTokens) * 0.9);
}

type TruncationResult = {
  truncated: StructuredContextItem[];
  historyPairsDropped: number;
  sampleItemsDropped: number;
  totalDropped: number;
};

/**
 * Trims context items until the estimated token count fits within the safe input budget:
 *   safeInputBudget = floor((contextLength - maxCompletionTokens) * 0.9)
 *
 * Drop policy:
 * 1) Oldest DIALOGUE_HISTORY exchange pairs (oldest-first), but never remove the newest
 *    DIALOGUE_HISTORY user turn so the current user request remains visible to the model.
 * 2) DIALOGUE_SAMPLE items are protected and never truncated.
 *
 * @param contextItems - Full list of structured context items to truncate
 * @param contextLength - Total context window size (input + output tokens)
 * @param maxCompletionTokens - Maximum output tokens reserved for the model's reply
 * @returns TruncationResult containing the truncated list and drop counts
 */
export function truncateDialogueHistory(
  contextItems: StructuredContextItem[],
  contextLength: number,
  maxCompletionTokens: number,
): TruncationResult {
  const safeInputBudget = computeSafeInputBudget(contextLength, maxCompletionTokens);

  const items = [...contextItems];
  let historyPairsDropped = 0;
  const sampleItemsDropped = 0;

  const findNewestDialogueUserIndex = (): number => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY && items[i].role === "user") {
        return i;
      }
    }
    return -1;
  };

  const dropOldestDroppableHistoryExchange = (): boolean => {
    const newestDialogueUserIdx = findNewestDialogueUserIndex();
    let oldestDroppableUserIdx = -1;

    for (let i = 0; i < items.length; i++) {
      if (
        i !== newestDialogueUserIdx &&
        items[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY &&
        items[i].role === "user"
      ) {
        oldestDroppableUserIdx = i;
        break;
      }
    }

    if (oldestDroppableUserIdx === -1) {
      return false;
    }

    let followingModelIdx = -1;
    for (let i = oldestDroppableUserIdx + 1; i < items.length; i++) {
      if (i === newestDialogueUserIdx) {
        break;
      }
      if (items[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY && items[i].role === "model") {
        followingModelIdx = i;
        break;
      }
    }

    if (followingModelIdx !== -1) {
      items.splice(oldestDroppableUserIdx, followingModelIdx - oldestDroppableUserIdx + 1);
    } else {
      items.splice(oldestDroppableUserIdx, 1);
    }
    historyPairsDropped++;
    return true;
  };

  // Iteratively drop context until within budget (or no droppable content remains)
  while (estimateInputTokens(items) > safeInputBudget) {
    if (dropOldestDroppableHistoryExchange()) {
      continue;
    }
    break;
  }

  return {
    truncated: items,
    historyPairsDropped,
    sampleItemsDropped,
    totalDropped: historyPairsDropped + sampleItemsDropped,
  };
}

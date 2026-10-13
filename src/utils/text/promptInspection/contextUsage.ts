import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { ContextBudget } from "@/utils/provider/contextBudget";
import { computeSafeInputBudget } from "@/utils/text/contextTruncator";
import { charsToTokensJson, charsToTokensText } from "@/utils/text/tokenEstimate";

type ContextSegmentId = "instructions" | "persona" | "server" | "memory" | "people" | "conversation" | "tools";

const CONTEXT_SEGMENT_ORDER: readonly ContextSegmentId[] = [
  "instructions",
  "persona",
  "server",
  "memory",
  "people",
  "conversation",
  "tools",
];

export type ContextCellId = ContextSegmentId | "free" | "reserved";

/**
 * Colored squares are the only color Discord renders identically on desktop and mobile: an
 * `ansi` code block loses its colors on mobile, which would leave the legend unreadable there.
 * Nine squares exist, so the segment list cannot grow past seven without merging two.
 */
const CONTEXT_CELL_SQUARES: Readonly<Record<ContextCellId, string>> = {
  instructions: "🟥",
  persona: "🟧",
  server: "🟨",
  memory: "🟩",
  people: "🟦",
  conversation: "🟪",
  tools: "🟫",
  free: "⬛",
  reserved: "⬜",
};

/** One circle per segment square, drawn for a segment smaller than one cell. */
const CONTEXT_SEGMENT_CIRCLES: Readonly<Record<ContextSegmentId, string>> = {
  instructions: "🔴",
  persona: "🟠",
  server: "🟡",
  memory: "🟢",
  people: "🔵",
  conversation: "🟣",
  tools: "🟤",
};

/** A full Record so that adding a context tag fails type checking until it is given a segment. */
const TAG_SEGMENTS: Readonly<Record<ContextItemTag, ContextSegmentId>> = {
  [ContextItemTag.SYSTEM_INSTRUCTION_BLOCK]: "instructions",
  [ContextItemTag.SYSTEM_HUMANIZER_RULES]: "instructions",
  [ContextItemTag.SYSTEM_CHANNEL_PROMPT]: "instructions",
  [ContextItemTag.SYSTEM_FUNCTION_GUIDE]: "instructions",
  [ContextItemTag.CONTEXT_NOTE_INJECTION]: "instructions",
  [ContextItemTag.SYSTEM_PERSONALITY]: "persona",
  [ContextItemTag.SYSTEM_PERSONA_PROMPT]: "persona",
  [ContextItemTag.KNOWLEDGE_PERSONA_SPRITES]: "persona",
  [ContextItemTag.DIALOGUE_SAMPLE]: "persona",
  [ContextItemTag.KNOWLEDGE_SERVER_INFO]: "server",
  [ContextItemTag.KNOWLEDGE_SERVER_EMOJIS]: "server",
  [ContextItemTag.KNOWLEDGE_SERVER_STICKERS]: "server",
  [ContextItemTag.KNOWLEDGE_SERVER_CONDITIONING]: "server",
  [ContextItemTag.KNOWLEDGE_SERVER_MEMORIES]: "memory",
  [ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS]: "memory",
  [ContextItemTag.KNOWLEDGE_USER_MEMORIES]: "memory",
  [ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY]: "memory",
  [ContextItemTag.KNOWLEDGE_PERSONA_USER_BLOCKS]: "people",
  [ContextItemTag.KNOWLEDGE_USER_STATUS]: "people",
  [ContextItemTag.KNOWLEDGE_CURRENT_CONTEXT]: "people",
  [ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION]: "people",
  [ContextItemTag.DIALOGUE_HISTORY]: "conversation",
  [ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS]: "tools",
};

interface ContextSegmentUsage {
  id: ContextSegmentId;
  tokens: number;
}

export interface ContextUsage {
  /** Non-empty segments in {@link CONTEXT_SEGMENT_ORDER}. */
  segments: ContextSegmentUsage[];
  inputTokens: number;
}

/**
 * Estimates how many input tokens each part of the prompt costs, with the same character
 * ratios as `/tool estimate cost`. Media parts are skipped because their cost differs per
 * provider, and provider tool schemas count toward the tools segment.
 */
export function measureContextUsage(
  contextItems: readonly StructuredContextItem[],
  providerTools: readonly Record<string, unknown>[] | null,
): ContextUsage {
  const charsBySegment = new Map<ContextSegmentId, number>();
  for (const item of contextItems) {
    // Untagged items come from SillyTavern preset routing, which carries prompt instructions.
    const segmentId = item.metadataTag ? TAG_SEGMENTS[item.metadataTag] : "instructions";
    const textChars = item.parts.reduce((total, part) => total + (part.type === "text" ? part.text.length : 0), 0);
    charsBySegment.set(segmentId, (charsBySegment.get(segmentId) ?? 0) + textChars);
  }

  const toolSchemaTokens =
    providerTools && providerTools.length > 0 ? charsToTokensJson(JSON.stringify(providerTools).length) : 0;

  const segments = CONTEXT_SEGMENT_ORDER.flatMap((id) => {
    const chars = charsBySegment.get(id) ?? 0;
    const tokens = (chars > 0 ? charsToTokensText(chars) : 0) + (id === "tools" ? toolSchemaTokens : 0);
    return tokens > 0 ? [{ id, tokens }] : [];
  });

  return { segments, inputTokens: segments.reduce((total, segment) => total + segment.tokens, 0) };
}

export const CONTEXT_GRID_COLUMNS = 10;
export const CONTEXT_GRID_ROWS = 20;
const CONTEXT_GRID_CELLS = CONTEXT_GRID_COLUMNS * CONTEXT_GRID_ROWS;

interface ContextGridPart {
  id: ContextCellId;
  tokens: number;
  /** The square, or for a segment smaller than one cell, its circle. */
  glyph: string;
}

export interface ContextGrid {
  /** Every part in display order, including zero-cell ones, for the legend. */
  parts: ContextGridPart[];
  /** The denominator for percentages: the window when it is known, else the input itself. */
  capacityTokens: number;
  tokensPerCell: number;
  /** Whether any segment is drawn as a circle, which the scale line then explains. */
  hasCircles: boolean;
  rows: string[];
}

/**
 * Lays the usage out as a 10x20 grid where each cell is 0.5% of the window.
 *
 * Free space is measured against the truncation budget rather than the raw window, and the gap
 * between them is drawn as reserved, so the free cells run out exactly where the live pipeline
 * starts dropping history. Any non-empty segment keeps at least one cell so a small slice stays
 * visible, and one smaller than a cell is drawn as a circle so that floor does not pass for its
 * size; the legend carries the exact figures.
 */
export function layoutContextGrid(usage: ContextUsage, budget: ContextBudget | null): ContextGrid {
  const parts: Array<{ id: ContextCellId; tokens: number }> = usage.segments.map(({ id, tokens }) => ({ id, tokens }));

  if (budget) {
    const safeInputBudget = Math.max(0, computeSafeInputBudget(budget.contextLength, budget.outputReserve));
    parts.push({ id: "free", tokens: Math.max(0, safeInputBudget - usage.inputTokens) });
    parts.push({ id: "reserved", tokens: Math.max(0, budget.contextLength - safeInputBudget) });
  }

  const capacityTokens = parts.reduce((total, part) => total + part.tokens, 0);
  const tokensPerCell = capacityTokens / CONTEXT_GRID_CELLS;

  const glyphParts = parts.map(({ id, tokens }) => ({
    id,
    tokens,
    glyph:
      id !== "free" && id !== "reserved" && tokens < tokensPerCell
        ? CONTEXT_SEGMENT_CIRCLES[id]
        : CONTEXT_CELL_SQUARES[id],
  }));

  // Free space may honestly be zero, so it is the one part without a floor.
  const cellCounts = allocateCells(
    parts.map((part) => part.tokens),
    CONTEXT_GRID_CELLS,
    (index) => parts[index].id !== "free",
  );
  const cells = glyphParts.flatMap((part, index) => Array<string>(cellCounts[index]).fill(part.glyph));

  const rows: string[] = [];
  for (let start = 0; start < cells.length; start += CONTEXT_GRID_COLUMNS) {
    rows.push(cells.slice(start, start + CONTEXT_GRID_COLUMNS).join(""));
  }

  return {
    parts: glyphParts,
    capacityTokens,
    tokensPerCell,
    hasCircles: glyphParts.some((part) => part.glyph !== CONTEXT_CELL_SQUARES[part.id]),
    rows,
  };
}

/**
 * Largest-remainder allocation of `totalCells` in proportion to `weights`, with a floor of one cell
 * for every non-zero weight that `keepVisible` selects.
 */
function allocateCells(
  weights: readonly number[],
  totalCells: number,
  keepVisible: (index: number) => boolean,
): number[] {
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  if (totalWeight <= 0 || totalCells <= 0) return weights.map(() => 0);

  const exact = weights.map((weight) => (weight / totalWeight) * totalCells);
  const counts = exact.map((value, index) => {
    const floor = Math.floor(value);
    return weights[index] > 0 && keepVisible(index) ? Math.max(1, floor) : floor;
  });

  let allocated = counts.reduce((total, count) => total + count, 0);

  // The one-cell floor can overshoot, so give cells back from the largest part first.
  while (allocated > totalCells) {
    let donor = 0;
    for (let index = 1; index < counts.length; index++) {
      if (counts[index] > counts[donor]) donor = index;
    }
    counts[donor] -= 1;
    allocated -= 1;
  }

  // Measured from the allocated count, not the floor, so a part the one-cell floor already lifted
  // does not take a leftover cell from a larger part.
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - counts[index] }))
    .sort((left, right) => right.remainder - left.remainder);
  for (let cursor = 0; allocated < totalCells && byRemainder.length > 0; cursor++) {
    counts[byRemainder[cursor % byRemainder.length].index] += 1;
    allocated += 1;
  }

  return counts;
}

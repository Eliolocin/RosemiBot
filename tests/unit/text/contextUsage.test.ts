import { describe, expect, test } from "bun:test";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import {
  CONTEXT_GRID_COLUMNS,
  CONTEXT_GRID_ROWS,
  type ContextCellId,
  type ContextGrid,
  layoutContextGrid,
  measureContextUsage,
} from "@/utils/text/promptInspection/contextUsage";

const GRID_CELLS = CONTEXT_GRID_COLUMNS * CONTEXT_GRID_ROWS;

function textItem(tag: ContextItemTag | undefined, chars: number): StructuredContextItem {
  return { role: "system", parts: [{ type: "text", text: "x".repeat(chars) }], metadataTag: tag };
}

function countCells(grid: ContextGrid, id: ContextCellId): number {
  const glyph = grid.parts.find((part) => part.id === id)?.glyph;
  return glyph ? grid.rows.join("").split(glyph).length - 1 : 0;
}

function allCells(grid: ContextGrid): string[] {
  return Array.from(grid.rows.join(""));
}

describe("measureContextUsage", () => {
  test("groups tags into segments and treats untagged preset items as instructions", () => {
    const usage = measureContextUsage(
      [
        textItem(ContextItemTag.SYSTEM_HUMANIZER_RULES, 8),
        textItem(undefined, 4),
        textItem(ContextItemTag.DIALOGUE_SAMPLE, 12),
        textItem(ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY, 16),
        textItem(ContextItemTag.DIALOGUE_HISTORY, 20),
      ],
      null,
    );

    expect(usage.segments).toEqual([
      { id: "instructions", tokens: 3 },
      { id: "persona", tokens: 3 },
      { id: "memory", tokens: 4 },
      { id: "conversation", tokens: 5 },
    ]);
    expect(usage.inputTokens).toBe(15);
  });

  test("adds provider tool schemas to the verbatim tool text", () => {
    const tools = [{ type: "function", function: { name: "weather", description: "x".repeat(40) } }];
    const usage = measureContextUsage([textItem(ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS, 8)], tools);

    expect(usage.segments).toEqual([{ id: "tools", tokens: 2 + Math.ceil(JSON.stringify(tools).length / 3.5) }]);
  });

  test("skips media parts, whose token cost differs per provider", () => {
    const usage = measureContextUsage(
      [
        {
          role: "user",
          metadataTag: ContextItemTag.DIALOGUE_HISTORY,
          parts: [{ type: "image", uri: "https://example.com/image.png", mimeType: "image/png" }],
        },
      ],
      null,
    );

    expect(usage.segments).toEqual([]);
  });
});

describe("layoutContextGrid", () => {
  test("always fills a full grid", () => {
    const usage = measureContextUsage([textItem(ContextItemTag.DIALOGUE_HISTORY, 4 * 123)], null);
    const grid = layoutContextGrid(usage, { contextLength: 1000, outputReserve: 100 });

    expect(grid.rows).toHaveLength(CONTEXT_GRID_ROWS);
    for (const row of grid.rows) {
      expect(Array.from(row)).toHaveLength(CONTEXT_GRID_COLUMNS);
    }
  });

  test("ends free space where truncation starts, drawing the reply reserve and margin as reserved", () => {
    // Truncation starts at floor((1000 - 100) * 0.9) = 810 estimated tokens, so 190 are reserved.
    const usage = measureContextUsage([textItem(ContextItemTag.DIALOGUE_HISTORY, 4 * 400)], null);
    const grid = layoutContextGrid(usage, { contextLength: 1000, outputReserve: 100 });

    expect(grid.parts.map(({ id, tokens }) => ({ id, tokens }))).toEqual([
      { id: "conversation", tokens: 400 },
      { id: "free", tokens: 410 },
      { id: "reserved", tokens: 190 },
    ]);
    expect(countCells(grid, "conversation")).toBe(80);
    expect(countCells(grid, "free")).toBe(82);
    expect(countCells(grid, "reserved")).toBe(38);
  });

  test("draws a segment smaller than one cell as a single circle, and says so", () => {
    const usage = measureContextUsage(
      [textItem(ContextItemTag.SYSTEM_PERSONALITY, 4), textItem(ContextItemTag.DIALOGUE_HISTORY, 4 * 50_000)],
      null,
    );
    const grid = layoutContextGrid(usage, { contextLength: 1_000_000, outputReserve: 8192 });
    const persona = grid.parts.find((part) => part.id === "persona");
    const conversation = grid.parts.find((part) => part.id === "conversation");

    expect(grid.tokensPerCell).toBe(5000);
    expect(grid.hasCircles).toBe(true);
    expect(persona?.glyph).not.toBe(conversation?.glyph);
    expect(countCells(grid, "persona")).toBe(1);
    expect(allCells(grid)).toHaveLength(GRID_CELLS);
  });

  test("draws every segment as a square when each fills at least one cell", () => {
    const usage = measureContextUsage(
      [textItem(ContextItemTag.SYSTEM_PERSONALITY, 4 * 100), textItem(ContextItemTag.DIALOGUE_HISTORY, 4 * 300)],
      null,
    );
    const grid = layoutContextGrid(usage, { contextLength: 1000, outputReserve: 100 });

    expect(grid.hasCircles).toBe(false);
  });

  test("never gives a segment the floor lifted more cells than a larger segment", () => {
    // At 5K tokens per cell, server info is 0.9 cells and memories 1.2: the floor lifts server info
    // to one cell, after which its 0.9 remainder must not win a leftover cell over larger parts.
    const usage = measureContextUsage(
      [
        textItem(ContextItemTag.SYSTEM_HUMANIZER_RULES, 4 * 21_000),
        textItem(ContextItemTag.KNOWLEDGE_SERVER_INFO, 4 * 4500),
        textItem(ContextItemTag.KNOWLEDGE_SERVER_MEMORIES, 4 * 6000),
        textItem(ContextItemTag.DIALOGUE_HISTORY, 4 * 18_000),
      ],
      null,
    );
    const grid = layoutContextGrid(usage, { contextLength: 1_000_000, outputReserve: 8192 });

    expect(countCells(grid, "server")).toBe(1);
    expect(countCells(grid, "memory")).toBe(1);
    expect(allCells(grid)).toHaveLength(GRID_CELLS);
  });

  test("shows no free space once the prompt is past the truncation budget", () => {
    const usage = measureContextUsage([textItem(ContextItemTag.DIALOGUE_HISTORY, 4 * 950)], null);
    const grid = layoutContextGrid(usage, { contextLength: 1000, outputReserve: 100 });

    expect(countCells(grid, "free")).toBe(0);
    expect(allCells(grid)).toHaveLength(GRID_CELLS);
  });

  test("shows only the prompt's composition when the window is unknown", () => {
    const usage = measureContextUsage(
      [textItem(ContextItemTag.SYSTEM_HUMANIZER_RULES, 4 * 25), textItem(ContextItemTag.DIALOGUE_HISTORY, 4 * 75)],
      null,
    );
    const grid = layoutContextGrid(usage, null);

    expect(grid.parts.map((part) => part.id)).toEqual(["instructions", "conversation"]);
    expect(countCells(grid, "instructions")).toBe(50);
    expect(countCells(grid, "conversation")).toBe(150);
  });
});

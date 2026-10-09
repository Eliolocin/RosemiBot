export const MARKDOWN_TABLE_ATTACHMENT_PREFIX = "markdown_table_";

export type MarkdownTableAlignment = "left" | "center" | "right";

export interface ParsedMarkdownTable {
  source: string;
  header: string[];
  rows: string[][];
  alignments: MarkdownTableAlignment[];
  start: number;
  end: number;
  columnCount: number;
}

export type MarkdownTableSegment =
  | {
      type: "text";
      content: string;
    }
  | {
      type: "table";
      content: string;
      table: ParsedMarkdownTable;
    };

interface LineInfo {
  content: string;
  start: number;
  end: number;
  inCodeFence: boolean;
}

interface TableScanResult {
  table: ParsedMarkdownTable | null;
  nextLineIndex: number;
  incompleteTail: boolean;
}

function getLineInfo(text: string): LineInfo[] {
  if (!text) return [];

  const lines: LineInfo[] = [];
  let cursor = 0;
  let insideCodeFence = false;

  while (cursor < text.length) {
    const newlineIndex = text.indexOf("\n", cursor);
    if (newlineIndex === -1) {
      const line = text.slice(cursor).replace(/\r$/, "");
      const isFenceLine = line.trimStart().startsWith("```");
      lines.push({
        content: line,
        start: cursor,
        end: text.length,
        inCodeFence: insideCodeFence || isFenceLine,
      });
      if (isFenceLine) {
        insideCodeFence = !insideCodeFence;
      }
      break;
    }

    const rawLine = text.slice(cursor, newlineIndex);
    const content = rawLine.replace(/\r$/, "");
    const isFenceLine = content.trimStart().startsWith("```");
    lines.push({
      content,
      start: cursor,
      end: newlineIndex + 1,
      inCodeFence: insideCodeFence || isFenceLine,
    });
    if (isFenceLine) {
      insideCodeFence = !insideCodeFence;
    }
    cursor = newlineIndex + 1;
  }

  return lines;
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return [];

  let normalized = trimmed;
  if (normalized.startsWith("|")) {
    normalized = normalized.slice(1);
  }
  if (normalized.endsWith("|")) {
    normalized = normalized.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of normalized) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());

  return cells.map((cell) => cell.replace(/\\\|/g, "|").trim());
}

// Discord spoilers are pipe-delimited too. A line that is only a spoiler would otherwise read as a
// table header whose separator row has not streamed yet, and that "incomplete table" holds the stream
// buffer's newline split, so the next speaker label lands in the same segment.
const DISCORD_SPOILER_PATTERN = /\|\|[^|\n]+?\|\|/g;

function isPotentialHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.replace(DISCORD_SPOILER_PATTERN, "").includes("|")) return false;

  const cells = splitMarkdownTableRow(trimmed);
  if (cells.length < 2) return false;
  if (cells.every((cell) => cell.length === 0)) return false;

  const pipeCount = (trimmed.match(/\|/g) || []).length;
  return trimmed.startsWith("|") || trimmed.endsWith("|") || pipeCount >= 2;
}

function isSeparatorCell(cell: string): boolean {
  return /^:?-+:?$/.test(cell.trim());
}

function parseAlignment(cell: string): MarkdownTableAlignment {
  const trimmed = cell.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.endsWith(":")) return "right";
  return "left";
}

function isSeparatorRow(line: string, expectedColumns: number): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length === expectedColumns && cells.every(isSeparatorCell);
}

function isBodyRow(line: string, expectedColumns: number): boolean {
  if (!line.trim() || !line.includes("|")) return false;

  const cells = splitMarkdownTableRow(line);
  if (cells.length !== expectedColumns) return false;

  return !cells.every(isSeparatorCell);
}

function tryParseMarkdownTableAt(
  text: string,
  lines: LineInfo[],
  startLineIndex: number,
  eofTerminatesBlock: boolean,
): TableScanResult {
  const headerLine = lines[startLineIndex];
  if (!headerLine || headerLine.inCodeFence || !isPotentialHeaderLine(headerLine.content)) {
    return {
      table: null,
      nextLineIndex: startLineIndex + 1,
      incompleteTail: false,
    };
  }

  const headerCells = splitMarkdownTableRow(headerLine.content);
  if (headerCells.length < 2) {
    return {
      table: null,
      nextLineIndex: startLineIndex + 1,
      incompleteTail: false,
    };
  }

  const separatorLine = lines[startLineIndex + 1];
  if (!separatorLine) {
    return {
      table: null,
      nextLineIndex: lines.length,
      incompleteTail: true,
    };
  }

  if (separatorLine.inCodeFence) {
    return {
      table: null,
      nextLineIndex: startLineIndex + 1,
      incompleteTail: false,
    };
  }

  if (!isSeparatorRow(separatorLine.content, headerCells.length)) {
    return {
      table: null,
      nextLineIndex: startLineIndex + 1,
      incompleteTail: false,
    };
  }

  const alignments = splitMarkdownTableRow(separatorLine.content).map(parseAlignment);
  const rows: string[][] = [];
  let lineIndex = startLineIndex + 2;

  while (
    lineIndex < lines.length &&
    !lines[lineIndex].inCodeFence &&
    isBodyRow(lines[lineIndex].content, headerCells.length)
  ) {
    rows.push(splitMarkdownTableRow(lines[lineIndex].content));
    lineIndex++;
  }

  if (rows.length === 0) {
    return {
      table: null,
      nextLineIndex: lineIndex,
      incompleteTail: lineIndex >= lines.length,
    };
  }

  if (lineIndex >= lines.length && !eofTerminatesBlock) {
    return {
      table: null,
      nextLineIndex: lineIndex,
      incompleteTail: true,
    };
  }

  const lastRowLine = lines[lineIndex - 1];
  const table = {
    source: text.slice(headerLine.start, lastRowLine.end),
    header: headerCells,
    rows,
    alignments,
    start: headerLine.start,
    end: lastRowLine.end,
    columnCount: headerCells.length,
  } satisfies ParsedMarkdownTable;

  return {
    table,
    nextLineIndex: lineIndex,
    incompleteTail: false,
  };
}

function scanMarkdownTables(
  text: string,
  eofTerminatesBlock: boolean,
): {
  tables: ParsedMarkdownTable[];
  incompleteTail: boolean;
} {
  const lines = getLineInfo(text);
  const tables: ParsedMarkdownTable[] = [];

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const result = tryParseMarkdownTableAt(text, lines, lineIndex, eofTerminatesBlock);
    if (result.table) {
      tables.push(result.table);
      lineIndex = result.nextLineIndex;
      continue;
    }

    if (result.incompleteTail) {
      return {
        tables,
        incompleteTail: true,
      };
    }

    lineIndex++;
  }

  return {
    tables,
    incompleteTail: false,
  };
}

export function extractMarkdownTableSegments(text: string): MarkdownTableSegment[] {
  const { tables } = scanMarkdownTables(text, true);
  if (tables.length === 0) {
    return [{ type: "text", content: text }];
  }

  const segments: MarkdownTableSegment[] = [];
  let cursor = 0;

  for (const table of tables) {
    if (table.start > cursor) {
      segments.push({
        type: "text",
        content: text.slice(cursor, table.start),
      });
    }

    segments.push({
      type: "table",
      content: table.source,
      table,
    });

    cursor = table.end;
  }

  if (cursor < text.length) {
    segments.push({
      type: "text",
      content: text.slice(cursor),
    });
  }

  return segments;
}

export function hasTrailingIncompleteMarkdownTable(text: string): boolean {
  return scanMarkdownTables(text, false).incompleteTail;
}

/**
 * Finds the markdown table block that the given offset falls strictly inside.
 *
 * Used by the stream buffer to keep a table atomic: any cut landing between a table's
 * first and last character would split it into two segments, and only the fragment that
 * still parses as a table gets rendered; the rest leaks out as raw pipe-delimited text.
 *
 * EOF is treated as terminating a block here (unlike {@link hasTrailingIncompleteMarkdownTable})
 * so a table that is still streaming is protected from a cut just as much as a finished one.
 *
 * @param index - Absolute offset a caller intends to cut at
 * @returns The enclosing table's `[start, end)` range, or null when the offset is at a
 *   block boundary or outside every table
 */
export function findMarkdownTableBlockAt(text: string, index: number): { start: number; end: number } | null {
  const { tables } = scanMarkdownTables(text, true);

  for (const table of tables) {
    // Boundaries are safe cut points: only offsets strictly interior split a table.
    if (index > table.start && index < table.end) {
      return { start: table.start, end: table.end };
    }
  }

  return null;
}

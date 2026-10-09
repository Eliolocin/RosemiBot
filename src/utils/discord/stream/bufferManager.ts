import { HumanizerDegree } from "@/types/db/schema";
import type { StreamConfig } from "@/types/stream/interfaces";
import { type ChunkProcessingResult, DISCORD_STREAMING_CONSTANTS, type StreamState } from "@/types/stream/types";
import { log } from "@/utils/misc/logger";
import {
  classifyEmphasisMarkerRun,
  createSentenceSplitRegex,
  type EmphasisMarker,
  maskInlineCodeAndUrls,
  PAIRED_QUOTE_MARKS,
} from "@/utils/text/processors/chunkProcessor";
import {
  extractMarkdownTableSegments,
  findMarkdownTableBlockAt,
  hasTrailingIncompleteMarkdownTable,
} from "@/utils/text/markdownTable";
import {
  endsWithReasoningTagPrefix,
  findReasoningTagClose,
  findReasoningTagOpen,
} from "@/providers/utils/reasoningTags";

function shouldDelayTrailingPeriodFlush(buffer: string, periodMatch: RegExpExecArray): boolean {
  const periodEndIndex = periodMatch.index + periodMatch[0].length;
  return periodMatch[0] === "." && periodEndIndex === buffer.length;
}

/**
 * Moves a flush offset out of any markdown table it lands inside.
 *
 * Table rows end in newlines, so every sentence/whitespace heuristic happily treats a row
 * boundary as a safe break; but cutting there splits the block, and only the fragment that
 * still parses as a table reaches the PNG renderer. The rest is delivered as raw pipes.
 *
 * Cutting *before* the table is preferred: it keeps the whole table together for the next
 * flush. When the table starts at offset 0 there is no prose to flush ahead of it, so the
 * cut moves past the table's end instead, and 0 is returned when even that is unavailable
 * (the caller treats 0 as "no safe cut, hold the buffer").
 *
 */
function snapFlushIndexOutOfMarkdownTable(buffer: string, index: number): number {
  const enclosingTable = findMarkdownTableBlockAt(buffer, index);
  if (!enclosingTable) return index;

  if (enclosingTable.start > 0) {
    log.info(`Stream Seg: Moved overflow cut from ${index} back to ${enclosingTable.start} to keep a table intact`);
    return enclosingTable.start;
  }

  if (enclosingTable.end < buffer.length) {
    log.info(`Stream Seg: Moved overflow cut from ${index} forward to ${enclosingTable.end} to keep a table intact`);
    return enclosingTable.end;
  }

  log.info("Stream Seg: Holding oversized buffer — the only safe cut would split a markdown table");
  return 0;
}

export function findRegularOverflowFlushIndex(buffer: string, targetLength: number): number {
  if (!buffer) return 0;

  const target = Math.min(Math.max(1, targetLength), buffer.length);
  const backwardWindowStart = Math.max(0, target - 300);
  const forwardWindowEnd = Math.min(buffer.length, target + 200);

  const isSentenceBoundary = (index: number): boolean => {
    const ch = buffer[index];
    if (!ch) return false;

    if (ch === "\n") return true;
    // Full-width terminators need no following whitespace because CJK prose has no spaces.
    if (/[。！？．｡]/.test(ch)) return true;
    if (!/[.!?]/.test(ch)) return false;

    const nextChar = buffer[index + 1];
    return nextChar === undefined || /\s/.test(nextChar);
  };

  for (let i = target; i < forwardWindowEnd; i++) {
    if (isSentenceBoundary(i)) return snapFlushIndexOutOfMarkdownTable(buffer, i + 1);
  }

  for (let i = target - 1; i >= backwardWindowStart; i--) {
    if (isSentenceBoundary(i)) return snapFlushIndexOutOfMarkdownTable(buffer, i + 1);
  }

  for (let i = target - 1; i >= backwardWindowStart; i--) {
    if (/\s/.test(buffer[i])) return snapFlushIndexOutOfMarkdownTable(buffer, i + 1);
  }
  for (let i = target; i < forwardWindowEnd; i++) {
    if (/\s/.test(buffer[i])) return snapFlushIndexOutOfMarkdownTable(buffer, i + 1);
  }

  return snapFlushIndexOutOfMarkdownTable(buffer, target);
}

export function drainThinkBlocksFromBuffer(state: StreamState): void {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (state.isInsideThinkBlock) {
      if (state.buffer.length > 0) {
        state.thinkBlockBuffer += state.buffer;
        state.buffer = "";
      }

      const closeMatch = findReasoningTagClose(state.thinkBlockBuffer);
      if (!closeMatch) {
        break;
      }

      const thinkContent = state.thinkBlockBuffer.slice(0, closeMatch.index).trim();
      if (thinkContent) {
        state.thoughtRawSegments.push(thinkContent);
        log.info(`Stream: Captured ${thinkContent.length} chars of think block content for thought log`);
      }

      const afterClose = state.thinkBlockBuffer.slice(closeMatch.index + closeMatch.length);
      state.thinkBlockBuffer = "";
      state.isInsideThinkBlock = false;
      state.buffer += afterClose;
    } else {
      const openMatch = findReasoningTagOpen(state.buffer);
      const closeMatch = findReasoningTagClose(state.buffer);
      const openIdx = openMatch?.index ?? -1;
      const closeIdx = closeMatch?.index ?? -1;

      if (closeMatch && closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
        const thinkContent = state.buffer.slice(0, closeIdx).trim();
        if (thinkContent) {
          state.thoughtRawSegments.push(thinkContent);
          log.info(`Stream: Captured ${thinkContent.length} chars before stray </think> for thought log`);
        }

        state.buffer = state.buffer.slice(closeMatch.index + closeMatch.length);
        continue;
      }

      if (!openMatch || openIdx === -1) {
        break;
      }

      state.thinkBlockBuffer = state.buffer.slice(openMatch.index + openMatch.length);
      state.buffer = state.buffer.slice(0, openIdx);
      state.isInsideThinkBlock = true;
    }
  }
}

export function stripSummaryTag(content: string): string {
  return content.replace(/<summary>[\s\S]*?<\/summary>/i, "").trim();
}

export function drainDetailsBlocksFromBuffer(state: StreamState): void {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (state.isInsideDetailsBlock) {
      if (state.buffer.length > 0) {
        state.detailsBlockBuffer += state.buffer;
        state.buffer = "";
      }

      const closeIdx = state.detailsBlockBuffer.indexOf("</details>");
      if (closeIdx === -1) {
        break;
      }

      let detailsContent = state.detailsBlockBuffer.slice(0, closeIdx).trim();
      if (detailsContent) {
        detailsContent = stripSummaryTag(detailsContent);
        if (detailsContent) {
          state.detailsSegments.push(detailsContent);
          log.info(`Stream: Captured ${detailsContent.length} chars of details block content for STM`);
        }
      }

      const afterClose = state.detailsBlockBuffer.slice(closeIdx + "</details>".length);
      state.detailsBlockBuffer = "";
      state.isInsideDetailsBlock = false;
      state.buffer += afterClose;
    } else {
      const openMatch = state.buffer.match(/<details(?:\s[^>]*)?>/);
      if (!openMatch || openMatch.index === undefined) {
        break;
      }

      const openIdx = openMatch.index;
      const fullTag = openMatch[0];
      state.detailsBlockBuffer = state.buffer.slice(openIdx + fullTag.length);
      state.buffer = state.buffer.slice(0, openIdx);
      state.isInsideDetailsBlock = true;
    }
  }
}

// Markers the hold counts. "_" is deliberately absent: in chat prose it is far more often an
// identifier or a kaomoji character ("_id", "user_id", "-_-", "^_^") than emphasis, and a false hold
// stops streaming for the rest of the response, while a missed "_span_" only loses protection the
// hold never provided. The chunker still recognizes "_" spans in the text it receives whole.
const HOLD_EMPHASIS_MARKERS: readonly EmphasisMarker[] = ["*", "~"];

/**
 * Counts the marker characters of `marker` that are still open.
 *
 * Runs are classified by the flanking rules a renderer applies (see
 * {@link classifyEmphasisMarkerRun}), so prose full of stray markers ("2 * 3", a `* ` bullet,
 * "Best*") never holds the buffer, and each run is weighted by its length so a nested
 * "**bold *italic***" closes both levels instead of stranding the outer run. Depth clamps at zero in
 * step with the parenthesis count, so an orphan closer cannot cancel a genuinely open marker.
 *
 * The ceiling: a false positive defers this response's remaining flushes to the final flush
 * (longer messages, no loss), where a false negative splits the span across two messages.
 */
function countOpenEmphasisMarkers(buffer: string, marker: EmphasisMarker): number {
  let depth = 0;

  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] !== marker) continue;

    const runStart = index;
    while (index + 1 < buffer.length && buffer[index + 1] === marker) index++;
    const runLength = index - runStart + 1;
    const { opens, closes } = classifyEmphasisMarkerRun(buffer, runStart, index + 1, marker);

    if (closes && depth > 0) depth = Math.max(0, depth - runLength);
    else if (opens) depth += runLength;
  }

  return depth;
}

export function hasIncompleteSemanticMarkers(buffer: string): boolean {
  // Only an unmatched OPENER is worth holding for: text is ordered, so a ")" that already passed
  // can never be matched by a "(" that follows. Counting it would both stall forever (the buffer
  // only grows, so a net-negative depth never returns to zero and every later flush defers to the
  // final one) and let an emoticon cancel a genuinely open parenthetical, splitting mid-aside.
  // Emoticons are the common source: "B)", ":)", ">:)".
  let unclosedOpeners = 0;
  for (const char of buffer) {
    if (char === "(") unclosedOpeners++;
    else if (char === ")" && unclosedOpeners > 0) unclosedOpeners--;
  }
  if (unclosedOpeners > 0) {
    log.info(`Stream: Buffer has unclosed parentheses (open: ${unclosedOpeners})`);
    return true;
  }

  const regularQuoteCount = (buffer.match(/"/g) || []).length;
  if (regularQuoteCount % 2 !== 0) {
    log.info("Stream: Buffer has unclosed quotes");
    return true;
  }

  const spoilerScanSegments = extractMarkdownTableSegments(buffer);
  const spoilerProseText = spoilerScanSegments
    .filter((seg) => seg.type === "text")
    .map((seg) => seg.content)
    .join("");
  const spoilerScanText = maskInlineCodeAndUrls(spoilerProseText);
  const spoilerMarkerCount = (spoilerScanText.match(/\|\|/g) || []).length;
  if (spoilerMarkerCount % 2 !== 0) {
    log.info("Stream: Buffer has unclosed spoiler tags");
    return true;
  }

  // Only surplus openers hold the buffer, for the same never-closing stall described above.
  const unclosedQuotePair = PAIRED_QUOTE_MARKS.find(
    ([open, close]) => buffer.split(open).length > buffer.split(close).length,
  );
  if (unclosedQuotePair) {
    log.info(`Stream: Buffer has an unclosed ${unclosedQuotePair[0]} quote`);
    return true;
  }

  // An unclosed emphasis run is the same hazard as an unclosed quote: the newline and period breaks
  // in processBufferContent would cut inside "*...and more*", and chunkMessage() can only protect a
  // span it receives whole. Inline code and URLs are blanked first, because a `*args` argument list
  // and a /_next/ path segment are not emphasis. The final auto-close pass already repairs these
  // markers, so a hold here can never outlive the response.
  const emphasisScanText = maskInlineCodeAndUrls(buffer);
  for (const marker of HOLD_EMPHASIS_MARKERS) {
    const openMarkers = countOpenEmphasisMarkers(emphasisScanText, marker);
    if (openMarkers > 0) {
      log.info(`Stream: Buffer has ${openMarkers} unclosed "${marker}" emphasis marker(s)`);
      return true;
    }
  }

  const openBrackets = (buffer.match(/\[/g) || []).length;
  const closeBrackets = (buffer.match(/\]/g) || []).length;
  const openParens = (buffer.match(/\(/g) || []).length;
  const closeParens = (buffer.match(/\)/g) || []).length;

  if (openBrackets > closeBrackets || openParens > closeParens) {
    if (buffer.includes("[") && (buffer.includes("](") || buffer.endsWith("]("))) {
      log.info("Stream: Buffer might contain incomplete markdown link");
      return true;
    }
  }

  if (buffer.match(/https?:$|https?:\/$|https?:\/\/$/)) {
    log.info("Stream: Buffer ends with incomplete URL protocol");
    return true;
  }

  if (hasTrailingIncompleteMarkdownTable(buffer)) {
    log.info("Stream: Buffer ends with an incomplete markdown table");
    return true;
  }

  // Hold the buffer when it ends mid think tag (incl. namespaced variants like
  // `<mm:think>`) so a split marker is not flushed as visible text.
  if (endsWithReasoningTagPrefix(buffer)) {
    log.info("Stream: Buffer ends with partial think tag prefix");
    return true;
  }

  if (/<details(?:\s[^>]*)?$/.test(buffer)) {
    log.info("Stream: Buffer ends with partial or unclosed <details> tag");
    return true;
  }

  const DETAILS_PREFIX = "<details";
  for (let len = DETAILS_PREFIX.length - 1; len >= 1; len--) {
    if (buffer.endsWith(DETAILS_PREFIX.slice(0, len))) {
      log.info("Stream: Buffer ends with partial <details> tag prefix");
      return true;
    }
  }

  return false;
}

/**
 * Appends closing markers for every unbalanced inline-markdown marker in the text.
 *
 * Splitting this out of {@link autoCloseIncompleteMarkers} lets the public function run the
 * repair over prose only, so a table's cell contents never influence the counts and the
 * closers never land on a table row.
 *
 */
function appendUnbalancedMarkerClosers(buffer: string): string {
  let fixedBuffer = buffer;
  const fixes: string[] = [];

  let unclosedOpeners = 0;
  for (const char of fixedBuffer) {
    if (char === "(") unclosedOpeners++;
    else if (char === ")" && unclosedOpeners > 0) unclosedOpeners--;
  }
  if (unclosedOpeners > 0) {
    fixedBuffer += ")".repeat(unclosedOpeners);
    fixes.push(`${unclosedOpeners} closing parentheses`);
  }

  const regularQuoteCount = (fixedBuffer.match(/"/g) || []).length;
  if (regularQuoteCount % 2 !== 0) {
    fixedBuffer += '"';
    fixes.push("closing quote");
  }

  for (const [open, close] of PAIRED_QUOTE_MARKS) {
    const missingCount = fixedBuffer.split(open).length - fixedBuffer.split(close).length;
    if (missingCount > 0) {
      fixedBuffer += close.repeat(missingCount);
      fixes.push(`${missingCount} closing ${close} quote(s)`);
    }
  }

  const doubleStar = (fixedBuffer.match(/\*\*/g) || []).length;
  if (doubleStar % 2 !== 0) {
    fixedBuffer += "**";
    fixes.push("markdown bold (**)");
  }

  const doubleUnderscore = (fixedBuffer.match(/__/g) || []).length;
  if (doubleUnderscore % 2 !== 0) {
    fixedBuffer += "__";
    fixes.push("markdown bold (__)");
  }

  const singleStars = (fixedBuffer.match(/(?<!\*)\*(?!\*)/g) || []).length;
  if (singleStars % 2 !== 0) {
    fixedBuffer += "*";
    fixes.push("markdown italic (*)");
  }

  const singleUnderscores = (fixedBuffer.match(/(?<!_)_(?!_)/g) || []).length;
  if (singleUnderscores % 2 !== 0) {
    fixedBuffer += "_";
    fixes.push("markdown italic (_)");
  }

  const doubleTilde = (fixedBuffer.match(/~~/g) || []).length;
  if (doubleTilde % 2 !== 0) {
    fixedBuffer += "~~";
    fixes.push("markdown strikethrough (~~)");
  }

  const spoilerScanText = maskInlineCodeAndUrls(fixedBuffer);
  const spoilerPipes = (spoilerScanText.match(/\|\|/g) || []).length;
  if (spoilerPipes % 2 !== 0) {
    fixedBuffer += "||";
    fixes.push("discord spoiler (||)");
  }

  if (fixedBuffer.match(/\[[^\]]+\]\([^)]*$/)) {
    fixedBuffer += ")";
    fixes.push("markdown link closing parenthesis");
  } else if (fixedBuffer.match(/\[[^\]]*$/)) {
    fixedBuffer += "](#)";
    fixes.push("markdown link closing bracket and empty URL");
  }

  if (fixes.length > 0) {
    log.info(`Stream Auto-Close: Applied fixes - ${fixes.join(", ")} (${buffer.length} buffer chars)`);
  }

  return fixedBuffer;
}

export function autoCloseIncompleteMarkers(buffer: string): string {
  const segments = extractMarkdownTableSegments(buffer);
  if (!segments.some((segment) => segment.type === "table")) {
    return appendUnbalancedMarkerClosers(buffer);
  }

  // Count markers across prose only. A table's cells routinely hold characters that are
  //    not unclosed inline markdown at all (`user_id`, a `Best*` footnote, `(approx` (and
  //    a table at the end of a response ALWAYS reaches this repair, because EOF never
  //    terminates a table block (more rows could still stream in).
  const proseOnly = segments
    .filter((segment) => segment.type === "text")
    .map((segment) => segment.content)
    .join("");
  const closers = appendUnbalancedMarkerClosers(proseOnly).slice(proseOnly.length);
  if (!closers) return buffer;

  // Land the closers on the last prose segment rather than the buffer's end. Appending
  //    after the final row changes that row's cell count, so the renderer stops recognizing
  //    it as a body row and drops it from the image, so the dropped row then leaks out as raw
  //    pipe-delimited text underneath the rendered table.
  //    Only a segment with real prose in it can host them: a text segment sitting between two
  //    tables is often just the newline separating them, and closers placed there would land
  //    on the NEXT table's header line and break that table instead.
  let lastProseIndex = -1;
  for (let index = segments.length - 1; index >= 0; index--) {
    if (segments[index].type === "text" && segments[index].content.trim()) {
      lastProseIndex = index;
      break;
    }
  }

  if (lastProseIndex === -1) {
    log.info("Stream Auto-Close: Buffer is a bare markdown table, skipping marker repair to keep it renderable");
    return buffer;
  }

  // Insert ahead of the segment's trailing whitespace. That whitespace is the newline
  //    separating prose from the table below it, so appending after it would push the closers
  //    onto the table's first line.
  const proseSegment = segments[lastProseIndex].content;
  const proseCore = proseSegment.replace(/\s+$/u, "");
  const proseTrailingWhitespace = proseSegment.slice(proseCore.length);

  segments[lastProseIndex] = {
    type: "text",
    content: `${proseCore}${closers}${proseTrailingWhitespace}`,
  };

  return segments.map((segment) => segment.content).join("");
}

export function processBufferContent(state: StreamState, config: StreamConfig): ChunkProcessingResult {
  if (state.isInsideThinkBlock || state.isInsideDetailsBlock) {
    return {
      shouldFlush: false,
      updatedBuffer: state.buffer,
      newCodeBlockState: undefined,
    };
  }

  if (state.isInsideCodeBlock) {
    const closingBackticksIndex = state.buffer.indexOf("```", 3);

    if (closingBackticksIndex !== -1) {
      return {
        shouldFlush: true,
        segmentToFlush: state.buffer.substring(0, closingBackticksIndex + 3),
        updatedBuffer: state.buffer.substring(closingBackticksIndex + 3),
        newCodeBlockState: false,
        breakType: "code_close",
      };
    }

    if (state.buffer.length >= DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_CODE_BLOCK) {
      return {
        shouldFlush: true,
        segmentToFlush: state.buffer,
        updatedBuffer: "",
        newCodeBlockState: false,
        breakType: "overflow",
      };
    }

    return {
      shouldFlush: false,
      updatedBuffer: state.buffer,
      newCodeBlockState: true,
    };
  }

  const openingBackticksIndex = state.buffer.indexOf("```");
  const newlineIndex = state.buffer.indexOf("\n");
  state.hasSemanticMarkers = hasIncompleteSemanticMarkers(state.buffer);

  let periodEndIndex = -1;
  if (config.humanizerDegree === HumanizerDegree.HEAVY) {
    const sentenceRegex = createSentenceSplitRegex();
    const periodMatch = sentenceRegex.exec(state.buffer);
    if (periodMatch && !shouldDelayTrailingPeriodFlush(state.buffer, periodMatch)) {
      periodEndIndex = periodMatch.index + periodMatch[0].length;
    }
  }

  let earliestBreakIndex = -1;
  let breakType: ChunkProcessingResult["breakType"];

  if (openingBackticksIndex !== -1) {
    earliestBreakIndex = openingBackticksIndex;
    breakType = "code_open";
  }
  if (newlineIndex !== -1 && (earliestBreakIndex === -1 || newlineIndex < earliestBreakIndex)) {
    earliestBreakIndex = newlineIndex;
    breakType = "newline";
  }
  if (periodEndIndex !== -1 && (earliestBreakIndex === -1 || periodEndIndex < earliestBreakIndex)) {
    earliestBreakIndex = periodEndIndex;
    breakType = "period";
  }

  if (earliestBreakIndex === -1) {
    return {
      shouldFlush: false,
      updatedBuffer: state.buffer,
      newCodeBlockState: undefined,
    };
  }

  if (breakType === "code_open") {
    if (earliestBreakIndex > 0) {
      return {
        shouldFlush: true,
        segmentToFlush: state.buffer.substring(0, earliestBreakIndex),
        updatedBuffer: state.buffer.substring(earliestBreakIndex),
        newCodeBlockState: false,
        breakType,
      };
    }

    const closingInSegment = state.buffer.indexOf("```", 3);
    if (closingInSegment !== -1) {
      return {
        shouldFlush: true,
        segmentToFlush: state.buffer.substring(0, closingInSegment + 3),
        updatedBuffer: state.buffer.substring(closingInSegment + 3),
        newCodeBlockState: false,
        breakType: "code_close",
      };
    }

    return {
      shouldFlush: false,
      updatedBuffer: state.buffer,
      newCodeBlockState: true,
    };
  }

  if (breakType === "newline" && !state.hasSemanticMarkers) {
    const nextCharIndex = earliestBreakIndex + 1;
    if (nextCharIndex >= state.buffer.length) {
      return {
        shouldFlush: false,
        updatedBuffer: state.buffer,
        newCodeBlockState: false,
      };
    }

    let flushEndIndex = nextCharIndex;
    const punctuationCarry = state.buffer.substring(nextCharIndex).match(/^\s*(?!\.{2,})[.,!?;。！？、，]+/);
    if (punctuationCarry) {
      flushEndIndex += punctuationCarry[0].length;
    }

    const segmentToFlush = state.buffer.substring(0, flushEndIndex);
    if (!hasIncompleteSemanticMarkers(segmentToFlush)) {
      return {
        shouldFlush: true,
        segmentToFlush,
        updatedBuffer: state.buffer.substring(flushEndIndex),
        newCodeBlockState: false,
        breakType,
      };
    }
  } else if (breakType === "period" && !state.hasSemanticMarkers) {
    const segmentToFlush = state.buffer.substring(0, periodEndIndex);
    if (!hasIncompleteSemanticMarkers(segmentToFlush)) {
      return {
        shouldFlush: true,
        segmentToFlush,
        updatedBuffer: state.buffer.substring(periodEndIndex),
        newCodeBlockState: false,
        breakType,
      };
    }
  }

  return {
    shouldFlush: false,
    updatedBuffer: state.buffer,
    newCodeBlockState: undefined,
  };
}

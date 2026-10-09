---
title: "05: Buffer Management"
---

Buffer management accumulates streamed text into semantic buffers and flushes discrete segments to
[stage 06](/architecture/pipelines/provider/06-segment-normalization/) when delivery boundaries are
detected. It prevents broken markdown formatting across message splits and isolates private thinking blocks.

## Flow and ownership

The stage 04 orchestrator calls `StreamBufferFlusher.processTextChunk()` for every normalized chunk of
type `"text"`. Buffering and boundary detection proceed in four steps:

1. **Chunk deduplication:** `deduplicateIncomingTextChunk()` inspects incoming text against recent
   accumulated output. Overlapping characters re-emitted across provider chunk boundaries are trimmed.
2. **Model replay history:** Non-empty text deltas append to `context.currentTurnModelParts` so the
   adapter can replay partial assistant output when reconstructing function interaction history.
3. **Semantic block routing:** Incoming text routes to `state.thinkBlockBuffer` while inside
   `<think>` tags, to `state.detailsBlockBuffer` while inside `<details>` tags, or to the main
   `state.buffer`. Drained thinking content collects in `state.thoughtRawSegments` for thought logs,
   while details blocks collect in `state.detailsSegments` for short-term memory.
4. **Boundary flushing:** `processStreamBufferContent()` evaluates `state.buffer` in a loop, detecting
   flush boundaries (code block transitions, newlines, and sentence endings) and forwarding segments to
   `StreamSegmentProcessor.sendBufferSegment()`.

## Flush types

Beyond the per-chunk evaluation loop, three flush paths handle specific lifecycle events:

- **Final flush (`flushFinalBuffer`):** Invoked when the generator finishes. Sends remaining buffer
  text, auto-closes unclosed inline markers via `autoCloseStreamBufferMarkers()`, drains unterminated
  think or details blocks, flushes held orphan punctuation, and executes aggregated-mode batch sends.
- **Pending flush (`flushPendingBuffer`):** Invoked on tool calls or user stops. Flushes the buffer
  up to a clean boundary. When called before tool calls, trailing incomplete clauses are trimmed to
  prevent partial narration from reaching Discord.
- **Overflow flush:** When `state.buffer` exceeds `FLUSH_BUFFER_SIZE_REGULAR` (1,000 characters) or
  `FLUSH_BUFFER_SIZE_CODE_BLOCK` (15,000 characters) without hitting a normal boundary,
  `findRegularOverflowFlushIndex()` locates a safe sentence or word break to flush segments down to size.

## Marker balance and holds

To prevent messages from splitting inside styled text spans, `hasIncompleteSemanticMarkers()` defers
flushes when unbalanced markers are detected:

- **Parentheses:** Counts unclosed opening parentheses. The count clamps at zero so orphan closers
  (such as emoticons `:)` or `B)`) cannot stall stream splitting.
- **Quotes and brackets:** Balances straight quotes and paired brackets from `PAIRED_QUOTE_MARKS`.
- **Spoilers:** Holds on odd counts of `||` markers in prose to keep multi-line spoilers together.
- **Emphasis:** Tracks open `*` and `~~` runs using renderer flanking rules. Underscores are excluded
  from stream holds because they appear frequently in identifiers and kaomoji.
- **Partial tags:** Holds the buffer when it ends with a prefix of `<think>` or `<details>`.

## Markdown table atomicity
<!-- anchor: markdown-table-atomicity -->

Markdown tables must arrive at stage 06 as intact blocks; partial tables fail parsing and deliver as
raw pipe characters rather than rendered PNG graphics:

- **Overflow snapping:** `findRegularOverflowFlushIndex()` passes candidate indices to
  `snapFlushIndexOutOfMarkdownTable()`. If an index lands inside a table, it moves before the table
  starts or after it ends. If no safe cut exists, the function returns 0 and holds the buffer for the
  final flush.
- **Scoped marker auto-close:** `autoCloseStreamBufferMarkers()` counts unbalanced markers over prose
  only. Closers land at the end of the last prose segment rather than on table rows, preventing cell
  count alterations that break table rendering.

## Source pointers

- `src/utils/discord/stream/bufferFlusher.ts`: `StreamBufferFlusher` implementation.
- `src/utils/discord/stream/bufferManager.ts`: boundary detection, marker balance checks, and overflow indexing.
- `src/utils/text/markdownTable.ts`: table boundary detection and block parsing.
- `src/types/stream/types.ts`: `StreamState` and buffer threshold constants.

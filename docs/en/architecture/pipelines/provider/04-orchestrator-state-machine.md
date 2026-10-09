---
title: "04: Orchestrator State Machine"
---

The orchestrator state machine drives the provider generator loop, routes normalized chunks to downstream
stages, resolves stop and interrupt signals, and compiles the terminal `StreamResult`.

## Flow and ownership

`StreamOrchestrator.streamToDiscord()` is the universal coordinator for Discord streaming. It wraps
the private `executeStream()` method, which instantiates fresh `StreamMetrics`, `StreamState`, and
delivery configurations before consuming the generator yielded by
[stage 02](/architecture/pipelines/provider/02-raw-chunk-generation/).

The state machine runs through a `for await` loop over the raw chunk generator:

```
Stream generator
       |
       v
Check stop registry (pre-chunk)
       |
       +---> Stop / Interrupt detected? ---> Return stop result
       |
Reset caller watchdog (onStreamProgress)
       |
Normalize chunk (stage 03 processChunk)
       |
Route chunk by type:
  - "text"          -> stage 05 processTextChunk
  - "function_call" -> flush pending buffer -> return { status: "function_call" }
  - "error"         -> flush pending buffer -> show error embed -> return { status: "error" }
  - "done"          -> record terminal metadata; continue loop
       |
Check stop registry (post-write)
       |
Loop exhausted?
       |
       v
completeStreamAfterProviderEnd()
       |  (flushFinalBuffer, clear internal stops, assemble StreamResult)
       v
Check wasEmptyStreamResponse()
       |
       +---> Empty? ---> return { status: "empty_response" }
       +---> Output? -> return { status: "completed" }
```

## Stop and interrupt resolution

The orchestrator inspects the stop registry (`src/utils/discord/stream/stopRequests.ts`) before
processing each chunk and again immediately after delivery writes. The post-write check resolves
delivery caps (such as message limits) without awaiting another token from the provider.

Stop handling distinguishes these cases:

- **Follow-up interrupts:** When a user sends a new message while generation is in flight, the
  orchestrator clears the stop request, discards the buffer, and exits immediately with
  `{ status: "follow_up_interrupt" }`. This lets the chat pipeline start the next turn without delay.
- **Graceful user stops:** Ordinary streaming flushes pending buffered text and exits with
  `{ status: "stopped_by_user" }`. Held response text is discarded. `/kill` additionally aborts the transport and
  rejects the [stream race](/architecture/pipelines/tool-loop/01-stream-once/), which can bypass this flush.
- **Internal delivery stops:** Stops triggered by delivery caps (`send_message_limit`, `flush_limit`,
  `speaker_guard`, `channel_deleted`, `missing_access`, `pending_response_limit`) skip the pending
  buffer flush. Flushing into
  an inaccessible or rate-limited destination would trigger redundant rejected Discord requests and
  risk re-registering stops that leak into subsequent turns. A speaker-guard stop can still flush
  already-accepted aggregated text; it discards the unsafe remainder.
- **Silent speaker-guard stops:** When a speaker guard stops generation before any visible text is
  sent, the orchestrator returns `{ status: "empty_response" }` so retry logic can reschedule the turn.

## Chunk routing and token usage

The orchestrator routes normalized chunks based on `ProcessedChunk.type`:

- **Text:** Sent to [stage 05](/architecture/pipelines/provider/05-buffer-management/)
  (`StreamBufferFlusher.processTextChunk()`) for semantic buffering and boundary detection.
- **Tool calls:** Triggers a pending buffer flush before returning `{ status: "function_call" }`.
  The tool loop executes the tool and starts a subsequent generation turn with the tool result.
- **Errors:** Flushes pending buffer text and displays a Discord error embed via `StreamErrorUi`
  (unless suppressed by retries or user impersonation), returning `{ status: "error" }`.
- **Done metadata:** Captures terminal completion data such as `finishReason`.
- **Token usage:** Captured from `metadata.usage` on any chunk (latest non-null wins). This handles
  providers that report usage on trailing empty chunks or override terminal metadata. Terminal results
  retain reported usage, including errors, stops and empty replies.

## Stream completion

When the generator finishes normally, `completeStreamAfterProviderEnd()` invokes `flushFinalBuffer()`,
clears internal stop requests, and constructs the completed `StreamResult`.

The outer `streamToDiscord()` wrapper inspects the completed result. If `wasEmptyStreamResponse()`
detects that no visible text and no tool call were delivered, it returns `{ status: "empty_response" }`
instead of `"completed"`, allowing upstream fallback and retry logic to trigger.

## Held response presentation

Response Drafting sets `holdResponseText` to collect normalized prose and its presentation segments
without sending messages or recording delivery receipts. Unlike `suppressTextOutput`, collection
still runs ordinary formatting, reasoning removal, emoji processing and speaker guards.

Completed and function-call results expose `pendingResponse.text` and a single-use `deliver(signal)`
closure. Approval replays the saved segments through ordinary delivery with webhook identity and
Discord limits intact. Only accepted sends create accumulated text and receipts. Cancellation never
flushes held prose. A speaker guard can complete a valid collected prefix for review; an empty prefix
retains ordinary empty-response handling.

Collection is bounded before text is retained, because a reviewer limit checked afterwards cannot
stop a runaway provider. One turn holds at most `MAX_PENDING_RESPONSE_BYTES` (64 KiB, below the
reviewer's 96,000-byte packet) and `MAX_PENDING_RESPONSE_SEGMENTS` across all tool-loop passes; the
tool loop passes the remaining room as `pendingResponseLimit`. Each pass also stops at the length one
replay could send (`send_message_limit`, or the flush cap times the message length), and a buffer that
can never flush, such as an unterminated table or fence, is cut once it exceeds the byte room. The cut
lands on a code-point boundary, records `pendingResponse.truncation`, and raises the internal
`pending_response_limit` stop, which completes with the kept prefix like a speaker guard. A truncated
result never becomes `empty_response`, because rescheduling would regenerate the same oversized output.

## Source pointers

- `src/utils/discord/stream/stateMachine.ts`: `StreamOrchestrator.executeStream` and loop routing.
- `src/types/provider/interfaces.ts`: `StreamResult` definition.
- `src/utils/discord/stream/stopRequests.ts`: channel stop registry.
- `src/utils/discord/stream/thoughtLog.ts`: `wasEmptyStreamResponse` evaluation.

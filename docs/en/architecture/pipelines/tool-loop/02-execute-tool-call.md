---
title: "02: Execute Tool Call"
---

`executeToolCall` validates, gates, and dispatches a single tool call from the provider. It returns a
discriminated outcome indicating whether to restart the turn with enriched context, abort execution,
or record a history entry and continue the tool chain.

## Gating and dispatch flow
<!-- anchor: gating-and-dispatch-flow -->

When the provider emits `function_call`, the stage processes the call through an ordered
sequence of validation and safety gates before invoking the registry:

1. **Payload validation:**
   The stage verifies that `streamResult.data` contains a valid tool name. If the payload is missing
   or lacks a name, it logs an error and returns `{ kind: "abort", status: "error" }`.

2. **Stop request check:**
   The stage inspects `StreamOrchestrator` for pending stop requests. If a user issued `/kill`, it
   returns `{ kind: "abort", status: "stopped_by_user" }`. With Response Drafting On, a follow-up
   interrupts review and prevents further dispatch. Off clears that flag and continues the tool chain;
   the follow-up message remains queued.

3. **Truncated arguments refusal:**
   Adapter-flagged truncated arguments are refused before dispatch. Partial keys could delete stored
   state in replacement-style tools. A synthetic failure history entry allows a complete retry.

4. **Deliberate tool mode allowlist gate:**
   Deliberate mode blocks names outside the trigger-admitted allowlist and returns a synthetic failure
   directly to the model.

5. **Registry execution under watchdog:**
   The stage marks the channel's active tool name via `setChannelActiveToolName` and runs
   `ToolRegistry.executeTool` under `runUnderWatchdog`. Dispatch races against a per-tool timeout
   (`TOOL_EXECUTION_TIMEOUT_MS`, default 300 s) and the turn-level kill signal (`turnAbortSignal`).
   A plain timeout yields `{ success: false }`, allowing the model to handle the failure; a kill
   signal returns `{ kind: "abort", status: "stopped_by_user" }`. The active tool name is cleared
   in the `finally` block when the race settles. Tools that do not honor abort can continue their
   external work after the caller stops awaiting them. A timeout does not roll back their effects.

## Actual request review

Response Drafting On calls `ToolRegistry.prepareToolRequest` after admission checks. It resolves
aliases, message identities and MCP defaults before the private reviewer sees the detached request
that execution will receive. Built-in availability and permission checks precede paid review;
dispatch retains its own checks.

Pass dispatches that request once. Rejection returns `review_rejected` history with
`actionExecuted: false`, correction eligibility and concise findings. It adds no failed-tool notice
or execution statistic. Exact rejected identities remain blocked; each normalized name permits one
changed correction, with two corrections and eight detailed tool reviews across the logical turn.
These limits remain separate from response review and survive fallback.

Successful identical requests reuse recorded outcomes, including after a response revision.
Unavailability ends review for the turn but preserves prior rejections. New independent requests
after exhaustion use ordinary tool rules. Cancellation is checked after review and asynchronous
discovery, and before MCP transport. Already-started tools retain their own cancellation support.
The normalized adapter interface dispatches one call at a time; approval covers only that actual call.

Optional Decision routing and internal prose-checker ownership follow the
[generation review lifecycle](../chat/06-per-turn/03-run-generation-turn.md#response-text-review).

## Expression delivery and side effects
<!-- anchor: expression-delivery-and-side-effects -->

Tool execution coordinates several turn-level side effects:

- **Expression delivery:** If a tool returns a `stickerSelection` payload (used by expression tools),
  the stage calls `deliverExpression` immediately. Expression delivery enforces a strict single-expression
  allowance per persona turn via `ChatTurnContext.expressionDelivery`. A repeated call returns
  `sticker_already_sent` without posting to Discord. If an earlier send timed out or was unconfirmed,
  subsequent expression attempts in that turn are refused to avoid duplicate visible messages.
  Successful delivery marks `responseDelivered = true`, which allows a sticker-only turn to settle
  as `completed` rather than failing as an empty response.
- **Usage tracking:** Successful non-blocked tool calls record a `tool_used` metric in `statRepository`
  for non-DM channels.
- **Diagnostic notices:** Failed tool calls emit a hidden thought-log notice containing redacted
  arguments. When deliberate tool mode admitted a tool via a trigger match, the stage emits a hidden
  notice recording the matched trigger pattern.
- **One-shot memory guard:** A successful `update_short_term_memory` call sets
  `streamingContext.disableShortTermMemoryUpdate = true`, blocking subsequent memory updates within the
  same turn.

## Return outcomes
<!-- anchor: return-outcomes -->

The stage returns one of three outcome kinds:

1. **`{ kind: "restart" }`:**
   Triggered when `handleEnhancedContextRestart` consumes a `context_restart_*` payload. The outer
   loop resets error counters and continues without recording a tool history entry.
2. **`{ kind: "abort", status }`:**
   Triggered on malformed payloads, cancellation stops, or aborted expression sends. The outer loop
   exits immediately with the specified turn status.
3. **`{ kind: "history", historyEntry, ... }`:**
   Standard completion. The stage packages the call and response into a `ToolHistoryEntry`.
   Visible text streamed before the tool call is converted into `preToolCallTextParts` on the history
   entry, and the outer loop clears `accumulatedModelParts` so trailing prefill does not duplicate
   already-delivered text.

## Source pointers
<!-- anchor: source-pointers -->

- `src/utils/chat/toolLoop.ts`: `executeToolCall`, `buildPreToolCallTextParts`, `emitFailedToolCallThoughtLog`.
- `src/tools/toolRegistry.ts`: `ToolRegistry.executeTool`.
- `src/utils/chat/expressionDelivery.ts`: `deliverExpression`, `buildExpressionToolResult`.
- `src/types/tool/interfaces.ts`: `ToolContext`, `ToolResult`.

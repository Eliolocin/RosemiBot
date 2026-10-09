---
title: "Tool-Loop Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "Tool Loop"
  order: 300
---

`runToolLoop` drives the streaming and tool dispatch loop for one LLM generation attempt.
The chat per-turn stage [Run Generation Turn](/architecture/pipelines/chat/06-per-turn/03-run-generation-turn/)
calls `runToolLoop` for each model fallback and key rotation attempt, after context and provider
configuration are prepared. The loop coordinates repeated generation passes, tool execution,
context-enrichment restarts, and result assembly until the model finishes, a stop signal arrives,
or a guard limit is reached.

## Two tiers of loop control
<!-- anchor: two-tiers-of-loop-control -->

Generation control is split into two distinct tiers:

1. **Outer attempt control (`runGenerationTurn`):**
   `runGenerationTurn` manages the fallback chain and API key rotation. When a generation attempt
   fails with a retryable status (`error` or `timeout`), it selects the next available key or advances
   to the next model in the fallback chain. Before starting a replacement attempt, it attempts to delete
   tracked partial messages from Discord. Failed deletions and sends that
   outlive the settling window can leave partial output visible.
   It also owns server-route fallback admission and model failure notice delivery.

2. **Inner generation and tool dispatch (`runToolLoop`):**
   `runToolLoop` operates within a single generation attempt. It repeatedly calls the provider adapter,
   dispatches requested tools, handles context-enrichment restart signals, and accumulates dialogue state.
   The loop continues until the provider emits a final response, hits a fatal error, or terminates through
   tool policy.

## Stage flow
<!-- anchor: stage-flow -->

```text
Provider stream
  ├─ Final response or stop → result assembly
  └─ Tool call → allowlist and execution checks → tool dispatch
                  ├─ Tool history → next provider stream
                  ├─ Context enrichment → restart with enriched context
                  └─ Tool completion or failure limit → result assembly
```

## Stage index
<!-- anchor: stage-index -->

| Stage | Symbol | Purpose |
|---|---|---|
| [01: Stream Once](/architecture/pipelines/tool-loop/01-stream-once/) | `streamOnce` | Executes one provider generation pass with a rolling inactivity timeout |
| [02: Execute Tool Call](/architecture/pipelines/tool-loop/02-execute-tool-call/) | `executeToolCall` | Validates, gates, dispatches tools, delivers expressions, and records history |
| [03: Enhanced Context Restart](/architecture/pipelines/tool-loop/03-enhanced-context-restart/) | `handleEnhancedContextRestart` | Consumes context-enrichment signals from tool results and restarts the generation pass |
| [04: Build Result](/architecture/pipelines/tool-loop/04-build-result/) | `buildResult` | Assembles `GenerationTurnResult`, merging NovelAI scene metadata and resolving thought log identity |

## Iteration state
<!-- anchor: iteration-state -->

The loop retains tool call/response history and provider-native assistant parts for the next stream. Visible text before a tool call belongs to its history entry so replay does not ask the model to repeat it. Delivery state also records tools that already sent an expression or another channel response; an empty follow-up can then settle without treating that delivered output as a failure.

Provider results accumulate for final text, usage, and thought-log attribution. Error counters bound repeated failures, with separate recovery for NovelAI turns that have already delivered text. The exact state shape belongs to `runToolLoop` and `ToolHistoryEntry`.

## Termination conditions and policy
<!-- anchor: termination-conditions-and-policy -->

The loop terminates through one of four pathways:

1. **Provider completion (`completed`):**
   The model completes its response without requesting further tools. The accumulated response text and
   details are packaged into the final result.

2. **Cancellation or interruption:**
   A `/kill` command yields `stopped_by_user`. If a stop response was requested, the stop message is
   queued at the front of the channel queue. If a new user message arrives while streaming, the stream
   yields `follow_up_interrupt` so the turn can yield to the incoming message.

3. **Tool-driven completion:**
   - **Explicit end turn:** If a tool result sets `endTurn: true`, the turn finishes immediately with
     `completed`.
   - **Pre-tool-text exit policy (`shouldEndAfterPreToolText`):**
     When a successful tool follows visible text streamed to Discord:
     - NovelAI with `update_short_term_memory`: ends immediately because memory updates are silent.
     - NovelAI with tools requiring follow-up: continues so search, fetch, or MCP results can be presented.
     - NovelAI with other successful tools: ends immediately with the pre-tool text.
     - Non-NovelAI tools in `TOOLS_SUPPRESS_FOLLOWUP_AFTER_PRETOOL_TEXT`: continues only if the tool
       requires follow-up; otherwise ends immediately.
     - Other tools and providers continue normally.
   - **Empty response resolution (`isSettledAfterTool`):**
     When the provider returns an empty response after visible text or an expression was delivered,
     `isSettledAfterTool` checks whether the preceding tool required follow-up. If the tool completed
     its task and required no follow-up, the turn settles cleanly as `completed` rather than failing
     with `empty_response`.

4. **Guard ceilings:**
   Reaching `MAX_FUNCTION_CALL_ITERATIONS` terminates the turn with `timeout`. Reaching
   `MAX_CONSECUTIVE_TOOL_ERRORS` emits the localized tool error embed and terminates with `error`.
   Reaching `NAI_TOOL_FAILURE_RETRY_THRESHOLD` emits the NovelAI retry exhausted embed and terminates
   with `completed`, preserving the already delivered text.

## Verbatim tool-calling mode
<!-- anchor: verbatim-tool-calling-mode -->

For models using verbatim tool calling (assistant text with code-span or fenced tool invocations),
the provider stream adapter (`CustomStreamAdapter`) parses the tool call from text into standard
`FunctionCall` objects before yielding to the orchestrator. Normal and verbatim tool calls enter
`runToolLoop` identically at `streamResult.status === "function_call"`. Gating, timeouts, restarts,
and history assembly apply equally to both. Prompt-level verbatim adaptation (injecting the schema dump
and calling format nudge) is owned by `runGenerationTurn` during context preparation
([Verbatim Tool Definitions](/architecture/pipelines/context-build/02-native-assembly/07b-verbatim-tool-definitions/)).

## Iteration guards
<!-- anchor: iteration-guards -->

Stream and tool deadlines bound each external operation. Stream inactivity deadlines advance on progress, while first-token waiting has a separate budget. An aborted stream receives a bounded settling window before cleanup; late sends can outlive that window. Iteration and consecutive-error ceilings prevent indefinitely repeating tool requests. `toolLoop.ts` owns their values; [Stream Once](/architecture/pipelines/tool-loop/01-stream-once/) explains timeout and cancellation ownership.

## Pending response completion

With Response Drafting On, `runToolLoop` shares function history and review state across attempts.
Pre-tool narration stays pending and joins the final candidate. `completeResponse` reviews that
candidate before replaying approved presentation or requesting the bounded revision. Revision clears
pending presentation and model parts while keeping actual tool outcomes; successful tools are not
replayed to reconstruct a reply. Tool-only turns do not invent prose.

Each pass receives the room left under the turn's
[held-prose ceiling](/architecture/pipelines/provider/04-orchestrator-state-machine/#held-response-presentation).
A pass that stops at that ceiling aborts its provider request, because an adapter that does not
cancel its reader on early return would keep generating undeliverable text. The reviewer packet
labels a cut candidate `pending_cut_at_length_limit` and is told the kept text will be delivered as
cut. A cut pass without reported usage records estimated author usage. After delivery,
`completeResponse` posts the ordinary `flush_limit` notice unless the replay already posted it or the
operator's `send_message_limit` caused the cut, which stays silent as it does when streaming.

Cancellation discards held text and retains the existing queued stop/follow-up handling. Result
assembly includes accepted dialogue and the actual-usage ledger; presentation carries no second
usage copy. The [tool checkpoint](02-execute-tool-call.md#actual-request-review) runs before dispatch,
with correction budgets independent of final-response review.

## Source pointers
<!-- anchor: source-pointers -->

- `src/utils/chat/toolLoop.ts`: `runToolLoop`, `shouldEndAfterPreToolText`, `isSettledAfterTool`.
- `src/utils/chat/generationTurn.ts`: `runGenerationTurn` (outer fallback and key rotation coordinator).
- `src/types/provider/interfaces.ts`: `StreamResult` interface and statuses.
- `src/utils/chat/types.ts`: `GenerationTurnResult`, `ToolHistoryEntry`, and `ChatTurnContext`.

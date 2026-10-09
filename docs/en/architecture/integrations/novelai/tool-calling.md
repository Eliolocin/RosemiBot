---
title: "NovelAI GLM 4.6 Tool Calling"
---

NovelAI's GLM 4.6 model lacks a native API for structured function calling. TomoriBot implements
prompt-based tool calling by injecting XML schema guides into the system prompt and parsing tool
invocations from the output token stream.

## Flow and ownership

Prompt-based tool execution is coordinated between the provider adapter and the stream parser:

```
Tool Registry
  │
  ▼
novelaiToolAdapter.ts ─────────► normalizeToolDefinitions()
                                       │
                                       ▼
novelaiStreamAdapter.ts ───────► buildToolCallingGuide() (<tools> XML in system prompt)
                                 buildToolHistoryGlm() (<|assistant|>/<|observation|>)
                                       │
                                       ▼
NovelAI Endpoint ──────────────► Streamed Token Output
                                       │
                                       ▼
processTokenWithToolParsing() ─► State Machine (undecided, text, tool_call)
                                 Unwrapped function call recovery
                                 Debris suppression & truncation recovery
                                       │
                                       ▼
Orchestrator ──────────────────► FunctionCall Object Dispatched to Tool Loop
```

### System prompt tool guide

At the start of a generation turn, `buildToolCallingGuide` serializes active tool definitions into a
`<tools>` XML container within the `<|system|>` turn.

The guide includes active function schemas and the XML invocation format. Its syntax must agree
with `parseToolCallBlock`; source owns the full generated instructions.

Historical tool calls from previous loop steps are injected between dialogue turns via
`buildToolHistoryGlm`, formatting assistant calls and environment responses using GLM's
`<|assistant|>` and `<|observation|>` tokens.

## Stream parsing state machine

The stream adapter first distinguishes conversational output from a tool invocation. It buffers
partial XML so tags do not leak into Discord, emits a normalized `FunctionCall` when parsing
succeeds, and hands execution to the shared tool loop. When tooling is unavailable, tokens follow
the normal text path. State transitions and buffering details belong to `processTokenWithToolParsing`.

### Unwrapped tool call detection

While the system prompt instructs the model to wrap calls in `<tool_call>` containers, GLM 4.6
frequently outputs bare function names directly:

```
web_search
<arg_key>query</arg_key>
<arg_value>Tokyo weather</arg_value>
```

When in `undecided` mode, `decideToolCallMode` applies defensive recovery:

1. Thinking blocks wrapped in `<think>...</think>` are stripped silently.
2. If the prelude contains `<tool_call>`, it transitions to `tool_call` mode.
3. If the first line matches a registered tool name (matching across hyphens and low lines via
   `normalizeToolName`), the parser waits for `<arg_key>` to confirm tool invocation. Once confirmed,
   it synthesizes the missing `<tool_call>` wrapper and enters `tool_call` mode.
4. If the prelude contains plain conversational text, it switches to `text` mode and emits the
   buffered tokens.

## Debris suppression and truncation recovery

GLM 4.6 exhibits specific token-generation quirks that require active stream guarding:

### Stray thinking tag termination

The model occasionally emits stray `</think>` tags mid-response followed by garbled text. When
`processVisibleText` detects `</think>` during the text phase, the stream halts immediately. The
adapter yields clean text preceding the tag and discards all subsequent tokens.

### Text followed by tool calls

`processTextWithToolScan` accepts explicit and recovered unwrapped calls after visible text, allowing a preamble such as a search announcement to precede execution. The tool loop owns whether a successful tool needs another model response; see [tool-loop completion policy](/architecture/pipelines/tool-loop/#termination-conditions-and-policy). The adapter's `hasEmittedVisibleText` guard applies to the initial undecided-mode transition, rather than prohibiting every later call.

### Truncation recovery

Strict token limits can exhaust the generation budget before the model emits the closing
`</tool_call>` tag. When the stream closes while still accumulating an incomplete tool call, the
adapter synthesizes the missing `</tool_call>` delimiter. If the accumulated XML contains valid
argument pairs, `parseToolCallBlock` successfully recovers the `FunctionCall` rather than discarding
the turn.

## Source pointers

- `src/providers/novelai/novelaiStreamAdapter.ts`: Stream parsing state machine, XML tool extraction,
  and truncation recovery.
- `src/providers/novelai/novelaiToolAdapter.ts`: Tool schema formatting and MCP name filtering.
- `src/providers/novelai/novelaiService.ts`: OpenAI-compatible transport for GLM 4.6 completions.

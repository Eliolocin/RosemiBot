---
title: "03: Chunk Normalization"
---

Chunk normalization converts provider-native `RawStreamChunk` envelopes into uniform `ProcessedChunk`
objects, extracts reasoning content, and normalizes error and tool-call payloads. It executes synchronously
within `BaseStreamAdapter.processChunk()`.

## Flow and ownership

The stage 04 [orchestrator loop](/architecture/pipelines/provider/04-orchestrator-state-machine/)
consumes raw chunks from stage 02 and passes each to `processChunk()`. The method produces no side
effects on orchestrator state or Discord APIs. It can update adapter-local accumulators and guards
and emit diagnostic logs, while shielding the orchestrator from vendor SDK structures.

The returned `ProcessedChunk` carries one of four primary types:

- `"text"`: carries a visible text delta in `content` for buffering and Discord delivery.
- `"function_call"`: carries a normalized `FunctionCall` (`name`, `args`, and optional `thoughtSignature`).
- `"error"`: carries a normalized `ProviderError` with classified failure codes.
- `"done"`: carries terminal metadata (such as finish reasons) before the generator finishes.

Any chunk variant may attach `thoughts` (`ThoughtLogEntry[]`) for chain-of-thought capture and
`servingProvider` to track upstream backends on routed endpoints.

## Reasoning extraction and spill guards

Reasoning content travels through dedicated fields or in-band tags:

- **Structured reasoning:** Adapters extract native thought blocks (such as Gemini `part.thought` or
  reasoning summaries) into `ThoughtLogEntry[]`. For OpenRouter, the upstream backend identifier is
  captured in `servingProvider` so unexpected reasoning leaks can be traced to specific model hosts.
- **Leaked reasoning tags:** When models output `<think>` blocks into visible text deltas,
  `ThinkBlockContentStripper` redirects the enclosed text to `delta.reasoning`.
- **Tagless reasoning spills:** When a provider concatenates reasoning directly onto content without
  tags, `ReasoningContentSpillGuard` detects unspaced sentence boundaries at the start of output. It
  strips the leaked tail while protecting backticked code identifiers.

## Tool-call normalization and recovery

Tool calls stream as structured objects or raw text deltas:

- **Verbatim tool-call parsing:** Models using custom endpoints or lacking native tool calling can
  output function calls directly in prose. `CustomStreamAdapter` runs `VerbatimToolCallParser` over
  visible content to match `<toolName>(...)` syntax. Text preceding the call emits as normal prose,
  followed by the parsed call as `type: "function_call"`.
- **Truncated argument recovery:** Network interruptions or socket resets can cut tool argument
  JSON mid-token. In adapters receiving incremental argument deltas (OpenAI-compatible, OpenRouter,
  Anthropic), `parseAccumulatedToolArguments()` falls back to `tryRepairIncompleteJson()`. The repair
  closes open containers without inventing keys and marks `chunk.functionCall.argumentsTruncated = true`.
  The tool loop inspects this flag and refuses execution of incomplete calls.

## Error normalization and classification

`handleProviderError()` converts SDK exceptions into a unified `ProviderError` shape with standard
categories (`api_error`, `rate_limit`, `content_blocked`, `timeout`, `provider_overloaded`, `model_error`).
Specialized classifiers in `src/utils/provider/providerErrorClassification.ts` inspect error text to
differentiate failure causes:

- **Model errors:** Distinguishes unknown or retired model IDs from bad credentials.
- **Billing limits:** Separates exhausted account balances from affordability ceilings that can succeed
  with smaller `max_tokens` settings.
- **Context overflow:** Identifies token window limits that prompt history trimming.
- **Provider timeouts:** Normalizes network read and socket timeouts into the `timeout` category.

Public sinks show only the provider's localized, classified headline from `createErrorDescription()`.
The upstream response text never reaches error embeds, interaction replies, the fallback notice, or
tool results returned to the model, because an endpoint can echo the bearer value it received in an
encoding that pattern redaction misses, and self-debug reads those notices back into context. Error
codes appear only when `formatProviderErrorCodeForDisplay()` recognizes an HTTP status or single-case
enum word; anything else shows as `unknown`. The chat logger caps the diagnostic snippet from
`getProviderErrorDetail()` at 2,000 characters, then passes it and the attached error through
credential-pattern redaction. Attached errors and stack traces can be longer; log string truncation
is opt-in. Routine provider failures use warning-level logs, which normal production logging hides.
Logs remain private operator diagnostics. See
[Production tuning](/wiki/production-tuning/) for log controls. `/persona generate` and speech
synthesis also keep upstream text out of public replies: preset generators reply with a classified
message and HTTP status, and speech adapters put only
the status or fixed text in `details`, which reaches both `/generate voice-message` and the voice tool.

## Credential-scoped recovery tips
<!-- anchor: credential-scoped-recovery-tips -->

The resolved credential source of the turn (`StreamContext.textCredentialSource`, either `"server"`
or `"personal"`) governs the troubleshooting tips displayed in error embeds:

- **Server scope:** Tips recommend administrative actions, such as adding API keys to rotation pools
  or configuring server fallback chains.
- **Personal scope:** Server key rotation tips are suppressed because standard members cannot manage
  server pools. Error embeds instead recommend checking personal credentials or disabling the personal
  text override to revert to server defaults.

## Source pointers

- `src/types/stream/interfaces.ts`: `ProcessedChunk`, `ProviderError`, and `BaseStreamAdapter.processChunk`.
- `src/providers/utils/toolCallArguments.ts`: `parseAccumulatedToolArguments` and truncation flags.
- `src/utils/text/jsonRepair.ts`: `tryRepairIncompleteJson`.
- `src/utils/provider/providerErrorClassification.ts`: error classification helpers.
- `src/utils/discord/stream/errorUi.ts`: error embed presentation and credential-scoped tips.
- `src/providers/custom/customStreamAdapter.ts`: verbatim tool parsing integration.

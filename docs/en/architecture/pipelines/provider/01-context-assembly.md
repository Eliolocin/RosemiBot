---
title: "01: Context Assembly"
---

Context assembly translates agnostic conversation items into a provider-native request and configures
generation parameters before opening the HTTP stream. It runs as the initial setup phase of
`BaseStreamAdapter.startStream()`.

## Flow and ownership

The tool loop stage [`streamOnce`](/architecture/pipelines/tool-loop/01-stream-once/) enters the
provider pipeline through `LLMProvider.streamToDiscord()`. That method instantiates the appropriate
`StreamAdapter` and delegates to `StreamOrchestrator.streamToDiscord()`, which calls
`adapter.startStream(config, context)`. The setup phase of `startStream()` builds the native request
payload before yielding raw chunks in [stage 02](/architecture/pipelines/provider/02-raw-chunk-generation/).

Context assembly handles five responsibilities:

1. **Context item translation:** `StreamContext.contextItems` (`StructuredContextItem[]`) are
   partitioned into system instructions and dialogue turns. Google adapters convert items into
   Gemini `Content[]` structures, while OpenAI-compatible adapters format standard message objects.
2. **Media processing:** Images are fetched and optimized via `fetchAndOptimizeImage()`. Animated
   GIFs are converted to keyframes or replaced with a text placeholder when running under production
   to avoid memory pressure. Videos are fetched and inlined as base64 only when their size stays
   under `VIDEO_CONTEXT_MAX_INLINE_MB`. Remote fetches execute through SSRF-validated network helpers.
3. **Dynamic tool declarations:** Tools prepared by `getAvailableToolsWithMCP()` pass through
   `src/tools/assembly.ts`. The assembler filters tools against model capabilities and emits native
   tool schemas attached to request options.
4. **Function history replay:** Paired calls and responses from `context.functionInteractionHistory`
   become provider-native tool exchanges. Google uses model and user turns; OpenAI-compatible APIs
   use assistant tool calls and tool-role responses. History entries retain visible pre-tool text
   and required replay fields, including Gemini thought signatures and DeepSeek reasoning content.
   `context.currentTurnModelParts` carries remaining assistant continuation parts.
5. **Stop strings and options:** `buildProviderStopStrings()` merges server `llm_stop_strings`,
   persona speaker-label patterns, and provider-native stop sequences. Generation parameters, such
   as temperature, max tokens, and thinking budgets, are applied to the request.

## Constraints and rationale

Adapters enforce strict structural constraints required by downstream model endpoints:

- **Tool response turn separation:** Vertex AI rejects user turns that combine `functionResponse`
  data with inline images or text. Google adapters emit the `functionResponse` in its own user turn
  and place tool-returned images in a subsequent user turn. OpenAI-compatible adapters construct a
  synthetic user message that carries tool images as optimized inline data URLs.
- **Expiring URL isolation:** Image serialization downloads and optimizes Discord attachments before
  embedding them, avoiding provider-side fetches of expiring URLs. Media handling remains
  provider-specific: Google's adapter can pass supported video links as `fileData`.
- **Speaker guard reset:** Adapters initialize rolling tail buffers before streaming starts. Guard
  state belongs strictly to a single attempt and resets on each new call to `startStream()`.

## Source pointers

- `src/types/stream/interfaces.ts`: `BaseStreamAdapter`, `StreamConfig`, and `StreamContext`.
- `src/providers/google/googleStreamAdapter.ts`: `GoogleStreamAdapter.startStream` and `buildTokenCountPayload`.
- `src/providers/openaiCompatible/openaiCompatibleStreamAdapter.ts`: OpenAI-compatible context serialization.
- `src/providers/utils/stopStrings.ts`: `buildProviderStopStrings`.
- `src/tools/assembly.ts`: dynamic tool assembly and schema filtering.

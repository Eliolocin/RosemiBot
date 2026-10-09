---
title: "02: Raw Chunk Generation"
---

The provider adapter opens the HTTP stream and yields provider-native chunks to the orchestrator.
It owns transport recovery and provider-specific preprocessing before stage 03 classifies each chunk.

## Flow and ownership

Request construction and streaming both happen inside `BaseStreamAdapter.startStream()`.
[Stage 01](/architecture/pipelines/provider/01-context-assembly/) describes request construction;
this stage covers opening and consuming the response. The adapter uses its provider SDK or fetch
implementation. Custom endpoints retain the SSRF-guarded fetch path on every retry.

The adapter wraps responses in `RawStreamChunk` objects with provider identity and metadata.
The [orchestrator](/architecture/pipelines/provider/04-orchestrator-state-machine/) consumes them
and calls the same adapter's `processChunk()` for
[normalization](/architecture/pipelines/provider/03-chunk-normalization/). The raw data stays in
that adapter's format until normalization.

Preprocessing handles quirks that affect delivery order or text safety. For example, Google's adapter
splits a response containing both text and a function call so the orchestrator can deliver the text
before handing the call to the tool loop. Adapters also remove overlapping text and, when the speaker
guard is enabled, hold back text that could begin another speaker's turn. Guard state belongs to one
stream and resets when a new stream starts.

## Shared parameter degradation
<!-- anchor: shared-parameter-degradation -->

OpenRouter and OpenAI-compatible adapters share request degradation: bounded retries that remove
optional request fields or image input when an endpoint rejects the payload. Rejection can arrive as
an HTTP failure or as an error event after an SSE stream opens with `200 OK`. The shared helpers
build retry bodies and decide whether rejection justifies another attempt; each adapter owns fetching,
response cleanup, and its per-attempt state.

Retries can use the error message to remove named parameters together or remove rejected image input
before trying other payloads. Equivalent bodies are deduplicated, and additional targeted parameter
retries are capped. Recovery applies only to the current stream: the next request starts with its
normal payload because backend capabilities can change between requests.

Fields needed to preserve the reply contract must remain mandatory. Dropping a field that changes
tool-call or reasoning replay requirements can produce a successful response that breaks the next
tool-loop request. The adapter declares these fields through `mandatoryBodyKeys`; safe optional
fields can be probed separately.

Removed images leave a text notice telling the model that an attachment was removed and that it
must not guess its contents. Known image limitations belong in the model's capability configuration;
degradation handles unexpected rejection without updating stored capabilities.

Error eligibility depends on the provider. OpenRouter permits degradation on a 502 because routing
can select an incompatible backend. Direct OpenAI-compatible adapters do not treat a 502 alone as
an incompatibility signal. NVIDIA also permits retries for opaque server errors, which its backend
can use for unsupported input. The classifier and adapter options own the exact conditions.

## Stream commitment and failures
<!-- anchor: stream-commitment-and-failures -->

A transparent retry is allowed only before the adapter commits meaningful output to its consumer:
text, reasoning, a tool-call delta, or usage. Keepalives and empty chunks do not commit the attempt.
After commitment, restarting could duplicate output or tool activity already observed downstream.

Before retrying an SSE rejection, the adapter closes the failed response and resets its per-attempt
accumulators and output guards. It suppresses that recoverable error. After commitment, or when no
retry is justified, errors pass through the normal error-chunk path to the orchestrator and the
[chat fallback flow](/architecture/pipelines/chat/06-per-turn/03-run-generation-turn/).
Degradation and recovery appear in structured logs without adding Discord notices or thought-log
entries of their own.

## Source pointers

- `src/types/stream/interfaces.ts`: `BaseStreamAdapter` and `RawStreamChunk` contracts.
- `src/providers/google/googleStreamAdapter.ts`: SDK streaming and text/function-call ordering.
- `src/providers/utils/paramDegradation.ts`: retry bodies, rejection classification, and image notices.
- `src/providers/openaiCompatible/openaiCompatibleStreamAdapter.ts` and
  `openaiCompatibleTypes.ts` in the same directory: shared transport and provider policy options.
- `src/providers/openrouter/openrouterStreamAdapter.ts`: router-specific transport and retry policy.

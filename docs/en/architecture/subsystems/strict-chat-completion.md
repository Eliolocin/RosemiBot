---
title: "Strict Chat-Completion Compatibility"
---

Different LLM provider APIs enforce conflicting message structure requirements. TomoriBot normalizes role alternation, prefix completion, and assistant media behind a shared seam in `src/providers/utils/strictChatCompat.ts` so built-in and custom-endpoint proxies can communicate with strict backends.

## The three normalizations

| Normalization | Setting | Mechanism |
|---|---|---|
| **Role alternation** | `strict_role_alternation` | Merges consecutive same-role messages into one and prepends a synthetic leading user turn (`[System: Conversation start]`) when the dialogue opens with an assistant turn. Tool-bearing turns act as merge boundaries so `tool_calls` and `tool_call_id` metadata are preserved. |
| **Prefix completion** | `supports_prefix_completion` | Stamps `prefix: true` on the trailing assistant message (`applyAssistantPrefixCompletion`) to activate vendor continuation modes (DeepSeek, Z.ai). |
| **Media relocation** | Shared serialization policy | Moves assistant media into following synthetic user turns (`relocateAssistantMediaContextItems`) with sender attribution. This gives adapters a common representation that strict backends can accept. |

### Orthogonal compatibility toggles

Role alternation and prefix completion address independent backend constraints and remain decoupled:

- A proxy fronting Claude requires role alternation enabled and prefix completion disabled; sending `prefix: true` causes request rejection.
- A proxy fronting DeepSeek or vLLM continue modes requires prefix completion enabled, without needing same-role turn merging.

A single bundled toggle would prevent configuring backends that need only one of these behaviors.

### Assistant prefill capability

`supports_assistant_prefill` records whether the backend accepts and continues a trailing assistant turn instead of rejecting it with an HTTP 400 error (such as Claude 4.6+ or Gemini 3.5 Flash-Lite) or restarting output from the beginning. It is distinct from prefix completion: prefix completion designates the `prefix: true` request field, while assistant prefill designates whether the model accepts the trailing turn.

- **Tool conflicts on DeepSeek**: DeepSeek rejects `prefix: true` in requests that also carry `tools`. When tool calling is active, the prefill resolver (`resolvePrefillBlocker` in `src/utils/chat/assistantPrefill.ts`) skips server prefills and converts `/respond` prefills into written prompt instructions.
- **Tool loop folding**: When a model initiates a tool call, trailing prefill text is folded into the first tool call's assistant message (`foldPrefillIntoToolHistory`). This prevents consecutive assistant turns that strict-alternation backends would reject.

### Media relocation

The structured request builders apply media relocation independently of the alternation and prefix-completion toggles. When dialogue history includes images sent by an assistant (such as generated images), the media parts are extracted into an immediately following synthetic user message:

```text
[System: The following image was sent by {name}.]
```

When no sender name is available, the notice falls back to `[System: The following image was sent]`. Relocation runs on structured context items before provider-specific serialization, preserving participant indices and mention metadata.

## Resolution and persistence

Compatibility settings are stored as boolean columns on `llms` and `custom_endpoints`:

- **Built-in providers**: Seeded with required flags in `src/db/seed/catalog/models.ts` (Anthropic enables alternation; DeepSeek, Z.ai, and Z.ai Coding enable prefix completion). `supports_assistant_prefill` is configured per measured model.
- **Custom endpoints**: Expose these settings as checkboxes under Chat Completion Compatibilities in `/providers` and `/setup`. Values sync to the custom endpoint's synthetic `llms` row via `upsertSyntheticCustomLlm`.
- **Runtime safety net**: `providerRequiresAlternation()` and `providerRequiresPrefixCompletion()` in `strictChatCompat.ts` OR-combine with stored database flags, preventing mis-seeded catalog rows from emitting invalid bodies.
- **Verification gate**: `bun run check-seed-catalogs` validates required flags at boot and in CI (`collectStrictChatFlagViolations` in `src/db/seed/catalog/modelSeed.ts`) to keep built-in requirements synchronized.

## Source pointers

- `src/providers/utils/strictChatCompat.ts`: Message normalization functions (`mergeConsecutiveSameRole`, `ensureLeadingUserTurn`, `applyAssistantPrefixCompletion`, `relocateAssistantMediaContextItems`).
- `src/utils/chat/assistantPrefill.ts`: Prefill capability resolution and tool conflict detection (`resolvePrefillBlocker`).
- `src/db/seed/catalog/models.ts`: Seed definitions for built-in provider model flags.
- `src/db/seed/catalog/modelSeed.ts`: Seed verification gates (`collectStrictChatFlagViolations`).

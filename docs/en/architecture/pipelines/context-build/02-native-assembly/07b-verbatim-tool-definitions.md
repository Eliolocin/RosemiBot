---
title: "02.7b: Verbatim Tool Definitions"
---

The verbatim tool definitions contributor emits an in-band JSON dump of active tool schemas for models operating under verbatim tool-calling mode.

## Flow and ownership

Certain local or OpenAI-compatible custom endpoints accept the API `tools` parameter without exposing function schemas to the underlying model. To support tool use on these endpoints, TomoriBot uses verbatim tool-calling:

1. **Gating predicate**: Evaluates `shouldInjectVerbatimToolCallingNudge(tomoriState)` in `src/utils/tools/verbatimToolCalling.ts`. The contributor activates only when `llm.verbatim_tool_calling === true`, the provider is `custom`, and `llm.has_tools === true`.
2. **Schema assembly**: `buildVerbatimToolDefinitionsJson` assembles `ToolStateForContext`, queries `getAvailableToolsWithMCP` for built-in and MCP tools matching feature flags and Deliberate Tool Mode scopes, and formats them into OpenAI-compatible function definitions using `OpenAICompatibleToolAdapter`.
3. **Context emission**: `buildVerbatimToolDefinitionsContextItem` in `src/utils/text/context/toolDefinitions.ts` formats the schemas into a fenced JSON block preceded by calling instructions, and emits a `user`-role item tagged `KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS`.

## Coordination with dialogue nudge

Verbatim tool calling is split into two coordinated halves:

- **Schema definitions (stage 07b)**: Serializes tool signatures in the prompt's reference zone (before RAG documents), placing static schema definitions in the prompt-cache-friendly prefix.
- **Behavioral nudge (stage 11)**: Injects `VERBATIM_TOOL_CALLING_NUDGE` at depth 3 in [Dialogue History](/architecture/pipelines/context-build/02-native-assembly/11-dialogue-history/), instructing the model how to format tool invocations in its output text.

Both halves share the identical gating predicate, so they always activate and deactivate together.

When generation fallbacks switch between native and verbatim models across retry attempts, `prepareProviderContextItems` in `src/utils/chat/generationTurn.ts` dynamically adds or removes this block to match the candidate model.

## Constraints and rationale

- **Prompt cache stability**: Placing tool schemas in the prefix rather than at the dialogue tail prevents tool definitions from invalidating prompt cache prefixes across successive turns.
- **Fail-safe fallback**: If schema resolution fails, the error is logged and returns `null`, allowing context assembly to proceed without crashing the turn.

## Source pointers

- `src/utils/text/context/toolDefinitions.ts`: `buildVerbatimToolDefinitionsContextItem`.
- `src/utils/tools/verbatimToolCalling.ts`: `shouldInjectVerbatimToolCallingNudge` and `VERBATIM_TOOL_CALLING_NUDGE`.
- `src/providers/openaiCompatible/openaiCompatibleToolAdapter.ts`: `OpenAICompatibleToolAdapter`.
- [11: Dialogue History](/architecture/pipelines/context-build/02-native-assembly/11-dialogue-history/): behavioral verbatim nudge injection.
- [Chunk Normalization](/architecture/pipelines/provider/03-chunk-normalization/): stream-time text parsing of verbatim tool calls.

---
title: "02: Native Assembly"
sidebar:
  label: "Overview"
---

Native assembly constructs the LLM prompt through a fixed-order sequence of contributors. Each contributor appends items to a shared context list or emits out-of-band directives for downstream positioning.

Prompt order matters for LLM reasoning and caching: identity framing sits at the top, reference knowledge sits in the middle, and recent dialogue turns sit at the bottom.

## Contributor sequence

```
[01] Prompt items                ← system role, top of prompt
[02] Server info
     Persona user blocks         ← optional active blocks notice
[03] Server memories             ← persona-scoped guild/DM long-term memories
[04] Server emojis               ← custom server emojis
[05] Server stickers             ← native and custom stickers
     Persona sprites             ← optional persona sprite instructions
[06] Participants                ← users in conversation, roles, presence, aliases
[07] Short-term memory           ← same/other channel summary and categories
[07b] Verbatim tool definitions  ← optional in-band tool JSON schemas
[08] RAG documents               ← vector retrieval over uploaded documents
[09] Conditioning                ← reward and punishment reinforcement notes
[10] Sample dialogues            ← few-shot persona examples
[11] Dialogue history            ← recent conversation messages and notes
```

## Contributor index

| Contributor | Relationship |
|---|---|
| [Prompt items](/architecture/pipelines/context-build/02-native-assembly/01-prompt-items/) | Establishes system and persona instructions. |
| [Server info](/architecture/pipelines/context-build/02-native-assembly/02-server-info/) | Supplies the conversation's server context. |
| [Server memories](/architecture/pipelines/context-build/02-native-assembly/03-server-memories/) | Reads persistent server knowledge for the active persona lineage. |
| [Server emojis](/architecture/pipelines/context-build/02-native-assembly/04-server-emojis/) and [stickers](/architecture/pipelines/context-build/02-native-assembly/05-server-stickers/) | Describe expressions available for output. |
| [Participants](/architecture/pipelines/context-build/02-native-assembly/06-participants/) | Resolves participant identity and personal context. |
| [Short-term memory](/architecture/pipelines/context-build/02-native-assembly/07-short-term-memory/) | Supplies recent memory and deferred refresh instructions. |
| [Verbatim tool definitions](/architecture/pipelines/context-build/02-native-assembly/07b-verbatim-tool-definitions/) | Adapts tool schemas for text-based calling. |
| [RAG documents](/architecture/pipelines/context-build/02-native-assembly/08-rag-documents/) | Retrieves relevant uploaded document excerpts. |
| [Conditioning](/architecture/pipelines/context-build/02-native-assembly/09-conditioning/) | Adds server-configured reinforcement. |
| [Sample dialogues](/architecture/pipelines/context-build/02-native-assembly/10-sample-dialogues/) | Shows persona response examples. |
| [Dialogue history](/architecture/pipelines/context-build/02-native-assembly/11-dialogue-history/) | Supplies recent messages and capability-neutral media descriptors. |

## Output contract

Directives and deferred short-term memory items are kept out of `contextItems` so that the downstream chat pipeline can position them relative to assembled dialogue turns:

- `tailDirectives` receive the impersonation command directive (`Imitate <User>, start your message with <User>:`).
- `uncensorDirective` receives cleaned uncensor text when enabled.
- `nudgeItem` holds the cadence-gated `update_short_term_memory` prompt.
- `memoryInjectionItems` holds the short-term memory content block when the server configures a non-negative content depth. A negative depth keeps the block inline inside `contextItems`.

## Shared helpers used across contributors
<!-- anchor: shared-helpers-used-across-contributors -->

Several contributors import shared text and state utilities:

- **`convertMentions`** (`src/utils/text/context/mentionNormalizer.ts`): Normalizes `<@id>`, `<#id>`, `<@&id>`, and macro placeholders (`{bot}`, `{user}`) into readable names. It respects user privacy levels and blacklist settings. In dialogue message bodies, it preserves `{bot}` and `{user}` literals to avoid clobbering raw prompts.
- **`toolPromptMacroResolver`** (`src/utils/tools/toolPromptMacros.ts`): Evaluates `{{if capability:...}}` and `{{if tool:...}}` conditionals, and substitutes provider-specific tool function names (such as `{short_term_memory_tool}` or `{sticker_tool}`) based on active model capabilities and deliberate tool allowlists.
- **`history.ts`** (`src/utils/text/context/history.ts`): Provides media window filtering, timestamp formatting, image limit tracking (`MEDIA_IMAGE_MESSAGE_LIMIT`), and user presence formatting for participant cards.

## Source pointers

- `src/utils/text/context/nativeBuilder.ts`: `buildContextNative` pipeline orchestrator.
- `src/utils/text/context/mentionNormalizer.ts`: Discord mention normalization and placeholder substitution.
- `src/utils/tools/toolPromptMacros.ts`: tool name and capability macro evaluation.
- `src/utils/text/context/history.ts`: shared history filtering and presence formatting helpers.

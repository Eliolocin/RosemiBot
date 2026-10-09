---
title: "06.1: Build Context"
---

The build-context stage constructs the `ChatTurnContext` closure for a persona turn. It fetches and
simplifies recent message history, translates Discord message IDs to compact prompt identifiers,
resolves participant metadata, and delegates prompt assembly to the context-build pipeline.

## Flow and ownership

The stage is coordinated by `buildChatTurnContext()` across two modules:

1. **Intent wrapper** (`src/utils/chat/contextPipelineIntent.ts`): checks whether autonomous short-term
   memory (STM) maintenance is due via `isShortTermMemoryMaintenanceDue()`. When Deliberate Tool Mode
   is active and maintenance is due, it temporarily admits `update_short_term_memory` into the tool
   allowlist so memory updates run without requiring user prompt keywords.
2. **Base builder** (`src/utils/chat/contextPipeline.ts`): coordinates history retrieval, message simplification,
   participant resolution, and prompt synthesis.

```
ChatTurn
  │
  ├─► contextPipelineIntent                    ──► checks autonomous STM maintenance
  │
  ▼
contextPipeline.buildChatTurnContext()
  │
  ├─► channel.messages.fetch()                 ──► fetches recent Discord messages
  ├─► buildSimplifiedHistory()                 ──► builds MessageIdMap, collapses same-author runs,
  │                                                extracts embed/CV2 notices, filters privacy
  ├─► prepareParticipantContext()              ──► resolves visible authors, aliases, personas
  │
  ▼
buildContext() (context-build pipeline)        ──► assembles StructuredContextItem prompt items
  │
  ├─► appendTailDirectives()                   ──► appends stop, reasoning, and queued directives
  └─► resolveAssistantPrefill()                ──► stores TurnPrefill on context closure
```

### History fetching and simplification

- **Message retrieval**: fetches up to `message_fetch_limit` messages from Discord.
- **Message ID translation**: `MessageIdMap` maps 64-bit Discord snowflake IDs to compact sequential
  identifiers (`ref_1`, `ref_2`). This reduces prompt token usage and provides stable references for
  tools that target messages.
- **Same-author merging**: consecutive pure-text messages from the same author collapse into a single
  entry while preserving individual timestamps and IDs for metadata tools. Media-bearing messages
  remain distinct to keep media attachments unambiguous.
- **Privacy and blocks**: messages from full-privacy users and blocked authors are excluded.
- **System notice hydration**: extracts system notices from Discord embeds and Components V2 containers,
  restoring the full text of minimal-verbosity cards via `resolveMinimalNoticeBodies()`.

### Participant resolution and prompt delegation

- **Participant context**: `prepareParticipantContext()` scans visible messages for mentions, aliases,
  and persona triggers. Results are cached in a request-scoped map (`participantRequestScopes`) across
  co-responding persona turns under the same channel lock.
- **Prompt construction**: delegates to `buildContext()` in `src/utils/text/contextBuilder.ts`.
  The [Context-Build Pipeline](/architecture/pipelines/context-build/) owns persona system prompts,
  retrieved memories, and RAG document assembly.
- **Tail directives**: appends prompt directives in prioritized order, including emoji usage penalties,
  reasoning formatting instructions, queued reply guidance, and uncensor rules.
- **Prefill resolution**: expanded prefill text is stored on `context.assistantPrefill` rather than
  committed directly to `contextItems`, allowing individual model attempts to determine how the prefill
  is formatted.

### Streaming context flags

The stage initializes per-turn flags on `StreamingContext`:

- `replyNoticeState`: initialized to `{ attempted: false, sent: false }` for queued turns. This allows
  subsequent delivery stages to post a "Replying to..." notice before sending alter or sprite webhook
  messages that cannot use native Discord replies.
- `disableRecentMessageReplyTool`: set to `true` on queued turns. The active stream already delivers the
  reply text, so suppressing tool-driven replies avoids duplicate delivery paths.

## Constraints and rationale

- **Stable compact references**: translating raw snowflakes into sequential reference IDs prevents
  token inflation and prevents models from hallucinating 19-digit Discord snowflake numbers.
- **Delegated prompt ownership**: chat coordination confines itself to channel history and delivery
  flags, delegating dialogue assembly and memory retrieval to the context-build pipeline.
- **Tool suppression on queued replies**: blocking the reply tool on queued turns prevents the bot
  from executing an autonomous tool reply that conflicts with its streamed text.

## Source pointers

- `src/utils/chat/contextPipelineIntent.ts`: autonomous STM intent preflight.
- `src/utils/chat/contextPipeline.ts`: `buildChatTurnContext()` implementation.
- `src/utils/text/contextBuilder.ts`: `buildContext()` entry point to the context-build pipeline.
- `src/utils/text/messageIdMap.ts`: Discord snowflake to compact ID translation.

---
title: "Architecture"
sidebar:
  label: "Overview"
  groupLabel: "Architecture"
  order: 5
---

TomoriBot is a TypeScript and Bun Discord AI chatbot focused on configurable personalities, memory,
and tool use. It is built around provider-agnostic execution, centralized tool routing, and
PostgreSQL-backed state.

:::tip[New to TomoriBot?]
This section is the code-level overview for contributors and integrators. To use the bot, start at
the [Introduction](/introduction/) and [Features](/features/).
:::

## System tiers

The codebase is organized into three architectural tiers:

- [Pipelines](/architecture/pipelines/): Sequenced execution workflows. Pipelines move events through
  turn planning, prompt synthesis, generation passes, provider streaming, and memory updates.
- [Subsystems](/architecture/subsystems/): Cross-cutting domain services. Subsystems support pipeline
  execution by managing slash commands, database persistence, in-memory caches, rate limits,
  multi-persona identity, and security gates.
- [Integrations](/architecture/integrations/): Platform adapters and external bridges. Integrations
  connect the runtime to Discord interface primitives, Matrix networks, NovelAI services,
  SillyTavern character assets, and voice infrastructure.

## Runtime lifecycle

Incoming Discord gateway events follow a common path from client connection to response delivery:

```text
Discord Gateway
  -> discord.js Client (src/init/discord.ts)
  -> Event Handler (src/handlers/eventHandler.ts)
     -> interactionCreate -> Slash Command Dispatch (src/commands/)
     -> messageCreate     -> Chat Pipeline Coordinator (src/events/messageCreate/tomoriChat.ts)

Chat Pipeline
  -> Normalization and Admission Guard (src/utils/chat/admission.ts)
  -> Channel Lock and Queue (src/utils/chat/channelQueue.ts)
  -> Turn Planning and Persona Routing (src/utils/chat/turnPlanner.ts)
  -> Context Assembly (src/utils/chat/contextPipeline.ts)
  -> Generation Turn (src/utils/chat/generationTurn.ts)
     -> Tool-Loop Pipeline (src/utils/chat/toolLoop.ts)
     -> Provider Pipeline (src/types/stream/interfaces.ts)
     -> Stream Delivery to Discord (src/utils/discord/stream/uiUpdater.ts)
  -> Post-Turn Effects (src/utils/chat/postTurnEffects.ts)
```

1. **Gateway dispatch**: The Discord client receives events and passes them to `src/handlers/eventHandler.ts`.
   Interactions dispatch to command modules in `src/commands/`, while messages route to `tomoriChat.ts`.
2. **Admission and locking**: The chat pipeline evaluates permission, channel scope, trigger phrases,
   and cooldowns. Admitted turns acquire a channel lock to prevent interleaved generation within a
   single conversation thread.
3. **Turn planning**: The coordinator identifies which personas respond to the trigger and schedules
   turns. Multi-persona triggers run the first turn immediately and enqueue remaining personas at the
   front of the channel queue.
4. **Context assembly**: The [Context-Build Pipeline](/architecture/pipelines/context-build/) collects
   persona definitions, server metadata, hydrated participant profiles, knowledge documents, and
   dialogue history into ordered context items.
5. **Generation and streaming**: The [Tool-Loop Pipeline](/architecture/pipelines/tool-loop/) manages
   generation passes and tool invocations within one attempt. Streaming passes delegate to the
   [Provider Pipeline](/architecture/pipelines/provider/), which normalizes chunks, buffers text, and
   updates Discord messages.
6. **Post-turn effects**: After generation settles, the coordinator runs result-dependent tasks: recording
   presence, consuming quota, updating short-term memory, emitting thought logs, and updating usage
   statistics.

## Core architectural invariants

These constraints connect the pipelines to their supporting services:

- **Database as source of truth**: PostgreSQL stores persistent configuration, credentials, and
  state. Configuration write paths must invalidate derived caches after write success. Working
  memory also has a live cache with asynchronous persistence; see [Memory](/architecture/pipelines/memory/).
- **Discord interaction timing**: Slash commands and message components acknowledge within the
  three-second Discord gateway deadline, using deferred replies or modals when work requires background
  processing.
- **Remote URL policy**: Custom endpoints, guild MCP, and bounded media downloads use
  `validateRemoteUrl()` and the DNS-pinned `fetchUserRemoteUrl()`. The URL-reading tool also has
  a guard for its external crawler. Production defaults reject private targets; cloud metadata
  blocking remains mandatory. See [Security](/architecture/subsystems/security/) for policy exceptions.
- **Secret protection**: External provider API keys are encrypted at rest with versioned keys using
  PostgreSQL `pgcrypto`. Credential-bearing transport fields require redaction and must stay out
  of model prompts and Discord inspection surfaces.
- **Explicit state scope**: Server settings and guild MCP registrations belong to a server.
  Server memories add persona lineage scope; personal memories follow the user and lineage across
  servers. Persona blocks use local persona IDs. Callers must preserve each domain's scope.

## Supported capabilities

- **AI providers**: Provider-agnostic adapters support first-party services (Google Gemini,
  Anthropic Claude, DeepSeek, OpenRouter, NVIDIA, Vertex AI, Z.AI) alongside local or self-hosted
  endpoints (OpenAI-compatible servers). NovelAI has a separate hosted text adapter.
- **Localization**: Seven authored locale trees (`en-US`, `es-419`, `ja`, `pt-BR`, `vi`, `zh-CN`,
  `zh-TW`), with `es-ES` aliased to `es-419`.
- **Tool execution**: A centralized registry coordinates built-in function calls, external Model
  Context Protocol (MCP) servers, and search engines.
- **Memory layers**: Guild-wide memories, user personal memories, automated short-term conversation
  summaries, and pgvector RAG document storage.

## Navigation

- [Entry point and startup flow](/architecture/entry-point/): Process startup, database migrations, and
  subsystem initialization order.
- [Pipelines](/architecture/pipelines/): Stage-by-stage breakdowns of chat turns, context building,
  tool loops, provider streaming, and memory distillation.
- [Subsystems](/architecture/subsystems/): Explanations of persistence, caching, security,
  commands, and persona behavior.
- [Integrations](/architecture/integrations/): Platform guides for Discord UI components, Matrix
  bridging, NovelAI, SillyTavern, and voice channels.
- [Getting started](/contributing/getting-started/): Local development setup and contribution guide.

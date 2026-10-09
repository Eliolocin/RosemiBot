---
title: "TomoriBot Docs Index"
---

The docs site is organized as an audience gradient: curious visitor → user → self-hoster
→ contributor → deep-diver. Sidebar order follows that gradient.

> **Restructure in progress.** Many `introduction/`, `features/`, and `self-hosting/`
> pages are Phase 1 stubs (frontmatter + placeholder). Prose lands in Phase 2: see
> `plans/docs-site-restructure.md`.

## Introduction (order 1)

The marketing front door: what TomoriBot is and how to start using it.

- [`introduction/README.mdx`](./en/introduction/README.mdx): hero + feature-card deck (Phase 2)
- [`introduction/quickstart.md`](./en/introduction/quickstart.mdx): invite the public instance or self-host

## Features (order 2)

Capability-oriented pages for people *using* TomoriBot. Category pages with sections;
a section graduates to its own file when it outgrows ~2-3 screens or gains its own setup flow.

Pages are bucketed into task-based sub-categories, each with a landing card-grid README.

- [`features/README.mdx`](./en/features/README.mdx): capability tour card grid
- **Chatting & Personality**: [`chatting-personality/`](./en/features/chatting-personality/README.mdx)
  - [`chatting-and-triggers.md`](./en/features/chatting-personality/chatting-and-triggers/)
  - [`multiple-personas.md`](./en/features/chatting-personality/multiple-personas/)
  - [`behavior-tweaking.md`](./en/features/chatting-personality/behavior-tweaking/)
- **Knowledge**: [`knowledge/`](./en/features/knowledge/README.mdx)
  - [`memory.md`](./en/features/knowledge/memory/)
  - [`inside-the-prompt.md`](./en/features/knowledge/inside-the-prompt/)
  - [`personalization.md`](./en/features/knowledge/personalization/)
  - [`data-handling.md`](./en/features/knowledge/data-handling/)
- **Capabilities**: [`capabilities/`](./en/features/capabilities/README.mdx)
  - [`tools-and-extensions.md`](./en/features/capabilities/tools-and-extensions/)
  - [`scheduled-tasks.md`](./en/features/capabilities/scheduled-tasks/)
  - [`media-generation/`](./en/features/capabilities/media-generation/README.mdx): image, video, and voice generation
- **Setup & Administration**: [`setup-administration/`](./en/features/setup-administration/README.mdx)
  - [`providers-and-models.md`](./en/features/setup-administration/providers-and-models/)
  - [`server-moderation.md`](./en/features/setup-administration/server-moderation/)
  - [`age-restricted-commands.md`](./en/features/setup-administration/age-restricted-commands/)
  - [`stats-and-insights.md`](./en/features/setup-administration/stats-and-insights/)
- **Integrations**: [`integrations/`](./en/features/integrations/README.mdx)
  - [`matrix-bridge.md`](./en/features/integrations/matrix-bridge/)
  - [`sillytavern-support.md`](./en/features/integrations/sillytavern-support/)
- [`features/command-reference.md`](./en/features/command-reference/): generated from command locales (Phase 3)

## Self-Hosting (order 3)

Running your own instance: core install plus every optional module. You don't need the
source open to follow these.

- [`self-hosting/README.md`](./en/self-hosting/README.md): requirements + module directory
- [`self-hosting/setup-wizard.md`](./en/self-hosting/setup-wizard.md): guided `bun run setup`
- [`self-hosting/manual-setup.md`](./en/self-hosting/manual-setup.md): manual procedure for technical users
- [`self-hosting/docker-compose.md`](./en/self-hosting/docker-compose.md): containerized local bot + database
- [`self-hosting/local-endpoints/`](./en/self-hosting/local-endpoints/README.mdx): self-hosted endpoints hub
  - [`local-endpoints/setup-local-llm.md`](./en/self-hosting/local-endpoints/setup-local-llm.md)
  - [`local-endpoints/setup-comfyui.md`](./en/self-hosting/local-endpoints/setup-comfyui.md)
  - [`local-endpoints/setup-searxng.md`](./en/self-hosting/local-endpoints/setup-searxng.md)
  - [`local-endpoints/setup-crawl4ai.md`](./en/self-hosting/local-endpoints/setup-crawl4ai.md)
  - [`local-endpoints/setup-chatmock.md`](./en/self-hosting/local-endpoints/setup-chatmock.md)
  - [`local-endpoints/setup-local-mcp.md`](./en/self-hosting/local-endpoints/setup-local-mcp.md)
  - [`local-endpoints/text-to-speech/`](./en/self-hosting/local-endpoints/text-to-speech/README.mdx): local TTS engines
    - [`comparison.md`](./en/self-hosting/local-endpoints/text-to-speech/comparison.md): empirical benchmarks, audio sample playback, and speed comparisons
    - [`MOSS-TTS`](./en/self-hosting/local-endpoints/text-to-speech/moss.md): experimental clone and voice-design auto endpoint
  - [`local-endpoints/speech-to-text/`](./en/self-hosting/local-endpoints/speech-to-text/README.mdx): local STT engines
- [`self-hosting/maintenance.md`](./en/self-hosting/maintenance.md): maintenance scripts, updating, backups/restore
- [`self-hosting/safe-migration.md`](./en/self-hosting/safe-migration.md)
- [`self-hosting/local-monitoring.md`](./en/self-hosting/local-monitoring.md)

## Contributing (order 4)

Code-contribution guides: for extending or modifying the bot with the source open.
Start at [`contributing/development-tasks.md`](./en/contributing/development-tasks.md) for the
task index and coding conventions, and
[`contributing/getting-started.md`](./en/contributing/getting-started.md) for local dev setup.

Per-task guides:

- [`contributing/extending/slash-command.md`](./en/contributing/extending/slash-command.md)
- [`contributing/policies/command-archetypes.md`](./en/contributing/policies/command-archetypes.md): which kind of command or panel to build
- [`contributing/extending/panel.md`](./en/contributing/extending/panel.md): building a panel, or adding a button or select to one
- [`contributing/extending/event-handler.md`](./en/contributing/extending/event-handler.md)
- [`contributing/extending/builtin-tool.md`](./en/contributing/extending/builtin-tool.md)
- [`contributing/extending/feature-flag-tool.md`](./en/contributing/extending/feature-flag-tool.md)
- [`contributing/extending/setup-module.md`](./en/contributing/extending/setup-module.md)
- [`contributing/extending/db-column.md`](./en/contributing/extending/db-column.md)
- [`contributing/extending/new-provider.md`](./en/contributing/extending/new-provider.md)
- [`contributing/localization/new-locale.md`](./en/contributing/localization/new-locale.md): locale codes, UI strings, protocol keys, intent packs, seed descriptions, and the gate sequence
- [`contributing/localization/docs-site.md`](./en/contributing/localization/docs-site.md): publishing translated pages and READMEs, and their link rules
- [`contributing/extending/persona-preset.md`](./en/contributing/extending/persona-preset.md)
- [`contributing/extending/participant-extension.md`](./en/contributing/extending/participant-extension.md)
- [`contributing/extending/env-variable.md`](./en/contributing/extending/env-variable.md)
- [`contributing/policies/comments.md`](./en/contributing/policies/comments.md): durable comments and the advisory policy audit
- [`contributing/policies/panel-prose-and-layout.md`](./en/contributing/policies/panel-prose-and-layout.md): text width, markers, and structure inside a panel
- [`contributing/policies/raw-sql.md`](./en/contributing/policies/raw-sql.md): keeping raw SQL in the repository layer
- [`contributing/localization/docs-authoring.md`](./en/contributing/localization/docs-authoring.md): docs routes, frontmatter, sidebar, cards, and asset conventions
- [`contributing/policies/dependency-security.md`](./en/contributing/policies/dependency-security.md): dependency overrides, patches, and audit exceptions

Testing your changes:

- [`contributing/testing/db-changes.md`](./en/contributing/testing/db-changes.md)
- [`contributing/testing/chat-changes.md`](./en/contributing/testing/chat-changes.md)
- [`contributing/testing/module-mocks.md`](./en/contributing/testing/module-mocks.md): leak-safe Bun module mocks
- [`contributing/testing/maintainable-tests.md`](./en/contributing/testing/maintainable-tests.md): test patterns to avoid, with the reason for each

## Architecture (order 5)

Code-level reference for deep-divers and plugin authors.

- [`architecture/README.md`](./en/architecture/README.md): code-level overview
- [`architecture/entry-point.md`](./en/architecture/entry-point.md): startup and initialization flow

### Pipelines

Per-stage reference. Each folder has a `README.md` (overview + ASCII flow) and numbered stage files.

- [`architecture/pipelines/chat/`](./en/architecture/pipelines/chat/README.mdx): message ingress → per-turn execution
- [`architecture/pipelines/context-build/`](./en/architecture/pipelines/context-build/README.md): preset routing + native context assembly
- [`architecture/pipelines/tool-loop/`](./en/architecture/pipelines/tool-loop/README.md): tool-call dispatch loop
- [`architecture/pipelines/provider/`](./en/architecture/pipelines/provider/README.md): stream adapter → chunk normalization → Discord delivery
- [`architecture/pipelines/memory/`](./en/architecture/pipelines/memory/README.md): STM passive capture + LTM create/update/delete

### Subsystems

Supporting services that pipelines depend on.

- [`architecture/subsystems/`](./en/architecture/subsystems/README.md): database schema, events, commands, tools,
  caching, cooldowns, security, localization, multi-persona, persona-presets, and more

### Integrations

- [`architecture/integrations/`](./en/architecture/integrations/README.md): Discord platform, Matrix bridge,
  NovelAI, SillyTavern, and voice pipeline internals

### Cloud

Production infrastructure on cloud provider services (Azure, AWS, GCP).

These pages live on the `release` branch under `docs/en/wiki/cloud/`, next to the `terraform/` and
`deploy/` trees they document. A `main` checkout omits them so a self-hoster's clone carries only
the bot. Read one without switching branches:

```bash
git show release:docs/en/wiki/cloud/azure/azure-production-deployment.md
```

## Meet Tomori (order 6)

The persona gallery: a card deck introducing each of Tomori's "sisters" (the default
personas TomoriBot ships with). Card sources: `src/db/seed/catalog/personas/*`.

- [`meet-tomori/README.mdx`](./en/meet-tomori/README.mdx): hero + sister card deck (stub)
- [`meet-tomori/rose.md`](./en/meet-tomori/rose/): Default Tomori, the eldest
- [`meet-tomori/zaya.md`](./en/meet-tomori/zaya/): Prideful Tomori, the former esports champion
- [`meet-tomori/aphel.md`](./en/meet-tomori/aphel/): Gloomy Tomori, the exhausted advisor
- [`meet-tomori/lilya.md`](./en/meet-tomori/lilya/): Shy Tomori, the youngest
- [`meet-tomori/nerine.md`](./en/meet-tomori/nerine/): Loyal Tomori, the discontinued model
- [`meet-tomori/locke.md`](./en/meet-tomori/locke/): Unhinged Tomori, planned (replaces Temari)

## Wiki (hidden)

Reachable only via in-page links: not shown in the sidebar.

- [`wiki/production-tuning.md`](./en/wiki/production-tuning.md): deep operational tuning, container sizing, and incident recovery
- [`wiki/refactor-record.md`](./en/wiki/refactor-record.md): historical plugin-architecture-prerequisite refactor record
- [`wiki/threat-models.md`](./en/wiki/threat-models.md): security threat models

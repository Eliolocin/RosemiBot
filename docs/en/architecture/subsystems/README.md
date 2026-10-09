---
title: "Subsystems"
sidebar:
  label: "Overview"
  groupLabel: "Subsystems"
  order: 30
---

Subsystem documentation describes cross-cutting services and persistent domain capabilities that
support pipeline execution. These modules are organized by functional domain rather than execution
order.

## Subsystem directory

### Runtime and dispatch

- [Command System](/architecture/subsystems/command-system/): Slash command discovery, single-flight
  loading, category cooldown scaling, and Discord interaction timing patterns.
- [Event System](/architecture/subsystems/event-system/): Gateway and REST event dispatch connecting
  Discord events to runtime handlers.
- [Localization](/architecture/subsystems/localization/): Multi-locale translation resolution, dynamic
  string formatting, embed protocol persistence, and status circle styling.
- [Utilities](/architecture/subsystems/utils/): Cross-cutting runtime infrastructure, including ambient
  error attribution (`AsyncLocalStorage`), channel sendability checks, and SSRF security helpers.

### State and security

- [Database Schema](/architecture/subsystems/database-schema/): Relational PostgreSQL schema structure,
  split server configuration tables, copy-on-write persona pointers, and `/reset` domain boundaries.
- [Caching](/architecture/subsystems/caching/): In-memory caching layers, lazy TTL eviction, insert-time
  size bounding, and post-commit write invalidation.
- [Cooldowns](/architecture/subsystems/cooldowns/): Ephemeral rate limit tracking in unlogged tables,
  fail-open database resilience, and periodic cleanup.
- [Security](/architecture/subsystems/security/): SSRF protection with DNS pinning, PGP symmetric
  credential encryption (`pgcrypto`), and secret access boundaries.

### Persona and generation policy

- [Multi-Persona](/architecture/subsystems/multi-persona/): Main and alter persona configurations,
  lineage scoping, webhook identity masking, and keyword trigger routing.
- [Persona Presets](/architecture/subsystems/persona-presets/): Seed catalog definitions,
  copy-on-write pointers, asset storage reconciliation, and guild avatar updates.
- [Prompt Snapshot](/architecture/subsystems/prompt-snapshot/): Point-in-time capture and export of
  assembled prompt blocks for inspection and debugging.
- [Thinking Level](/architecture/subsystems/thinking-level/): Extended reasoning budgets, budget clamping
  across models, and provider parameter translation.
- [Strict Chat Completion](/architecture/subsystems/strict-chat-completion/): Request compatibility
  for role alternation, assistant prefill, and assistant media.
- [Logit Bias](/architecture/subsystems/logit-bias/): Token biasing rules and provider parameter mapping.

### Tools and auxiliary services

- [Tool System](/architecture/subsystems/tool-system/): Centralized tool registry coordinating built-in
  function calls, Model Context Protocol (MCP) servers, and search engines.
- [Status Command](/architecture/subsystems/status-command/): Server configuration dashboards,
  permission checks, and system diagnostics.
- [Stats Infographic](/architecture/subsystems/stats-infographic/): Usage counter aggregation, SVG
  infographic rendering, and model cost pricing.
- [Video Generation](/architecture/subsystems/video-generation/): ComfyUI and OpenRouter video generation
  workflows and TLS bypass handling.

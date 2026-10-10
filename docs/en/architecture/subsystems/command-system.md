---
title: "Command System"
---

TomoriBot loads Discord slash commands dynamically from `src/commands/` and dispatches interactions through a unified pipeline in `src/events/interactionCreate/handleCommands.ts`.

## Loader and execution pipeline

Command discovery and registration are managed by `src/utils/discord/commandLoader.ts`.

- **Directory structure:** The loader scans `src/commands/` for root command files (`subscribe.ts`) and nested folders (`export/personal/config.ts`). Root files represent top-level commands; nested folders map to `{category} {group} {subcommand}` or `{category} {subcommand}` hierarchies.
- **ES module loading:** `commandLoader.ts` uses asynchronous directory traversal and dynamic ES module imports (`await import()`). Command files may use top-level `await`.
- **Registration payload:** Command metadata is compiled into discord.js `SlashCommandBuilder` structures and registered with Discord at startup via `src/events/clientReady/01_registercommands.ts`.
- **Runtime execution map:** The loader constructs an in-memory `CommandExecutionMap` mapping each command path to its target execution function.

### Single-flight loading

`loadCommandData()` is called from two code paths: startup command registration and the first incoming interaction in `handleCommands.ts`. The loader memoizes evaluation behind a shared promise (`cachedCommandDataPromise`).

This single-flight pattern prevents startup race conditions. If an interaction arrives while startup registration is importing command modules, concurrent evaluation would interleave ES module loading. A second loader could read an export binding while the module remains in its Temporal Dead Zone, throwing initialization errors and silently dropping commands. The promise clears on catastrophic failure or an empty execution map, allowing subsequent interactions to retry.

### Import hygiene

Command modules import database repositories, which can lead to large dependency graphs. Data-layer modules (repositories, caches) must not import high-level runtime subsystems (context building, tools, webhooks, providers). Shared leaf constants must be imported directly from their owning leaf files rather than from barrel modules that re-export heavy subsystems.

## Command file contract

Subcommand modules export:

- `configureSubcommand(subcommand)`
- `execute(client, interaction, userData, locale)`

Root command modules export:

- `configureCommand(command)`
- `execute(client, interaction, userData, locale)`

Root command files may export optional boundary flags:

- `guildOnly = true`: restricts the command to Discord guild channels.
- `managerOnly = true`: requires the Discord `ManageGuild` permission.
- `nsfw = true`: marks the command as age-restricted.
- `isCommandEnabled(context)`: evaluated before registration; returning `false` omits the command from the registration payload and execution map.

Command metadata descriptions and choices are auto-localized by `commandLoader.ts`. Builders configure English text with `localizer("en-US", key)`. The loader matches keys across authored locale trees using `{option_name}_description` and `{choice_value}_option`.

## Runtime interaction dispatch

All Discord interactions arrive at `src/events/interactionCreate/handleCommands.ts`:

1. **Autocomplete:** If `interaction.isAutocomplete()` is true, routes to `runAutocompleteCommand()`.
2. **Chat-input slash commands:** If `interaction.isChatInputCommand()` is true, routes to `runChatInputCommand()`:
   - Resolves category, group, and subcommand names into an execution key.
   - Evaluates server blacklist status.
   - Checks category cooldown in `cooldownRepository`, scaling duration with `COMMAND_COOLDOWN_SCALE`.
   - Opens an ambient error context scope with `source: "command"`, enriching it with user and guild database IDs.
   - Calls the registered `execute(client, interaction, userData, locale)` function.
3. **Globally routed components and modals:** If `isGlobalRoutableInteraction()` is true, passes the interaction to `dispatchGlobalInteraction()`.

## Globally routed persistent interactions
<!-- anchor: globally-routed-persistent-interactions -->

TomoriBot separates bounded temporary interactions from persistent UI panels:

- **Collector-owned workflows:** Bounded command sessions that rely on in-memory message component collectors. When the collector times out or the process restarts, the controls deactivate.
- **Globally routed panels:** Persistent controls (such as `/help`, `/config`, `/moderation`, `/setup`, and `/expressions manage`) where every button click, select choice, or modal submit arrives as an independent `interactionCreate` event. State is reconstructed from the custom ID and database records rather than in-memory collectors.

Global dispatch mechanics:

- `src/utils/discord/interactions/routeRegistry.ts` parses custom IDs using the format `<namespace>:<version>:<action>:<state...>`.
- `src/utils/discord/interactions/router.ts` checks the registered route list.
- Unmatched IDs return `false`, allowing invocation-scoped collectors to process the interaction instead.
- Outdated route versions receive a localized stale-panel notice with instructions to re-invoke the command.
- Deferred panel branches call `beginPanelInteraction()` in `src/utils/discord/interactions/panelController.ts`. This helper calls `deferUpdate()` before authorization or state loading, preventing asynchronous database reads from exceeding Discord's acknowledgement deadline. Branches that open modals remain outside `beginPanelInteraction()` because `showModal()` must serve as the primary acknowledgement.

## Panel failure observability
<!-- anchor: panel-failure-observability -->

Panels communicate expected refusals by returning a status object (`{ status: "write-failed" }`) and repainting with an error or warning receipt. Because these paths do not throw unhandled exceptions, the router error handler does not observe them.

Panel failure metrics maintain visibility:

- `deliverGuardedPanel()` in `src/utils/discord/ui/interactionCore.ts` is the single choke point for guarded panel delivery.
- When delivery includes a receipt with `error` or `warning` tone, it emits a `panel_failure` metric containing the namespace, locale, tone, and machine `reason` key (`PanelReceipt.reason`).
- Failure metrics emit to two destinations: structured host logs via `log.metric`, and the database via `metricSampleRepository.recordSample("panel_failure", fields)`. The database write is non-blocking.
- Metric aggregation groups on the machine `reason` key rather than localized heading text, so failures across different languages aggregate into uniform defect categories.

## Interaction timing rules

Discord requires interaction acknowledgement within approximately three seconds of generation (`interaction.createdTimestamp`). An acknowledgement taking longer than 1.5 seconds emits a rate-limited latency warning (`INTERACTION_ACK_WARN_MS`). After acknowledgement, the bot has up to 15 minutes to complete work.

### Reply and deferral ownership

A fast command can reply directly. Commands that need database, network, or other asynchronous work acknowledge first with `deferReply()`. Synchronous rejection checks can run before deferral.

Opening a modal acknowledges the original interaction with `showModal()`, so pre-deferral prevents the modal from opening. Pre-modal reads must fit within the acknowledgement deadline. The modal submission is a new interaction: `promptWithRawModal()` can auto-defer that submission when passed `MessageFlags.Ephemeral`, or its caller can defer the returned submission before asynchronous work.

### Pattern 3A and 3B: Checkbox management modals

Used for managing collections of configuration settings (such as `/moderation` whitelists and `/config` channel rules) using Discord modal checkbox groups:

- Up to 50 options per modal (chunked into five groups of 10 options).
- Pre-check existing active settings; unchecking indicates removal or disabling.
- Reopening preloads current database state; submission writes the complete selection or computed diff.
- Database writes must invalidate associated caches in the same execution path upon transaction success.

### Pattern 4: Pagination helpers (no pre-defer)

Pagination helpers (`replyPaginatedChoices()` and `promptWithPaginatedModal()`) send their controls and own the initial acknowledgement. Pre-deferral conflicts with that ownership.

### Pattern 4A: Anchor message workflow
<!-- anchor: pattern-4a-anchor-message-workflow-persona-picker -->

The anchor message workflow in `src/utils/discord/ui/personaWorkflow.ts` powers multi-step persona pickers and complex configuration transactions.

- **Single message invariant:** One command invocation owns exactly one ephemeral Components V2 message (`selection.message.anchorMessageId`). That message is edited in place through every phase: selection, range pagination, modal launching, progress indicators, and terminal receipts.
- **Rationale:** Discord emits no event when a user dismisses a modal. Leaving a picker message active while opening a modal would leave dead interactive buttons if dismissed. Rendering all phases onto one anchor message and collapsing controls when a modal opens prevents stranded components.
- **First-acknowledgement contract:** Each phase operation owns its first acknowledgement. Calling raw interaction methods before a phase operation, or calling two first-acknowledgement operations on the same interaction, throws `PersonaWorkflowUpdateError` with code `already-acknowledged`.
- **Anchor message controller:** The controller exposes typed operations: `replace()`, `edit()`, `fetchMessage()`, `disableControls()`, and `delete()`. Payloads require `MessageFlags.IsComponentsV2` and `components`; legacy `content` and `embeds` fields are forbidden.

### Timing quick reference

| Command style | Defer before work? | Primary API |
|---|---|---|
| Simple and fast | No | `interaction.reply(...)` |
| Async DB or API operations | Yes | `interaction.deferReply(...)`, then helper reply |
| Modal prompt | No (before modal) | `promptWithRawModal(...)`, defer on submit if heavy |
| Pagination helper | No (before helper) | `replyPaginatedChoices(...)` / `promptWithPaginatedModal(...)` |
| Persona workflow | No | `runPersonaPickerWorkflow(...)`; phase operation owns acknowledgement |

## Response Drafting panel

`/config` > Plugins > Response Drafting stores workspace settings for guild managers and DM owners.
Reviewer, Decision and checker dropdowns render directly, like `/config` > Models; picking a provider
opens its model modal without changing the primary text model. Clearing the reviewer restores inheritance from the actual response model;
clearing Decisions or the checker stores None. A removed checker binding stays saved and unavailable.

The page shows availability, added time/cost and a shortened prompt preview. `Set Prompt` opens the
complete instructions in a prefilled 4,000-character modal; `Use Default` clears the override. Custom
prompts retain the Decision selection but disable skipping, and Decisions stay inactive while
calibration is absent; the page labels Decision models experimental. Persistence is described in
[database settings](database-schema.md#response-drafting-workspace-settings); runtime ownership is in
[generation review](../pipelines/chat/06-per-turn/03-run-generation-turn.md#response-text-review).

## Current Top-Level Categories

- `comment`
- `compact`
- `conditioning`
- `config`
- `context`
- `contribute`
- `donate`
- `export`
- `expressions`
- `generate`
- `help`
- `impersonate`
- `import`
- `kill`
- `learn`
- `legal`
- `matrix`
- `memories`
- `model`
- `moderation`
- `novelai`
- `nsfw`
- `nuke`
- `persona`
- `personal`
- `ping`
- `providers`
- `punish`
- `quota`
- `refresh`
- `reset`
- `respond`
- `reward`
- `scheduled-task`
- `setup`
- `stats`
- `status`
- `support`
- `tool`
- `troubleshoot`
- `update`

## Contributor guides

Procedures for adding commands and authoring UI panels belong to dedicated contributor guides:

- Authoring slash commands: [Adding a Slash Command](/contributing/extending/slash-command/)
- Command architecture selection: [Command Archetypes](/contributing/policies/command-archetypes/)
- Building Components V2 panels: [Adding a Panel](/contributing/extending/panel/)

## Source pointers

- `src/utils/discord/commandLoader.ts`: dynamic command discovery and metadata localization.
- `src/events/interactionCreate/handleCommands.ts`: interaction routing, cooldowns, and error context attribution.
- `src/utils/discord/interactions/router.ts`: persistent interaction routing and custom ID dispatch.
- `src/utils/discord/interactions/panelController.ts`: panel interaction acknowledgement timing and guarded delivery.
- `src/utils/discord/ui/personaWorkflow.ts`: anchor message lifecycle and phase operations.
- `src/utils/discord/ui/interactionCore.ts`: guarded panel delivery and panel failure metrics.

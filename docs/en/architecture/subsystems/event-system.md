---
title: "Event System"
---

TomoriBot routes Discord gateway events and REST rate-limit notifications through one dispatcher in `src/handlers/eventHandler.ts`.

## Dispatcher model

The dispatcher maps Discord event names to folder names under `src/events/` using `eventFolderMap`.

- **Shallow module discovery:** At startup, `getHandlerFiles()` scans for `*.ts` files directly inside each mapped folder. Subdirectories are ignored by the loader, reserving nested folders under `src/events/<eventName>/` for event-local helper modules.
- **Lexical execution order:** Handlers within a folder are imported dynamically and sorted alphabetically by filename before caching. When an event fires, its handlers execute sequentially in that order.
- **Isolated execution:** Each handler runs in its own `try...catch` block. A thrown error in one handler logs structured metadata (`EventHandlerError`) without preventing subsequent handlers from executing for that event.
- **Activity tracking:** Dispatched gateway events call `healthTracker.recordActivity()`. The health endpoint reports activity age as a diagnostic; readiness and WebSocket ping determine its verdict.
- **Fan-in mapping:** Multiple Discord events can map to a single handler folder. For example, `emojiCreate`, `emojiDelete`, and `emojiUpdate` all route to `guildEmojisUpdate`, while `stickerCreate`, `stickerDelete`, and `stickerUpdate` route to `guildStickersUpdate`.

## REST rate limits

REST rate limits arrive on `client.rest.on("rateLimited", ...)`. In discord.js v14, the REST rate limiter is owned by the REST client. `setupEventListeners()` checks for the `rateLimit` folder separately and registers the listener on `client.rest` rather than the gateway client.

## Primary event flows

### Slash commands and interactions

The gateway event `interactionCreate` routes to `src/events/interactionCreate/handleCommands.ts`. The handler separates chat-input commands, autocomplete requests, and globally routed component or modal interactions, dispatching each to its respective runner. See [Command System](/architecture/subsystems/command-system/) for interaction lifecycle and timing constraints.

### Chat messages

The `messageCreate` event routes to `src/events/messageCreate/tomoriChat.ts`. The handler normalizes incoming messages, evaluates server admission and ignore rules, manages per-channel execution queues, and runs turn planning and generation. See [Normalize Invocation](/architecture/pipelines/chat/01-normalize-invocation/) for chat normalization and admission details.

### Startup initialization

The `clientReady` event runs startup initialization tasks, including registering application slash commands with Discord (`src/events/clientReady/01_registercommands.ts`) and initializing Model Context Protocol (MCP) servers.

### Member joins and the welcome gate

The `guildMemberAdd` event routes to `src/events/guildMemberAdd/newUser.ts`:

- Registers the user row in the database via `userRepository.register`.
- Evaluates guild welcome configuration. If the server has Membership Screening or Onboarding enabled, `helpers/welcomeGate.ts` retains an in-memory waiter per member until screening clears and onboarding completes (`CompletedOnboarding` flag on `guildMemberUpdate`).
- If the member leaves before clearing screening, `guildMemberRemove` cancels the waiter. Waiters that never resolve are dropped after one hour (`WELCOME_GATE_MAX_WAIT_MS`).
- Once screening clears, the handler verifies the member is still in the guild and invokes the welcome greeting through the standard chat coordinator pipeline.

## Extending event handling

Adding a new event handler or mapping a new Discord event is documented in the contributor guide [Adding an Event Handler](/contributing/extending/event-handler/).

## Source pointers

- `src/handlers/eventHandler.ts`: single event dispatcher and listener setup.
- `src/events/interactionCreate/handleCommands.ts`: slash command, autocomplete, and interaction dispatch.
- `src/events/messageCreate/tomoriChat.ts`: chat pipeline entry point.
- `src/events/guildMemberAdd/newUser.ts`: member registration and welcome gate runner.
- `src/utils/misc/healthTracker.ts`: liveness tracking.

---
title: "Adding an Event Handler"
sidebar:
  order: 10
aiGenerated: true
---

How to handle a new Discord event.

1. Create `src/events/{folderName}/` if the event has no folder yet.
2. Add a file whose default export takes the discord.js payload for that event.
3. Map the event name to the folder in `eventFolderMap` in `src/handlers/eventHandler.ts`.

Run `bun run check` and `bun run lint`, restart the bot, trigger the event in Discord, and confirm the
handler runs without errors. Conventions: [Event System](/architecture/subsystems/event-system/).

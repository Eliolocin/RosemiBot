---
title: "Matrix Bridge"
sidebar:
  order: 1
---

Bridge a Matrix room to a Discord channel so people can chat across both platforms.
Messages sent from Matrix appear in Discord as webhook messages, and TomoriBot replies
directly into the Matrix room.

For appservice hosting and deployment architecture, see the
[Matrix bridge architecture](/architecture/integrations/matrix/bridge/).

## Setup

1. Invite the Matrix bot account to an unencrypted Matrix room.
2. Copy that room's Internal Room ID (in most clients: `Room Settings` > `Advanced` > `Internal Room ID`, formatted like `!abc:matrix.org`).
3. Run `/matrix link` in the Discord channel you want to bridge, and paste the room ID.

After the bot joins, it posts a confirmation in Matrix, but you must complete the link
from Discord using `/matrix link`. To disconnect a bridged channel later, run `/matrix unlink`.

## Using It From Matrix

- Chat normally once the room is linked. Matrix messages relay into the Discord channel.
- TomoriBot replies back into the Matrix room.
- The supported Matrix text commands are `/kill` and `/refresh`.

## Current Limitations

- No slash commands from Matrix (beyond `/kill` and `/refresh`).
- No direct messages or DM-based cooldown reminders.
- Matrix avatars are not visible to the bot's vision features.
- Message pinning is unavailable.
- Custom emojis and complex formatting do not render reliably; embeds relay as plain text.
- Personal memories for Matrix users fall back to attributed server memories.

## Notes

- If the bot does not join automatically, invite the Matrix bot account manually and rerun `/matrix link`.
- Matrix encryption cannot be disabled after room creation: an encrypted room must be replaced with a fresh unencrypted room.
- To unlink a channel, use `/matrix unlink`.
- If an issue is not listed above, report it in the support server with `/support discord`.

In `/help`, choose `Plugins`, then `Matrix`, for the interactive walkthrough in Discord.

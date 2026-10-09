export default {
  matrix: {
    encryption_unlinked: {
      title: `Matrix Bridge Stopped`,
      description: `The Matrix room \`{room_id}\` turned on end-to-end encryption, so I unlinked it from this channel and stopped relaying messages. Matrix encryption can't be turned off.

To keep bridging, create a new unencrypted Matrix room, invite the bot account, and link it with {link_command}.`,
    },
    notices: {
      invited: `TomoriBot joined this room.

To finish setup:
1. In Discord, run {link_command} in the channel you want to bridge.
2. Paste this room's Internal Room ID from {room_id_path}.

Important:
- This room must stay unencrypted.
- Once linked, you can talk here normally.
- The only Matrix text commands are {kill_command} and {refresh_command}.

Use {help_command} in Discord for the full guide and limitation list.`,
      linked: `This room is now bridged to the Discord channel {channel_name}.

Quick tips:
- Chat here normally to talk to TomoriBot.
- The only Matrix text commands are {kill_command} and {refresh_command}.
- Slash commands, DMs, and pinning are not available from Matrix.
- Custom emojis/Markdown do not render reliably, and embeds relay as plain text.
- Personal memories for Matrix users fall back to server memories.

Use {help_command} in Discord for the full guide and current limitations.`,
    },
  },
};

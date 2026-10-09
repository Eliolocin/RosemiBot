export default {
  troubleshoot: {
    description: "Get help with something TomoriBot did.",
    chat: {
      description: "Make a private file about a recent chat problem.",
      message_description: "Optional link to your message or TomoriBot's reply in this channel.",
      minutes_description: "About how many minutes ago the problem happened (1-60).",
      invalid_request_title: "Invalid Request",
      choose_one: "Use either a message link or minutes ago.",
      invalid_minutes: "Choose a number of minutes from 1 to 60.",
      invalid_link: "Use a Discord message link from this channel.",
      no_recent_chat_title: "No Recent Chat Details",
      no_recent_chat:
        "I couldn't find recent chat details for one of your messages here. Try right after the problem happens, or use a message link from the past hour.",
      dm_title: "Chat Troubleshooting File",
      dm_description:
        "Here's your chat troubleshooting file. It contains event times and counts, with no chat text or raw user and message IDs, so you can share it when asking for help.",
      success_title: "Troubleshooting File Ready",
      dm_sent: "I sent the troubleshooting file to your DMs.",
      dm_fallback: "I couldn't DM you, so I've attached the troubleshooting file here privately instead.",
    },
  },
};

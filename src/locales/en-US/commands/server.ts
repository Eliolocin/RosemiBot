export default {
  server: {
    timezone: {
      value_description: `UTC offset hours (default: 0). Examples: 8, -5, 0, 9.`,
    },
    stm: {
      parameters: {
        supersede_option: `Supersede (categories replace crude turns)`,
        crude_summary_option: `Crude + summary (show both additively)`,
      },
      "prompt-edit": {
        tool_description_label: `Tool Description`,
        tool_description_description: `How the STM tool is described to the model.`,
        update_nudge_label: `Memory Nudge`,
        update_nudge_description: `Prompt injected into context that nudges the model to use the STM tool.`,
      },
      "categories-edit": {
        slot_1_label: `Category 1`,
        slot_2_label: `Category 2`,
        slot_3_label: `Category 3`,
        slot_4_label: `Category 4`,
        slot_5_label: `Category 5`,
        slot_instructions: `Box = "Label: Description" (e.g. "Goals: party objectives"). Empty skipped; clear all resets.`,
        slot_placeholder: `Label: Description`,
      },
    },
    "crosschannel-blocklist": {
      channel_label_forum: `{channel_name} [Forum]`,
      channel_label_media: `{channel_name} [Media]`,
    },
    cooldown: {
      triggers: {
        cooldown_type_description: `How cooldowns apply (default: off; per-user, per-channel, server-wide).`,
        cooldown_length_description: `Cooldown duration in seconds (1-86400, default: 5).`,
        type: {
          choice_off: `Off`,
          choice_per_user: `Per-User`,
          choice_per_channel: `Per-Channel`,
          choice_server_wide: `Server-Wide`,
          choice_strict_server_wide: `Strict Server-Wide`,
        },
      },
    },
    "member-permissions": {
      servermemories_option: `Server Memories`,
      attributelist_option: `Attribute List`,
      sampledialogues_option: `Sample Dialogues`,
      promptsnapshot_option: `Prompt Snapshots`,
      servermemories_desc: `Add/remove server-wide memories`,
      attributelist_desc: `Add/remove personality attributes`,
      sampledialogues_desc: `Add/remove sample dialogue pairs`,
      promptsnapshot_desc: `View full prompts from /context and /tool prompt snapshot`,
      select_placeholder: `Select what members can do with me`,
      select_embed_title: `Server Member Permissions`,
      select_embed_description: `Select which things non-admin members can do. Checked = allowed.`,
    },

    alwaysreply: {
      description: `Toggle always-reply mode for the main persona.`,
    },
    deliberatetriggermode: {
      description: `Toggle deliberate trigger mode (DTM) for this server.`,
    },
    deliberatetoolmode: {
      description: `Toggle deliberate tool mode for this server.`,
    },
    "deliberate-tool-mode": {
      description: `Toggle deliberate tool mode for this server.`,
    },
  },
};

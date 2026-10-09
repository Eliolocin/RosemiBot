export default {
  server: {
    timezone: {
      value_description: `UTC 偏移小时数（默认：0）。例如：8、-5、0、9。`,
    },
    stm: {
      parameters: {
        supersede_option: `取代（分类替换原始对话轮次）`,
        crude_summary_option: `原始对话轮次 + 摘要（两者叠加显示）`,
      },
      "prompt-edit": {
        tool_description_label: `工具说明`,
        tool_description_description: `STM 工具在模型眼中的说明。`,
        update_nudge_label: `记忆提示`,
        update_nudge_description: `注入上下文的提示词，提醒模型使用 STM 工具。`,
      },
      "categories-edit": {
        slot_1_label: `分类 1`,
        slot_2_label: `分类 2`,
        slot_3_label: `分类 3`,
        slot_4_label: `分类 4`,
        slot_5_label: `分类 5`,
        slot_instructions: `输入框格式为「标签：描述」（例如「Goals: 队伍目标」）。留空会跳过；全部清空则恢复默认。`,
        slot_placeholder: `标签：描述`,
      },
    },
    "crosschannel-blocklist": {
      channel_label_forum: `{channel_name} [论坛]`,
      channel_label_media: `{channel_name} [媒体]`,
    },
    cooldown: {
      triggers: {
        cooldown_type_description: `冷却如何生效（默认：关闭；按用户、按频道、全服务器）。`,
        cooldown_length_description: `冷却时间，单位为秒（1-86400，默认：5）。`,
        type: {
          choice_off: `关闭`,
          choice_per_user: `按用户`,
          choice_per_channel: `按频道`,
          choice_server_wide: `全服务器`,
          choice_strict_server_wide: `严格全服务器`,
        },
      },
    },
    "member-permissions": {
      servermemories_option: `服务器记忆`,
      attributelist_option: `属性列表`,
      sampledialogues_option: `示例对话`,
      promptsnapshot_option: `提示词快照`,
      servermemories_desc: `添加或移除服务器级记忆`,
      attributelist_desc: `添加或移除性格属性`,
      sampledialogues_desc: `添加或移除示例对话对`,
      promptsnapshot_desc: `从 /context 和 /tool prompt snapshot 查看完整提示词`,
      select_placeholder: `选择成员可以对我做什么`,
      select_embed_title: `服务器成员权限`,
      select_embed_description: `选择非管理员成员可以做的事。勾选表示允许。`,
    },
    alwaysreply: {
      description: `切换主人格的始终回复模式。`,
    },
    deliberatetriggermode: {
      description: `切换这个服务器的明确触发模式（DTM）。`,
    },
    deliberatetoolmode: {
      description: `切换这个服务器的明确工具模式。`,
    },
    "deliberate-tool-mode": {
      description: `切换这个服务器的明确工具模式。`,
    },
  },
};

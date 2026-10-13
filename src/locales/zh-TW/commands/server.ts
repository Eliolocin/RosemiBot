export default {
  server: {
    timezone: {
      value_description: `UTC 位移時數（預設：0）。範例：8、-5、0、9。`,
    },
    stm: {
      parameters: {
        supersede_option: `取代（分類取代原始對話輪）`,
        crude_summary_option: `原始 + 摘要（兩者並列顯示）`,
      },
      "prompt-edit": {
        tool_description_label: `工具說明`,
        tool_description_description: `向模型描述 STM 工具的方式。`,
        update_nudge_label: `記憶提醒`,
        update_nudge_description: `注入脈絡的提示詞，提醒模型使用 STM 工具。`,
      },
      "categories-edit": {
        slot_1_label: `分類 1`,
        slot_2_label: `分類 2`,
        slot_3_label: `分類 3`,
        slot_4_label: `分類 4`,
        slot_5_label: `分類 5`,
        slot_instructions: `欄位格式為「標籤：說明」（例如「目標：隊伍任務」）。留空會略過；全部清除則重設。`,
        slot_placeholder: `標籤：說明`,
      },
    },
    "crosschannel-blocklist": {
      channel_label_forum: `{channel_name} [論壇]`,
      channel_label_media: `{channel_name} [媒體]`,
    },
    cooldown: {
      triggers: {
        cooldown_type_description: `冷卻的套用方式（預設：關閉；每位使用者、每個頻道、整個伺服器）。`,
        cooldown_length_description: `冷卻時間長度，以秒為單位（1-86400，預設：5）。`,
        type: {
          choice_off: `關閉`,
          choice_per_user: `每位使用者`,
          choice_per_channel: `每個頻道`,
          choice_server_wide: `整個伺服器`,
          choice_strict_server_wide: `嚴格整個伺服器`,
        },
      },
    },
    "member-permissions": {
      servermemories_option: `伺服器記憶`,
      attributelist_option: `屬性清單`,
      sampledialogues_option: `範例對話`,
      promptsnapshot_option: `提示詞快照`,
      servermemories_desc: `新增或移除伺服器層級的記憶`,
      attributelist_desc: `新增或移除人格屬性`,
      sampledialogues_desc: `新增或移除範例對話配對`,
      promptsnapshot_desc: `從 /context 與 /tool prompt snapshot 檢視完整提示詞`,
      select_placeholder: `選擇成員可以對我做的事`,
      select_embed_title: `伺服器成員權限`,
      select_embed_description: `選擇非管理員成員可以做的事。勾選代表允許。`,
    },

    alwaysreply: {
      description: `切換主要人格的總是回覆模式。`,
    },
    deliberatetriggermode: {
      description: `切換這個伺服器的明確觸發模式（DTM）。`,
    },
    deliberatetoolmode: {
      description: `切換這個伺服器的明確工具模式。`,
    },
    "deliberate-tool-mode": {
      description: `切換這個伺服器的明確工具模式。`,
    },
  },
};

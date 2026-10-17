export default {
  conditioning: {
    description: `管理長期保留的獎勵與懲罰制約記憶。`,
    shared: {
      reason_line: `原因：\`\`{reason}\`\``,
      reward_footer: `❤️ {bot} 會記住這件事。用 /conditioning 管理。`,
      punish_footer: `💀 {bot} 會記住這件事。用 /conditioning 管理。`,
      persona_access_blocked_title: `沒有可用的人格`,
      persona_access_blocked_description: `依你目前的白名單權限與個人聚光燈設定，這個頻道沒有可用於這次互動的人格。`,
      marker_reward: `❤️`,
      marker_punish: `💀`,
      option_reason_description: `共 {count} 次 • 原因：「{reason}」`,
      option_reason_description_single: `原因：「{reason}」`,
      option_label: `{type_marker} {persona_name} • {action}`,
    },
    manage: {
      description: `管理這個伺服器所有注入的制約紀錄。`,
    },
    remove: {
      description: `移除這個伺服器所有人格的制約紀錄。`,
      empty_title: `沒有制約記憶`,
      empty_description: `這個伺服器沒有可管理的長期制約紀錄。`,
      page_select_prompt: `找到 {total} 筆制約紀錄。選擇一批來移除：`,
      page_select_prompt_capped: `找到 {total} 筆制約紀錄。下面是最近顯示的
{shown} 筆，移除一些就能觸及其餘項目。`,
    },
    panel: {
      remove_modal_title: `移除制約`,
      remove_checkbox_label: `制約紀錄`,
      remove_checkbox_label_continued: `制約紀錄（續）`,
      remove_checkbox_description: `取消勾選你想移除的任何制約紀錄。`,
      stale_heading: `面板已過期`,
      stale_detail: `制約紀錄已變更。面板已重新整理。`,
      no_changes_heading: `沒有變更`,
      no_changes_detail: `沒有取消勾選任何制約紀錄。`,
      success_heading: `制約已移除`,
      success_detail: `已移除 {count} 筆制約紀錄。`,
      write_failed_heading: `更新失敗`,
      write_failed_detail: `無法儲存這項變更。請再試一次。`,
    },
  },
};

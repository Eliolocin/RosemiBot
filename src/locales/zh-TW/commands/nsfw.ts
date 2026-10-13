export default {
  nsfw: {
    description: `年齡限制的指令與設定。`,
    persona: {
      description: `年齡限制的人格指令。`,
      default: {
        description: `套用 NSFW 的預設人格設定`,
      },
      import: {
        description: `從 PNG、JSON 或 CHARX 檔匯入人格，包含 NSFW 人格`,
      },
    },
    jailbreaks: {
      description: `管理這個伺服器上我提示詞的選用越獄行為。`,
      modal_title: `管理越獄策略`,
      checkbox_label: `已啟用的越獄策略`,
      checkbox_description: `已勾選的策略會保持啟用。未勾選的策略則會停用。`,
      injection_option: `提示詞注入（18+ 確認）`,
      unicode_spaces_option: `Unicode 空格取代`,
      sanitize_option: `敏感詞彙處理`,
      no_changes_title: `沒有變更`,
      no_changes_description: `越獄策略清單沒有變更。`,
      success_title: `越獄策略已更新`,
      success_description: `已更新你的越獄策略設定。目前啟用 **{enabled_count}** 個選項。`,
    },
  },
};

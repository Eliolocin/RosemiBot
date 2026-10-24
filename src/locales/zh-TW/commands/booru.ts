export default {
  booru: {
    description: `尋找現有的動漫插圖`,
    search: {
      description: `根據一個或兩個標籤隨機發送 4 張評價良好的 Danbooru 圖片`,
      tag_description: `角色、作品名稱或標籤（輸入時顯示建議）`,
      second_tag_description: `可選的第二個標籤，用於縮小搜尋範圍`,
      rating_description: `顯示哪個分級的圖片（預設：普遍級與敏感）`,
      general_option: `普遍級（General）`,
      sensitive_option: `敏感（Sensitive）`,
      questionable_option: `存疑（Questionable，僅限年齡限制頻道）`,
      explicit_option: `限制級（Explicit，僅限年齡限制頻道）`,
      rating_restricted_title: `此分級需要年齡限制頻道`,
      rating_restricted_description: `存疑與限制級內容僅在標記為年齡限制的頻道中顯示。請選擇普遍級或敏感，或在年齡限制頻道中執行此指令。`,
      no_results_title: `找不到圖片`,
      no_results_description: `Danbooru 上沒有符合 {query} 的高評價圖片。請檢查拼字，或嘗試使用單一標籤。`,
      error_title: `Danbooru 沒有回應`,
      error_description: `請稍後再試。`,
    },
  },
};

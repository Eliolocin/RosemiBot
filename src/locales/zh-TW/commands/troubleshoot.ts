export default {
  troubleshoot: {
    description: "針對 TomoriBot 的行為取得協助與排查問題。",
    chat: {
      description: "建立一份關於近期聊天問題的私人診斷檔案。",
      message_description: "可選填此頻道中你的訊息或 TomoriBot 回覆的連結。",
      minutes_description: "問題大約發生在幾分鐘前（1 到 60）。",
      invalid_request_title: "🔴 請求無效",
      choose_one: "訊息連結與發生分鐘數只能二選一。",
      invalid_minutes: "請選擇 1 到 60 之間的分鐘數。",
      invalid_link: "請使用此頻道的 Discord 訊息連結。",
      no_recent_chat_title: "🟡 找不到近期聊天詳情",
      no_recent_chat: "我在此處找不到你某則訊息的近期聊天詳情。請在問題發生後立即重試，或使用過去一小時內的訊息連結。",
      dm_title: "聊天問題排查檔案",
      dm_description:
        "這是你的聊天問題排查檔案。內容包含事件時間與次數，不包含任何聊天文字或原始使用者與訊息 ID，你可以在尋求協助時放心分享。",
      success_title: "🟢 排查檔案已就緒",
      dm_sent: "我已將排查檔案傳送到你的私訊。",
      dm_fallback: "我無法傳送私訊給你，因此改為在此處以私人方式附加排查檔案。",
    },
  },
};

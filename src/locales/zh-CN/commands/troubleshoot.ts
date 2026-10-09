export default {
  troubleshoot: {
    description: "针对 TomoriBot 的行为获取帮助与排查问题。",
    chat: {
      description: "生成一份关于近期聊天问题的私密诊断文件。",
      message_description: "可选提供此频道中你的消息或 TomoriBot 回复的链接。",
      minutes_description: "问题发生在大约多少分钟前（1 到 60）。",
      invalid_request_title: "🔴 请求无效",
      choose_one: "消息链接与发生分钟数只能二选一。",
      invalid_minutes: "请选择 1 到 60 之间的分钟数。",
      invalid_link: "请使用当前频道的 Discord 消息链接。",
      no_recent_chat_title: "🟡 未找到近期聊天详情",
      no_recent_chat: "我在这里没找到你某条消息的近期聊天详情。请在问题发生后立即重试，或使用过去一小时内的消息链接。",
      dm_title: "聊天问题排查文件",
      dm_description:
        "这是你的聊天问题排查文件。它记录了事件时间与次数，不包含任何聊天文本或原始用户及消息 ID，你可以放心在寻求帮助时分享。",
      success_title: "🟢 排查文件已就绪",
      dm_sent: "我已将排查文件发送到你的私信。",
      dm_fallback: "我无法向你发送私信，因此改为在这里私密附上排查文件。",
    },
  },
};

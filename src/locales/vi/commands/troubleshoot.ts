export default {
  troubleshoot: {
    description: "Nhận trợ giúp về những gì TomoriBot đã thực hiện.",
    chat: {
      description: "Tạo tệp riêng tư về sự cố trò chuyện gần đây.",
      message_description: "Liên kết tùy chọn đến tin nhắn của bạn hoặc câu trả lời của TomoriBot trong kênh này.",
      minutes_description: "Khoảng bao nhiêu phút trước khi sự cố xảy ra (1-60).",
      invalid_request_title: "🔴 Yêu cầu không hợp lệ",
      choose_one: "Vui lòng chỉ dùng liên kết tin nhắn hoặc số phút trước.",
      invalid_minutes: "Hãy chọn số phút từ 1 đến 60.",
      invalid_link: "Hãy dùng liên kết tin nhắn Discord từ kênh này.",
      no_recent_chat_title: "🟡 Không có thông tin trò chuyện gần đây",
      no_recent_chat:
        "Mình không tìm thấy thông tin trò chuyện gần đây cho tin nhắn của bạn ở đây. Hãy thử lại ngay sau khi sự cố xảy ra, hoặc dùng liên kết tin nhắn trong vòng một giờ qua.",
      dm_title: "Tệp chẩn đoán sự cố trò chuyện",
      dm_description:
        "Đây là tệp chẩn đoán sự cố trò chuyện của bạn. Tệp chứa thời gian và số lượng sự kiện, không có nội dung trò chuyện hay ID thô của người dùng và tin nhắn, vì vậy bạn có thể yên tâm chia sẻ khi cần trợ giúp.",
      success_title: "🟢 Tệp chẩn đoán đã sẵn sàng",
      dm_sent: "Mình đã gửi tệp chẩn đoán vào tin nhắn trực tiếp của bạn.",
      dm_fallback:
        "Mình không thể gửi tin nhắn trực tiếp cho bạn, nên mình đã đính kèm tệp chẩn đoán riêng tư tại đây.",
    },
  },
};

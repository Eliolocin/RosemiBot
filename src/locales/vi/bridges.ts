export default {
  matrix: {
    encryption_unlinked: {
      title: `Cầu nối Matrix đã dừng`,
      description: `Phòng Matrix \`{room_id}\` đã bật mã hóa đầu cuối, vì vậy mình đã hủy liên kết phòng khỏi kênh này và dừng chuyển tiếp tin nhắn. Mã hóa Matrix không thể tắt sau khi đã bật.

Để tiếp tục cầu nối, hãy tạo một phòng Matrix mới không mã hóa, mời tài khoản bot và liên kết lại bằng {link_command}.`,
    },
    notices: {
      invited: `TomoriBot đã tham gia phòng này.

Để hoàn tất thiết lập:
1. Trên Discord, chạy {link_command} ở kênh muốn liên kết.
2. Dán ID phòng nội bộ lấy từ {room_id_path}.

Quan trọng:
- Phòng này phải luôn không mã hóa.
- Sau khi liên kết, bạn có thể trò chuyện bình thường.
- Lệnh Matrix duy nhất là {kill_command} và {refresh_command}.

Dùng {help_command} trên Discord để xem hướng dẫn và giới hạn.`,
      linked: `Phòng này hiện đã liên kết với kênh Discord {channel_name}.

Mẹo nhanh:
- Trò chuyện tại đây để nói chuyện với TomoriBot.
- Lệnh Matrix duy nhất là {kill_command} và {refresh_command}.
- Lệnh slash, DM và ghim tin nhắn không dùng được từ Matrix.
- Emoji/Markdown hiển thị kém, embed chuyển thành văn bản thuần.
- Bộ nhớ cá nhân cho Matrix sẽ dùng bộ nhớ máy chủ.

Dùng {help_command} trên Discord để xem hướng dẫn và giới hạn.`,
    },
  },
};

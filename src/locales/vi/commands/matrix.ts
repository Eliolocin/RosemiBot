export default {
  matrix: {
    description: `Liên kết kênh Discord với phòng Matrix để chuyển tiếp hai chiều.`,
    link: {
      description: `Liên kết kênh Discord với phòng Matrix để chuyển tiếp hai chiều`,
      channel_description: `Kênh Discord cần liên kết`,
      room_description: `ID phòng Matrix cần liên kết (vd: !abc:matrix.org)`,
      success_title: `Đã liên kết phòng Matrix`,
      success_description: `<#{channel_id}> hiện đã kết nối với \`{room_id}\`. Tin nhắn từ mình sẽ xuất hiện trong phòng Matrix và tin nhắn Matrix sẽ xuất hiện tại đây.

Mở {help_matrix}, sau đó vào Tích hợp > Matrix để xem các bước thiết lập, lưu ý lệnh Matrix và danh sách hạn chế hiện tại.`,
      invalid_room_title: `ID phòng không hợp lệ`,
      invalid_room_description: `ID phòng Matrix phải bắt đầu bằng \`!\` và chứa dấu \`:\` (vd: \`!abc:matrix.org\`). Vui lòng kiểm tra lại ID phòng và thử lại.`,
      join_failed_description: `<#{channel_id}> đã được liên kết với \`{room_id}\`, nhưng mình không thể tự động tham gia phòng Matrix. Vui lòng mời \`{bot_user_id}\` vào phòng theo cách thủ công. Nếu bạn cần các bước thiết lập và danh sách giới hạn, hãy mở {help_matrix} và vào Tích hợp > Matrix.`,
      encrypted_room_title: `Không thể liên kết phòng được mã hóa`,
      encrypted_room_description: `\`{room_id}\` đang bật mã hóa đầu cuối. Không thể tắt mã hóa Matrix sau khi đã thiết lập, vì vậy không thể dùng phòng này để bắc cầu. Vui lòng tạo một phòng Matrix mới **không** mã hóa và mời \`{bot_user_id}\` vào đó.`,
      encryption_unknown_title: `Không thể xác minh mã hóa phòng`,
      encryption_unknown_description: `Mình không thể xác nhận rằng \`{room_id}\` không mã hóa, vì vậy mình chưa liên kết phòng. Mình chỉ bắc cầu cho những phòng có thể xác minh, vì tin nhắn được chuyển tiếp dưới dạng văn bản thuần.

Hãy mời \`{bot_user_id}\` vào phòng, đợi bot tham gia rồi chạy lại lệnh này. Nếu bot đã ở trong phòng, homeserver có thể đang không thể kết nối, hãy thử lại sau vài phút.`,
      matrix_not_configured_title: `Cầu nối Matrix không khả dụng`,
      matrix_not_configured_description: `Cầu nối Matrix chưa được cấu hình trên bot này. Hãy liên hệ với chủ bot để bật tính năng.`,
    },
    unlink: {
      description: `Xóa liên kết cầu nối Matrix khỏi một kênh Discord`,
      channel_description: `Kênh Discord cần hủy liên kết khỏi phòng Matrix`,
      success_title: `Đã hủy liên kết phòng Matrix`,
      success_description: `<#{channel_id}> không còn kết nối với bất kỳ phòng Matrix nào.`,
      not_linked_title: `Chưa liên kết`,
      not_linked_description: `<#{channel_id}> chưa được liên kết với phòng Matrix nào.`,
    },
  },
};

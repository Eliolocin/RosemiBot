export default {
  nsfw: {
    description: `Các lệnh và cài đặt giới hạn độ tuổi.`,
    persona: {
      description: `Các lệnh persona giới hạn độ tuổi.`,
      default: {
        description: `Áp dụng cấu hình preset persona NSFW`,
      },
      import: {
        description: `Nhập persona từ tệp PNG, JSON hoặc CHARX, bao gồm cả persona NSFW`,
      },
    },
    jailbreaks: {
      description: `Quản lý các hành vi jailbreak tùy chọn cho prompt của mình trên máy chủ này.`,
      modal_title: `Quản lý chiến lược jailbreak`,
      checkbox_label: `Chiến lược jailbreak đã bật`,
      checkbox_description: `Chiến lược được tích sẽ bật. Chiến lược bỏ tích sẽ bị tắt.`,
      injection_option: `Prompt Injection (xác nhận 18+)`,
      unicode_spaces_option: `Thay thế khoảng trắng Unicode`,
      sanitize_option: `Khử trùng từ nhạy cảm`,
      no_changes_title: `Không có thay đổi nào`,
      no_changes_description: `Danh sách chiến lược jailbreak được giữ nguyên.`,
      success_title: `Đã cập nhật chiến lược jailbreak`,
      success_description: `Đã cập nhật cài đặt chiến lược jailbreak của bạn. Hiện đang bật **{enabled_count}** tùy chọn.`,
    },
  },
};

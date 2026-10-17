export default {
  conditioning: {
    description: `Quản lý bộ nhớ điều hòa thưởng và phạt dài hạn.`,
    shared: {
      reason_line: `Lý do: \`\`{reason}\`\``,
      reward_footer: `❤️ {bot} sẽ ghi nhớ điều này. Dùng /conditioning để quản lý.`,
      punish_footer: `💀 {bot} sẽ ghi nhớ điều này. Dùng /conditioning để quản lý.`,
      persona_access_blocked_title: `Không có persona khả dụng`,
      persona_access_blocked_description: `Quyền danh sách cho phép hiện tại và cài đặt tâm điểm cá nhân của bạn không còn persona nào khả dụng cho tương tác này trong kênh này.`,
      marker_reward: `❤️`,
      marker_punish: `💀`,
      option_reason_description: `Tổng cộng {count} • do: "{reason}"`,
      option_reason_description_single: `do: "{reason}"`,
      option_label: `{type_marker} {persona_name} • {action}`,
    },
    manage: {
      description: `Quản lý lịch sử điều hòa được đưa vào trên mọi persona trong máy chủ này.`,
    },
    remove: {
      description: `Xóa các mục điều hòa trên mọi persona trong máy chủ này.`,
      empty_title: `Không có bộ nhớ điều hòa`,
      empty_description: `Không có mục điều hòa dài hạn nào để quản lý trong máy chủ này.`,
      page_select_prompt: `Tìm thấy {total} mục điều hòa. Chọn một nhóm để xóa:`,
      page_select_prompt_capped: `Tìm thấy {total} mục điều hòa. {shown} mục gần nhất được
hiển thị bên dưới; hãy xóa bớt để xem phần còn lại.`,
    },
    panel: {
      remove_modal_title: `Xóa điều hòa`,
      remove_checkbox_label: `Các mục điều hòa`,
      remove_checkbox_label_continued: `Các mục điều hòa (tiếp theo)`,
      remove_checkbox_description: `Bỏ chọn bất kỳ mục điều hòa nào bạn muốn xóa.`,
      stale_heading: `Bảng điều khiển đã cũ`,
      stale_detail: `Các mục điều hòa đã thay đổi. Bảng điều khiển đã được làm mới.`,
      no_changes_heading: `Không có thay đổi`,
      no_changes_detail: `Không có mục điều hòa nào bị bỏ chọn.`,
      success_heading: `Đã xóa điều hòa`,
      success_detail: `Đã xóa {count} mục điều hòa.`,
      write_failed_heading: `Cập nhật thất bại`,
      write_failed_detail: `Không thể lưu thay đổi. Vui lòng thử lại.`,
    },
  },
};

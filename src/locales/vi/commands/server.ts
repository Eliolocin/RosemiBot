export default {
  server: {
    timezone: {
      value_description: `Chênh lệch múi giờ UTC theo giờ (mặc định: 0). Ví dụ: 8, -5, 0, 9.`,
    },
    stm: {
      parameters: {
        supersede_option: `Thay thế (danh mục thay thế lượt thô)`,
        crude_summary_option: `Thô + tóm tắt (hiển thị bổ sung cả hai)`,
      },
      "prompt-edit": {
        tool_description_label: `Mô tả công cụ`,
        tool_description_description: `Cách mô tả công cụ STM cho model.`,
        update_nudge_label: `Nhắc nhở bộ nhớ`,
        update_nudge_description: `Prompt chèn vào ngữ cảnh để nhắc model dùng công cụ STM.`,
      },
      "categories-edit": {
        slot_1_label: `Danh mục 1`,
        slot_2_label: `Danh mục 2`,
        slot_3_label: `Danh mục 3`,
        slot_4_label: `Danh mục 4`,
        slot_5_label: `Danh mục 5`,
        slot_instructions: `Ô = "Nhãn: Mô tả" (vd: "Mục tiêu: nhiệm vụ nhóm"). Bỏ trống để bỏ qua; xóa hết để đặt lại.`,
        slot_placeholder: `Nhãn: Mô tả`,
      },
    },
    "crosschannel-blocklist": {
      channel_label_forum: `{channel_name} [Diễn đàn]`,
      channel_label_media: `{channel_name} [Media]`,
    },
    cooldown: {
      triggers: {
        cooldown_type_description: `Cách áp dụng cooldown (mặc định: tắt; theo người dùng, theo kênh, toàn máy chủ).`,
        cooldown_length_description: `Thời lượng cooldown tính bằng giây (1-86400, mặc định: 5).`,
        type: {
          choice_off: `Tắt`,
          choice_per_user: `Theo người dùng`,
          choice_per_channel: `Theo kênh`,
          choice_server_wide: `Toàn máy chủ`,
          choice_strict_server_wide: `Toàn máy chủ nghiêm ngặt`,
        },
      },
    },
    "member-permissions": {
      servermemories_option: `Bộ nhớ máy chủ`,
      attributelist_option: `Danh sách thuộc tính`,
      sampledialogues_option: `Đoạn hội thoại mẫu`,
      promptsnapshot_option: `Ảnh chụp nhanh prompt`,
      servermemories_desc: `Thêm/xóa bộ nhớ trên toàn máy chủ`,
      attributelist_desc: `Thêm/xóa thuộc tính tính cách`,
      sampledialogues_desc: `Thêm/xóa các cặp hội thoại mẫu`,
      promptsnapshot_desc: `Xem toàn bộ prompt từ /context và /tool prompt snapshot`,
      select_placeholder: `Chọn những việc thành viên có thể làm với mình`,
      select_embed_title: `Quyền thành viên máy chủ`,
      select_embed_description: `Chọn các quyền cho thành viên không phải quản trị viên. Đã chọn = cho phép.`,
    },

    alwaysreply: {
      description: `Bật/tắt chế độ luôn trả lời cho persona chính.`,
    },
    deliberatetriggermode: {
      description: `Bật/tắt chế độ kích hoạt có chủ ý (DTM) cho máy chủ này.`,
    },
    deliberatetoolmode: {
      description: `Bật/tắt chế độ công cụ có chủ ý cho máy chủ này.`,
    },
    "deliberate-tool-mode": {
      description: `Bật/tắt chế độ công cụ có chủ ý cho máy chủ này.`,
    },
  },
};

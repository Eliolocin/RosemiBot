export default {
  persona: {
    description: `Quản lý các preset persona`,
    "image-tags": {
      modal_title: `Thẻ ngoại hình persona`,
      tags_input_label: `Thẻ ngoại hình`,
      tags_input_description: `Các thẻ kiểu imageboard cách nhau bằng dấu phẩy cho ngoại hình persona. Để trống để xóa.`,
      tags_input_placeholder: `tóc trắng ngắn, mắt đỏ, đồng phục học sinh`,
      no_tags_title: `Chưa cung cấp thẻ nào`,
      no_tags_description: `Vui lòng cung cấp ít nhất một thẻ ngoại hình.`,
      too_many_tags_title: `Quá nhiều thẻ`,
      too_many_tags_description: `Bạn có thể đặt tối đa {max_tags} thẻ hình ảnh cho mỗi persona.`,
      tag_too_long_title: `Thẻ quá dài`,
      tag_too_long_description: `Mỗi thẻ hình ảnh phải có độ dài từ {max_length} ký tự trở xuống.`,
      success_title: `Đã cập nhật ngoại hình`,
      success_description: `Đã cập nhật các thẻ ngoại hình cho **{persona_name}**:
\`\`\`
{tag_list}
\`\`\``,
      cleared_title: `Đã xóa ngoại hình`,
      cleared_description: `Đã xóa các thẻ ngoại hình của **{persona_name}**.`,
    },
    sprites: {
      add: {
        sprite_name_label: `Tên sprite`,
        sprite_name_description: `Nhãn dùng cho sprite. Dùng lại nhãn sẽ thay thế sprite tương ứng.`,
        sprite_name_placeholder: `mad`,
        image_label: `Hình ảnh sprite`,
        image_description: `Tải lên PNG, JPG hoặc GIF. Ảnh sẽ được chuyển đổi sang PNG.`,
        instructions_label: `Hướng dẫn sử dụng`,
        instructions_description: `Hướng dẫn tùy chọn về thời điểm nên sử dụng sprite này.`,
        instructions_placeholder: `Dùng khi tức giận, khó chịu hoặc bực bội thấy rõ.`,
        identity_label: `Lưu làm danh tính`,
        identity_description: `Hiện tên "Sprite (Persona)" trong Discord, hữu ích cho alter. Tắt = bình thường.`,
      },
      edit: {
        image_description: `Tùy chọn. Tải lên PNG, JPG hoặc GIF để thay thế ảnh sprite.`,
        identity_status_on: `Danh tính`,
        identity_status_off: `Sprite bình thường`,
      },
      import: {
        archive_label: `Tệp lưu trữ sprite`,
        archive_description: `Tải lên tệp .zip được tạo bởi /persona sprites export.`,
      },
    },
    attribute: {
      description: `Quản lý các thuộc tính của persona.`,
      add: {
        description: `Thêm một thuộc tính vào persona.`,
      },
      remove: {
        description: `Xóa một thuộc tính khỏi persona.`,
      },
    },
    prompt: {
      description: `Quản lý hướng dẫn prompt của persona.`,
      set: {
        description: `Đặt prompt cho persona.`,
      },
      remove: {
        description: `Xóa prompt của persona.`,
      },
    },
    "sample-dialogue": {
      description: `Thêm một cặp đối thoại mẫu làm ví dụ về cách mình nên phản hồi.`,
      add: {
        description: `Thêm một cặp đối thoại mẫu làm ví dụ về cách mình nên phản hồi.`,
      },
      remove: {
        description: `Xóa một cặp đối thoại mẫu khỏi bộ nhớ của mình.`,
      },
    },
    name_conflict_title: `🔴 Trùng tên persona`,
    name_conflict_description: `Persona có tên **{name}** đã tồn tại trên máy chủ này. Tên persona phải là duy nhất trong một máy chủ.`,
    export: {
      description: `Xuất persona hiện tại thành tệp PNG có thể chia sẻ`,
      export_json_select_label: `Xuất JSON`,
      export_json_select_description: `Tùy chọn: xuất tệp JSON có thể nhập thay thế (không kèm avatar)`,
      persona_modal_title: `Chọn persona`,
      persona_select_label: `Persona`,
      persona_select_description: `Chọn persona muốn xuất.`,
      persona_select_placeholder: `Chọn một persona...`,
      main_persona_description: `Persona chính`,
      alter_persona_description: `Persona alter`,
      success_title: `🟢 Xuất persona thành công`,
      success_description: `Persona hiện tại **{nickname}** đã được xuất! Hãy chia sẻ tệp PNG này với người khác để lan tỏa cấu hình persona này.`,
      success_description_json: `Persona hiện tại **{nickname}** đã được xuất thành tệp JSON.

**Lưu ý:** Tệp JSON này có thể được nhập lại bằng \`/persona import\`. Tệp không bao gồm ảnh avatar. Hãy dùng bản xuất PNG để chia sẻ cả avatar.`,
      json_importable_note: `Bản xuất JSON này có thể được nhập bằng /persona import. Tệp không kèm ảnh avatar; hãy dùng bản xuất PNG để chia sẻ cả avatar.`,
      failed_title: `🔴 Xuất thất bại`,
      avatar_failed_title: `🔴 Tải avatar thất bại`,
      avatar_failed_description: `Không thể tải xuống avatar của persona. Vui lòng thử lại sau.`,
      embed_failed_title: `🔴 Xử lý PNG thất bại`,
      embed_failed_description: `Không thể nhúng siêu dữ liệu vào tệp PNG. Vui lòng thử lại.`,
      error_no_server_data: `Không tìm thấy máy chủ trong cơ sở dữ liệu. Vui lòng chạy /setup trước.`,
      error_no_preset_data: `Không tìm thấy dữ liệu persona. Vui lòng chạy /setup trước.`,
      error_validation_failed: `Không thể xác thực cấu trúc dữ liệu xuất`,
      error_export_failed: `Không thể xuất dữ liệu persona`,
    },
    import: {
      description: `Nhập persona từ tệp PNG, JSON hoặc CHARX`,
      file_description: `Tệp PNG, JSON hoặc CHARX chứa dữ liệu persona`,
      type_description: `Nhập dưới dạng persona chính hoặc persona alter`,
      triggers_description: `Từ kích hoạt phụ tùy chọn, cách nhau bằng dấu phẩy ("," hoặc "、")`,
      memories_description: `Giữ lại bộ nhớ người dùng và máy chủ của persona này?`,
      memories_choice_preserve: `Có, giữ lại bộ nhớ người dùng/máy chủ`,
      memories_choice_fork: `Không, bắt đầu bộ nhớ người dùng/máy chủ mới`,
      type_choice_main: `Persona chính (thay thế persona hiện tại)`,
      type_choice_alter: `Persona alter`,
      success_title: `🟢 Nhập persona thành công`,
      success_description: `Đã nhập thành công persona **{nickname}**!
Thuộc tính: {attribute_count}
Đối thoại mẫu: {dialogue_count}
Từ kích hoạt: {trigger_word_count}`,
      success_confirmation: `Đã nhập thành công persona chính **{nickname}**! Thông tin nhập chi tiết đã được gửi trong kênh.`,
      post_missing_permission: `Đã nhập persona nhưng tôi không thể gửi thông báo xác nhận. Hãy nhờ quản trị viên cấp quyền {permission} trong kênh này.`,
      nickname_update_success: `Đã cập nhật biệt danh trên máy chủ.`,
      nickname_update_failed: `🟡 Không thể cập nhật biệt danh máy chủ, có thể do giới hạn tốc độ của Discord. Vui lòng đổi thủ công.`,
      avatar_update_success: `Đã cập nhật avatar trên máy chủ.`,
      avatar_update_skipped_no_image: `🟡 Tệp được nhập không có ảnh avatar, nên avatar của persona chính hiện tại được giữ nguyên.`,
      avatar_update_rate_limited: `🟡 Avatar máy chủ không được cập nhật do giới hạn tốc độ của Discord. Vui lòng đổi thủ công.`,
      avatar_update_failed: `🟡 Không thể cập nhật avatar máy chủ, có thể do giới hạn tốc độ của Discord. Vui lòng đổi thủ công.`,
      alter_success_title: `🟢 Nhập persona alter thành công`,
      alter_success_description: `Đã nhập thành công persona alter **{nickname}**!
Từ kích hoạt duy nhất: {trigger_count}
Từ kích hoạt: {triggers}

Persona này sẽ phản hồi khi các từ kích hoạt xuất hiện.`,
      alter_success_confirmation: `Đã nhập thành công persona alter **{nickname}** với {trigger_count} từ kích hoạt duy nhất! Thông tin nhập chi tiết đã được gửi trong kênh.`,
      alter_avatar_fallback_main: `🟡 Bản nhập này không có ảnh avatar, nên alter này sẽ dùng tạm avatar persona chính của **{nickname}**. Bạn có thể dùng \`/config\` > Persona > General để thay đổi.`,
      alter_avatar_warning: `⚠️ Đừng xóa khung nhúng ảnh avatar ở trên, nếu không avatar của persona alter sẽ bị mất.`,
      alter_dm_not_allowed_title: `🔴 Không cho phép persona alter trong DM`,
      alter_dm_not_allowed_description: `Persona alter chỉ có thể được nhập trong máy chủ, không hỗ trợ trong tin nhắn trực tiếp. Vui lòng chạy lệnh này trong một máy chủ.`,
      alter_no_triggers_warning: `⚠️ Persona này không có từ kích hoạt nào. Persona sẽ không phản hồi tin nhắn nào cho đến khi bạn thêm từ kích hoạt bằng \`/config\` > Persona > General.`,
      alter_name_conflict_title: `🔴 Tên persona đã tồn tại`,
      alter_name_conflict_description: `Một persona có tên **{name}** đã tồn tại trên máy chủ này. Mỗi persona phải có một tên riêng biệt.

Vui lòng chỉnh sửa tệp nhập để dùng tên khác, hoặc xóa persona hiện có bằng \`/persona remove\`.`,
      alter_limit_title: `🔴 Đã đạt giới hạn persona`,
      alter_limit_description: `Máy chủ này đã có {current} persona. Giới hạn tối đa là {max}. Vui lòng xóa bớt một alter bằng \`/persona remove\` trước khi nhập mới.`,
      failed_title: `🔴 Nhập thất bại`,
      failed_description: `Không thể nhập persona. Vui lòng kiểm tra lại tệp và thử lại.`,
      sprite_snapshot_failed_description: `Quá trình nhập đã bị hủy vì không thể đọc các sprite của persona hiện tại. Dữ liệu persona chưa bị thay đổi. Vui lòng thử lại.`,
      sprite_cleanup_failed_description: `Persona đã được nhập, nhưng không thể xóa các hàng sprite trước đó. Quá trình nhập chưa hoàn tất. Vui lòng thử lại hoặc liên hệ quản trị viên.`,
      sprite_storage_cleanup_partial_description: `Persona đã được nhập, nhưng không thể xóa {failed_count} ảnh sprite trước đó khỏi bộ nhớ lưu trữ.`,
      invalid_file_type_title: `🔴 Loại tệp không hợp lệ`,
      invalid_file_type_description: `Vui lòng tải lên tệp .png, .json hoặc .charx hợp lệ chứa dữ liệu persona.`,
      file_too_large_title: `🔴 Tệp quá lớn`,
      file_too_large_description: `Tệp quá lớn. Kích thước tệp tối đa là {max_size}MB.`,
      download_failed_title: `🔴 Tải xuống thất bại`,
      download_failed_description: `Không thể tải xuống tệp đính kèm. Vui lòng thử lại.`,
      invalid_charx_title: `🔴 Kho lưu trữ thẻ nhân vật không hợp lệ`,
      invalid_charx_description: `Không thể đọc tệp .charx này dưới dạng kho lưu trữ Thẻ nhân vật V3. Hãy tải lại thẻ từ trang lưu trữ, hoặc xuất thẻ dưới dạng .png.`,
      card_conversion_failed_title: `🟡 Thẻ nhân vật chuyển đổi thất bại`,
      card_conversion_failed_description: `Đã giải mã được thẻ từ **{source}**, nhưng chuyển đổi sang định dạng Tomori thất bại. Dữ liệu giải mã được đính kèm để kiểm tra. Vui lòng báo cáo qua \`/support discord\` kèm tệp đính kèm.`,
      charx_not_card_description: `Đã mở được tệp lưu trữ .charx này, nhưng thẻ bên trong không phải là thẻ nhân vật. Hãy đảm bảo tệp chính là thẻ nhân vật chứ không phải tệp lưu trữ khác cùng tải về.`,
      charx_too_large_description: `Thẻ bên trong tệp lưu trữ này quá lớn để nhập. Kích thước thẻ tối đa là {max_size}MB.`,
      charx_assets_too_large_description: `Thẻ này chứa nhiều phương tiện hơn mức có thể kiểm tra. Hãy thử thẻ được xuất không kèm tài nguyên hình ảnh, âm thanh hoặc video.`,
      charx_assets_ignored_description: `🟡 Hình ảnh, âm thanh và phương tiện đi kèm thẻ này đã không được nhập. Chỉ phần văn bản persona được đọc. Bạn có thể đặt avatar bằng \`/server avatar\` và thêm sprite tại \`/config\` > Persona > Sprites.`,
      invalid_png_title: `🔴 Tệp PNG không hợp lệ`,
      invalid_png_description: `Tệp được tải lên không phải là ảnh PNG hợp lệ.`,
      no_metadata_title: `🔴 Không tìm thấy dữ liệu persona`,
      no_metadata_description: `Tệp này không chứa dữ liệu persona được hỗ trợ. Hãy dùng tệp xuất từ \`/persona export\` hoặc thẻ nhân vật SillyTavern được hỗ trợ.`,
      invalid_file_title: `🔴 Tệp persona không hợp lệ`,
      invalid_file_description: `Định dạng tệp persona không hợp lệ hoặc không tương thích.`,
      no_permission_title: `🔴 Không có quyền`,
      no_permission_description: `Bạn cần có quyền **Quản lý máy chủ** để nhập persona.`,
      error_download_timeout: `Tải tệp xuống đã hết thời gian chờ. Vui lòng thử lại.`,
      error_invalid_attribute: `Nội dung thuộc tính không hợp lệ: {details}`,
      error_attribute_flags_mismatch: `Cờ hiển thị thuộc tính phải khớp với độ dài danh sách thuộc tính.`,
      error_invalid_dialogue_in: `Đối thoại mẫu không hợp lệ (đầu vào): {details}`,
      error_invalid_dialogue_out: `Đối thoại mẫu không hợp lệ (đầu ra): {details}`,
      error_invalid_trigger_word: `Từ kích hoạt không hợp lệ: {details}`,
      error_dialogue_mismatch: `Các mảng đối thoại mẫu không khớp về độ dài`,
      error_invalid_config: `Các trường cấu hình trong dữ liệu persona không hợp lệ`,
      error_no_server_data: `Không tìm thấy máy chủ trong cơ sở dữ liệu. Vui lòng chạy \`/setup\` trước.`,
      error_name_conflict: `Một persona có tên **{name}** đã tồn tại trên máy chủ này. Vui lòng dùng tên khác.`,
      error_nsfw_persona: `Persona này được đánh dấu NSFW, nên \`/persona import\` không thể tải nó. Hãy dùng \`/nsfw persona import\`.`,
      error_import_failed: `Không thể nhập dữ liệu persona`,
      error_not_json: `Tệp được nhập phải chứa dữ liệu JSON hợp lệ`,
      error_incompatible_version: `Phiên bản preset không tương thích. Cần {expected}, nhưng nhận được {actual}`,
      error_invalid_format: `Định dạng tệp persona không hợp lệ`,
      error_invalid_type: `Loại persona không hợp lệ: {type}. Dự kiến là "preset"`,
      avatar_update_skipped_dm: `Persona đã được nhập thành công, ngoại trừ cập nhật avatar và biệt danh do không khả dụng trong tin nhắn trực tiếp`,
      refresh_reminder: `Chạy \`/refresh\` để áp dụng cập nhật persona trong đoạn chat này`,
    },
    remove: {
      description: `Xóa một persona alter khỏi máy chủ`,
      no_permission_title: `🔴 Không có quyền`,
      no_permission_description: `Bạn cần có quyền **Quản lý máy chủ** để xóa persona alter.`,
      modal_title: `Xóa persona alter`,
      select_label: `Persona alter`,
      select_placeholder: `Chọn một persona alter để xóa...`,
      no_alters_error_title: `🟡 Không có persona alter`,
      no_alters_error_description: `Không có persona alter nào để xóa. Nhập persona alter bằng cách dùng \`/persona import type:alter\`.`,
      success_title: `🟢 Đã xóa persona alter`,
      success_description: `Đã xóa thành công persona alter **{nickname}**.`,
    },
    default: {
      description: `Áp dụng cấu hình preset persona`,
      type_description: `Nhắm vào persona chính/mặc định hoặc tạo làm persona alter`,
      type_choice_default: `Persona chính (thay thế persona hiện tại)`,
      type_choice_alter: `Persona alter`,
      no_permission_title: `🔴 Không có quyền`,
      no_permission_description: `Bạn cần có quyền **Quản lý máy chủ** để áp dụng preset persona.`,
      modal_title: `Áp dụng preset persona`,
      select_label: `Preset persona`,
      select_description: `Chọn preset để áp dụng. Thao tác này sẽ thay thế thuộc tính và đối thoại hiện tại.`,
      select_placeholder: `Chọn một preset...`,
      no_presets_title: `Không có preset khả dụng`,
      no_presets_description: `Không có preset persona nào khả dụng cho ngôn ngữ của bạn. Vui lòng báo cáo qua \`/support discord\`.`,
      preset_not_found: `Không thể tìm thấy preset đã chọn.`,
      success_title: `Đã áp dụng preset`,
      success_details_description: `Đã áp dụng preset **{preset_name}** cho **{nickname}**!
Thuộc tính: {attribute_count}
Đối thoại mẫu: {dialogue_count}
Từ kích hoạt ({trigger_word_count}): {triggers}`,
      success_confirmation: `Đã áp dụng preset cho **{nickname}**. Thông tin chi tiết đã được gửi trong kênh này.`,
      avatar_update_failed: `🟡️ Không thể cập nhật avatar máy chủ do lỗi Discord API, nhưng persona đã được áp dụng thành công.`,
      avatar_update_skipped_dm: `Preset đã áp dụng thành công, ngoại trừ avatar do không hỗ trợ trong tin nhắn trực tiếp`,
    },
    import_now: {
      button: `Nhập ngay`,
      imported: `Đã nhập`,
      already_imported_title: `🟡 Đã được nhập`,
      already_imported_description: `Persona này đã được nhập rồi, hoặc một tiến trình nhập đang diễn ra.`,
    },
    generate: {
      description: `Tạo persona bằng AI (yêu cầu nhà cung cấp tương thích)`,
      modal: {
        title: `Tạo persona bằng AI`,
        character_name_label: `Tên nhân vật`,
        character_name_description: `Các tên cách nhau bằng dấu phẩy ("," hoặc "、"): đều thành từ kích hoạt; tên đầu là tên hiển thị.`,
        character_name_placeholder: `vd: Hatsune Miku, Miku, 初音ミク`,
        character_info_label: `Thông tin nhân vật & mẫu lời thoại`,
        character_info_description: `Mô tả nhân vật và cách họ trò chuyện`,
        character_info_placeholder: `Tính cách, tiểu sử, phong cách nói chuyện, câu nói mẫu, v.v.`,
        web_search_label: `Tìm kiếm trên web?`,
        web_search_description: `Tìm thông tin nhân vật (dành cho nhân vật có sẵn từ tác phẩm)`,
        web_search_placeholder: `Chọn Có hoặc Không`,
        web_search_yes: `Có, tìm kiếm thông tin nhân vật`,
        web_search_no: `Không, tạo nhân vật nguyên bản`,
        additional_inst_label: `Hướng dẫn bổ sung`,
        additional_inst_placeholder: `Tùy chọn: Hướng dẫn khác (vd: "hãy giữ câu trả lời của nhân vật ngắn gọn")`,
        file_upload_label: `Ảnh / Thẻ nhân vật (Tùy chọn)`,
        file_upload_description: `Tải lên ảnh, preset Tomori hoặc PNG thẻ SillyTavern để tạo hoặc chuyển đổi nhân vật`,
      },
      field_character_name: `Tên nhân vật`,
      field_character_info: `Thông tin nhân vật & mẫu lời thoại`,
      field_web_search: `Tìm kiếm trên web?`,
      field_additional_inst: `Hướng dẫn bổ sung`,
      wrong_provider_title: `🔴 Nhà cung cấp không tương thích`,
      wrong_provider_description: `Tạo preset yêu cầu nhà cung cấp tương thích. Nhà cung cấp hiện tại của bạn là **{current_provider}**. Dùng \`/config\` > Models > Switch Models để chuyển sang nhà cung cấp được hỗ trợ.`,
      no_api_key_title: `🔴 Không có khóa API`,
      no_api_key_description: `Chưa cấu hình nhà cung cấp nào. Dùng \`/setup\` (lần đầu) hoặc \`/providers\` để đăng ký.`,
      model_incompatible_title: `Model không tương thích`,
      model_incompatible_description: `Model hiện tại (**{model_name}**) không hỗ trợ **STRUCTURED OUTPUT**, vốn là tính năng bắt buộc để tạo persona.

**Các bước tiếp theo:**
Dùng \`/config\` > Models > Switch Models để chuyển sang model hỗ trợ structured output (ví dụ: các model có tính năng "STRUCT").`,
      image_vision_required_title: `🔴 Cần tính năng thị giác hình ảnh`,
      image_vision_required_description: `Bạn đã tải lên hình ảnh, nhưng model hiện tại (**{model_name}**) không hỗ trợ **IMAGE VISION** và chưa cấu hình model thị giác.

**Các bước tiếp theo:**
1. Dùng \`/config\` > Models > Switch Models để đặt model thị giác riêng, HOẶC
2. Dùng \`/config\` > Models > Switch Models để đổi sang model có khả năng thị giác, HOẶC
3. Gỡ bỏ hình ảnh và tạo lại mà không dùng ảnh`,
      web_search_tools_required_title: `🔴 Tìm kiếm web không khả dụng`,
      web_search_tools_required_description: `Bạn đã chọn tìm kiếm web, nhưng model hiện tại (**{model_name}**) không hỗ trợ **TOOLS**.

**Các bước tiếp theo:**
1. Dùng \`/config\` > Models > Switch Models để đổi sang model hỗ trợ công cụ, HOẶC
2. Tạo lại mà không dùng tìm kiếm web (chọn "Không" khi được hỏi)`,
      api_key_decrypt_failed_title: `🔴 Lỗi khóa API`,
      api_key_decrypt_failed_description: `Không thể giải mã thông tin nhà cung cấp đang hoạt động. Hãy cấu hình lại bằng \`/providers\`.`,
      vision_credentials_unavailable_title: `🔴 Không dùng được thông tin xác thực của model thị giác`,
      vision_credentials_unavailable_description: `Model thị giác của bạn (**{vision_model_name}**) chạy trên nhà cung cấp **{vision_provider}**, nhưng không thể dùng khóa API đã lưu của nó để mô tả hình ảnh. Hãy cấu hình lại thông tin xác thực của nhà cung cấp đó bằng \`/providers\`, hoặc kiểm tra \`/config\` > Models.`,
      invalid_image_title: `🔴 Ảnh không hợp lệ`,
      invalid_image_description: `Vui lòng tải lên một tệp hình ảnh hợp lệ (PNG, JPG, JPEG, v.v.).`,
      error_file_too_large: `Ảnh avatar phải có dung lượng từ {max_size}MB trở xuống.`,
      error_download_timeout: `Tải ảnh avatar xuống đã hết thời gian chờ. Vui lòng thử lại.`,
      error_download_failed: `Không thể tải ảnh avatar xuống.`,
      processing_title: `Đang tạo persona...`,
      processing_description: `Có thể mất 1-2 phút. Vui lòng chờ mình tạo nhân vật...

Kết quả đôi khi bất ngờ. Bạn có thể tạo lại nếu cần.`,
      captioning_title: `Đang mô tả ảnh đại diện...`,
      captioning_description: `Model chính của bạn không xem được hình ảnh, nên tôi nhờ model thị giác (**{model_name}**) mô tả ảnh đại diện bạn đã tải lên trước. Sau đó model chính sẽ viết tính cách dựa trên mô tả đó. Quá trình này có thể mất 1-2 phút.`,
      generation_failed_title: `🔴 Tạo thất bại`,
      generation_failed_description: `Không thể tạo persona: {error}

Vui lòng thử lại với dữ liệu khác hoặc kiểm tra khóa API.`,
      vision_caption_failed_title: `🔴 Không mô tả được ảnh đại diện`,
      vision_caption_failed_description: `Model thị giác của bạn (**{vision_model_name}** trên {vision_provider}) không thể mô tả ảnh đại diện đã tải lên.

**Bước tiếp theo:**
1. Kiểm tra khóa API của nhà cung cấp đó bằng \`/providers\`, HOẶC
2. Gỡ ảnh rồi tạo lại, HOẶC
3. Đặt một model thị giác khác trong \`/config\` > Models`,
      validation_failed_title: `🔴 Xác thực thất bại`,
      validation_failed_description: `Dữ liệu persona được tạo không vượt qua xác thực. Vui lòng thử lại.`,
      image_processing_failed_title: `🔴 Xử lý ảnh thất bại`,
      image_processing_failed_description: `Không thể xử lý hình ảnh đã tải lên. Vui lòng thử một ảnh khác.`,
      avatar_fetch_failed_title: `🔴 Lấy avatar thất bại`,
      avatar_fetch_failed_description: `Không thể lấy avatar máy chủ để xuất. Vui lòng thử tải lên một hình ảnh thay thế.`,
      metadata_embed_failed_title: `🔴 Xuất thất bại`,
      metadata_embed_failed_description: `Không thể nhúng dữ liệu persona vào hình ảnh. Vui lòng thử lại.`,
      success_title: `🟢 Đã tạo {character_name} thành công!`,
      success_description: `Mình đã tạo persona cho **{character_name}**!
**Xem trước thuộc tính:**
{attribute_preview}
**Đối thoại mẫu:**
{dialogue_preview}`,
      success_next_steps_title: `Các bước tiếp theo`,
      success_next_steps_description: `1. Tải xuống tệp PNG đính kèm ở bên phải
2. Dùng \`/persona import\` với tệp PNG
Hoặc nhấn nút Nhập`,
      success_next_steps_description_dm: `1. Tải xuống tệp PNG đính kèm
2. Dùng \`/persona import\` với tệp PNG
3. Chạy \`/refresh\` để áp dụng persona mới của mình`,
      success_next_steps_footer: `Sau đó bạn có thể tùy chỉnh thêm cho mình trong \`/config\`.`,
      avatar_update_skipped_dm: `Lưu ý: cập nhật avatar và biệt danh không khả dụng khi nhập trong tin nhắn trực tiếp.`,
    },
    create: {
      description: `Tạo thủ công một preset persona đơn giản`,
      modal: {
        title: `Tạo persona`,
        character_name_label: `Tên nhân vật`,
        character_name_description: `Các tên cách nhau bằng dấu phẩy ("," hoặc "、"): đều thành từ kích hoạt; tên đầu là tên hiển thị.`,
        character_name_placeholder: `vd: Hatsune Miku, Miku, 初音ミク`,
        character_desc_label: `Mô tả nhân vật`,
        character_desc_placeholder: `Mô tả nhân vật của bạn (tính cách, ngoại hình, tiểu sử, v.v.)`,
        example_user_label: `Tin nhắn mẫu của người dùng`,
        example_user_description: `Mẹo: Thêm nhiều hơn bằng cách dùng /persona sample-dialogue add sau`,
        example_user_placeholder: `Chào {bot}!`,
        example_bot_label: `Phản hồi mẫu của bot`,
        example_bot_placeholder: `Xin chào {user}! Bạn khỏe không?`,
        file_upload_label: `Ảnh nhân vật (Tùy chọn)`,
        file_upload_description: `Tải lên hình ảnh để xuất nhân vật`,
      },
      field_character_name: `Tên nhân vật`,
      field_character_desc: `Mô tả nhân vật`,
      field_example_user: `Tin nhắn mẫu của người dùng`,
      field_example_bot: `Phản hồi mẫu của bot`,
      invalid_image_title: `🔴 Ảnh không hợp lệ`,
      invalid_image_description: `Vui lòng tải lên một tệp hình ảnh hợp lệ (PNG, JPG, JPEG, v.v.).`,
      error_file_too_large: `Ảnh avatar phải có dung lượng từ {max_size}MB trở xuống.`,
      error_download_timeout: `Tải ảnh avatar xuống đã hết thời gian chờ. Vui lòng thử lại.`,
      error_download_failed: `Không thể tải ảnh avatar xuống.`,
      desc_too_long_title: `Mô tả quá dài`,
      desc_too_long_description: `Mô tả nhân vật quá dài ({current_length} ký tự). Độ dài tối đa cho phép là {max_allowed} ký tự.`,
      example_user_too_long_title: `Tin nhắn mẫu người dùng quá dài`,
      example_user_too_long_description: `Tin nhắn mẫu người dùng quá dài ({current_length} ký tự). Tối đa cho phép là {max_allowed} ký tự.`,
      example_bot_too_long_title: `Phản hồi mẫu của bot quá dài`,
      example_bot_too_long_description: `Phản hồi mẫu của bot quá dài ({current_length} ký tự). Tối đa cho phép là {max_allowed} ký tự.`,
      validation_failed_title: `🔴 Xác thực thất bại`,
      validation_failed_description: `Dữ liệu preset không vượt qua xác thực. Vui lòng thử lại.`,
      image_processing_failed_title: `🔴 Xử lý ảnh thất bại`,
      image_processing_failed_description: `Không thể xử lý hình ảnh đã tải lên. Vui lòng thử một ảnh khác.`,
      avatar_fetch_failed_title: `🔴 Lấy avatar thất bại`,
      avatar_fetch_failed_description: `Không thể lấy avatar máy chủ để xuất. Vui lòng thử tải lên một hình ảnh thay thế.`,
      metadata_embed_failed_title: `🔴 Xuất thất bại`,
      metadata_embed_failed_description: `Không thể nhúng dữ liệu persona vào hình ảnh. Vui lòng thử lại.`,
      success_title: `🟢 Đã tạo {character_name} thành công!`,
      success_description: `**Mô tả:**
{character_description}`,
      success_dialogue_title: `Đối thoại mẫu`,
      success_next_steps_title: `Các bước tiếp theo`,
      success_next_steps_description: `1. Tải xuống tệp PNG đính kèm ở bên phải
2. Dùng \`/persona import\` với tệp PNG
Hoặc nhấn nút Nhập`,
      success_next_steps_footer: `Sau đó bạn có thể tùy chỉnh thêm cho mình trong \`/config\`.`,
      avatar_update_skipped_dm: `Xin lưu ý rằng tính năng cập nhật avatar và biệt danh không khả dụng trong tin nhắn trực tiếp.`,
    },
  },
};

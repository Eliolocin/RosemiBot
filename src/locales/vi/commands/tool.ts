export default {
  tool: {
    description: `Các thao tác tiện ích cho ngữ cảnh hội thoại, prompt và chẩn đoán.`,
    estimate: {
      description: `Ước tính mức sử dụng và chi phí`,
      cost: {
        description: `Ước tính chi phí API cho các nhà cung cấp AI trả phí`,
        title: `Chi phí API ước tính`,
        embed_description: `Dưới đây là ước tính chi phí **RẤT SƠ BỘ** cho mỗi lần kích hoạt trong kênh Discord khi dùng nhà cung cấp AI trả phí. Chi phí được ước tính theo giá mẫu của **{provider}** (Đầu vào: {inputPrice}/M token, Đầu ra: {outputPrice}/M token)`,
        current_context_description: `Chi phí ước tính **chỉ cho ngữ cảnh hiện tại**. Token đầu vào được đo bằng API nhà cung cấp theo cấu hình hiện tại và lịch sử kênh gần đây trên **{provider}** model **{model}**. Token đầu ra vẫn là ước tính. Giá áp dụng: Đầu vào {inputPrice}/M, Đầu ra {outputPrice}/M.`,
        current_context_estimated_description: `Chi phí ước tính **chỉ cho ngữ cảnh hiện tại**. **{provider}** (model **{model}**) không có API đếm token trực tiếp, nên token đầu vào được **ước lượng từ số ký tự** (~4 ký tự mỗi token) theo cấu hình hiện tại và lịch sử kênh gần đây. Độ chính xác tùy thuộc vào ngôn ngữ, và các hệ chữ dày đặc như tiếng Nhật sẽ tốn nhiều token hơn ước tính này. Token đầu ra cũng là ước tính. Giá áp dụng: Đầu vào {inputPrice}/M, Đầu ra {outputPrice}/M.`,
        current_input_title: `Token đầu vào đo được (Ngữ cảnh hiện tại)`,
        current_input_estimated_title: `Token đầu vào ước tính (Ngữ cảnh hiện tại)`,
        current_input_value: `**Đầu vào:** {inputTokens} token
**Chỉ chi phí đầu vào:** ~{inputCost} mỗi lần kích hoạt`,
        current_output_typical_title: `Ước tính đầu ra: Thông thường`,
        current_output_persona_average_title: `Ước tính đầu ra: Trung bình persona`,
        current_output_band_value: `**Ước tính đầu ra:** {outputTokens} token
**Chi phí đầu ra ước tính:** ~{outputCost}/lần`,
        average_total_cost_title: `Tổng chi phí trung bình mỗi lần kích hoạt`,
        average_total_cost_value: `**Tổng ước tính:** {totalTokens} token
~{costPerMessage}/lần kích hoạt (~{costPer100}/100 lần)`,
        current_footer: `Số lượng token đầu vào chỉ được đo đối với các nhà cung cấp có hỗ trợ đếm trực tiếp. Số lượng token đầu ra là ước tính. Dải "Trung bình persona" kết hợp phản hồi đối thoại mẫu của persona và các lượt gần đây của persona trong kênh này. Sẽ chuyển về ước tính thông thường khi không có nguồn nào khả dụng.`,
        current_estimated_footer: `Nhà cung cấp này không có API đếm trực tiếp, nên token đầu vào được ước lượng từ số ký tự. Hãy xem đây là số liệu sơ bộ, đặc biệt đối với ngữ cảnh tiếng Nhật hoặc nhiều JSON. Token đầu ra cũng là ước tính. Dải "Trung bình persona" kết hợp phản hồi đối thoại mẫu của persona và các lượt gần đây của persona trong kênh này. Sẽ chuyển về ước tính thông thường khi không có nguồn nào khả dụng.`,
        no_cost_provider_description: `Nhà cung cấp hiện tại không tốn chi phí`,
        unavailable_description: `Ước tính chi phí trực tiếp không khả dụng cho nhà cung cấp hiện tại (**{provider}**).`,
        fallback_notice_title: `Không thể đếm trực tiếp`,
        fallback_notice_value: `Không thể đếm token trực tiếp từ nhà cung cấp cho cấu hình hiện tại của bạn, nên phần hiển thị này là ước tính dự phòng sơ bộ.`,
        minimum_scenario_title: `Kịch bản tối thiểu (Sử dụng nhẹ)`,
        minimum_scenario_value: `**Ngữ cảnh:** 1 người dùng với 0 bộ nhớ, 1 đoạn văn persona, hội thoại dưới một câu mỗi tin nhắn
**Token:** {inputTokens} đầu vào + {outputTokens} đầu ra`,
        average_scenario_title: `Kịch bản trung bình (Sử dụng vừa phải)`,
        average_scenario_value: `**Ngữ cảnh:** 3 người dùng với 10 bộ nhớ mỗi người, ~16 đoạn văn persona (gồm thuộc tính & đối thoại), hội thoại 1-2 câu mỗi tin nhắn
**Token:** {inputTokens} đầu vào + {outputTokens} đầu ra`,
        maximum_scenario_title: `Kịch bản tối đa (Sử dụng nhiều)`,
        maximum_scenario_value: `**Ngữ cảnh:** 5 người dùng với 25 bộ nhớ mỗi người, ~31 đoạn văn persona (gồm thuộc tính & đối thoại), hội thoại 2 đoạn văn mỗi tin nhắn
**Token:** {inputTokens} đầu vào + {outputTokens} đầu ra`,
        breakdown_title: `Yếu tố ảnh hưởng đến chi phí`,
        breakdown_value: `**Token đầu vào (ngữ cảnh gửi tới AI):**
- Các đoạn văn persona (gồm thuộc tính & đối thoại mẫu)
- Bộ nhớ máy chủ & cá nhân
- Các công cụ đã bật (nếu có)
- Trạng thái người dùng & lời nhắc
- Lịch sử hội thoại gần đây (gồm ảnh, video, sticker, emoji, embed nếu nhà cung cấp hỗ trợ)
- Emoji máy chủ (10 cố định)

**Token đầu ra (phản hồi của AI):**
- Độ dài phản hồi thay đổi theo độ phức tạp của câu hỏi
- Câu hỏi chi tiết hơn = phản hồi dài hơn = chi phí cao hơn

**Mẹo giảm chi phí:**
Mình có các tính năng tích hợp sẵn để giúp giảm chi phí từ người lạm dụng hoặc spam trong máy chủ của bạn, ngoài ra đây là một số mẹo bổ sung:
- Dùng ít đoạn văn persona hơn (thuộc tính & đối thoại)
- Giữ bộ nhớ ngắn gọn
- Dùng nhà cung cấp AI miễn phí (Google Gemini miễn phí)
- Giới hạn các kênh tự động kích hoạt`,
        footer: `Các nhà cung cấp miễn phí như Google Gemini (gói miễn phí) và một số model OpenRouter hoàn toàn không mất phí! NovelAI cung cấp mức sử dụng không giới hạn theo gói thuê bao. Mở \`/help\` đến Thiết lập, rồi Bước 1: Lấy khóa API, để tìm hiểu thêm.`,
      },
    },
    delete: {
      description: `Xóa lượt trò chuyện hoặc nội dung khác trong kênh.`,
      turn: {
        description: `Xóa lượt trò chuyện gần nhất của persona khỏi kênh.`,
        regenerate_description: `Nếu đúng, kích hoạt lại persona sau khi xóa.`,
        select_persona_description: `Nếu đúng, chọn lượt của persona nào để xóa.`,
        no_permission_title: `Không có quyền`,
        no_permission_description: `Lệnh này yêu cầu quyền Quản lý máy chủ hoặc phải được dùng trong kênh RP được chỉ định.`,
        already_running_title: `Đang thực hiện xóa`,
        already_running_description: `Một tiến trình xóa đang diễn ra cho kênh này. Vui lòng chờ.`,
        no_persona_found_title: `Không tìm thấy lượt persona nào`,
        no_persona_found_description: `Không tìm thấy khối tin nhắn persona liền kề nào trong lịch sử gần đây.`,
        deleting_title: `⏳ Đang xóa lượt`,
        deleting_description: `Đang xóa {count} tin nhắn từ **{persona_name}**...`,
        success_title: `✅ Đã xóa lượt`,
        success_description: `Đã xóa {count} tin nhắn từ **{persona_name}**.`,
        success_regenerate_description: `Đã xóa {count} tin nhắn từ **{persona_name}**. Đang kích hoạt lại...`,
        partial_title: `⚠️ Xóa một phần`,
        partial_description: `Đã xóa {deleted_count}/{total_count} tin nhắn từ **{persona_name}**. Một số tin nhắn không thể xóa.`,
        partial_no_manage_messages_description: `Đã xóa {deleted_count}/{total_count} tin nhắn từ **{persona_name}**. Mình không thể xóa hết do thiếu quyền **Quản lý tin nhắn**.`,
        bot_no_delete_title: `Không thể xóa tin nhắn`,
        bot_no_delete_description: `Mình không có quyền **Quản lý tin nhắn** trong kênh này, và cũng không thể xóa qua webhook dự phòng. Vui lòng cấp quyền **Quản lý tin nhắn** cho mình hoặc đảm bảo webhook của mình khả dụng.`,
        bot_failed_delete_description: `Mình đã gặp lỗi không mong muốn khi cố gắng xóa các tin nhắn.`,
      },
    },
    prompt: {
      description: `Kiểm tra các prompt TomoriBot gửi đến model.`,
      snapshot: {
        description: `Xuất chính xác prompt LLM của một persona ra tệp để gỡ lỗi.`,
        persona_description: `Persona cần tạo snapshot. Mặc định là persona chính.`,
        format_description: `Định dạng đầu ra cho tệp snapshot.`,
        fetch_tools_description: `Nếu đúng, nối thêm định nghĩa công cụ/hàm khả dụng vào snapshot (chỉ JSON).`,
        text_option: `Văn bản`,
        json_option: `JSON`,
        no_permission_title: `Không có quyền`,
        no_permission_description: `Bạn cần quyền **Quản lý máy chủ**, hoặc chủ máy chủ phải bật tính năng này cho thành viên qua \`/moderation\`.`,
        persona_not_found_title: `Không tìm thấy persona`,
        persona_not_found_description: `Persona đó không còn tồn tại trên máy chủ này. Hãy chọn một persona từ danh sách.`,
        dm_title: `Snapshot prompt`,
        dm_description: `Đây là snapshot prompt cho persona **{persona_name}** (định dạng: {format}).`,
        dm_txt_headers_note: `Các tiêu đề \`=== Title (/command) ===\` và \`== SubTitle ==\` trong tệp TXT là chú thích cho biết lệnh cấu hình nào kiểm soát từng phần. Chúng **không** phải là một phần của prompt thực tế gửi đến LLM. "Untagged" nghĩa là phần đó được sắp xếp lại bởi preset st tùy chỉnh hoặc là một phần của preset đó`,
        dm_hint_try_json: `Chạy lại lệnh với \`format: JSON\` để xem định dạng gốc.`,
        dm_hint_try_text: `Chạy lại lệnh với \`format: Text\` để xem định dạng dễ đọc hơn.`,
        dm_tools_txt_note: `Các định nghĩa công cụ được lược bỏ trong định dạng TXT, vui lòng chạy lại với \`format: JSON\` và \`fetch_tools: true\` để kèm theo.`,
        dm_config_heading: `**Cấu hình lấy mẫu / yêu cầu** (khớp với những gì adapter nhà cung cấp sẽ gửi lúc chạy):`,
        dm_truncated_note: `Lịch sử trò chuyện vượt quá giới hạn của model, nên {count} lượt trao đổi cũ nhất đã được lược bỏ, giống như trong câu trả lời thực tế.`,
        dm_failed_title: `Không thể gửi DM`,
        dm_failed_description: `Mình không thể gửi DM. Snapshot của bạn được đính kèm tại đây. Hãy bật nhận DM từ thành viên máy chủ để nhận các snapshot sau này qua DM.`,
        success_title: `Đã gửi snapshot`,
        success_description: `Snapshot prompt đã được gửi đến DM của bạn.`,
        no_personas_title: `Không tìm thấy persona nào`,
        no_personas_description: `Không tìm thấy persona nào cho máy chủ này.`,
        build_failed_title: `Tạo snapshot thất bại`,
        build_failed_description: `Không thể tạo snapshot prompt. Vui lòng thử lại.`,
        guild_only_title: `Chỉ trong máy chủ`,
        guild_only_description: `Lệnh này chỉ có thể sử dụng trong một kênh máy chủ.`,
        dm_tools_filtering_note: `Định nghĩa công cụ trong snapshot JSON được lọc cho lượt hiển thị mới nhất khi chế độ công cụ có chủ đích đang bật. Snapshot sau sự việc có thể không tái hiện hoàn hảo ngữ cảnh công cụ tạm thời được giữ lại, nhưng chúng không còn xuất toàn bộ hộp công cụ khi lượt trực tiếp đã thu hẹp hoặc ẩn bớt công cụ.`,
      },
    },

    visualize: {
      missing_permissions_title: `Thiếu quyền`,
      missing_permissions_description: `Mình cần quyền xem kênh này, đọc lịch sử tin nhắn, gửi tin nhắn và đính kèm tệp trước khi có thể tạo ảnh bối cảnh tại đây.`,
      cooldown_active: `Quản lý của máy chủ này đã cấu hình cooldown. Vui lòng đợi **{seconds}** giây trước khi dùng lại \`/generate image\` ở chế độ **Vẽ những gì đang diễn ra**. Cooldown này được dùng chung với các kích hoạt tin nhắn và lệnh thủ công khác.`,
      channel_not_whitelisted: `Máy chủ này có giới hạn danh sách trắng đang bật. \`/generate image\` ở chế độ **Vẽ những gì đang diễn ra** chỉ có thể được dùng trong các kênh trong danh sách trắng bởi thành viên có vai trò trong danh sách trắng, và chỉ với các persona được phép trong kênh này.`,
      persona_access_blocked: `Quyền trong danh sách trắng và cài đặt spotlight cá nhân hiện tại không còn persona nào khả dụng cho \`/generate image\` ở chế độ **Vẽ những gì đang diễn ra** trong kênh này.`,
      no_backend_title: `Không có backend tạo ảnh khả dụng`,
      no_backend_description: `Hiện mình không tìm thấy backend tạo ảnh dùng được cho máy chủ này. Hãy cấu hình **{current_provider}** với một model tạo ảnh hợp lệ, hoặc thêm khóa tùy chọn NovelAI nếu bạn muốn dùng trình kết xuất NovelAI.`,
      planner_unavailable_title: `Không có model lập kế hoạch khả dụng`,
      planner_unavailable_description: `Mình không tìm thấy model structured-output nào cho nhà cung cấp hiện tại, nên hiện tại không thể lập kế hoạch ảnh bối cảnh.`,
      planner_failed_title: `Lập kế hoạch bối cảnh thất bại`,
      planner_failed_description: `Mình không thể chuyển ngữ cảnh kênh gần đây thành kế hoạch tạo ảnh: {error}`,
      success_title: `Đã đăng ảnh bối cảnh`,
      success_description: `Mình đã lên kế hoạch cho khung hình từ ngữ cảnh kênh gần đây và đăng ảnh vào kênh này.`,
      modal: {
        title: `Ảnh bối cảnh`,
        prompt_label: `Chỉ dẫn bổ sung (Tùy chọn)`,
        prompt_description: `Thêm bất kỳ hiệu chỉnh, tâm trạng hoặc chi tiết nào bạn muốn người lập kế hoạch bối cảnh tuân theo`,
        prompt_placeholder: `vd: tập trung vào cơn mưa, làm cho cảnh dịu hơn, hiển thị rõ cả hai nhân vật`,
        setting_label: `Preset khung hình`,
        setting_description: `Chọn preset bố cục/phong cách cho ảnh bối cảnh nhanh này`,
        setting_storybeat_label: `Nhịp truyện`,
        setting_storybeat_description: `Khung hình điện ảnh góc rộng cho bối cảnh tức thời`,
        setting_character_label: `Tập trung nhân vật`,
        setting_character_description: `Khung hình cận hơn quanh nhân vật chính hoặc người nói`,
        setting_snapshot_label: `Ảnh chụp vuông`,
        setting_snapshot_description: `Bố cục vuông cân đối cho khoảnh khắc hiện tại`,
        setting_vertical_label: `Hình nền điện thoại`,
        setting_vertical_description: `Khung hình dọc cao với bóng dáng rõ nét hơn`,
        backend_label: `Backend hình ảnh`,
        backend_description: `Chọn trình kết xuất sẽ tạo ảnh bối cảnh`,
        backend_current_label: `Nhà cung cấp hiện tại`,
        backend_current_description: `Dùng quy trình tạo ảnh và phong cách prompt thông thường của {provider}`,
        backend_novelai_label: `NovelAI`,
        backend_novelai_description: `Chuyển bối cảnh thành các thẻ kiểu NovelAI và dùng công cụ tạo ảnh NovelAI`,
        persona_label: `Persona người gửi`,
        persona_description: `Chọn persona sẽ đăng hình ảnh được tạo`,
      },
    },
  },
};

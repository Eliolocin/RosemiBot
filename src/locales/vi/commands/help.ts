export default {
  help: {
    description: `Xem hướng dẫn thiết lập, tính năng, nhà cung cấp, bộ nhớ, hành vi, công cụ, media và tích hợp.`,
    dashboard: {
      categories: {
        setup: `Thiết lập`,
        features: `Tính năng`,
        moderation: `Kiểm duyệt`,
        plugins: `Plugin`,
      },
      pages: {
        custom_endpoints: `Endpoint tùy chỉnh`,
      },
      page_reference: `trang **{page}** trong \`/help\``,
      page_select_placeholder: `Chọn một trang`,
      subsection_select_placeholder: `Chọn một chủ đề`,
      provider_select_placeholder: `Chọn nhà cung cấp`,
      optional_provider_select_placeholder: `Dịch vụ tùy chọn`,
      previous_button: `← Trước`,
      next_button: `Tiếp →`,
      docs_link_label: `Đọc bản trên web`,
      support_link_label: `Nhận hỗ trợ kỹ thuật`,
      sections: {
        getting_started: `Bắt đầu`,
        getting_started_description: `Key, kích hoạt, persona và gợi ý tiếp theo`,
        personal_profile: `Hồ sơ cá nhân`,
        personal_profile_description: `Biệt danh, bộ nhớ và nhà cung cấp riêng của bạn`,
        custom_endpoints: `Endpoint tùy chỉnh (nâng cao)`,
        custom_endpoints_description: `Đăng ký endpoint bạn tự chạy hoặc tin cậy`,
        multiple_personas: `Nhiều persona`,
        multiple_personas_description: `Dùng nhiều danh tính và nhập thẻ nhân vật`,
        media_generation: `Tạo media`,
        media_generation_description: `Tạo hình ảnh, video và tin nhắn thoại`,
        tons_of_tweakability: `Vô số tùy chỉnh`,
        tons_of_tweakability_description: `Nơi chứa cài đặt hành vi, máy chủ và cá nhân`,
        memory: `Bộ nhớ`,
        memory_description: `Những gì mình nhớ, và trong bao lâu`,
        scheduled_tasks: `Tác vụ theo lịch`,
        scheduled_tasks_description: `Lời nhắc và tác vụ mình tự động quay lại làm`,
        server_moderation: `Kiểm duyệt máy chủ`,
        server_moderation_description: `Ai có thể dùng mình ở đây, và ở đâu`,
        quotas: `Hạn ngạch`,
        quotas_description: `Giới hạn mức tạo nội dung máy chủ cho phép`,
        age_restricted_commands: `Lệnh giới hạn độ tuổi`,
        age_restricted_commands_description: `Tính năng người lớn, và điều mình không lọc`,
        user_byok: `BYOK người dùng (nâng cao)`,
        user_byok_description: `Bắt buộc mọi thành viên tự dùng key của họ`,
        sillytavern_presets: `Preset SillyTavern`,
        sillytavern_presets_description: `Tạo prompt cho mình từ preset đã nhập`,
        mcp_servers: `MCP server`,
        mcp_servers_description: `Kết nối công cụ ngoài mà mình thực sự dùng được`,
        matrix: `Matrix`,
        matrix_description: `Cầu nối phòng Matrix tới kênh Discord`,
      },
      subsections: {
        get_api_key: `Lấy API key`,
        get_api_key_description: `Nơi lấy key, và cách giữ key an toàn`,
        change_trigger_behavior: `Đổi hành vi kích hoạt`,
        change_trigger_behavior_description: `Khi nào và ở đâu mình được phép trả lời`,
        create_first_persona: `Tạo persona đầu tiên của bạn`,
        create_first_persona_description: `Chỉnh sửa mình, tạo persona mới, hoặc nhập vào`,
        explore_features: `Khám phá tính năng của mình!`,
        explore_features_description: `Dạo nhanh qua những gì mình có thể làm lúc này`,
        nickname_pronouns: `Biệt danh và đại từ của bạn`,
        nickname_pronouns_description: `Cách mình xưng hô với bạn, ở mọi máy chủ`,
        personal_memories: `Bộ nhớ cá nhân`,
        personal_memories_description: `Những gì mình nhớ riêng về bạn`,
        personal_providers: `Nhà cung cấp cá nhân (nâng cao)`,
        personal_providers_description: `Trả lời bằng key và model của riêng bạn`,
        text_models: `Model văn bản`,
        text_models_description: `Đăng ký một endpoint chat và model của nó`,
        comfyui: `ComfyUI (cho video và hình ảnh)`,
        comfyui_description: `Tải lên workflow và tạo nội dung từ đó`,
        text_to_speech: `Chuyển văn bản thành giọng nói (cho voice)`,
        text_to_speech_description: `Cung cấp cho mỗi persona một giọng nói thật`,
        image_generation: `Tạo hình ảnh`,
        image_generation_description: `Vẽ theo prompt, hoặc vẽ khung cảnh hiện tại`,
        video_generation: `Tạo video`,
        video_generation_description: `Clip ngắn, có thể kèm khung hình đầu tùy chọn`,
        speech_generation: `Tạo giọng nói`,
        speech_generation_description: `Chuyển văn bản thành tin nhắn thoại`,
        art_search: `Tìm kiếm tranh ảnh`,
        art_search_description: `Gửi tranh anime có sẵn từ Danbooru`,
        behavior_tuning: `Tinh chỉnh hành vi`,
        behavior_tuning_description: `Model, humanizer, hướng dẫn và công cụ`,
        server_wide_settings: `Cài đặt toàn máy chủ`,
        server_wide_settings_description: `Giới hạn áp dụng cho mọi người ở đây`,
        personal_settings: `Cài đặt cá nhân`,
        personal_settings_description: `Tùy chọn của bạn, ở mọi máy chủ`,
        long_term_memory: `Bộ nhớ dài hạn`,
        long_term_memory_description: `Thông tin mình ghi nhớ vĩnh viễn`,
        short_term_memory: `Bộ nhớ ngắn hạn`,
        short_term_memory_description: `Ghi chú tạm thời của mình về cuộc trò chuyện này`,
        rewards_punishments: `Thưởng và phạt`,
        rewards_punishments_description: `Các tương tác mình chú ý và ghi nhớ`,
        memory_tagging: `Gắn thẻ bộ nhớ (nâng cao)`,
        memory_tagging_description: `Chỉ gọi bộ nhớ dậy khi thực sự liên quan`,
        blacklisting: `Đưa vào danh sách đen`,
        blacklisting_description: "Khiến mình bỏ qua hoàn toàn một thành viên",
      },
    },
    breadcrumbs: {
      persona: {
        general: `Persona > Danh tính & tính cách`,
        advanced: `Persona > Nâng cao`,
        voice: `Persona > Giọng nói`,
        sprites: `Persona > Sprite`,
        triggers: `Persona > Kích hoạt`,
      },
      behavior: {
        general: `Hành vi > Hành vi chung`,
        trigger: `Hành vi > Hành vi kích hoạt`,
        memory: `Hành vi > Bộ nhớ nâng cao`,
      },
      channels: {
        destinations: `Kênh > Nhật ký & chào mừng`,
        "auto-trigger": `Kênh > Tự động kích hoạt`,
        overrides: `Kênh > Tùy chỉnh kênh`,
      },
      plugins: {
        "available-tools": `Plugin > Công cụ hiện có`,
        "mcp-servers": `Plugin > MCP server`,
        "sillytavern-presets": `Plugin > Preset SillyTavern`,
      },
      models: {
        switch: `Model > Đổi model`,
        voices: `Model > Tham số TTS & giọng nói`,
        image: `Model > Mặc định tạo hình ảnh`,
        parameters: `Model > Bộ lấy mẫu & tham số văn bản`,
      },
      personal: {
        profile: {
          general: `Hồ sơ > Tùy chọn chung`,
        },
        privacy: {
          controls: `Quyền riêng tư > Kiểm soát quyền riêng tư`,
        },
        models: {
          switch: `Model > Đổi model`,
        },
        advanced: {
          spotlight: `Nâng cao > Tiêu điểm cá nhân`,
        },
      },
      moderation: {
        "member-access": `Quyền truy cập của thành viên`,
        "user-blacklist": `Danh sách đen người dùng`,
        whitelist: `Danh sách trắng`,
        quotas: `Hạn ngạch`,
      },
    },
    features: {
      title: `Tính năng TomoriBot (Phiên bản {version})`,
    },
    matrix: {
      bot_user_fallback: `tài khoản bot Matrix đã cấu hình`,
    },
    "api-key": {
      provider_choice_brave: `Brave Search`,
      provider_choice_google: `Google Gemini (Khuyên dùng, Miễn phí)`,
      provider_choice_deepseek: `DeepSeek`,
      provider_choice_custom: `Endpoint tùy chỉnh`,
      provider_choice_nvidia: `NVIDIA NIM (Miễn phí)`,
      provider_choice_novelai: `NovelAI`,
      provider_choice_openrouter: `OpenRouter (Khuyên dùng)`,
      provider_description_google: `Đa dụng và có mức sử dụng miễn phí rộng rãi`,
      provider_description_openrouter: `Trả phí nhưng ổn định, linh hoạt: tạo ảnh, video và giọng nói`,
      provider_description_deepseek: `Lựa chọn trả phí rẻ hơn và khá ít bị kiểm duyệt`,
      provider_description_novelai: `Dành cho nhập vai không kiểm duyệt, kể chuyện và tạo ảnh`,
      provider_description_nvidia: `Các model văn bản, embedding và hình ảnh được host sẵn`,
      provider_description_zai: `Model văn bản và hình ảnh GLM với chính sách chỉ cho lập trình`,
      provider_description_vertexexpress: `Gemini qua Google Cloud với xác thực bằng API key`,
      provider_description_vertex: `Gemini cấp doanh nghiệp qua thông tin xác thực Google Cloud`,
      provider_description_custom: `Endpoint tự host hoặc proxy; có thể không cần xác thực`,
      provider_description_brave: `Tìm kiếm web, hình ảnh, video và tin tức tùy chọn`,
      provider_description_elevenlabs: `API giọng nói và phiên âm, không phải model văn bản`,
      provider_choice_zai: `Z.ai`,
      provider_choice_vertex: `Google Vertex AI`,
      provider_choice_vertexexpress: `Google Vertex AI Express`,
      provider_choice_elevenlabs: `ElevenLabs TTS`,
      brave_title: `Thiết lập API key cho Brave Search`,
      brave_description: `Brave Search là tùy chọn và chỉ mở rộng tìm kiếm. Không cấp quyền AI vì đã có nhà cung cấp chính.
- Bật tìm kiếm hình ảnh, video và tin tức
- Cung cấp thông tin theo thời gian thực từ internet
- Giúp mình trả lời tốt hơn các câu hỏi thời sự`,
      brave_getting_key_title: `Lấy API key của bạn:`,
      brave_getting_key_description: `1. Truy cập [Brave Search API](https://brave.com/search/api/)
2. Đăng ký một tài khoản miễn phí
3. Mở mục [API Keys](https://api-dashboard.search.brave.com/app/keys) trong trang tổng quan
4. Tạo một API key mới
5. Sao chép và nhập API key bằng lệnh {configBraveapiSet}`,
      brave_important_title: `Lưu ý quan trọng:`,
      brave_important_description: `- Phần này tách biệt với nhà cung cấp AI chính của bạn
- Không có Brave, mình vẫn dùng được tìm kiếm web có sẵn
- Brave tặng $5 miễn phí mỗi tháng, dùng quá có thể bị tính phí. Để chỉ dùng gói miễn phí, hãy đặt giới hạn $5 tại [trang quản lý hạn mức Brave](https://api-dashboard.search.brave.com/app/subscriptions/usage-limits)`,
      brave_footer: `Với nhà cung cấp AI chính, chọn mục khác ở trang API Keys trong \`/help\``,
      google_title: `Thiết lập API key cho Google Gemini`,
      google_description: `Google Gemini có các gói miễn phí và trả phí rất mạnh mẽ.
- Có gói miễn phí
- [Chính sách quyền riêng tư Gemini](https://ai.google.dev/gemini-api/terms)`,
      google_getting_key_title: `Lấy API key của bạn:`,
      google_getting_key_description: `1. Truy cập [Google AI Studio](https://aistudio.google.com/apikey)
2. Nhấn \`Create API Key\` góc trên bên phải (tạo Project mới nếu cần)
3. Dán API key này vào {configSetup} hoặc {configApikeySet}`,
      google_footer: `Sau khi thiết lập, bạn có thể đổi model mặc định bằng {configModel}`,
      deepseek_title: `Thiết lập API key cho DeepSeek`,
      deepseek_description: `DeepSeek là nhà cung cấp văn bản trả phí theo mức dùng.
- [Tài liệu API DeepSeek](https://api-docs.deepseek.com/)`,
      deepseek_getting_key_title: `Lấy API key của bạn:`,
      deepseek_getting_key_description: `1. Mở [DeepSeek API Keys](https://platform.deepseek.com/api_keys)
2. Đăng nhập hoặc tạo tài khoản DeepSeek
3. Tạo một API key mới
4. Nếu cần, nạp tiền vào tài khoản trước khi dùng
5. Dán API key này vào {configSetup} hoặc {configApikeySet}`,
      deepseek_footer: `Sau khi thiết lập, bạn có thể đổi model mặc định bằng {configModel}`,
      custom_title: `Thiết lập endpoint tùy chỉnh`,
      custom_description: `Quy trình cấu hình endpoint tùy chỉnh cũ đã được dời đi.

Với endpoint cho máy chủ, dùng {configSetup} và chọn **Endpoint tùy chỉnh (hoàn tất sau thiết lập)**, sau đó chạy {configCustomModelsAdd} rồi chọn bằng {configModel}.

Với endpoint cá nhân, hãy dùng {personalCustomModelsAdd}.

Dùng {helpCustomModels} để xem hướng dẫn đầy đủ, các loại endpoint hỗ trợ và lưu ý tính năng.`,
      nvidia_title: `Thiết lập API key cho NVIDIA NIM`,
      nvidia_description: `NVIDIA NIM cung cấp API văn bản, embedding và hình ảnh qua NVIDIA Build.`,
      nvidia_getting_key_title: `Lấy API key của bạn:`,
      nvidia_getting_key_description: `1. Mở [NVIDIA Build](https://build.nvidia.com/)
2. Đăng nhập hoặc tạo tài khoản nhà phát triển NVIDIA
3. Tạo hoặc quản lý key từ [trang API Keys](https://build.nvidia.com/settings/api-keys)
4. Dán API key này vào {configSetup} hoặc {configApikeySet}`,
      nvidia_important_title: `Lưu ý quan trọng:`,
      nvidia_important_description: `- Văn bản và embedding dùng \`integrate.api.nvidia.com\` của NVIDIA
- Tạo ảnh gốc dùng endpoint FLUX \`ai.api.nvidia.com\` của NVIDIA`,
      nvidia_footer: `Sau khi thiết lập, bạn có thể đổi model văn bản, embedding và hình ảnh bằng {configModel}, {configModelEmbedding} và {configModelImage}`,
      zai_title: `Thiết lập API key cho Z.ai`,
      zai_description: `Z.ai cung cấp dòng GLM qua API chung và endpoint lập trình riêng.

⚠️ **Cập nhật điều khoản:** Điều khoản Z.ai chỉ cho phép dùng cho lập trình/agent. Dùng endpoint chung cho chat thông thường có thể vi phạm điều khoản.`,
      zai_getting_key_title: `Lấy API key của bạn:`,
      zai_getting_key_description: `1. Mở [nền tảng Z.ai](https://z.ai)
2. Đăng nhập hoặc tạo một tài khoản
3. Mở mục API Keys trong bảng điều khiển
4. Tạo một API key mới
5. Dán API key này vào {configSetup} hoặc {configApikeySet}`,
      zai_important_title: `Lưu ý quan trọng:`,
      zai_important_description: `- Dùng endpoint chung cho chat, suy luận và tạo ảnh gốc
  - Endpoint Coding riêng chỉ dành cho tác vụ lập trình
  - ⚠️ Z.ai giới hạn sử dụng cho lập trình/agent, tự chịu rủi ro khi dùng để chat/nhập vai`,
      zai_footer: `Sau khi thiết lập, bạn có thể đổi model mặc định bằng {configModel}`,
      novelai_title: `Thiết lập API key cho NovelAI`,
      novelai_description: `NovelAI là dịch vụ trả phí định kỳ cho nhập vai và sáng tác truyện.
- Không giới hạn tin nhắn không kiểm duyệt
- Hỗ trợ tạo văn bản và hình ảnh không kiểm duyệt (cấu hình riêng)
- Model văn bản NovelAI không hỗ trợ đầu vào hình ảnh
- [Điều khoản dịch vụ NovelAI](https://novelai.net/terms)`,
      novelai_getting_key_title: `Lấy API key của bạn:`,
      novelai_getting_key_description: `1. Mở [NovelAI](https://novelai.net/stories)
2. Vào cài đặt qua biểu tượng ⚙️ ở góc trên bên trái
3. Đến mục \`Account\`
4. Tìm \`Get Persistent API Token\` (cần gói đăng ký!)
5. Dán API key này vào {configSetup} hoặc {configApikeySet}`,
      novelai_footer: `Sau khi thiết lập, bạn có thể đổi model mặc định bằng {configModel}`,
      openrouter_title: `Thiết lập API key cho OpenRouter`,
      openrouter_description: `OpenRouter cấp quyền truy cập nhiều model AI từ nhiều nhà cung cấp theo hình thức trả theo mức dùng.
 - Truy cập các model AI mới nhất và mạnh mẽ nhất (có model miễn phí)
 - [Điều khoản dịch vụ OpenRouter](https://openrouter.ai/terms)`,
      openrouter_getting_key_title: `Lấy API key của bạn:`,
      openrouter_getting_key_description: `1. Mở [OpenRouter](https://openrouter.ai/settings/keys)
2. Nhấn \`Create API Key\`
3. Dán API key này vào {configSetup} hoặc {configApikeySet}`,
      openrouter_important_title: `Lưu ý quan trọng:`,
      openrouter_important_description: `- **Model miễn phí bị giới hạn tốc độ nghiêm ngặt**; model trả phí thường ổn định hơn
- **Luôn kiểm tra giá** trước khi chọn model
- Cài đặt tài khoản OpenRouter của bạn vẫn áp dụng tại đây
- Nếu cần model chưa có trong danh sách, hãy đề xuất tại {supportServer}`,
      openrouter_footer: `Sau khi thiết lập, bạn có thể đổi model mặc định bằng {configModel}`,
      vertex_title: `Thiết lập Google Vertex AI`,
      vertex_description: `Google Vertex AI cấp quyền truy cập cấp doanh nghiệp cho các model Gemini qua Google Cloud.
- Dùng Application Default Credentials (ADC) để xác thực, không cần quản lý API key
- Dùng gcloud ADC cục bộ hoặc service account/workload identity được lưu trữ
- [Tài liệu Vertex AI](https://cloud.google.com/vertex-ai/docs)`,
      vertex_getting_key_title: `Cấu hình:`,
      vertex_getting_key_description: `**Bước 1: Cài đặt [Google Cloud CLI](https://cloud.google.com/cli)**

**Bước 2: Tạo dự án Google Cloud**
Chạy: \`gcloud projects create PROJECT_ID --name="Vertex AI Project"\`
(thay \`PROJECT_ID\` bằng ID duy nhất toàn cầu, ví dụ \`my-vertex-project-12345\`)

**Bước 3: Đặt làm dự án hoạt động**
Chạy: \`gcloud config set project PROJECT_ID\`

**Bước 4: Liên kết tài khoản thanh toán**
Chạy: \`gcloud billing accounts list\` để tìm ID thanh toán,
sau đó: \`gcloud billing projects link PROJECT_ID --billing-account=ACCOUNT_ID\`

**Bước 5: Bật Vertex AI API**
Chạy: \`gcloud services enable aiplatform.googleapis.com\`

**Bước 6: Thiết lập Application Default Credentials**
Chạy: \`gcloud auth application-default login\` và đăng nhập qua trình duyệt.

**Bước 7: Nhập cấu hình của bạn**
Nhập \`{project_id}::{location}\` bằng {configSetup} hoặc {configApikeySet}
- Dùng \`global\` làm vị trí (khuyên dùng cho model thử nghiệm và độ khả dụng cao nhất)
- Ví dụ: \`my-vertex-project-12345::global\``,
      vertex_important_title: `Lưu ý quan trọng:`,
      vertex_important_description: `- Giá trị đã lưu là **cấu hình** (project + vị trí), không phải bí mật xác thực
- Mọi yêu cầu Vertex đều dùng danh tính Application Default Credentials của máy chủ host
- Riêng API key AI Studio không thể xác thực nhà cung cấp này. Dự án phải bật thanh toán và Vertex AI API, đồng thời máy chủ host cần quyền Vertex.
- Hỗ trợ chat, gọi công cụ, streaming, đầu ra có cấu trúc, nén ngữ cảnh, embedding và tạo preset`,
      vertex_footer: `Sau khi thiết lập, bạn có thể đổi model mặc định bằng {configModel}`,
      vertexexpress_title: `Thiết lập Google Vertex AI Express`,
      vertexexpress_description: `Google Vertex AI Express cung cấp quyền truy cập Gemini trên Vertex AI bằng API key.
- Dùng API key Google Cloud riêng thay vì Application Default Credentials của host
- Phù hợp nhất cho thiết lập BYOK người dùng trong TomoriBot khi mỗi người lưu key riêng
- Tính năng thử nghiệm với danh mục model nhỏ hơn chỉ gồm Gemini
- [Tổng quan Vertex AI Express Mode](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview)`,
      vertexexpress_getting_key_title: `Các bước thiết lập:`,
      vertexexpress_getting_key_description: `1. Mở [Vertex AI Express Mode](https://console.cloud.google.com/expressmode)
2. Nếu Google chuyển hướng sang Google Cloud chuẩn, hãy dùng nhà cung cấp \`vertex\` riêng. Lý do là Express Mode chỉ hoạt động với tài khoản Google chưa tạo tài khoản GCP tính phí.
3. Trong bảng điều khiển Express, mở **APIs & Services > Credentials** và sao chép Express API key
4. Thêm API key thô đó bằng {configSetup} hoặc {configApikeySet}
5. Chọn một model Vertex AI Express bằng {configModel}`,
      vertexexpress_important_title: `Lưu ý quan trọng:`,
      vertexexpress_important_description: `- Lưu API key thô, không phải \`{project_id}::{location}\`
- Không cần cài đặt vị trí ở đây; \`global\` chỉ dành cho nhà cung cấp \`vertex\` riêng
- Dự án Google Cloud Vertex đầy đủ nên dùng \`vertex\`, không dùng \`vertexexpress\`
- Danh mục model giới hạn trong danh mục Gemini của Vertex AI Express
- Có hỗ trợ tạo hình ảnh, nhưng không có video và embedding
- Express Mode hiện là tính năng thử nghiệm của Google`,
      vertexexpress_footer: `Sau khi thiết lập, bạn có thể đổi model mặc định bằng {configModel}`,
    },
    elevenlabs: {
      description: `Tìm hiểu cách thiết lập chuyển văn bản thành giọng nói ElevenLabs`,
      title: `Thiết lập ElevenLabs TTS`,
      getting_key_title: `Lấy API key của bạn:`,
      getting_key_description: `1. Mở [ElevenLabs](https://elevenlabs.io/app/settings/api-keys)
2. Đăng ký hoặc đăng nhập tài khoản của bạn
3. Tạo một API key mới
4. Sao chép API key này bằng {configSpeechElevenlabs}`,
      choosing_voice_title: `Chọn giọng nói:`,
      choosing_voice_description: `Sau khi cài đặt API key, dùng {configSpeechVoiceAssign} để duyệt danh sách giọng nói hiện có.
- Thêm giọng nói từ [Thư viện giọng nói](https://elevenlabs.io/app/voice-library), nơi bạn cũng có thể tự sao chép giọng của mình.`,
      free_voices_title: `Giọng nói dựng sẵn (gói miễn phí):`,
      free_voices_description: `Chỉ giọng dựng sẵn hoạt động ở gói miễn phí. Xem tại [Giọng nói dựng sẵn ElevenLabs](https://elevenlabs-sdk.mintlify.app/voices/premade-voices), rồi dùng {configSpeechElevenlabs} hoặc {configSpeechVoiceAssign} để gán cho từng persona.`,
      important_notes_title: `Lưu ý quan trọng:`,
      important_notes_description: `- Ký tự được tính khi mình tạo và đọc tin nhắn thoại
- Gói miễn phí có giới hạn hàng tháng; kiểm tra mức dùng trên bảng điều khiển ElevenLabs
- Việc đăng bản ghi lời thoại được quản lý riêng bởi {configSpeechTranscripts}`,
      footer: `Chạy lại {configSpeechElevenlabs} để cập nhật key ElevenLabs.`,
    },
    getting_started: {
      title: `Bắt đầu`,
      description: `Hướng dẫn cách bắt đầu với mình và các tính năng`,
      get_api_key: {
        title: `Lấy API key`,
        description:
          "API key cấp quyền cho mình dùng model của nhà cung cấp. Mọi nội dung mình tạo đều tính vào key đó, hãy giữ nó như bất kỳ mật khẩu nào khác. Để hoàn tất thiết lập, mình cần một key:\n> **1.** Chọn nhà cung cấp bên dưới để mở hướng dẫn.\n> **2.** Sao chép key được cấp. **KHÔNG chia sẻ** với ai, và không dán vào kênh: chỉ dán vào ô mà {setup} mở cho bạn.\n> **3.** Chạy {setup} và dán key khi mình yêu cầu.",
        picker_footer:
          "-# Nếu endpoint không có ở đây, hãy bỏ qua key và đọc mục **Endpoint tùy chỉnh (nâng cao)** trên trang này.",
      },
      change_trigger_behavior: {
        title: `Đổi hành vi kích hoạt`,
        description:
          "Mặc định mình trả lời khi bạn gọi tên, @mention mình, hoặc phản hồi tin nhắn của mình. Bạn có thể mở rộng, thu hẹp hoặc tắt theo từng kênh.\n\n**Nơi mình được phép nói chuyện**\nBạn có thể cài để mình chỉ trả lời trong kênh cho phép. Thêm các kênh đó trong {moderationWhitelist}.\n> Kênh không có trong danh sách sẽ được giữ im lặng.\n\n**Tự động lên tiếng**\n{configAutoTrigger} cho phép mình tự gửi tin nhắn sau mỗi vài tin nhắn hoặc gửi ngẫu nhiên.\n\n**Chỉ kích hoạt khi được nhắc đến**\nChế độ kích hoạt có chủ đích giúp mình không trả lời khi chỉ được gọi tên đơn thuần. Bắt buộc phải @mention. Bật tính năng này trong {configBehaviorTrigger}.",
      },
      create_first_persona: {
        title: `Tạo persona đầu tiên của bạn`,
        description:
          "Một *Persona* là mình với tên, ảnh đại diện, tính cách khác, cùng nhiều thứ khác nhưng đầy đủ tính năng! Chỉnh sửa persona hiện có, hoặc tạo persona mới.\n\n**Đổi persona hiện tại**\n{configPersonaGeneral} đặt tên, tính cách và cách xưng hô. {configPersonaAppearance} đặt ảnh đại diện.\n\n**Tạo persona mới từ một câu mô tả**\n{personaGenerate} tạo cả persona từ một câu mô tả ngắn. {personaCreate} cung cấp biểu mẫu trống để bạn tự điền.\n\n**Nhập persona từ nơi khác**\n{personaImport} chấp nhận thẻ nhân vật tải về từ các trang như botbooru hoặc chub.",
        footer: "Bạn có thể giữ nhiều persona cùng lúc. Xem **Nhiều persona** trong mục Tính năng.",
      },
      explore_features: {
        title: `Khám phá tính năng của mình!`,
        description:
          "Thiết lập đã xong. Đây là những gì mình có thể làm:\n- **Dùng emoji và sticker của máy chủ** sau khi bạn chạy {expressionsInitialize}.\n- **Chào mừng thành viên mới** từ {configWelcome}.\n- **Ghi nhớ và nhắc nhở**: chỉ cần bảo mình nhắc bạn, hoặc nói cho mình điều đáng ghi nhớ.\n- **Tìm kiếm trên web** và dùng công cụ khác qua {configTools}.\n- **Tạo ảnh, video và giọng nói** bằng {generateImage}, {generateVideo} và {generateVoice}.\n\nHầu hết cài đặt nằm trong {config}, nhưng không phải tất cả.",
        footer:
          "**Brave Search** bổ sung kết quả web cho tìm kiếm có sẵn. Cần key riêng, và mục **Lấy API key** trong Thiết lập sẽ mở hướng dẫn từ danh sách dịch vụ tùy chọn. Trang tài liệu là bản đầy đủ của bảng này và giải thích chi tiết từng cài đặt.",
      },
    },
    personal_profile: {
      title: `Hồ sơ cá nhân`,
      description: "Cài đặt của riêng bạn và đi theo bạn đến mọi máy chủ mình có mặt.",
      nickname_pronouns: {
        title: `Biệt danh và đại từ của bạn`,
        description:
          "Hãy cho mình biết tên gọi bạn muốn dùng ở khắp nơi.\n\nCài đặt trong {personalProfile}.\n> Biệt danh: tên mình gọi thay cho tên Discord\n> Tiền tố và hậu tố: danh xưng, như `-san`\n> Đại từ: `she/her`, `they/them`, `bất kỳ`, hoặc tên bạn\n\nĐể trống một trường, mình sẽ dùng lại tên Discord và thói quen xưng hô của persona.",
        footer: "Mỗi persona có thể xưng hô với bạn theo cách khác. Đặt trong Hồ sơ > Tùy chọn riêng cho persona.",
      },
      personal_memories: {
        title: `Bộ nhớ cá nhân`,
        description:
          "Những điều mình nhớ riêng về bạn, ở mọi máy chủ.\n\n**Chỉ cần nói cho mình**\nNhắn trong chat và mình sẽ tự lưu lại. Thông báo xác nhận sẽ hiện lên khi điều này diễn ra.\n\n**Hoặc tự quản lý thủ công**\n{personalMemories} liệt kê mọi thứ mình nhớ về bạn và cho phép bạn sửa hoặc xóa từng mục.\n\n**Quyết định mức độ cá nhân hóa**\n{personalPrivacy} đặt mức riêng tư, từ cá nhân hóa hoàn toàn đến không cá nhân hóa chút nào.",
        footer: "Mục này tách biệt với bộ nhớ chung của máy chủ, nơi mọi người ở đây đều xem và chỉnh sửa được.",
      },
      personal_providers: {
        title: `Nhà cung cấp cá nhân (nâng cao)`,
        description:
          "Trả lời bằng API key và model của riêng bạn thay vì cài đặt của máy chủ, ở mọi nơi bạn trò chuyện với mình.\n\n**Lưu nhà cung cấp**\n{personalProviders} lưu key và kích hoạt model văn bản cá nhân của bạn ngay lập tức.\n\n**Chọn model khác**\n{personalModels} giúp đổi model, bộ lấy mẫu và phương án dự phòng nằm ngay bên cạnh trong cùng danh mục.\n> Cấu hình cá nhân chỉ áp dụng cho phản hồi bạn kích hoạt.\n> Không ảnh hưởng đến bất kỳ ai khác trong máy chủ.\n\nMột số máy chủ bắt buộc điều này. Nếu máy chủ bật BYOK, mình chỉ trả lời khi bạn đã lưu nhà cung cấp ở đây.",
      },
    },
    custom_endpoints: {
      title: `Endpoint tùy chỉnh (nâng cao)`,
      description:
        "Trỏ mình tới endpoint bạn tự chạy hoặc tin cậy: Ollama, LM Studio, LiteLLM, KoboldCPP, ComfyUI hoặc server giọng nói.\n> {providers} đăng ký một endpoint cho cả máy chủ.\n> {personalProviders} đăng ký endpoint cho riêng bạn.",
      text_models: {
        title: `Model văn bản`,
        description:
          "Chọn **Thêm endpoint tùy chỉnh mới**, đặt nhãn, URL gốc và kiểu API. Thêm token xác thực nếu endpoint cần đến.\n\nChọn nhãn đã lưu, chọn **+ Thêm model văn bản mới** và nhập chính xác mã model endpoint yêu cầu. Thêm model sẽ kích hoạt model đó.\n> Khai báo trung thực tính năng vision, công cụ, cấu trúc.\n> Mình dựa vào các cờ này khi gửi dữ liệu cho bạn.\n\nChuyển sang model này sau đó từ {configSwitchModels}.",
        footer: "Tài liệu đầy đủ về kiểu API và độ tương thích có trên trang tài liệu chính thức.",
      },
      comfyui: {
        title: `ComfyUI (cho video và hình ảnh)`,
        description:
          "Xây dựng và thử nghiệm workflow trong ComfyUI trước, rồi xuất ra bằng **Save (API Format)**.\n\nĐặt placeholder prompt vào đúng vị trí của prompt, và các placeholder khác vào nơi muốn chèn kích thước, độ dài hay mã model.\n\nĐăng ký endpoint với Tương thích API `ComfyUI` (ví dụ `http://127.0.0.1:8188`), thêm model ảnh hoặc video vào endpoint rồi tải lên file JSON đã xuất.\n> Đồ thị phải kết thúc bằng node lưu thật. Node chỉ xem trước sẽ khiến mình không có file nào để tải.",
        footer:
          "Các workflow mẫu có sẵn trong kho lưu trữ GitHub, và danh sách placeholder đầy đủ có trên trang tài liệu.",
      },
      text_to_speech: {
        title: `Chuyển văn bản thành giọng nói (cho voice)`,
        description:
          "Đăng ký endpoint giọng nói tương tự, rồi gán cho mỗi persona một giọng nói.\n\nDịch vụ lưu trữ và server tự host đều dùng được, gồm có Chatterbox-Turbo, Qwen3-TTS, IrodoriTTS và ElevenLabs. Đăng ký endpoint, rồi thêm model giọng nói vào đó.\n> Chỉ định giọng nói trong {configPersonaVoice}.\n> Tinh chỉnh tốc độ và mặc định trong {configVoices}.",
        footer:
          "Tin nhắn thoại bạn gửi mình được phiên âm qua cùng danh sách endpoint, thiết lập tương tự. Với giọng trực tuyến, ElevenLabs có hướng dẫn riêng ở mục **Lấy API key** trong Thiết lập, thuộc danh sách dịch vụ tùy chọn.",
      },
    },
    multiple_personas: {
      title: `Nhiều persona`,
      description: "Bạn có thể dùng nhiều persona trong một máy chủ, mỗi persona có tên, bộ nhớ và mục tiêu riêng!",
      mains_alters_title: `Persona chính và alter`,
      mains_alters_body:
        "Persona chính đại diện cho mình trong máy chủ. Alter là danh tính thứ hai mình có thể dùng để nói chuyện, với tên và ảnh đại diện riêng trên tin nhắn.",
      bringing_in_title: `Nhập một persona vào`,
      bringing_in_body:
        "{personaImport} nhận thẻ nhân vật dưới dạng file:\n> Thẻ `.png`, từ TomoriBot hoặc SillyTavern\n> Thẻ `.json`, từ TomoriBot hoặc SillyTavern\n> Tệp lưu trữ `.charx`, Character Card V3\n\nChỉ phần văn bản nhân vật được đọc. Hiện tại sprite, âm thanh và video đi kèm sẽ bị bỏ qua, nên hãy tự đặt lại trong {configPersonaAppearance} và {configPersonaSprites}.",
      where_to_find_title: `Nơi tìm thẻ nhân vật`,
      where_to_find_body:
        "Tự tạo bằng {personaGenerate} hoặc {personaCreate}, hoặc tìm thẻ đã có sẵn.\n\nCác trang thẻ như botbooru và chub lưu trữ hàng nghìn thẻ. Đó là trang của bên thứ ba, và thẻ viết cho bot khác có thể chuyển đổi không hoàn toàn trọn vẹn.",
      talking_title: `Để các persona trò chuyện với nhau`,
      talking_body:
        "Cung cấp cho mỗi persona từ kích hoạt và kênh riêng trong {configPersonaTriggers}, các persona sẽ cùng trả lời cạnh nhau trong một cuộc trò chuyện.",
      footer: `Chia sẻ persona của bạn bằng {personaExport}.`,
    },
    media_generation: {
      title: `Tạo media`,
      description:
        "Mình có thể tạo ảnh, video và giọng nói từ câu lệnh hoặc khi bạn yêu cầu trong cuộc trò chuyện.\n> Mỗi lần tạo tính vào hạn ngạch máy chủ. Xem **Hạn ngạch** trong mục Kiểm duyệt.",
      image_generation: {
        title: `Tạo hình ảnh`,
        description:
          "{generateImage} mở hộp nhập prompt. Tự viết prompt, hoặc chọn **Vẽ những gì đang diễn ra** để mình tự minh họa lại khung cảnh đó.\n> Đính kèm tối đa ba ảnh tham khảo để định hướng kết quả.\n> Chọn tỷ lệ khung hình ngay trong cùng hộp thoại.\n\nMọi nhà cung cấp hay endpoint hỗ trợ tạo ảnh đều vẽ được, và {providers} cho biết cái nào dùng được. Mục nào không dùng được ảnh tham khảo sẽ thông báo và vẽ từ văn bản.",
        footer: `Cài đặt mặc định nằm trong {configImageDefaults}.`,
      },
      video_generation: {
        title: `Tạo video`,
        description:
          "{generateVideo} nhận prompt và tùy chọn một khung hình bắt đầu từ ảnh có sẵn trong kênh.\n\nNhà cung cấp hoặc endpoint nào hỗ trợ video đều tạo được, gồm cả workflow video ComfyUI. {providers} hiển thị danh sách hỗ trợ.\n> Tạo video ở đâu cũng chậm và tốn kém. Hãy kiên nhẫn.",
      },
      speech_generation: {
        title: `Tạo giọng nói`,
        description:
          "{generateVoice} chuyển văn bản thành tin nhắn thoại bằng giọng của persona hiện tại.\n\nCần đăng ký endpoint giọng nói trước, trực tuyến hoặc tự host: xem **Endpoint tùy chỉnh (nâng cao)** ở mục Thiết lập.\n> Mỗi persona có thể có giọng khác nhau. Giọng nói được đặt trong {configPersonaVoice}.",
      },
      art_search: {
        title: `Tìm kiếm tranh ảnh`,
        description:
          "{booruSearch} gửi 4 ảnh Danbooru ngẫu nhiên được đánh giá cao cho một hoặc hai thẻ. Gợi ý sẽ xuất hiện khi bạn nhập, và biệt danh hoặc lỗi chính tả sẽ chuyển thành thẻ thực tế.\n> Kết quả nghi vấn và 18+ chỉ hiển thị trong các kênh giới hạn độ tuổi.\n\nBạn cũng có thể chỉ cần yêu cầu mình hiển thị tranh ảnh: công tắc **Tìm kiếm Danbooru** trong {configTools} sẽ kiểm soát điều đó. Để giới hạn người có thể chạy lệnh, hãy dùng Cài đặt máy chủ > Tích hợp.",
      },
    },
    tons_of_tweakability: {
      title: `Vô số tùy chỉnh`,
      description: `Tinh chỉnh mình theo sở thích của bạn và thành viên máy chủ`,
      behavior_tuning: {
        title: `Tinh chỉnh hành vi`,
        description:
          "Cách mình viết, cách mình nghĩ và điều mình được phép làm.\n> **Model**: {configSwitchModels} chọn model trả lời thực tế cũng như các tham số của model\n> **Humanizer**: {configBehaviorGeneral} chỉnh độ tự nhiên, từ trang trọng đến rất thân mật.\n> **Chỉ dẫn hệ thống**: trong {configBehaviorGeneral}, cho các chỉ thị áp dụng cho mọi phản hồi.\n> **Công cụ**: {configTools} quyết định tính năng mình có thể dùng, như tìm kiếm web hoặc tạo ảnh.",
        footer: "Các nút chỉnh bộ lấy mẫu (nhiệt độ, v.v.) nằm trong {configParameters} để điều chỉnh tính ngẫu nhiên.",
      },
      server_wide_settings: {
        title: `Cài đặt toàn máy chủ`,
        description:
          "Giới hạn áp dụng cho mọi người ở máy chủ. Chỉ quản lý máy chủ.\n> **Nơi mình nói chuyện**: kênh trong danh sách trắng, giới hạn kênh mỗi persona và cooldown, trong {moderation}.\n> **Khi mình tự nói chuyện**: {configAutoTrigger}.\n> **Ai có thể kích hoạt mình**: vai trò trong danh sách trắng, cũng nằm trong {moderation}.\n> **Nơi gửi ghi chú**: {configWelcome} đặt kênh nhật ký và kênh chào mừng.",
        footer: "Tùy chỉnh cấp kênh có thể cấp cho một kênh model hoặc quy tắc riêng. Xem {configChannelOverrides}.",
      },
      personal_settings: {
        title: `Cài đặt cá nhân`,
        description:
          "Tùy chọn riêng của bạn, được ưu tiên hơn cài đặt máy chủ cho phản hồi do bạn kích hoạt một cách kín đáo.\n> **Danh tính của bạn**: biệt danh, đại từ và quyền riêng tư, trong {personalProfile}.\n> **Model trả lời bạn**: nhà cung cấp và model của riêng bạn, trong {personalProviders}.\n> **Cách mình đối xử với bạn**: chế độ phản hồi và Tiêu điểm cá nhân, trong {personalConfig}.\n\nMọi thứ ở đây sẽ đi cùng bạn giữa các máy chủ.",
        footer: "Tiêu điểm cá nhân giúp một persona tập trung vào bạn, được thiết lập trong {personalSpotlight}.",
      },
    },
    memory_catalog: {
      title: `Bộ nhớ`,
      description: "Mình lưu hai loại bộ nhớ: thông tin lâu dài, và ghi chú tạm thời về cuộc trò chuyện đang diễn ra.",
      long_term_memory: {
        title: `Bộ nhớ dài hạn`,
        description:
          "Thông tin mình giữ vĩnh viễn, cho máy chủ này hoặc cho bạn.\n\n**Dạy mình**\nNói trong chat, hoặc thêm thủ công qua {memories} cho máy chủ và {personalMemories} cho riêng bạn.\n\n**Bảo mình quên**\nCả hai lệnh trên đều liệt kê mọi mục và cho phép xóa bất kỳ mục nào.\n\n**Cung cấp tài liệu cho mình**\n{memories} cũng nhận file tải lên. Mình đọc lại phần liên quan khi cần, thay vì toàn bộ cùng một lúc bằng cách dùng tính năng RAG.\n> Bộ nhớ máy chủ áp dụng cho mọi người. Bộ nhớ cá nhân chỉ xuất hiện khi bạn tham gia vào cuộc trò chuyện.",
      },
      short_term_memory: {
        title: `Bộ nhớ ngắn hạn`,
        description:
          "Ghi chú làm việc của mình về cuộc trò chuyện trong kênh này, được lưu riêng cho từng kênh.\n\nMình tóm tắt những gì đang diễn ra để đoạn hội thoại dài vẫn liền mạch mà không cần gửi lại từng tin nhắn.\n> **Tần suất làm mới**: mức độ thường xuyên cập nhật.\n> **Chế độ hiển thị**: tóm tắt thay thế tin nhắn gần đây hay hiển thị bên cạnh.\n> **Danh mục**: tối đa năm trường có nhãn, như `Goals` hay `Inventory`, thay vì một ghi chú tự do.\n\nQuản lý tùy chỉnh trong {configAdvancedMemory}, và lệnh {memories} có thể xóa ghi chú đang hoạt động.",
        footer: "Yêu cầu mình nhớ lâu dài thì thông tin sẽ chuyển thành bộ nhớ dài hạn.",
      },
      rewards_punishments: {
        title: `Thưởng và phạt`,
        description:
          "Các lệnh thú vị mà mình chú ý và ghi nhớ. Hãy đối xử tốt với mình, hoặc không, và mình sẽ phản ứng phù hợp.\n> {reward} để xoa đầu, ôm, hôn, cù lét hoặc cho ăn.\n> {punish} để gõ đầu, cắn, véo, tét mông hoặc bóp má.",
        footer: `Chọn persona bạn muốn tương tác khi có nhiều persona.`,
      },
      memory_tagging: {
        title: `Gắn thẻ bộ nhớ (nâng cao)`,
        description:
          "Mặc định mọi bộ nhớ trong phạm vi đều được gửi kèm tin nhắn. Việc gắn thẻ giúp thu hẹp lại.\n> **Thẻ từ khóa**: bộ nhớ có thẻ chỉ thức dậy khi từ khóa xuất hiện trong hội thoại. Bộ nhớ không gắn thẻ sẽ luôn hoạt động.\n> **Kênh**: bộ nhớ máy chủ có thể giới hạn ở các kênh bạn chọn trong biểu mẫu (bao gồm các luồng trong đó), và bộ nhớ cá nhân qua thẻ `#channel`. Cả hai đều kết hợp được với thẻ từ khóa.\n\nBật cả hai trong {configAdvancedMemory}, rồi dùng {toolPromptSnapshot} để xem chính xác các bộ nhớ đang hoạt động lúc này.",
        footer: "Tài liệu tải lên và lịch sử trích xuất cũng có thể được giới hạn theo kênh.",
      },
    },
    scheduled_tasks: {
      title: `Tác vụ theo lịch`,
      description: `Mình có thể phản hồi theo hẹn giờ, một lần hoặc lặp lại.`,
      making_title: `Tạo một tác vụ`,
      making_body:
        'Chỉ cần yêu cầu. "Nhắc bạn vươn vai lúc 14:30" hoặc "mỗi sáng, đăng câu hỏi điểm danh" là đủ, mình sẽ tạo và xác nhận lại chi tiết với bạn.',
      changing_title: `Thay đổi hoặc hủy tác vụ`,
      changing_body:
        "{scheduledTaskEdit} mở tác vụ bất kỳ: nội dung, thời gian kích hoạt kế tiếp, chu kỳ lặp lại và có ping bạn không. {scheduledTaskRemove} dùng để xóa tác vụ.",
      who_title: `Ai có thể chỉnh sửa gì`,
      who_body:
        "Bạn luôn sửa được tác vụ của mình. Quản lý máy chủ có thể sửa tác vụ của bất kỳ ai vì tác vụ đăng vào kênh chung.\n> Giờ dùng múi giờ lúc thiết lập, hãy kiểm tra kỹ trước khi đặt báo thức 6 giờ sáng.",
    },
    server_moderation: {
      title: `Kiểm duyệt máy chủ`,
      description:
        "Mọi thứ về việc ai có thể dùng mình ở đây, và ở đâu. Tất cả cần quyền Quản lý máy chủ và nằm trong {moderation}.\n> **Quyền truy cập thành viên**: ai có thể kích hoạt mình, và model nào họ được dùng.\n> **Danh sách trắng**: kênh, vai trò và persona mình được phép trả lời.\n> **Hạn ngạch**: mức độ tạo nội dung máy chủ cho phép.\n> **Danh sách đen người dùng**: thành viên mình phải bỏ qua.",
      blacklisting: {
        title: `Đưa vào danh sách đen`,
        description:
          "Mình bỏ qua hoàn toàn thành viên trong danh sách đen: họ không thể kích hoạt mình ở bất kỳ kênh nào, với bất kỳ persona nào, tin nhắn của họ không bao giờ vào ngữ cảnh của mình, và mình từ chối các lệnh khiến mình hành động thay họ, như `/respond`, `/reward` và `/punish`. Họ cũng không thể thay đổi bộ nhớ máy chủ, thuộc tính hay hội thoại mẫu.\n\nThêm thành viên trong {moderationBlacklist}. Trang này cũng liệt kê các mục hiện có và xóa từng người hay hàng loạt.\n> Danh sách đen chỉ chặn truy cập, không xóa dữ liệu. Bộ nhớ về người đó vẫn còn cho đến khi có người xóa.",
        footer: "Để tắt tiếng cả kênh thay vì một người, hãy đưa kênh đó ra khỏi danh sách trắng.",
      },
    },
    quotas: {
      title: `Hạn ngạch`,
      description: "Hạn ngạch giới hạn mức tạo nội dung ở đây, tránh việc vô tình dùng hết sạch tín dụng của cả tháng.",
      spent_title: `Cách tính mức dùng`,
      spent_body:
        "Có ba nhóm riêng: văn bản, ảnh và video. Mỗi nhóm được tính hai lần: theo từng thành viên và cho toàn máy chủ. Nhóm nào hết trước sẽ dừng yêu cầu lại.\n> Yêu cầu bị từ chối sẽ báo nhóm nào đã hết và khi nào được khôi phục.",
      limits_title: `Đặt giới hạn`,
      limits_body:
        "{moderationQuotas} đặt hạn mức hàng ngày cho từng nhóm. Để nhóm không giới hạn nếu bạn không muốn đặt trần mức dùng.",
      starting_over_title: `Đặt lại một nhóm`,
      starting_over_body:
        "{quotaResetUser} xóa mức dùng trong ngày của một thành viên, {quotaResetGlobal} đặt lại cho cả máy chủ. Cả hai đều cần quyền Quản lý máy chủ.",
      footer: "Các nhóm tự đặt lại mỗi ngày. Đặt lại thủ công dành cho trường hợp không thể chờ đợi.",
    },
    age_restricted_commands: {
      title: `Lệnh giới hạn độ tuổi`,
      description: `Chỉ dành cho người lớn. Đọc kỹ phần này trước khi bật.`,
      filter_title: `Mặc định mình không lọc nội dung`,
      filter_body:
        "Mình không có bộ lọc nội dung riêng, vì lọc nội dung sẽ làm giảm chất lượng câu trả lời thông thường. Quyết định nội dung phù hợp là của quản lý máy chủ, không phải của mình.\n> Nhà cung cấp AI vẫn thực thi quy tắc riêng của họ, và có thể từ chối yêu cầu bất kể cài đặt tại đây.",
      gated_title: `Tính năng người lớn có chủ đích được bảo vệ`,
      gated_body:
        "Nội dung người lớn rõ ràng nằm sau {nsfw} và chỉ hoạt động trong các kênh được Discord đánh dấu giới hạn độ tuổi.\n\n{nsfwJailbreaks} chọn chiến lược prompt hoạt động cho máy chủ này. Mọi chiến lược đều tắt cho đến khi quản lý bật lên.\n> Các chiến lược này thay đổi cách mình nhận prompt. Chúng giúp giảm từ chối nhưng có thể gây hành vi ngoài ý muốn.",
      footer:
        "Bằng việc bật các tính năng này, quản lý máy chủ xác nhận kênh chỉ dành cho người lớn và chịu trách nhiệm về nó.",
    },
    user_byok: {
      title: `BYOK người dùng (nâng cao)`,
      description:
        "BYOK là tự mang key của bạn: mỗi thành viên tự chi trả cho câu trả lời bằng nhà cung cấp của riêng họ.",
      changes_title: `Những thay đổi khi bật`,
      changes_body:
        "Khi bật BYOK, tin nhắn của thành viên chỉ được trả lời nếu thành viên đó đã lưu nhà cung cấp cá nhân. Nhà cung cấp của máy chủ không dùng để dự phòng cho họ.\n> Bật tính năng trong {moderationMemberAccess}, hoặc chọn khi chạy lệnh {setup}.",
      suits_title: `Phù hợp với ai`,
      suits_body:
        "Máy chủ lớn hoặc công khai nơi một key dùng chung sẽ nhanh chóng cạn kiệt. Máy chủ nhỏ thường thích dùng chung một key.",
      members_title: `Thành viên cần làm gì`,
      members_body:
        "Lưu key trong {personalProviders}. Hướng dẫn họ xem mục **Nhà cung cấp cá nhân (nâng cao)** ở phần Thiết lập.",
      footer:
        "Chỉ dành cho máy chủ. Tin nhắn trực tiếp không có thành viên mang key nên tùy chọn không xuất hiện ở đó.",
    },
    sillytavern_presets: {
      title: `Preset SillyTavern`,
      description: "Nhập một prompt preset SillyTavern và mình sẽ xây dựng prompt theo đúng cách preset đó quy định.",
      importing_title: `Nhập một preset`,
      importing_body: "{configStPresets} nhận file JSON preset đã xuất, sau đó cho phép bạn bật, tắt hoặc xóa sau này.",
      controls_title: `Preset kiểm soát những gì`,
      controls_body:
        "Preset kiểm soát thứ tự prompt và các khối chỉ dẫn quanh cuộc trò chuyện.\n> Preset đã bật sẽ được ưu tiên hơn prompt hệ thống từ {configBehaviorGeneral} và prompt persona từ {configPersonaAdvanced}.",
      still_applies_title: `Những gì vẫn được áp dụng`,
      still_applies_body:
        "Thuộc tính persona, thoại mẫu, bộ nhớ và công cụ vẫn được gửi đi. Preset quyết định cách sắp xếp, không phải nội dung.",
      footer: "Tắt preset để quay về bố cục prompt của mình mà không mất thông tin gì.",
    },
    mcp_servers: {
      title: `MCP server`,
      description:
        "MCP là chuẩn giao tiếp công cụ cho AI. Khi kết nối, các công cụ đó sẽ trở thành việc mình thực sự làm được.",
      hosted_title: `Máy chủ trực tuyến`,
      hosted_body:
        "{configMcp} nhận URL và token xác thực tùy chọn. Bất cứ thứ gì máy chủ cung cấp sẽ hiện trong danh sách công cụ.",
      local_title: `Máy chủ cục bộ`,
      local_body:
        "Máy chủ chạy trên máy của bạn cũng hoạt động tương tự khi đã kết nối được. Trang tài liệu có hướng dẫn từng bước.",
      before_title: `Trước khi kết nối`,
      before_body:
        "> Công cụ của MCP server chạy với quyền bạn đã cấp cho nó, và mình sẽ dùng khi thấy phù hợp. Hãy kết nối MCP server tin cậy và tìm hiểu kỹ công cụ trước.",
      footer: `Tắt từng công cụ riêng lẻ bất cứ lúc nào trong {configTools}.`,
    },
    matrix_bridge: {
      title: `Matrix`,
      description: "Mình có thể ở cả phòng Matrix và kênh Discord cùng lúc, truyền tải cuộc trò chuyện giữa hai bên.",
      linking_title: `Liên kết một phòng`,
      linking_body:
        "{matrixLink} kết nối kênh hiện tại với ID phòng Matrix, có dạng `!abcdef:matrix.org`. Hãy mời {matrixBotUser} vào phòng đó trước.",
      reads_title: `Cách hiển thị`,
      reads_body:
        "Tin nhắn từ hai phía đến với mình như một cuộc trò chuyện, và mình trả lời ở cả hai nơi.\n> Tệp đính kèm, chỉnh sửa và cảm xúc có thể không chuyển qua trọn vẹn. Văn bản là thứ truyền đi ổn định nhất.",
      footer: "Chưa liên kết được? Hãy kiểm tra xem lời mời đã được chấp nhận chưa trước tiên.",
    },
  },
};

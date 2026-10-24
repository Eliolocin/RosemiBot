export default {
  help: {
    description: `瀏覽設定、功能、供應商、記憶、行為、工具、媒體與整合的說明。`,
    dashboard: {
      categories: {
        setup: `設定`,
        features: `功能`,
        moderation: `管理`,
        plugins: `外掛`,
      },
      pages: {
        custom_endpoints: `自訂端點`,
      },
      page_reference: `\`/help\` 的 **{page}** 頁面`,
      page_select_placeholder: `選擇一個頁面`,
      subsection_select_placeholder: `選擇一個主題`,
      provider_select_placeholder: `選擇供應商`,
      optional_provider_select_placeholder: `選用服務`,
      previous_button: `← 上一頁`,
      next_button: `下一頁 →`,
      docs_link_label: `閱讀網頁版`,
      support_link_label: `取得技術支援`,
      sections: {
        getting_started: `開始使用`,
        getting_started_description: `金鑰、觸發、人格，以及接下來可以試什麼`,
        personal_profile: `個人資料`,
        personal_profile_description: `你的稱呼、你的記憶、你自己的供應商`,
        custom_endpoints: `自訂端點（進階）`,
        custom_endpoints_description: `註冊你自己架設或信任的端點`,
        multiple_personas: `多個人格`,
        multiple_personas_description: `同時擁有多個身分，並匯入角色卡`,
        media_generation: `媒體生成`,
        media_generation_description: `製作圖片、影片與語音訊息`,
        tons_of_tweakability: `大量可調設定`,
        tons_of_tweakability_description: `行為、伺服器與個人設定的位置`,
        memory: `記憶`,
        memory_description: `我記得什麼，以及記得多久`,
        scheduled_tasks: `排程任務`,
        scheduled_tasks_description: `提醒，以及我會主動回來執行的任務`,
        server_moderation: `伺服器管理`,
        server_moderation_description: `誰可以在這裡使用我，以及在哪些地方`,
        quotas: `額度`,
        quotas_description: `限制這個伺服器可以生成多少內容`,
        age_restricted_commands: `年齡限制指令`,
        age_restricted_commands_description: `成人功能，以及我不會過濾的內容`,
        user_byok: `使用者 BYOK（進階）`,
        user_byok_description: `讓每位成員自備金鑰`,
        sillytavern_presets: `SillyTavern 預設集`,
        sillytavern_presets_description: `用匯入的預設集組出我的提示詞`,
        mcp_servers: `MCP 伺服器`,
        mcp_servers_description: `連接我真正能使用的外部工具`,
        matrix: `Matrix`,
        matrix_description: `把 Matrix 房間橋接到 Discord 頻道`,
      },
      subsections: {
        get_api_key: `取得 API 金鑰`,
        get_api_key_description: `去哪裡取得，以及如何妥善保管`,
        change_trigger_behavior: `調整觸發行為`,
        change_trigger_behavior_description: `我何時、何地可以回應`,
        create_first_persona: `建立你的人格`,
        create_first_persona_description: `編輯我、生成新的人格，或匯入一個`,
        explore_features: `探索我的功能！`,
        explore_features_description: `快速導覽我現在能做的事`,
        nickname_pronouns: `你的稱呼與代稱`,
        nickname_pronouns_description: `我在每個伺服器怎麼稱呼你`,
        personal_memories: `個人記憶`,
        personal_memories_description: `我特別記得關於你的事`,
        personal_providers: `個人供應商（進階）`,
        personal_providers_description: `用自己的金鑰與模型回答你`,
        text_models: `文字模型`,
        text_models_description: `註冊聊天端點與它的模型`,
        comfyui: `ComfyUI（用於影片與圖片）`,
        comfyui_description: `上傳工作流，並用工作流生成`,
        text_to_speech: `文字轉語音（用於語音）`,
        text_to_speech_description: `給每個人格一個真實的聲音`,
        image_generation: `圖片生成`,
        image_generation_description: `畫出你的提示詞，或畫出當下場景`,
        video_generation: `影片生成`,
        video_generation_description: `短片，可指定第一幀`,
        speech_generation: `語音生成`,
        speech_generation_description: `把文字變成語音訊息`,
        art_search: `插圖搜尋`,
        art_search_description: `從 Danbooru 發送現有的動漫插圖`,
        behavior_tuning: `行為調整`,
        behavior_tuning_description: `模型、擬人化、指令與工具`,
        server_wide_settings: `伺服器層級設定`,
        server_wide_settings_description: `這裡所有人都適用的界線`,
        personal_settings: `個人設定`,
        personal_settings_description: `你在每個伺服器都沿用的偏好`,
        long_term_memory: `長期記憶`,
        long_term_memory_description: `我永久保留的事實`,
        short_term_memory: `短期記憶`,
        short_term_memory_description: `我對這段對話的隨手筆記`,
        rewards_punishments: `獎勵與懲罰`,
        rewards_punishments_description: `我會注意到並記住的互動`,
        memory_tagging: `記憶標籤（進階）`,
        memory_tagging_description: `只在相關時喚醒某則記憶`,
        blacklisting: `黑名單`,
        blacklisting_description: "讓我完全忽略某位成員",
      },
    },
    breadcrumbs: {
      persona: {
        general: `人格 > 身分與個性`,
        advanced: `人格 > 進階`,
        voice: `人格 > 語音`,
        sprites: `人格 > 立繪`,
        triggers: `人格 > 觸發`,
      },
      behavior: {
        general: `行為 > 一般行為`,
        trigger: `行為 > 觸發行為`,
        memory: `行為 > 進階記憶`,
      },
      channels: {
        destinations: `頻道 > 紀錄與歡迎`,
        "auto-trigger": `頻道 > 自動觸發`,
        overrides: `頻道 > 頻道覆寫`,
      },
      plugins: {
        "available-tools": `外掛 > 可用工具`,
        "mcp-servers": `外掛 > MCP 伺服器`,
        "sillytavern-presets": `外掛 > SillyTavern 預設集`,
      },
      models: {
        switch: `模型 > 切換模型`,
        voices: `模型 > TTS 參數與語音`,
        image: `模型 > 圖片生成預設`,
        parameters: `模型 > 文字取樣器與參數`,
      },
      personal: {
        profile: {
          general: `個人資料 > 一般偏好`,
        },
        privacy: {
          controls: `隱私 > 隱私控制`,
        },
        models: {
          switch: `模型 > 切換模型`,
        },
        advanced: {
          spotlight: `進階 > 個人焦點`,
        },
      },
      moderation: {
        "member-access": `成員存取`,
        "user-blacklist": `使用者黑名單`,
        whitelist: `白名單`,
        quotas: `額度`,
      },
    },
    features: {
      title: `TomoriBot 功能（版本 {version}）`,
    },
    matrix: {
      bot_user_fallback: `已設定的 Matrix bot 帳號`,
    },
    "api-key": {
      provider_choice_brave: `Brave Search`,
      provider_choice_google: `Google Gemini（推薦，免費）`,
      provider_choice_deepseek: `DeepSeek`,
      provider_choice_custom: `自訂端點`,
      provider_choice_nvidia: `NVIDIA NIM（免費）`,
      provider_choice_novelai: `NovelAI`,
      provider_choice_openrouter: `OpenRouter（推薦）`,
      provider_description_google: `通用，且有充裕的免費額度`,
      provider_description_openrouter: `付費但穩定有彈性，可生成圖片、影片與語音`,
      provider_description_deepseek: `較便宜的付費選擇，審查相對寬鬆`,
      provider_description_novelai: `適合無審查的角色扮演、故事創作與圖片生成`,
      provider_description_nvidia: `託管的文字、嵌入與圖片模型`,
      provider_description_zai: `GLM 文字與圖片模型，使用政策僅限程式開發用途`,
      provider_description_vertexexpress: `透過 Google Cloud 使用 Gemini，以 API 金鑰驗證`,
      provider_description_vertex: `企業級 Gemini，透過 Google Cloud 憑證使用`,
      provider_description_custom: `自架或代理端點；驗證可以是選用的`,
      provider_description_brave: `選用的網頁、圖片、影片與新聞搜尋`,
      provider_description_elevenlabs: `語音與轉錄 API，不是文字模型`,
      provider_choice_zai: `Z.ai`,
      provider_choice_vertex: `Google Vertex AI`,
      provider_choice_vertexexpress: `Google Vertex AI Express`,
      provider_choice_elevenlabs: `ElevenLabs TTS`,
      brave_title: `設定 Brave Search API 金鑰`,
      brave_description: `Brave Search 是選用的，只會強化我的搜尋能力，並不會驅動我的 AI，那由你的主要供應商負責。
- 啟用圖片、影片與新聞搜尋
- 提供來自網路的即時資訊
- 強化我回答時事問題的能力`,
      brave_getting_key_title: `取得你的 API 金鑰：`,
      brave_getting_key_description: `1. 前往 [Brave Search API](https://brave.com/search/api/)
2. 註冊免費帳號
3. 在儀表板前往 [API Keys](https://api-dashboard.search.brave.com/app/keys) 區段
4. 建立新的 API 金鑰
5. 用 {configBraveapiSet} 指令複製並輸入你的 API 金鑰`,
      brave_important_title: `重要提醒：`,
      brave_important_description: `- 這與你的主要 AI 供應商是分開的
- 沒有 Brave API 金鑰，我仍能運作，並使用內建的網頁搜尋
- Brave 每月附帶 5 美元的免費額度，超過的部分可能會收費。如果你只想用免費額度，請在 [Brave 用量限制儀表板](https://api-dashboard.search.brave.com/app/subscriptions/usage-limits) 設定 5 美元的上限`,
      brave_footer: `主要 AI 供應商請在 \`/help\` 的 API 金鑰頁面選擇其他供應商`,
      google_title: `設定 Google Gemini API 金鑰`,
      google_description: `Google Gemini 提供免費與付費方案，並有強大的 AI 模型。
- 提供免費方案
- [Gemini 隱私權政策](https://ai.google.dev/gemini-api/terms)`,
      google_getting_key_title: `取得你的 API 金鑰：`,
      google_getting_key_description: `1. 前往 [Google AI Studio](https://aistudio.google.com/apikey)
2. 點擊右上角的 \`Create API Key\`（需要的話先建立新專案）
3. 把這組 API 金鑰複製到 {configSetup} 或 {configApikeySet}`,
      google_footer: `設定好這個供應商後，你可以用 {configModel} 變更它的預設模型`,
      deepseek_title: `設定 DeepSeek API 金鑰`,
      deepseek_description: `DeepSeek 是依照用量計費的文字供應商。
- [DeepSeek API 文件](https://api-docs.deepseek.com/)`,
      deepseek_getting_key_title: `取得你的 API 金鑰：`,
      deepseek_getting_key_description: `1. 前往 [DeepSeek API Keys](https://platform.deepseek.com/api_keys)
2. 登入或建立 DeepSeek 平台帳號
3. 建立新的 API 金鑰
4. 需要的話，先在你的 DeepSeek 平台帳號加值
5. 把這組 API 金鑰複製到 {configSetup} 或 {configApikeySet}`,
      deepseek_footer: `設定好這個供應商後，你可以用 {configModel} 變更它的預設模型`,
      custom_title: `自訂端點設定`,
      custom_description: `舊版的內嵌自訂供應商流程已經搬家。

伺服器層級的端點請用 {configSetup}，並選擇 **自訂端點（設定後再完成）**，接著執行 {configCustomModelsAdd}，再用 {configModel} 選取它。

個人端點請用 {personalCustomModelsAdd}。

完整的指令說明、支援的端點類型與功能注意事項請看 {helpCustomModels}。`,
      nvidia_title: `設定 NVIDIA NIM API 金鑰`,
      nvidia_description: `NVIDIA NIM 透過 NVIDIA Build 提供託管的文字、嵌入與圖片 API。`,
      nvidia_getting_key_title: `取得你的 API 金鑰：`,
      nvidia_getting_key_description: `1. 前往 [NVIDIA Build](https://build.nvidia.com/)
2. 登入或建立 NVIDIA 開發者帳號
3. 在 [API Keys 頁面](https://build.nvidia.com/settings/api-keys) 建立或管理你的 API 金鑰
4. 把這組 API 金鑰複製到 {configSetup} 或 {configApikeySet}`,
      nvidia_important_title: `重要提醒：`,
      nvidia_important_description: `- 文字與嵌入使用 NVIDIA 託管的 \`integrate.api.nvidia.com\` 介面
- 原生圖片生成使用 NVIDIA 託管的 \`ai.api.nvidia.com\` FLUX 端點`,
      nvidia_footer: `設定好這個供應商後，你可以用 {configModel}、{configModelEmbedding} 與 {configModelImage} 變更文字、嵌入與圖片模型`,
      zai_title: `設定 Z.ai API 金鑰`,
      zai_description: `Z.ai 透過一般 API 與另一個程式開發端點提供 GLM 系列模型。

⚠️ **服務條款更新：** Z.ai 的服務條款已更新，只允許程式開發與代理用途。用一般端點進行非程式開發的聊天需自行承擔風險，且可能違反他們的條款。`,
      zai_getting_key_title: `取得你的 API 金鑰：`,
      zai_getting_key_description: `1. 前往 [Z.ai 平台](https://z.ai)
2. 登入或建立帳號
3. 在儀表板前往 API Keys
4. 建立新的 API 金鑰
5. 把這組 API 金鑰複製到 {configSetup} 或 {configApikeySet}`,
      zai_important_title: `重要提醒：`,
      zai_important_description: `- 一般端點用於一般聊天、推理與原生圖片生成
  - 專用的程式開發端點是分開的，供程式開發相關流程使用
  - ⚠️ Z.ai 的服務條款只允許程式開發與代理情境，一般聊天與角色扮演需自行承擔風險`,
      zai_footer: `設定好這個供應商後，你可以用 {configModel} 變更它的預設模型`,
      novelai_title: `設定 NovelAI API 金鑰`,
      novelai_description: `NovelAI 是訂閱制服務，專注於創意故事創作與角色扮演。
- 無限的無審查訊息
- 支援無審查文字生成與 NovelAI 圖片生成，後者需另外設定
- NovelAI 文字模型不支援圖片輸入
- [NovelAI 服務條款](https://novelai.net/terms)`,
      novelai_getting_key_title: `取得你的 API 金鑰：`,
      novelai_getting_key_description: `1. 前往 [NovelAI](https://novelai.net/stories)
2. 點擊左上角的 ⚙️ 圖示進入設定
3. 前往 \`Account\`
4. 找到 \`Get Persistent API Token\`（需要訂閱！）
5. 把這組 API 金鑰複製到 {configSetup} 或 {configApikeySet}`,
      novelai_footer: `設定好這個供應商後，你可以用 {configModel} 變更它的預設模型`,
      openrouter_title: `設定 OpenRouter API 金鑰`,
      openrouter_description: `OpenRouter 以用量計費的方式，讓你使用來自不同供應商的多種 AI 模型。
 - 可使用最新、最強大的 AI 模型（部分免費）
 - [OpenRouter 服務條款](https://openrouter.ai/terms)`,
      openrouter_getting_key_title: `取得你的 API 金鑰：`,
      openrouter_getting_key_description: `1. 前往 [OpenRouter](https://openrouter.ai/settings/keys)
2. 點擊 \`Create API Key\`
3. 把這組 API 金鑰複製到 {configSetup} 或 {configApikeySet}`,
      openrouter_important_title: `重要提醒：`,
      openrouter_important_description: `- **免費模型有嚴格的速率限制**；付費模型通常更穩定
- **選擇模型前務必確認價格**
- 你的 OpenRouter 帳號設定在這裡同樣適用
- 如果需要清單上沒有的模型，請在 {supportServer} 提出建議`,
      openrouter_footer: `設定好這個供應商後，你可以用 {configModel} 變更它的預設模型`,
      vertex_title: `設定 Google Vertex AI`,
      vertex_description: `Google Vertex AI 透過 Google Cloud 提供企業級的 Gemini 模型存取。
- 使用應用程式預設憑證（ADC）驗證，不需要管理 API 金鑰
- 使用本機的 gcloud ADC，或託管的工作負載身分與服務帳號
- [Vertex AI 文件](https://cloud.google.com/vertex-ai/docs)`,
      vertex_getting_key_title: `設定步驟：`,
      vertex_getting_key_description: `**步驟 1：安裝 [Google Cloud CLI](https://cloud.google.com/cli)**

**步驟 2：建立 Google Cloud 專案**
執行：\`gcloud projects create PROJECT_ID --name="Vertex AI Project"\`
（把 \`PROJECT_ID\` 換成全球唯一的 ID，例如 \`my-vertex-project-12345\`）

**步驟 3：將它設為使用中的專案**
執行：\`gcloud config set project PROJECT_ID\`

**步驟 4：連結帳單帳戶**
執行 \`gcloud billing accounts list\` 找出你的帳單帳戶 ID，
然後執行：\`gcloud billing projects link PROJECT_ID --billing-account=ACCOUNT_ID\`

**步驟 5：啟用 Vertex AI API**
執行：\`gcloud services enable aiplatform.googleapis.com\`

**步驟 6：設定應用程式預設憑證**
執行 \`gcloud auth application-default login\`，並用瀏覽器登入。

**步驟 7：輸入你的設定**
用 {configSetup} 或 {configApikeySet} 輸入 \`{project_id}::{location}\`
- 位置請用 \`global\`（推薦用於預覽模型，可用性也最好）
- 範例：\`my-vertex-project-12345::global\``,
      vertex_important_title: `重要提醒：`,
      vertex_important_description: `- 儲存的值是**設定**（專案加位置），不是憑證機密
- 所有 Vertex 請求都使用主機的應用程式預設憑證身分
- 只有 AI Studio 的 API 金鑰無法驗證這個供應商。專案必須已啟用帳單與 Vertex AI API，主機身分也需要 Vertex 存取權。
- 支援聊天、工具呼叫、串流、結構化輸出、壓縮、嵌入與預設集生成`,
      vertex_footer: `設定好這個供應商後，你可以用 {configModel} 變更它的預設模型`,
      vertexexpress_title: `設定 Google Vertex AI Express`,
      vertexexpress_description: `Google Vertex AI Express 以 API 金鑰方式提供 Vertex AI 上的 Gemini。
- 使用你自己的 Google Cloud API 金鑰，而非主機的應用程式預設憑證
- 最適合已部署的 TomoriBot BYOK 情境，每位使用者各自保存自己的金鑰
- 預覽功能，Gemini 專用的模型清單較小
- [Vertex AI Express 模式總覽](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview)`,
      vertexexpress_getting_key_title: `設定步驟：`,
      vertexexpress_getting_key_description: `1. 開啟 [Vertex AI Express 模式](https://console.cloud.google.com/expressmode)
2. 如果 Google 把你導向一般的 Google Cloud，請改用另一個 \`vertex\` 供應商。這是因為 Express 模式只適用於尚未建立計費 GCP 帳號的 Google 帳號。
3. 在 Express 主控台開啟 **APIs & Services > Credentials**，複製 Express API 金鑰
4. 用 {configSetup} 或 {configApikeySet} 加入這組原始 API 金鑰
5. 用 {configModel} 選擇 Vertex AI Express 模型`,
      vertexexpress_important_title: `重要提醒：`,
      vertexexpress_important_description: `- 儲存原始 API 金鑰，不要存 \`{project_id}::{location}\`
- 這裡不需要設定位置；\`global\` 只適用於另一個 \`vertex\` 供應商
- 完整的 Google Cloud Vertex 專案請用 \`vertex\`，不要用 \`vertexexpress\`
- 模型僅限 Vertex AI Express 的 Gemini 清單
- 支援圖片生成，但不支援影片與嵌入
- Express 模式目前是 Google 的預覽功能`,
      vertexexpress_footer: `設定好這個供應商後，你可以用 {configModel} 變更它的預設模型`,
    },
    elevenlabs: {
      description: `了解如何設定 ElevenLabs 文字轉語音`,
      title: `設定 ElevenLabs TTS`,
      getting_key_title: `取得你的 API 金鑰：`,
      getting_key_description: `1. 前往 [ElevenLabs](https://elevenlabs.io/app/settings/api-keys)
2. 註冊或登入你的帳號
3. 建立新的 API 金鑰
4. 用 {configSpeechElevenlabs} 複製這組 API 金鑰`,
      choosing_voice_title: `選擇語音：`,
      choosing_voice_description: `設定好 API 金鑰後，用 {configSpeechVoiceAssign} 瀏覽可用的語音。
- 你也可以從 [語音庫](https://elevenlabs.io/app/voice-library) 加入更多語音，在那裡也能複製自己的聲音。`,
      free_voices_title: `預製語音（免費方案）：`,
      free_voices_description: `免費方案只能使用預製語音。完整清單請看 [ElevenLabs 預製語音](https://elevenlabs-sdk.mintlify.app/voices/premade-voices)，再用 {configSpeechElevenlabs} 或 {configSpeechVoiceAssign} 指派給每個人格。`,
      important_notes_title: `重要提醒：`,
      important_notes_description: `- 我生成與朗讀語音訊息時會計算字元數
- 免費方案有每月上限；請在 ElevenLabs 儀表板查看用量
- 是否顯示逐字稿由 {configSpeechTranscripts} 另外控制`,
      footer: `再次執行 {configSpeechElevenlabs} 即可更新 ElevenLabs 金鑰。`,
    },
    getting_started: {
      title: `開始使用`,
      description: `如何開始使用我與我的功能`,
      get_api_key: {
        title: `取得 API 金鑰`,
        description:
          "API 金鑰讓我能使用 AI 供應商的模型。 我生成的所有內容都會記在那組金鑰上，所以請把它 當成密碼一樣保管。 完成設定需要一組金鑰：\n> **1.** 從下方挑一個供應商，開啟它的說明。\n> **2.** 複製它給你的金鑰。**絕對不要分享**給任何人，也不要貼到頻道裡：只能貼進 {setup} 為你開啟的欄位。\n> **3.** 執行 {setup}，並在我要求時貼上金鑰。",
        picker_footer: "-# 如果你的端點不在清單上，先略過金鑰，改讀同一頁的 **自訂端點（進階）**。",
      },
      change_trigger_behavior: {
        title: `調整觸發行為`,
        description:
          "預設情況下，你喊我的名字、@標註我，或回覆我 時，我就會回應。你可以放寬、收窄，或 按頻道關閉這個行為。\n\n**我可以在哪裡說話**\n你可以讓我只在白名單頻道回覆。 在 {moderationWhitelist} 加入這些頻道。\n> 不在清單上的頻道會保持安靜。\n\n**主動開口**\n{configAutoTrigger} 讓我每隔幾則訊息，或隨機 自動送出一則訊息。\n\n**只接受標註觸發**\n明確觸發模式會阻止我因為單純喊名字就回應， 改成等待 @標註。請在 {configBehaviorTrigger} 開啟。",
      },
      create_first_persona: {
        title: `建立你的人格`,
        description:
          "*人格* 就是換了名字、頭像、個性等等的我， 但功能完全相同！你可以編輯現有的那一個， 也可以建立新的。\n\n**修改現有的人格**\n{configPersonaGeneral} 設定我的名字、個性，以及我 怎麼稱呼別人。{configPersonaAppearance} 設定我的頭像。\n\n**用一句話寫出新的人格**\n{personaGenerate} 能用簡短描述生成完整的人格。 {personaCreate} 則給你空白範本。\n\n**從別的地方帶一個進來**\n{personaImport} 接受從 botbooru 或 chub 等角色卡 網站下載的角色卡。",
        footer: "你可以同時擁有多個人格。請看功能底下的 **多個人格**。",
      },
      explore_features: {
        title: `探索我的功能！`,
        description:
          "設定完成。既然我能說話了，以下是我現在能做的事。\n- **使用這個伺服器的表情符號與貼圖**，執行 {expressionsInitialize} 之後即可。\n- **歡迎新成員**，在 {configWelcome} 設定。\n- **記住與提醒**：直接叫我提醒你，或 告訴我值得留下的事。\n- **搜尋網頁**並使用其他工具，在 {configTools} 開啟。\n- **製作圖片、影片與語音**，用 {generateImage}、 {generateVideo} 與 {generateVoice}。\n\n我的開關大多在 {config}，但不是全部。",
        footer:
          "**Brave Search** 會為我原本的搜尋再加上網頁 結果。它需要自己的金鑰，而設定底下的 **取得 API 金鑰** 會從選用服務清單開啟它的 說明。文件網站是這個面板的完整版本， 裡頭詳細說明了每一項設定。",
      },
    },
    personal_profile: {
      title: `個人資料`,
      description: "屬於你、並跟著你到每個我在的伺服器 的設定。",
      nickname_pronouns: {
        title: `你的稱呼與代稱`,
        description:
          "告訴我怎麼稱呼你，我會在所有地方使用。\n\n在 {personalProfile} 設定。\n> 稱呼：我不用你的 Discord 名稱，改用這個稱呼你\n> 前綴與後綴：敬稱或稱謂，例如 `-san`\n> 代稱：`she/her`、`they/them`、`any`，或你的名字\n\n欄位留空的話，我會改用你目前的 Discord 名稱，以及人格自己的稱呼習慣。",
        footer: "單一人格可以改用不同方式稱呼你。請在 個人資料 > 人格專屬偏好設定。",
      },
      personal_memories: {
        title: `個人記憶`,
        description:
          "我特別記得關於你的事，在每個伺服器都適用。\n\n**直接告訴我就好**\n在聊天中說出來，我會自己記下來。發生時 會出現一則確認訊息。\n\n**或手動管理**\n{personalMemories} 會列出我持有的所有相關內容， 並讓你編輯或刪除任何一則。\n\n**決定我能用多少**\n{personalPrivacy} 設定你的隱私等級，從完整 個人化到完全不個人化。",
        footer: "這些與這個伺服器的共享記憶是分開的， 這裡的任何人可以看到並編輯後者。",
      },
      personal_providers: {
        title: `個人供應商（進階）`,
        description:
          "在你與我對話的所有地方，改用你自己的 API 金鑰與 你自己的模型回答，而不是伺服器使用的設定。\n\n**儲存供應商**\n{personalProviders} 會保存你的金鑰，並立刻啟用你的 個人文字模型。\n\n**挑選不同模型**\n{personalModels} 可切換模型，取樣器與 備援模型就在同一個分類底下。\n> 你的個人設定只影響你觸發的回覆。\n> 伺服器裡其他人不會被切換過去。\n\n有些伺服器要求這樣做。如果伺服器開啟了使用者 BYOK，除非你在這裡儲存供應商，否則我無法回答你。",
      },
    },
    custom_endpoints: {
      title: `自訂端點（進階）`,
      description:
        "把我指向你自己架設或信任的端點：Ollama、LM Studio、 LiteLLM、KoboldCPP、ComfyUI，或自架的語音伺服器。\n> {providers} 為整個伺服器註冊一個。\n> {personalProviders} 只為你一個人註冊。",
      text_models: {
        title: `文字模型`,
        description:
          "選擇 **新增自訂端點**，然後給它一個標籤、一個 基準 URL，以及它的 API 風格。需要驗證權杖的話 也一併加入。\n\n選取剛儲存的標籤，選擇 **+ 新增文字模型**， 輸入端點要求的完整模型代號。加入模型即會啟用它。\n> 請誠實宣告圖片輸入、工具使用與結構化輸出。\n> 我決定要送你什麼時，會信任這些標記。\n\n切換過去請用 {configSwitchModels}。",
        footer: "完整的 API 風格與相容性參考在 文件網站。",
      },
      comfyui: {
        title: `ComfyUI（用於影片與圖片）`,
        description:
          "先在 ComfyUI 裡建好並測試工作流，再用 **Save (API Format)** 匯出。\n\n把提示詞預留位置放在提示詞該在的地方，其他 預留位置放在你想注入尺寸、長度或模型代號的 位置。\n\n用 API 相容性 `ComfyUI` 註冊端點（例如 `http://127.0.0.1:8188`），然後加入圖片或影片 模型，並上傳匯出的 JSON。\n> 工作流必須以真正的儲存節點結尾。只有預覽的 節點會讓我沒有檔案可下載。",
        footer: "現成的工作流隨 GitHub 儲存庫提供， 完整的預留位置清單在文件網站。",
      },
      text_to_speech: {
        title: `文字轉語音（用於語音）`,
        description:
          "用同樣的方式註冊語音端點，然後給每個人格 一個聲音。\n\n託管服務與自架伺服器都可以，包括 Chatterbox-Turbo、Qwen3-TTS、IrodoriTTS 與 ElevenLabs。 註冊端點後，再為它加入語音模型。\n> 在 {configPersonaVoice} 指派語音。\n> 在 {configVoices} 調整語速與預設值。",
        footer:
          "你傳給我的語音訊息會透過同一份端點清單 轉錄，設定方式相同。託管的語音方面， ElevenLabs 在設定底下的 **取得 API 金鑰** 有 自己的說明，列在選用服務之中。",
      },
    },
    multiple_personas: {
      title: `多個人格`,
      description: "同一個伺服器可以有多個人格，各自有 自己的名字、記憶與目標！",
      mains_alters_title: `主要人格與 alter`,
      mains_alters_body:
        "主要人格是在伺服器中代表我的人格。alter 是我能 用來發言的第二個身分，訊息本身會顯示它自己的 名字與頭像。",
      bringing_in_title: `帶入人格`,
      bringing_in_body:
        "{personaImport} 以檔案形式接收角色卡：\n> `.png` 角色卡，來自 TomoriBot 或 SillyTavern\n> `.json` 角色卡，來自 TomoriBot 或 SillyTavern\n> `.charx` 壓縮檔，Character Card V3\n\n只會讀取角色的文字。目前會略過內含的立繪、 音訊與影片，請自行在 {configPersonaAppearance} 與 {configPersonaSprites} 設定。",
      where_to_find_title: `去哪裡找角色卡`,
      where_to_find_body:
        "用 {personaGenerate} 或 {personaCreate} 自己做一張，或 找一張現成的。\n\nbotbooru 與 chub 等角色卡網站上有數千張 角色卡。那些是別人的網站，而且為別的 bot 寫的 角色卡不一定能順利轉換。",
      talking_title: `讓它們互相對話`,
      talking_body: "在 {configPersonaTriggers} 為每個人格設定自己的觸發詞 與頻道，它們就會在同一段對話中 並肩回覆。",
      footer: `用 {personaExport} 分享你自己的人格。`,
    },
    media_generation: {
      title: `媒體生成`,
      description:
        "我可以生成圖片、影片與語音，可以用指令要求， 也可以因為你在對話中請我這麼做。\n> 每一項都會計入伺服器的額度。請看管理底下的 **額度**。",
      image_generation: {
        title: `圖片生成`,
        description:
          "{generateImage} 會開啟提示詞欄位。你可以自己寫提示詞，或 選擇 **Draw what's happening now**，由我來畫出 當下場景。\n> 最多可附上三張參考圖來引導結果。\n> 在同一個欄位挑選長寬比。\n\n任何在這裡儲存、且標示支援圖片的供應商或端點 都能畫圖，{providers} 會顯示你有哪些。不能用 參考圖的供應商會說明這點，並依文字作畫。",
        footer: `預設值在 {configImageDefaults}。`,
      },
      video_generation: {
        title: `影片生成`,
        description:
          "{generateVideo} 需要一段提示詞，並可選擇用頻道中 已有的圖片作為起始幀。\n\n任何標示支援影片的供應商或端點都能生成， 包括 ComfyUI 影片工作流。{providers} 會顯示 你有哪些。\n> 影片在任何地方都又慢又貴。請預期需要等待。",
      },
      speech_generation: {
        title: `語音生成`,
        description:
          "{generateVoice} 會用目前人格的聲音把文字變成 語音訊息。\n\n必須先註冊語音端點，託管或自架皆可：請看 設定底下的 **自訂端點（進階）**。\n> 每個人格都可以有不同聲音。聲音來自 {configPersonaVoice}。",
      },
      art_search: {
        title: `插圖搜尋`,
        description:
          "{booruSearch} 會根據一個或兩個標籤隨機發送 4 張評價良好的 Danbooru 圖片。輸入時會顯示建議，暱稱或錯字也會轉換成真實標籤。\n> 存疑與限制級內容僅在年齡限制頻道中顯示。\n\n你也可以直接請我展示一些插圖；{configTools} 中的 **Danbooru 搜尋** 開關用於控制該功能。如需限制誰能執行此指令，請使用伺服器設定 > 整合。",
      },
    },
    tons_of_tweakability: {
      title: `大量可調設定`,
      description: `把你和我調成你和伺服器成員喜歡的樣子`,
      behavior_tuning: {
        title: `行為調整`,
        description:
          "我怎麼寫、怎麼想，以及被允許做什麼。\n> **模型**：{configSwitchModels} 挑選實際回答的 模型，以及它的參數\n> **擬人化**：{configBehaviorGeneral} 控制我的 表達有多像人，從正式到非常口語。\n> **系統指令**：同樣在 {configBehaviorGeneral}， 用來下達適用於每一則回覆的指示。\n> **工具**：{configTools} 決定我可以動用哪些 功能，例如網頁搜尋或圖片生成。",
        footer: "取樣器層級的選項（temperature 之類）在 {configParameters}，用來調整隨機性等。",
      },
      server_wide_settings: {
        title: `伺服器層級設定`,
        description:
          "這個伺服器裡所有人都適用的界線。僅限 管理員。\n> **我在哪裡說話**：白名單頻道、每個人格的 頻道限制與冷卻，全部在 {moderation}。\n> **我何時主動說話**：{configAutoTrigger}。\n> **誰可以觸發我**：白名單身分組，同樣在 {moderation}。\n> **我的紀錄去哪裡**：{configWelcome} 設定紀錄與 歡迎頻道。",
        footer: "頻道層級的覆寫可以讓單一頻道有自己的 模型或規則。請看 {configChannelOverrides}。",
      },
      personal_settings: {
        title: `個人設定`,
        description:
          "你自己的偏好，會在你觸發的回覆中默默覆寫 伺服器的設定。\n> **我認為你是誰**：稱呼、代稱與隱私， 在 {personalProfile}。\n> **誰來回答你**：你自己的供應商與模型，在 {personalProviders}。\n> **我怎麼對待你**：回應模式與個人 焦點，在 {personalConfig}。\n\n這裡的每一項都會跟著你到不同伺服器。",
        footer: "個人焦點讓某個人格把你當成它的 重點對象，設定在 {personalSpotlight}。",
      },
    },
    memory_catalog: {
      title: `記憶`,
      description: "我保留兩種記憶：長久的事實，以及對當下 這段對話的隨手筆記。",
      long_term_memory: {
        title: `長期記憶`,
        description:
          "我永久保留的事實，屬於這個伺服器或屬於你。\n\n**教導我**\n在聊天中說出來，或在 {memories} 為伺服器 手動加入，你自己的部分則用 {personalMemories}。\n\n**讓我忘記**\n同樣這兩道指令會列出每一則內容，並可刪除 其中任何一則。\n\n**給我文件**\n{memories} 也接受上傳的檔案。需要時我會讀回 相關段落，而不是一次讀完整份，這是透過 檢索增強生成（RAG）做到的。\n> 伺服器記憶這裡所有人都看得到。個人記憶 只在你參與對話時才會出現。",
      },
      short_term_memory: {
        title: `短期記憶`,
        description:
          "我對這個頻道當下對話的隨手筆記， 依頻道分開保存。\n\n我會隨著對話進行摘要目前發生的事，讓長 討論串保持連貫，而不必重送每一則訊息。\n> **更新頻率**：我多常更新那份筆記。\n> **呈現模式**：摘要要取代近期 訊息，還是與它們並列。\n> **分類**：最多五個有標籤的欄位，例如 `Goals` 或 `Inventory`，取代單一自由格式的筆記。\n\n管理員在 {configAdvancedMemory} 調整這一切， {memories} 則可以清除使用中的筆記。",
        footer: "請我永久記住某件事，它就會變成 長期記憶。",
      },
      rewards_punishments: {
        title: `獎勵與懲罰`,
        description:
          "我確實會注意到並記住的有趣指令。對我 好一點，或者不要，我會照著反應。\n> 用 {reward} 摸頭、擁抱、親吻、搔癢或餵食。\n> 用 {punish} 敲頭、咬、捏、打屁股或緊抱。",
        footer: `同時有多個人格時，請選擇你指的是哪一個。`,
      },
      memory_tagging: {
        title: `記憶標籤（進階）`,
        description:
          "預設情況下，範圍內的每則記憶都會隨每則訊息送出。標籤可以把範圍縮小。\n> **關鍵字標籤**：有標籤的記憶只在它的關鍵字出現在對話中時才會醒來。沒有標籤的記憶則永遠有效。\n> **頻道**：伺服器記憶可限制在你在表單中挑選的頻道（包含其討論串），個人記憶則可使用 `#channel` 標籤限制。兩者皆可與關鍵字標籤合併使用。\n\n在 {configAdvancedMemory} 同時開啟兩者，再用 {toolPromptSnapshot} 查看目前實際有哪些記憶生效。",
        footer: "上傳的文件與擷取的歷史紀錄也可以限定頻道。",
      },
    },
    scheduled_tasks: {
      title: `排程任務`,
      description: `我可以依排定的時間回應，單次或重複都可以。`,
      making_title: `建立排程`,
      making_body:
        "直接開口就好。「提醒我 14:30 伸展一下」或「每天早上 發布站立會議的問題」這樣就夠了，我會設定好 並確認細節。",
      changing_title: `修改或取消排程`,
      changing_body:
        "{scheduledTaskEdit} 會開啟任何現有任務：它的內容、 下次觸發時間、重複間隔，以及是否標註你。 {scheduledTaskRemove} 則刪除任務。",
      who_title: `誰可以動誰的排程`,
      who_body:
        "你永遠可以編輯自己的。伺服器管理員可以編輯 任何人的，因為任務會發到共用頻道。\n> 時間採用設定時選定的時區，所以相信早上六點的 鬧鐘之前，請先確認那個設定。",
    },
    server_moderation: {
      title: `伺服器管理`,
      description:
        "關於誰可以在這裡使用我，以及在哪些地方。全都 需要管理伺服器權限，並位於 {moderation}。\n> **成員存取**：誰可以觸發我，以及他們可以 使用哪些模型。\n> **白名單**：我可以在哪些頻道、身分組與 人格中回應。\n> **額度**：這個伺服器允許多少生成量。\n> **使用者黑名單**：我必須忽略的個別成員。",
      blacklisting: {
        title: `黑名單`,
        description:
          "被列入黑名單的成員會被我完全忽略：在任何頻道、用任何人格都無法觸發我，他們的訊息也不會進入我的上下文。像 `/respond`、`/reward`、`/punish` 這類讓我替他們行動的指令也會被拒絕。他們也無法修改伺服器記憶、屬性或範例對話。\n\n在 {moderationBlacklist} 加入。同一頁會列出所有目前的項目並可移除，一次一個或批次處理。\n> 黑名單處理的是存取權，不是刪除。關於該成員的記憶會保留，直到有人移除它們。",
        footer: "想讓整個頻道安靜，而不是針對某個人，請把 該頻道從白名單移除。",
      },
    },
    quotas: {
      title: `額度`,
      description: "額度限制這裡能生成多少內容，以免有人 不小心花掉一整個月的額度。",
      spent_title: `額度怎麼計算`,
      spent_body:
        "共有三個獨立的池子：文字、圖片與影片。每個 池子都計算兩次，一次算成員個人，一次算整個 伺服器，先耗盡的那個就會中止請求。\n> 被拒絕的請求會告訴你是哪個池子用完，以及 何時恢復。",
      limits_title: `設定上限`,
      limits_body: "{moderationQuotas} 設定每個池子的每日額度。 不想設限的池子就讓它維持無上限。",
      starting_over_title: `重新開始計算`,
      starting_over_body:
        "{quotaResetUser} 清除某位成員的當日用量， {quotaResetGlobal} 清除伺服器整體的池子。兩者都需要 管理伺服器權限。",
      footer: "池子每天會自行重置。手動重置是給 不該等待的人使用。",
    },
    age_restricted_commands: {
      title: `年齡限制指令`,
      description: `僅限成人。開啟任何功能前請先閱讀這一節。`,
      filter_title: `我預設不過濾`,
      filter_body:
        "我出廠時沒有任何自己的內容過濾，因為過濾 在擋下內容的同時，也會同樣破壞一般回覆的品質。 這裡什麼合適由伺服器管理員決定，不是 我決定。\n> 你的 AI 供應商仍會在它那一端執行自己的規則， 而且無論這裡怎麼設定，它都可以拒絕請求。",
      gated_title: `明確的成人功能有額外關卡`,
      gated_body:
        "任何明確屬於成人的內容都在 {nsfw} 後面，且只在 Discord 本身標記為年齡限制的頻道中運作。\n\n{nsfwJailbreaks} 選擇這個伺服器要啟用哪些提示詞 策略。在管理員開啟之前，每一個都是關閉的。\n> 這些策略會改變我的提示方式。它們可以讓我 少拒絕一些，但也可能造成非預期的行為。",
      footer: "啟用這些功能，代表伺服器管理員確認該 頻道僅限成人，並為此負責。",
    },
    user_byok: {
      title: `使用者 BYOK（進階）`,
      description: "BYOK 意思是自備金鑰：每位成員用自己的供應商 為自己的回覆付費。",
      changes_title: `它改變了什麼`,
      changes_body:
        "開啟 BYOK 後，成員的訊息只有在該成員已儲存 個人供應商時才會被回答。伺服器自己的 供應商不會成為他們的備援。\n> 在 {moderationMemberAccess} 開啟，或在 {setup} 過程中選擇。",
      suits_title: `適合誰`,
      suits_body: "適合大型或公開的伺服器，因為共用一組 API 金鑰 會被耗盡。小型伺服器通常更適合共用一個供應商。",
      members_title: `成員需要做什麼`,
      members_body: "在 {personalProviders} 儲存金鑰。請引導他們看設定 底下的 **個人供應商（進階）** 以取得完整說明。",
      footer: "僅限伺服器。私訊沒有成員可以自備 金鑰，所以那裡不提供這個選項。",
    },
    sillytavern_presets: {
      title: `SillyTavern 預設集`,
      description: "匯入 SillyTavern 提示詞預設集，我就會照那個 預設集的方式組出我的提示詞。",
      importing_title: `匯入預設集`,
      importing_body: "{configStPresets} 接收匯出的預設集 JSON，之後 你可以啟用、停用或移除它。",
      controls_title: `它控制什麼`,
      controls_body:
        "預設集會接管提示詞的排序，以及對話周圍的 指令區塊。\n> 啟用的預設集會覆寫來自 {configBehaviorGeneral} 的系統提示詞，以及來自 {configPersonaAdvanced} 的人格提示詞。",
      still_applies_title: `哪些仍然適用`,
      still_applies_body: "人格屬性、範例對話、記憶與工具仍然會 送出。預設集決定的是排列方式，不是內容。",
      footer: "把預設集關掉就會回到我自己的提示詞配置， 不會遺失任何內容。",
    },
    mcp_servers: {
      title: `MCP 伺服器`,
      description: "MCP 是把工具交給 AI 的標準做法。連接一個 伺服器，它的工具就會成為我真正能做的事。",
      hosted_title: `託管伺服器`,
      hosted_body: "{configMcp} 接收一個 URL 與選用的驗證權杖。那個 伺服器公開的任何工具都會出現在我的工具清單中。",
      local_title: `本機伺服器`,
      local_body: "跑在你自己機器上的伺服器只要連得到，運作方式 完全相同。文件網站有完整說明。",
      before_title: `連接之前`,
      before_body:
        "> MCP 伺服器的工具會以你給它的權限執行， 而我在看起來相關時就會使用它們。請連接 你信任的伺服器，並先讀清楚它們的工具在做什麼。",
      footer: `你可以隨時在 {configTools} 關閉個別工具。`,
    },
    matrix_bridge: {
      title: `Matrix`,
      description: "我可以同時待在 Matrix 房間與 Discord 頻道， 在兩者之間傳遞對話。",
      linking_title: `連結房間`,
      linking_body:
        "{matrixLink} 會把目前的頻道連接到 Matrix 房間 ID，格式類似 `!abcdef:matrix.org`。請先邀請 {matrixBotUser} 加入該房間。",
      reads_title: `我怎麼讀取`,
      reads_body:
        "來自兩邊的訊息會以同一段對話到達我這裡，而 我會在兩邊回覆。\n> 附件、編輯與表情回應不一定都能完整 傳遞。文字才是最可靠的。",
      footer: "沒有連結成功嗎？請先確認邀請已被接受， 再檢查其他部分。",
    },
  },
};

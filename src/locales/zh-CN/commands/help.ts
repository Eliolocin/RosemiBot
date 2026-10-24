export default {
  help: {
    description: `浏览设置、功能、提供方、记忆、行为、工具、媒体与集成指南。`,
    dashboard: {
      categories: {
        setup: `设置`,
        features: `功能`,
        moderation: `管理`,
        plugins: `插件`,
      },
      pages: {
        custom_endpoints: `自定义端点`,
      },
      page_reference: `\`/help\` 里的 **{page}** 页面`,
      page_select_placeholder: `选择页面`,
      subsection_select_placeholder: `选择主题`,
      provider_select_placeholder: `选择提供方`,
      optional_provider_select_placeholder: `可选服务`,
      previous_button: `← 上一页`,
      next_button: `下一页 →`,
      docs_link_label: `阅读网页版`,
      support_link_label: `获取技术支持`,
      sections: {
        getting_started: `新手上路`,
        getting_started_description: `密钥、触发、人格，以及接下来可以试什么`,
        personal_profile: `个人资料`,
        personal_profile_description: `你的昵称、你的记忆、你自己的提供方`,
        custom_endpoints: `自定义端点（高级）`,
        custom_endpoints_description: `注册你自己运行或信任的端点`,
        multiple_personas: `多个人格`,
        multiple_personas_description: `保留多个身份，并导入角色卡`,
        media_generation: `媒体生成`,
        media_generation_description: `生成图像、视频和语音消息`,
        tons_of_tweakability: `大量可调设置`,
        tons_of_tweakability_description: `行为、服务器与个人设置分别在哪里`,
        memory: `记忆`,
        memory_description: `我会记住什么，以及记多久`,
        scheduled_tasks: `定时任务`,
        scheduled_tasks_description: `提醒，以及我会自己回来执行的任务`,
        server_moderation: `服务器管理`,
        server_moderation_description: `谁能在这里使用我，以及在哪里使用`,
        quotas: `配额`,
        quotas_description: `限制这个服务器允许的生成量`,
        age_restricted_commands: `年龄限制指令`,
        age_restricted_commands_description: `成人功能，以及我不做过滤的部分`,
        user_byok: `用户 BYOK（高级）`,
        user_byok_description: `让每位成员自备密钥`,
        sillytavern_presets: `SillyTavern 预设集`,
        sillytavern_presets_description: `用导入的预设集构建我的提示词`,
        mcp_servers: `MCP 服务器`,
        mcp_servers_description: `接入我真正能用的外部工具`,
        matrix: `Matrix`,
        matrix_description: `把 Matrix 房间桥接到 Discord 频道`,
      },
      subsections: {
        get_api_key: `获取 API 密钥`,
        get_api_key_description: `去哪里获取，以及如何保管`,
        change_trigger_behavior: `调整触发行为`,
        change_trigger_behavior_description: `我能在什么时候、什么地方回复`,
        create_first_persona: `创建你的第一个人格`,
        create_first_persona_description: `编辑我、生成新人格，或导入一个`,
        explore_features: `看看我的功能！`,
        explore_features_description: `简单看看我现在能做什么`,
        nickname_pronouns: `你的昵称与代词`,
        nickname_pronouns_description: `我在每个服务器里如何称呼你`,
        personal_memories: `个人记忆`,
        personal_memories_description: `我专门记住的你的事情`,
        personal_providers: `个人提供方（高级）`,
        personal_providers_description: `用你自己的密钥和模型回复`,
        text_models: `文本模型`,
        text_models_description: `注册聊天端点及其模型`,
        comfyui: `ComfyUI（用于视频与图像）`,
        comfyui_description: `上传工作流并据此生成`,
        text_to_speech: `文本转语音（用于语音）`,
        text_to_speech_description: `给每个人格一个真实的声音`,
        image_generation: `图像生成`,
        image_generation_description: `画出你的提示词，或当前场景`,
        video_generation: `视频生成`,
        video_generation_description: `短视频，可选首帧`,
        speech_generation: `语音生成`,
        speech_generation_description: `把文字变成语音消息`,
        art_search: `插画搜索`,
        art_search_description: `从 Danbooru 发送现有的动漫插画`,
        behavior_tuning: `行为调校`,
        behavior_tuning_description: `模型、回复自然度、指令与工具`,
        server_wide_settings: `服务器级设置`,
        server_wide_settings_description: `对这里所有人都生效的边界`,
        personal_settings: `个人设置`,
        personal_settings_description: `你的偏好，在所有服务器生效`,
        long_term_memory: `长期记忆`,
        long_term_memory_description: `我永久保留的事实`,
        short_term_memory: `短期记忆`,
        short_term_memory_description: `我对这段对话的工作记录`,
        rewards_punishments: `奖励与惩罚`,
        rewards_punishments_description: `我会注意并记住的动作`,
        memory_tagging: `记忆标签（高级）`,
        memory_tagging_description: `只在相关时唤醒某条记忆`,
        blacklisting: `屏蔽名单`,
        blacklisting_description: "让我完全忽略某位成员",
      },
    },
    breadcrumbs: {
      persona: {
        general: `人格 > 身份与性格`,
        advanced: `人格 > 高级`,
        voice: `人格 > 语音`,
        sprites: `人格 > 立绘`,
        triggers: `人格 > 触发设置`,
      },
      behavior: {
        general: `行为 > 常规行为`,
        trigger: `行为 > 触发行为`,
        memory: `行为 > 高级记忆`,
      },
      channels: {
        destinations: `频道 > 日志与欢迎`,
        "auto-trigger": `频道 > 自动触发`,
        overrides: `频道 > 频道覆盖`,
      },
      plugins: {
        "available-tools": `插件 > 可用工具`,
        "mcp-servers": `插件 > MCP 服务器`,
        "sillytavern-presets": `插件 > SillyTavern 预设集`,
      },
      models: {
        switch: `模型 > 切换模型`,
        voices: `模型 > TTS 参数与语音`,
        image: `模型 > 图像生成默认值`,
        parameters: `模型 > 文本采样器与参数`,
      },
      personal: {
        profile: {
          general: `个人资料 > 常规偏好`,
        },
        privacy: {
          controls: `隐私 > 隐私控制`,
        },
        models: {
          switch: `模型 > 切换模型`,
        },
        advanced: {
          spotlight: `高级 > 个人聚焦`,
        },
      },
      moderation: {
        "member-access": `成员访问`,
        "user-blacklist": `用户屏蔽名单`,
        whitelist: `白名单`,
        quotas: `配额`,
      },
    },
    features: {
      title: `TomoriBot 功能（版本 {version}）`,
    },
    matrix: {
      bot_user_fallback: `已配置的 Matrix bot 账号`,
    },
    "api-key": {
      provider_choice_brave: `Brave Search`,
      provider_choice_google: `Google Gemini（推荐，免费）`,
      provider_choice_deepseek: `DeepSeek`,
      provider_choice_custom: `自定义端点`,
      provider_choice_nvidia: `NVIDIA NIM（免费）`,
      provider_choice_novelai: `NovelAI`,
      provider_choice_openrouter: `OpenRouter（推荐）`,
      provider_description_google: `通用模型，免费额度很大方`,
      provider_description_openrouter: `付费但稳定灵活，可生成图像、视频和语音`,
      provider_description_deepseek: `更便宜的付费选择，审查相对宽松`,
      provider_description_novelai: `适合无审查的角色扮演、故事创作与图像生成`,
      provider_description_nvidia: `托管式文本、嵌入与图像模型`,
      provider_description_zai: `GLM 文本与图像模型，使用政策限制在编码场景`,
      provider_description_vertexexpress: `经 Google Cloud 使用 Gemini，以 API 密钥认证`,
      provider_description_vertex: `经 Google Cloud 凭据使用企业级 Gemini`,
      provider_description_custom: `自部署或代理端点，认证可选`,
      provider_description_brave: `可选的网页、图像、视频与新闻搜索`,
      provider_description_elevenlabs: `语音与转写 API，不是文本模型`,
      provider_choice_zai: `Z.ai`,
      provider_choice_vertex: `Google Vertex AI`,
      provider_choice_vertexexpress: `Google Vertex AI Express`,
      provider_choice_elevenlabs: `ElevenLabs TTS`,
      brave_title: `设置 Brave Search API 密钥`,
      brave_description: `Brave Search 是可选项，只用来增强我的搜索能力。它**不**驱动我的 AI，那由你的主提供方负责。\n- 启用图像、视频与新闻搜索\n- 提供来自互联网的实时信息\n- 让我更擅长回答当下的问题`,
      brave_getting_key_title: `获取你的 API 密钥：`,
      brave_getting_key_description: `1. 打开 [Brave Search API](https://brave.com/search/api/)\n2. 注册一个免费账号\n3. 在控制台进入你的 [API Keys](https://api-dashboard.search.brave.com/app/keys) 页面\n4. 新建一个 API 密钥\n5. 复制密钥，用 {configBraveapiSet} 指令填入`,
      brave_important_title: `重要说明：`,
      brave_important_description: `- 这与你主 AI 提供方的密钥是分开的\n- 没有 Brave API 密钥，我依然可以工作，并使用内置的网页搜索\n- Brave 每月含 5 美元免费额度，超出部分可能计费。如果只想用免费额度，请在 [Brave 用量上限面板](https://api-dashboard.search.brave.com/app/subscriptions/usage-limits) 设置 5 美元上限`,
      brave_footer: `主 AI 提供方请到 \`/help\` 的「API 密钥」页面另选一个提供方`,
      google_title: `设置 Google Gemini API 密钥`,
      google_description: `Google Gemini 提供免费与付费档位，模型能力很强。\n- 有免费档位\n- [Gemini 隐私政策](https://ai.google.dev/gemini-api/terms)`,
      google_getting_key_title: `获取你的 API 密钥：`,
      google_getting_key_description: `1. 打开 [Google AI Studio](https://aistudio.google.com/apikey)\n2. 点击右上角的 \`Create API Key\`（需要的话先新建一个项目）\n3. 把密钥填入 {configSetup} 或 {configApikeySet}`,
      google_footer: `设置好这个提供方后，可以用 {configModel} 更换它的默认模型`,
      deepseek_title: `设置 DeepSeek API 密钥`,
      deepseek_description: `DeepSeek 是按量付费的文本提供方。\n- [DeepSeek API 文档](https://api-docs.deepseek.com/)`,
      deepseek_getting_key_title: `获取你的 API 密钥：`,
      deepseek_getting_key_description: `1. 打开 [DeepSeek API Keys](https://platform.deepseek.com/api_keys)\n2. 登录或注册一个 DeepSeek 平台账号\n3. 新建一个 API 密钥\n4. 如有需要，先在你的 DeepSeek 平台账号里充值\n5. 把密钥填入 {configSetup} 或 {configApikeySet}`,
      deepseek_footer: `设置好这个提供方后，可以用 {configModel} 更换它的默认模型`,
      custom_title: `自定义端点设置`,
      custom_description: `旧的内嵌「Custom Provider」流程已经搬家。\n\n服务器级端点请用 {configSetup} 并选择 **自定义端点（设置完成后继续）**，再运行 {configCustomModelsAdd}，用 {configModel} 选中它。\n\n个人端点请用 {personalCustomModelsAdd}。\n\n完整的指令说明、支持的端点类型与能力说明请用 {helpCustomModels}。`,
      nvidia_title: `设置 NVIDIA NIM API 密钥`,
      nvidia_description: `NVIDIA NIM 通过 NVIDIA Build 提供托管式文本、嵌入与图像 API。`,
      nvidia_getting_key_title: `获取你的 API 密钥：`,
      nvidia_getting_key_description: `1. 打开 [NVIDIA Build](https://build.nvidia.com/)\n2. 登录或注册一个 NVIDIA 开发者账号\n3. 在 [API Keys 页面](https://build.nvidia.com/settings/api-keys) 新建或管理密钥\n4. 把密钥填入 {configSetup} 或 {configApikeySet}`,
      nvidia_important_title: `重要说明：`,
      nvidia_important_description: `- 文本与嵌入使用 NVIDIA 托管的 \`integrate.api.nvidia.com\` 接口\n- 原生图像生成使用 NVIDIA 托管的 \`ai.api.nvidia.com\` FLUX 端点`,
      nvidia_footer: `设置好这个提供方后，可以用 {configModel}、{configModelEmbedding} 和 {configModelImage} 更换文本、嵌入与图像模型`,
      zai_title: `设置 Z.ai API 密钥`,
      zai_description: `Z.ai 通过通用 API 和单独的编码端点提供 GLM 系列模型。\n\n⚠️ **服务条款更新：** Z.ai 的服务条款已更新，只允许编码与智能体用途。用通用端点进行非编码聊天需自行承担风险，并可能违反其条款。`,
      zai_getting_key_title: `获取你的 API 密钥：`,
      zai_getting_key_description: `1. 打开 [Z.ai 平台](https://z.ai)\n2. 登录或注册一个账号\n3. 在控制台进入 API Keys\n4. 新建一个 API 密钥\n5. 把密钥填入 {configSetup} 或 {configApikeySet}`,
      zai_important_title: `重要说明：`,
      zai_important_description: `- 常规聊天、推理与原生图像生成请用通用端点\n  - 专用的编码端点独立存在，面向编码类工作流\n  - ⚠️ Z.ai 的服务条款只允许编码与智能体场景，通用聊天或角色扮演需自行承担风险`,
      zai_footer: `设置好这个提供方后，可以用 {configModel} 更换它的默认模型`,
      novelai_title: `设置 NovelAI API 密钥`,
      novelai_description: `NovelAI 是订阅制服务，专注创意故事创作与角色扮演。\n- 无限制的无审查消息\n- 支持无审查文本生成与 NovelAI 图像生成，图像生成需单独配置\n- NovelAI 文本模型不支持图像输入\n- [NovelAI 服务条款](https://novelai.net/terms)`,
      novelai_getting_key_title: `获取你的 API 密钥：`,
      novelai_getting_key_description: `1. 打开 [NovelAI](https://novelai.net/stories)\n2. 点击左上角的 ⚙️ 图标进入设置\n3. 进入 \`Account\`\n4. 找到 \`Get Persistent API Token\`（需要订阅！）\n5. 把密钥填入 {configSetup} 或 {configApikeySet}`,
      novelai_footer: `设置好这个提供方后，可以用 {configModel} 更换它的默认模型`,
      openrouter_title: `设置 OpenRouter API 密钥`,
      openrouter_description: `OpenRouter 按量付费，提供来自不同提供方的多种 AI 模型。\n - 可用最新最强的 AI 模型（部分免费）\n - [OpenRouter 服务条款](https://openrouter.ai/terms)`,
      openrouter_getting_key_title: `获取你的 API 密钥：`,
      openrouter_getting_key_description: `1. 打开 [OpenRouter](https://openrouter.ai/settings/keys)\n2. 点击 \`Create API Key\`\n3. 把密钥填入 {configSetup} 或 {configApikeySet}`,
      openrouter_important_title: `重要说明：`,
      openrouter_important_description: `- **免费模型有严格的速率限制**，付费模型通常更稳定\n- 选模型前**务必看清价格**\n- 你的 OpenRouter 账号设置在这里依然生效\n- 如果需要列表里没有的模型，可以在 {supportServer} 里提建议`,
      openrouter_footer: `设置好这个提供方后，可以用 {configModel} 更换它的默认模型`,
      vertex_title: `设置 Google Vertex AI`,
      vertex_description: `Google Vertex AI 通过 Google Cloud 提供企业级 Gemini 模型访问。\n- 使用应用默认凭据（ADC）认证，无需管理 API 密钥\n- 使用本机 gcloud ADC，或托管环境的工作负载身份／服务账号\n- [Vertex AI 文档](https://cloud.google.com/vertex-ai/docs)`,
      vertex_getting_key_title: `配置步骤：`,
      vertex_getting_key_description: `**第 1 步：安装 [Google Cloud CLI](https://cloud.google.com/cli)**\n\n**第 2 步：创建 Google Cloud 项目**\n运行：\`gcloud projects create PROJECT_ID --name="Vertex AI Project"\`\n（把 \`PROJECT_ID\` 换成全球唯一的 ID，例如 \`my-vertex-project-12345\`）\n\n**第 3 步：把它设为当前项目**\n运行：\`gcloud config set project PROJECT_ID\`\n\n**第 4 步：关联结算账号**\n运行 \`gcloud billing accounts list\` 找到结算账号 ID，\n然后运行：\`gcloud billing projects link PROJECT_ID --billing-account=ACCOUNT_ID\`\n\n**第 5 步：启用 Vertex AI API**\n运行：\`gcloud services enable aiplatform.googleapis.com\`\n\n**第 6 步：设置应用默认凭据**\n运行 \`gcloud auth application-default login\`，然后在浏览器里登录。\n\n**第 7 步：填入你的配置**\n用 {configSetup} 或 {configApikeySet} 填入 \`{project_id}::{location}\`\n- 位置填 \`global\`（预览模型与可用性最好，推荐）\n- 例如：\`my-vertex-project-12345::global\``,
      vertex_important_title: `重要说明：`,
      vertex_important_description: `- 保存的是**配置**（项目加位置），不是凭据密钥\n- 所有 Vertex 请求都使用宿主机的应用默认凭据身份\n- 只有 AI Studio 的 API 密钥无法认证这个提供方。项目必须已启用结算与 Vertex AI API，宿主身份也需要有 Vertex 访问权限。\n- 支持聊天、工具调用、流式输出、结构化输出、压缩、嵌入与预设集生成`,
      vertex_footer: `设置好这个提供方后，可以用 {configModel} 更换它的默认模型`,
      vertexexpress_title: `设置 Google Vertex AI Express`,
      vertexexpress_description: `Google Vertex AI Express 通过 API 密钥访问 Vertex AI 上的 Gemini。\n- 使用你自己的 Google Cloud API 密钥，而不是宿主机的应用默认凭据\n- 最适合已部署的 TomoriBot BYOK 场景，每位用户保存自己的密钥\n- 预览功能，模型目录较小且只有 Gemini\n- [Vertex AI Express 模式概览](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview)`,
      vertexexpress_getting_key_title: `设置步骤：`,
      vertexexpress_getting_key_description: `1. 打开 [Vertex AI Express 模式](https://console.cloud.google.com/expressmode)\n2. 如果 Google 把你转到标准 Google Cloud，请改用独立的 \`vertex\` 提供方。因为 Express 模式只适用于尚未创建计费 GCP 账号的 Google 账号。\n3. 在 Express 控制台打开 **API 和服务 > 凭据**，复制 Express API 密钥\n4. 用 {configSetup} 或 {configApikeySet} 填入这个原始 API 密钥\n5. 用 {configModel} 选择 Vertex AI Express 模型`,
      vertexexpress_important_title: `重要说明：`,
      vertexexpress_important_description: `- 保存原始 API 密钥，而不是 \`{project_id}::{location}\`\n- 这里不需要设置位置，\`global\` 只用于独立的 \`vertex\` 提供方\n- 完整的 Google Cloud Vertex 项目请用 \`vertex\`，不要用 \`vertexexpress\`\n- 可用模型仅限 Vertex AI Express 的 Gemini 目录\n- 可用图像生成，但没有视频与嵌入\n- Express 模式目前是 Google 的预览功能`,
      vertexexpress_footer: `设置好这个提供方后，可以用 {configModel} 更换它的默认模型`,
    },
    elevenlabs: {
      description: `了解如何设置 ElevenLabs 文本转语音`,
      title: `设置 ElevenLabs TTS`,
      getting_key_title: `获取你的 API 密钥：`,
      getting_key_description: `1. 打开 [ElevenLabs](https://elevenlabs.io/app/settings/api-keys)\n2. 注册或登录你的账号\n3. 新建一个 API 密钥\n4. 用 {configSpeechElevenlabs} 填入这个 API 密钥`,
      choosing_voice_title: `选择语音：`,
      choosing_voice_description: `设置好 API 密钥后，用 {configSpeechVoiceAssign} 浏览可用语音。\n- 可以在 [语音库](https://elevenlabs.io/app/voice-library) 里添加更多语音，也能克隆你自己的声音。`,
      free_voices_title: `预置语音（免费档位）：`,
      free_voices_description: `免费方案只能使用预置语音。完整列表见 [ElevenLabs 预置语音](https://elevenlabs-sdk.mintlify.app/voices/premade-voices)，然后用 {configSpeechElevenlabs} 或 {configSpeechVoiceAssign} 为每个人格指定一个。`,
      important_notes_title: `重要说明：`,
      important_notes_description: `- 我生成和朗读语音消息时会按字符计费\n- 免费档位有每月上限，请在 ElevenLabs 控制台查看用量\n- 是否公开语音转写由 {configSpeechTranscripts} 单独控制`,
      footer: `再次运行 {configSpeechElevenlabs} 即可更新 ElevenLabs 密钥。`,
    },
    getting_started: {
      title: `新手上路`,
      description: `介绍如何开始使用我和我的功能`,
      get_api_key: {
        title: `获取 API 密钥`,
        description:
          "API 密钥让我能访问某个 AI 提供方的模型。 我生成的所有内容都记在这把密钥上，所以请像 对待其他密码一样对待它。 要完成设置，我需要一把：\n> **1.** 在下面选一个提供方，打开它的指南。\n> **2.** 复制它给你的密钥。**不要把它分享**给 任何人，也不要粘贴到频道里，只填进 {setup} 为你打开的输入框。\n> **3.** 运行 {setup}，等我询问时粘贴密钥。",
        picker_footer: "-# 如果你的端点不在列表里，可以跳过密钥，看本页的 **自定义端点（高级）**。",
      },
      change_trigger_behavior: {
        title: `调整触发行为`,
        description:
          "默认情况下，你说我的名字、@我或回复我，我就会回应。你可以按频道 放宽、收紧或直接关掉。\n\n**我可以在哪里说话**\n你可以让我只在白名单频道里回复。 在白名单里添加即可，见 {moderationWhitelist}。\n> 不在名单里的频道我保持安静。\n\n**我自己主动开口**\n{configAutoTrigger} 让我可以每隔几条消息，或随机地 自动发一条消息。\n\n**只用提及触发我**\n明确触发模式让我不再因为叫到名字就回应， 而是等 @提及。在 {configBehaviorTrigger} 里打开。",
      },
      create_first_persona: {
        title: `创建你的第一个人格`,
        description:
          "*人格* 就是换一个名字、头像、性格等等的我，功能完全一样！ 你可以编辑现有的那个，也可以新建。\n\n**改掉现有的那个**\n{configPersonaGeneral} 设置我的名字、性格和称呼别人的 方式。{configPersonaAppearance} 设置我的头像。\n\n**用一句话写出新人格**\n{personaGenerate} 用一小段描述生成完整人格。 {personaCreate} 给你一份空白模板。\n\n**从别处带一个进来**\n{personaImport} 接受从 botbooru、chub 等角色卡 站点下载的角色卡。",
        footer: "你可以同时保留多个人格。见「功能」里的 **多个人格**。",
      },
      explore_features: {
        title: `看看我的功能！`,
        description:
          "设置完成了。现在我能说话了，这些是我能做的事。\n- **使用这个服务器的表情与贴纸**，运行 {expressionsInitialize} 之后即可。\n- **欢迎新成员**，在 {configWelcome} 里设置。\n- **记住并提醒**：直接让我提醒你，或者 告诉我值得留下的事。\n- **搜索网页**并使用其他工具，在 {configTools} 里打开。\n- **生成图像、视频和语音**，用 {generateImage}、 {generateVideo} 和 {generateVoice}。\n\n我的大部分开关都在 {config} 里，但不是全部。",
        footer:
          "**Brave Search** 会给我已有的搜索加上网页 结果。它需要单独的密钥，「设置」里的 **获取 API 密钥** 可从可选服务列表打开指南。 文档站是这块面板的完整版本， 逐项解释了每个设置。",
      },
    },
    personal_profile: {
      title: `个人资料`,
      description: `属于你的设置，会跟随你进入我在的每个服务器。`,
      nickname_pronouns: {
        title: `你的昵称与代词`,
        description:
          "告诉我该怎么称呼你，我会在任何地方都用这个称呼。\n\n在 {personalProfile} 里设置。\n> 昵称：我用来代替你 Discord 名字的称呼\n> 前缀与后缀：称号或敬称，例如 `-san`\n> 代词：`she/her`、`they/them`、`any`，或你的名字\n\n留空的字段会回退到你的 Discord 现用名字， 以及人格自己的称呼习惯。",
        footer: "某个人格可以单独用别的称呼叫你。在 个人资料 > 人格专属偏好 里设置。",
      },
      personal_memories: {
        title: `个人记忆`,
        description:
          "我专门记住的关于你的事，在每个服务器都生效。\n\n**直接告诉我就行**\n在聊天里说一句，我会自己存下来。存好时 会出现一条确认消息。\n\n**或者手动管理**\n{personalMemories} 列出我记住的关于你的一切， 并允许你编辑或删除其中任意一条。\n\n**决定我能用多少**\n{personalPrivacy} 设置你的隐私等级，从完全 个性化一直到完全不做个性化。",
        footer: "这些与这个服务器共享的记忆是分开的， 后者这里任何人都能查看和编辑。",
      },
      personal_providers: {
        title: `个人提供方（高级）`,
        description:
          "在和我说话的任何地方，都用你自己的 API 密钥和模型回复， 而不是服务器用的那一套。\n\n**保存一个提供方**\n{personalProviders} 会保存你的密钥，并立刻启用你的 个人文本模型。\n\n**换一个模型**\n{personalModels} 用来切换模型，采样器和 备用模型就在同一分类的旁边。\n> 你的个人设置只影响你触发的回复。\n> 服务器里的其他人不受影响。\n\n有些服务器要求这样做。如果某个服务器开启了用户 BYOK， 你不先在这里保存一个提供方，我就无法回复你。",
      },
    },
    custom_endpoints: {
      title: `自定义端点（高级）`,
      description:
        "把我指向你自己运行或信任的端点：Ollama、LM Studio、 LiteLLM、KoboldCPP、ComfyUI，或自部署的语音服务器。\n> {providers} 为整个服务器注册一个。\n> {personalProviders} 只为你自己注册一个。",
      text_models: {
        title: `文本模型`,
        description:
          "选择 **添加新的自定义端点**，然后填一个标签、 基础 URL 和它的 API 风格。需要认证令牌的话也填上。\n\n选中保存好的标签，选择 **+ 添加新文本模型**， 填入端点要求的准确模型代号。添加模型即启用它。\n> 视觉、工具使用和结构化输出请如实勾选。\n> 我决定给你发什么时会信任这些标记。\n\n之后可以在 {configSwitchModels} 里切换过去。",
        footer: "完整的 API 风格与兼容性参考在 文档站上。",
      },
      comfyui: {
        title: `ComfyUI（用于视频与图像）`,
        description:
          "先在 ComfyUI 里搭好并测试工作流，再用 **Save (API Format)** 导出。\n\n把提示词占位符放在提示词该在的位置， 其他占位符放在你想注入尺寸、时长或 模型代号的地方。\n\n注册端点时 API 兼容性选 `ComfyUI`（例如 `http://127.0.0.1:8188`），再给它添加一个图像或视频 模型，然后上传导出的 JSON。\n> 图必须以真正的保存节点结尾，只有预览 节点的话我没有文件可下载。",
        footer: "现成的工作流在 GitHub 仓库里， 完整的占位符列表在文档站上。",
      },
      text_to_speech: {
        title: `文本转语音（用于语音）`,
        description:
          "用同样的方式注册语音端点，然后给每个人格 配一个声音。\n\n托管服务与自部署服务器都可以，包括 Chatterbox-Turbo、Qwen3-TTS、IrodoriTTS 和 ElevenLabs。 先注册端点，再给它添加语音模型。\n> 在 {configPersonaVoice} 里指定声音。\n> 在 {configVoices} 里调节语速和默认值。",
        footer:
          "你发给我的语音消息会通过同一份端点列表转写， 设置方式也一样。托管语音方面， ElevenLabs 在「设置」的 **获取 API 密钥** 里有自己的 指南，列在可选服务中。",
      },
    },
    multiple_personas: {
      title: `多个人格`,
      description: "一个服务器里可以有多个人格，各自有 自己的名字、记忆和目标！",
      mains_alters_title: `主人格与副人格`,
      mains_alters_body:
        "主人格是在服务器里代表我的人格。 副人格是我可以借其说话的第二身份， 消息上有它自己的名字和头像。",
      bringing_in_title: `引入人格`,
      bringing_in_body:
        "{personaImport} 以文件形式接收角色卡：\n> `.png` 卡片，来自 TomoriBot 或 SillyTavern\n> `.json` 卡片，来自 TomoriBot 或 SillyTavern\n> `.charx` 压缩包，Character Card V3\n\n只会读取角色的文字。目前会跳过卡片自带的立绘、 音频和视频，所以请自己在 {configPersonaAppearance} 和 {configPersonaSprites} 里设置。",
      where_to_find_title: `去哪里找角色卡`,
      where_to_find_body:
        "用 {personaGenerate} 或 {personaCreate} 自己做一个， 或者去找现成的。\n\nbotbooru、chub 这类角色卡站点上有成千上万张。 它们是别人的站点，而且为别的 bot 写的卡片 未必能顺利转换。",
      talking_title: `让人格之间互相说话`,
      talking_body: "在 {configPersonaTriggers} 里给每个人格单独的触发词和 频道，它们就会在同一段对话里 并排回复。",
      footer: `用 {personaExport} 分享一个你自己的人格。`,
    },
    media_generation: {
      title: `媒体生成`,
      description:
        "我可以生成图像、视频和语音，既可以用指令， 也可以由你在对话里要求。\n> 每次生成都计入服务器的配额。见「管理」里的 **配额**。",
      image_generation: {
        title: `图像生成`,
        description:
          "{generateImage} 会打开提示词输入框。你可以自己写提示词， 也可以选择 **画出当前场景**，让我来描绘现场。\n> 最多可附三张参考图来引导结果。\n> 在同一个框里选择宽高比。\n\n这里保存的、标注支持图像的提供方或端点都能画图， {providers} 会显示你有哪些可用。不能用参考图的会说明， 然后只按文字来画。",
        footer: `默认值在 {configImageDefaults} 里。`,
      },
      video_generation: {
        title: `视频生成`,
        description:
          "{generateVideo} 接收一段提示词，可选地接收频道里 已有图像作为起始帧。\n\n任何标注支持视频的提供方或端点都能生成， 包括 ComfyUI 视频工作流。{providers} 会显示 你有哪些可用。\n> 视频在任何地方都又慢又贵，请做好等待的准备。",
      },
      speech_generation: {
        title: `语音生成`,
        description:
          "{generateVoice} 把文字变成当前人格声音的 语音消息。\n\n必须先注册语音端点，托管或自部署都可以： 见「设置」里的 **自定义端点（高级）**。\n> 每个人格的声音可以不同。声音来自 {configPersonaVoice}。",
      },
      art_search: {
        title: `插画搜索`,
        description:
          "{booruSearch} 会根据一个或两个标签随机发送 4 张评价良好的 Danbooru 图像。输入时会显示建议，昵称或拼写错误也会转换成真实标签。\n> 存疑和明确成人内容仅在年龄限制频道中显示。\n\n你也可以直接让我展示一些插画；{configTools} 中的 **Danbooru 搜索** 开关用于控制该功能。如需限制谁能运行该指令，请使用服务器设置 > 整合。",
      },
    },
    tons_of_tweakability: {
      title: `大量可调设置`,
      description: `按你和服务器成员的偏好来调整我`,
      behavior_tuning: {
        title: `行为调校`,
        description:
          "我怎么写、怎么想，以及被允许做什么。\n> **模型**：{configSwitchModels} 选择实际回答的模型 及其参数\n> **回复自然度**：{configBehaviorGeneral} 控制我的表达有多 像真人，从正式到非常随意。\n> **系统指令**：同样在 {configBehaviorGeneral}， 用于对每条回复都生效的要求。\n> **工具**：{configTools} 决定我可以动用哪些能力， 例如网页搜索或图像生成。",
        footer: "采样器层面的旋钮（温度之类）在 {configParameters} 里，用来调节随机性等。",
      },
      server_wide_settings: {
        title: `服务器级设置`,
        description:
          "对服务器里每个人生效的边界。仅限 管理员。\n> **我在哪里说话**：白名单频道、每个人格的 频道限制和冷却，都在 {moderation} 里。\n> **我什么时候自己开口**：{configAutoTrigger}。\n> **谁能触发我**：白名单身份组，同样在 {moderation} 里。\n> **我的记录放在哪里**：{configWelcome} 设置日志与 欢迎频道。",
        footer: "频道级覆盖可以让某个频道有自己的 模型或规则。见 {configChannelOverrides}。",
      },
      personal_settings: {
        title: `个人设置`,
        description:
          "你自己的偏好，会悄悄覆盖服务器的设置， 只影响你触发的回复。\n> **我认为你是谁**：昵称、代词和隐私， 在 {personalProfile} 里。\n> **谁来回答你**：你自己的提供方和模型，在 {personalProviders} 里。\n> **我怎么对待你**：回复模式和个人 聚焦，在 {personalConfig} 里。\n\n这里的一切都会跟着你在服务器之间走。",
        footer: "个人聚焦让某个人格把你当作它的 关注对象，在 {personalSpotlight} 里设置。",
      },
    },
    memory_catalog: {
      title: `记忆`,
      description: "我保留两种记忆：长期有效的事实，以及 正在进行的这段对话的工作记录。",
      long_term_memory: {
        title: `长期记忆`,
        description:
          "我永久保留的事实，属于这个服务器或属于你。\n\n**教导我**\n在聊天里说，或者手动添加：服务器记忆用 {memories}， 你自己的用 {personalMemories}。\n\n**让我忘掉**\n同样是这两条指令，列出所有条目并删除其中任意一条。\n\n**给我文档**\n{memories} 也接受上传的文件。相关部分在需要时 才会被读出来，不会一次性全读， 靠的就是检索增强生成（RAG）。\n> 服务器记忆这里所有人都能用。个人记忆 只在你参与对话时才会出现。",
      },
      short_term_memory: {
        title: `短期记忆`,
        description:
          "我对这个频道里正在进行的对话的工作记录， 每个频道单独保存。\n\n我会边走边总结发生了什么，长对话因此 保持连贯，而不用重发每条消息。\n> **刷新节奏**：我多久更新一次这份记录。\n> **呈现模式**：摘要是替换最近的消息， 还是放在它们旁边。\n> **分类**：最多五个带标签的字段，例如 `Goals` 或 `Inventory`，代替一段自由记录。\n\n管理员可以在 {configAdvancedMemory} 里调整全部设置， {memories} 可以清空当前记录。",
        footer: "让我永久记住某件事，它就会变成 长期记忆。",
      },
      rewards_punishments: {
        title: `奖励与惩罚`,
        description:
          "我确实会注意并记住的有趣指令。对我好一点， 或者不好，我都会照做反应。\n> {reward}：摸头、拥抱、亲吻、挠痒或喂食。\n> {punish}：敲头、咬、捏、打屁股或捏紧。",
        footer: `同时有几个人格时，请指明你针对的是哪一个。`,
      },
      memory_tagging: {
        title: `记忆标签（高级）`,
        description:
          "默认情况下，范围内的每条记忆都会随每条消息一起发送。标签可以缩小这个范围。\n> **关键词标签**：带标签的记忆只在其关键词出现在对话里时才会唤醒。没有标签的记忆始终有效。\n> **频道**：服务器记忆可以限制在表单中选取的频道（包含其子区），个人记忆则可通过 `#channel` 标签限制。两者均可与关键词标签叠加。\n\n在 {configAdvancedMemory} 里把两者打开，然后用 {toolPromptSnapshot} 查看当前究竟有哪些记忆处于有效状态。",
        footer: "上传的文档和提取出的历史记录也可以限制频道。",
      },
    },
    scheduled_tasks: {
      title: `定时任务`,
      description: `我可以按设定的时间回应，一次或重复进行。`,
      making_title: `创建一条`,
      making_body:
        "直接说就行。「14:30 提醒我起来活动一下」或「每天早上 发一句站会问题」就够了，我会建好任务， 并向你确认细节。",
      changing_title: `修改或取消`,
      changing_body:
        "{scheduledTaskEdit} 打开任意已有任务：内容、 下次触发时间、重复间隔，以及是否 @你。 {scheduledTaskRemove} 删除一条。",
      who_title: `谁可以动什么`,
      who_body:
        "你随时可以编辑自己的任务。服务器管理员可以编辑 任何人的任务，因为任务会发到共享频道。\n> 时间使用设置时指定的时区，所以在依赖 早上 6 点的闹钟之前先核对一下时区。",
    },
    server_moderation: {
      title: `服务器管理`,
      description:
        "关于谁能在这里使用我、在哪里使用我的一切。全部 需要管理服务器权限，都在 {moderation} 里。\n> **成员访问**：谁可以触发我，以及他们能用到 哪些模型。\n> **白名单**：我被允许回复的频道、身份组和 人格。\n> **配额**：这个服务器允许多少生成量。\n> **用户屏蔽名单**：我必须忽略的个别成员。",
      blacklisting: {
        title: `屏蔽名单`,
        description:
          "被列入黑名单的成员会被我完全忽略：在任何频道、用任何人格都无法触发我，他们的消息也不会进入我的上下文。像 `/respond`、`/reward`、`/punish` 这类让我替他们行动的命令也会被拒绝。他们也无法修改服务器记忆、属性或示例对话。\n\n在 {moderationBlacklist} 里添加。同一页面会列出当前所有条目，并可逐条或批量移除。\n> 黑名单管的是访问权限，不是删除。关于该成员的记忆会保留，直到有人删掉。",
        footer: "如果要让整个频道安静，而不是针对某个人， 请改为把该频道移出白名单。",
      },
    },
    quotas: {
      title: `配额`,
      description: "配额限制这里能生成多少，这样就不会有人 不小心花掉一个月的额度。",
      spent_title: `用量怎么算`,
      spent_body:
        "有三个独立的池子：文本、图像和视频。每个池子 都按成员和整个服务器各算一次， 先耗尽的那个会中止请求。\n> 被拒绝的请求会告诉你哪个池子用完了， 以及什么时候恢复。",
      limits_title: `设置上限`,
      limits_body: "{moderationQuotas} 设置每个池子的每日额度。 不想限制的话，把某个池子留为无限制即可。",
      starting_over_title: `重置池子`,
      starting_over_body:
        "{quotaResetUser} 清空某位成员的当日用量， {quotaResetGlobal} 清空服务器级池子。两者都需要 管理服务器权限。",
      footer: "池子每天会自动重置。手动重置是为了 不该让某人干等的时候。",
    },
    age_restricted_commands: {
      title: `年龄限制指令`,
      description: `仅限成年人。打开任何功能之前请先读这一节。`,
      filter_title: `默认不做过滤`,
      filter_body:
        "我自带的内容不过滤，因为过滤在挡住某些内容的同时， 同样会拉低普通回复的质量。这里什么合适由 服务器管理员决定，不是我。\n> 你的 AI 提供方仍会在自己那边执行它的规则， 无论这里怎么设置，它都可能拒绝请求。",
      gated_title: `明确的成人功能有门槛`,
      gated_body:
        "明确属于成人的内容都在 {nsfw} 之后，并且只在 Discord 标记为年龄限制的频道里生效。\n\n{nsfwJailbreaks} 选择这个服务器启用哪些提示词策略。 管理员没打开之前，它们全部关闭。\n> 这些策略会改变我被提示的方式。它们能让我少拒绝一些， 但也可能带来意外行为。",
      footer: "启用这些功能即表示服务器管理员确认该频道 仅限成年人，并为此负责。",
    },
    user_byok: {
      title: `用户 BYOK（高级）`,
      description: "BYOK 就是自备密钥：每位成员用自己的提供方 为自己的回复付费。",
      changes_title: `会改变什么`,
      changes_body:
        "开启 BYOK 后，只有保存了个人提供方的成员， 其消息才会被回复。服务器自己的提供方 不会作为他们的备用。\n> 在 {moderationMemberAccess} 里打开，或在 {setup} 过程中选择。",
      suits_title: `适合谁`,
      suits_body: "共享一把 API 密钥会被用光的大型或公开服务器。 小型服务器通常更愿意共用一个提供方。",
      members_title: `成员需要做什么`,
      members_body: "在 {personalProviders} 里保存密钥。想了解步骤， 可以让他们看「设置」里的 **个人提供方（高级）**。",
      footer: "仅限服务器。私信里没有成员可以自备 密钥，所以那里不提供这个选项。",
    },
    sillytavern_presets: {
      title: `SillyTavern 预设集`,
      description: "导入一个 SillyTavern 提示词预设集，我就会按那个 预设集的方式构建提示词。",
      importing_title: `导入预设集`,
      importing_body: "{configStPresets} 接收导出的预设集 JSON，之后你可以 启用、停用或移除它。",
      controls_title: `它控制什么`,
      controls_body:
        "预设集接管提示词的排序，以及对话周围的 指令块。\n> 启用后，它会覆盖来自 {configBehaviorGeneral} 的 系统提示词和来自 {configPersonaAdvanced} 的 人格提示词。",
      still_applies_title: `什么仍然生效`,
      still_applies_body: "人格属性、示例对话、记忆和工具仍会发送。 预设集决定的是排列方式，不是内容。",
      footer: "关掉预设集就会回到我自己的提示词布局， 不会丢失任何内容。",
    },
    mcp_servers: {
      title: `MCP 服务器`,
      description: "MCP 是把工具交给 AI 的标准方式。接入一个之后， 它的工具就成了我真正能做的事。",
      hosted_title: `托管服务器`,
      hosted_body: "{configMcp} 接收一个 URL 和可选的认证令牌。那个服务器 公开的任何东西都会出现在我的工具列表里。",
      local_title: `本地服务器`,
      local_body: "跑在你自己机器上的服务器，只要能访问，用法也一样。 文档站上有步骤说明。",
      before_title: `接入之前`,
      before_body:
        "> MCP 服务器的工具会用你给它的权限运行， 只要看起来相关我就会使用它们。请接入你 信任的服务器，并先读清楚它们的工具做什么。",
      footer: `随时可以在 {configTools} 里单独关掉某个工具。`,
    },
    matrix_bridge: {
      title: `Matrix`,
      description: "我可以同时待在 Matrix 房间和 Discord 频道里， 把对话在两边传递。",
      linking_title: `关联房间`,
      linking_body:
        "{matrixLink} 把当前频道关联到一个 Matrix 房间 ID，形如 `!abcdef:matrix.org`。请先邀请 {matrixBotUser} 进入那个房间。",
      reads_title: `它怎么读取`,
      reads_body:
        "两侧的消息会作为同一段对话到达我这里， 我会在两边都回复。\n> 附件、编辑和表情回应不一定都能带过去。可靠传递的是文字。",
      footer: "什么都没关联上？先确认邀请已被接受， 再检查其他问题。",
    },
  },
};

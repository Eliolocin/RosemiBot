---
title: "语音：TTS与STT"
sidebar:
  order: 3
aiGenerated: true
---

TomoriBot可以在Discord中说和听：通过文本转语音 (TTS) 发送语音回复，并通过语音转文本 (STT) 将音频消息转录到对话上下文中。

在 `/providers` 中选择语音提供方，或用 `/personal providers` 使用你自己的 Google 或 OpenRouter 语音模型。你也可以在自己的硬件上运行本地语音模型。

## 文本转语音
<!-- anchor: text-to-speech -->

### Google 与 OpenRouter 语音

添加 Google 会将 Gemini Flash TTS 选为 `TTS（语音设计）`。添加 OpenRouter 会将付费的 Fish S2.1 Pro 选为 `TTS（声音克隆）`，并在该槽位为空时将 Seed Audio 1.0 填入 `TTS（语音设计）`。OpenRouter 绝不会替换你已经选好的 Gemini 或 Vertex 语音设计，因此两家提供方可以同时保持启用。如果你在 Seed 上线前添加过 OpenRouter，你的语音设计槽位会保持为空，直到你手动选中 Seed。再次添加 OpenRouter 密钥也会将 Seed 填入空的语音设计槽位，包括你特意清空的槽位。Flash-Lite 和免费版 Fish 需要明确手动选择模型；可用性与提供方配额仍然适用。用 `/config` > 模型 > 切换模型 更改或清空任意槽位。
个人选择及其开关位于 `/personal config` > 模型 > 切换模型。关闭某项个人模式后，该模式会转而使用服务器设置，而另一项仍保持启用。

在所选范围相同的范围内使用对应提供方的 API 密钥。仅有网页聊天订阅并不能获得 API 访问权限。Gemini 的[免费 API 级别](https://ai.google.dev/gemini-api/docs/pricing)有项目配额和资格要求；请在 AI Studio 中确认访问权限。免费版 Fish 是独立的模型代码 `fish-audio/s2.1-pro-free:free`，必须显式选择。开启服务器模型备用后，个人免费模型调用失败时仍可回退到服务器配置的付费模型。

在 `/config` > 人格 > 语音 中，选择`描述声音`可以保存最多 1,000 个字符的描述。你可以在挑选模型之前先写好描述。若要使用 Fish 或本地克隆模型，请在 `/config` > 模型 > TTS 参数与语音 中添加参考音频，并在对应人格的语音页面中进行分配。更换提供方后，两项输入内容都会保留。选择`语音设计`或`声音克隆`来设定优先级；首选输入若没有匹配的模型或可用的声音，就可以改用另一项已保存的输入。页面会说明当前服务器选择下实际生效的是哪种来源。

运行 `/generate voice-message` 输入一段简短台词，或者让人格发送语音消息。该指令也接受单次生效的声音描述或参考音频上传。保存的描述会复用 Gemini 语音身份；修改描述会停用旧身份。单次生效的描述会创建临时身份，bot 会在生成后将其删除。清理失败会在再次使用该凭据时重试；崩溃或出现不确定的超时后，管理员可能需要在提供方控制台中手动移除这些声音。
导出的 PNG 与 JSON 格式人格卡会包含声音描述；远程语音身份和参考音频分配不会导出。Google 会将设计好的语音身份保存在其 API 项目中。Gemini 基于参考音频克隆语音的功能已暂缓，直到 bot 能收集到授权录音。

Seed Audio 的工作方式与 Gemini 不同。它每次发声都会根据描述重新构建声音，因此同一段描述在不同消息之间听起来可能会略有差异。如果你需要保持稳定不变的声音，请使用 Gemini 或参考样本。Seed 在英语和中文上的表现最佳，单条消息最多生成两分钟音频，因此台词上限为 1,100 个字符。此外，声音描述、语气指示与台词共用 2,048 个字符，因此描述过长就会压缩台词的空间。如果台词超出限制，在发送任何内容前就会被拒绝，bot 会提示你缩短台词。
OpenRouter 按音频秒数对 Seed 计费，折合每分钟费用约为 Fish 的十倍左右。要切换到 Gemini 或清空该槽位，请使用 `/config` > 模型 > 切换模型。

个人语音生成失败遵循服务器模型备用设置及服务器权限。成功备用会体现在指令回执中。提供方可能会对失败或取消的请求计费；台词和音频长度限制并不代表费用上限。

### ElevenLabs（云端，最省事）

1. 从 [ElevenLabs](https://elevenlabs.io/app/settings/api-keys) 获取API密钥。
2. 运行`/providers`，选择`添加新提供方`，选择`ElevenLabs`，然后粘贴密钥。这个流程：
   - 注册ElevenLabs语音端点和转录端点，
   - 激活两个端点，
   - （可选）立即将声音分配给一个人格。
3. 在`/config` > `人格` > 语音中将语音分配给其他人格。在[ElevenLabs语音库](https://elevenlabs.io/app/voice-library)中浏览语音，你也可以在其中克隆自己的语音。

在`/providers`中选择ElevenLabs，然后每当需要更新密钥时选择`编辑端点`。

笔记：

- 在免费计划中，只有预制声音有效。浏览[预制语音列表](https://elevenlabs-sdk.mintlify.app/voices/premade-voices)。
- 当她生成语音消息时，字符数就会被计算在内。免费套餐有每月限制，因此请监控你的ElevenLabs仪表板。
- 语音回复需要`/config` > `权限`中的`voice_message_enabled`，并且活动人格必须分配有语音。
- 更改`/config` > `人格` > 语音需要服务器中的“管理服务器”权限，并且在DM中仍可供所有者使用。

在`/help`中，选择`功能`，然后选择`语音`，以进行Discord中的交互式演练。

### 本地语音克隆引擎（自部署）

在自部署实例上，你可以运行本地语音克隆服务器。工作流程：启动服务器，在`/providers`中注册其连接和型号，在`/providers`中选择它，在`/config` > `模型` > TTS参数和语音中上传参考样本，然后在`/config` > `人格` >语音中分配它。接受任何音频格式（自动转换为单声道WAV）； 没有背景音乐的10到20秒剪辑效果最佳。

每个引擎都有自己的设置指南：

- [Chatterbox-Turbo/Nano](/zh-CN/self-hosting/local-endpoints/text-to-speech/chatterbox/)：快速英语语音克隆，带有`[laugh]`等情感标签。
- [Qwen3-TTS](/zh-CN/self-hosting/local-endpoints/text-to-speech/qwen3tts/)：多语言（10种语言）加上自然语言VoiceDesign模式。
- [MOSS-TTS](/zh-CN/self-hosting/local-endpoints/text-to-speech/moss/)：多语言克隆和英文或中文语音设计。
- [IrodoriTTS](/zh-CN/self-hosting/local-endpoints/text-to-speech/irodoritts/)：日本专用引擎，将表情符号读取为情感线索。

有关硬件指南和完整引擎列表，请参阅[文本到语音比较表](/zh-CN/self-hosting/local-endpoints/text-to-speech/)。

## 语音转文字
<!-- anchor: speech-to-text -->

转录端点将用户音频附件转换为对话上下文的文本。是否在聊天中公开发布文字记录在`/config` > `行为` > 通知行为中控制。

### ElevenLabs（云端）

从`/providers`添加ElevenLabs会将转录端点与语音一起注册。使用`/providers`在活动转录端点之间切换。

### 本地引擎（自部署）

- [WhisperX](/zh-CN/self-hosting/local-endpoints/speech-to-text/whisperx/)：推荐本地路径； 大约100种语言、GPU加速、多种模型大小。
- [KoboldCPP](/zh-CN/self-hosting/local-endpoints/speech-to-text/koboldcpp/)：当你的构建公开OpenAI兼容的转录端点时起作用。
- [耳语.cpp](/zh-CN/self-hosting/local-endpoints/speech-to-text/whispercpp/)。

请参阅 [语音转文本](/zh-CN/self-hosting/local-endpoints/speech-to-text/) 中心以获取完整的引擎列表。对于Discord摘要，运行`/help`，然后选择`功能`和`语音识别`。

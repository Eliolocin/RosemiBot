---
title: "语音：TTS与STT"
sidebar:
  order: 3
---

TomoriBot可以在Discord中说和听：通过文本转语音 (TTS) 发送语音回复，并通过语音转文本 (STT) 将音频消息转录到对话上下文中。

两者都使用提供商端点系统。ElevenLabs是最快的云选项。你还可以使用自部署引擎在自己的硬件上运行本地语音模型。

## 文本转语音
<!-- anchor: text-to-speech -->

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

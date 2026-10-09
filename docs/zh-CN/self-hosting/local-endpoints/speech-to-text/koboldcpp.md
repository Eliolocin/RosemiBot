---
title: "KoboldCPP语音转写"
sidebar:
  order: 3
---

使用现有的 [KoboldCPP](https://github.com/LostRuins/koboldcpp) 实例转录TomoriBot中的音频附件和语音消息。

KoboldCPP包括基于Whisper的语音转文本。TomoriBot使用其兼容OpenAI的音频转录端点 (`POST /v1/audio/transcriptions`) 连接到KoboldCPP。

## 设置

在启用Whisper/STT的情况下启动KoboldCPP，并确认你的构建暴露了以下端点：

- `POST /v1/audio/transcriptions`
- `GET /v1/models`或`GET /models`

在TomoriBot使用它期间，请让KoboldCPP保持运行。如果你的构建只暴露了`/api/extra/transcribe`或其他自定义形态，请先用一个封装程序，直到TomoriBot有专用适配器为止。

## 在TomoriBot中注册

运行`/providers`，选择`添加新自定义端点`，并使用语音识别专用的API兼容性：

- API兼容性：`openai-compatible-transcription`
- `endpoint_url`：你的KoboldCPP服务器根地址

保存连接后，选中它，并用它的模型下拉菜单把服务器上报的模型名称添加为语音识别模型。

端点注册和模型设置都在`/providers`里做，之后打开`/config` > 模型 > `切换模型`，选中并激活已注册的端点。

## 使用成绩单

注册后，TomoriBot在后台转录音频附件并将文本添加到聊天上下文中。仅当你还希望在聊天中可见地发布文字记录时，才使用`/config` > 引擎 > 通知。

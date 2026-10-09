---
title: "whisper.cpp语音转写"
sidebar:
  order: 2
---

使用 [whisper.cpp](https://github.com/ggerganov/whisper.cpp) 为TomoriBot运行高性能、轻量级的语音转文本。

TomoriBot通过其与OpenAI兼容的音频转录端点 (`POST /v1/audio/transcriptions`) 连接到tweet.cpp。

## 设置

启动你的whisper.cpp HTTP服务器，并确认它暴露了OpenAI兼容的转写端点：

- `POST /v1/audio/transcriptions`
- `GET /v1/models`或`GET /models`

在TomoriBot使用它期间，请让该服务器保持运行。端点URL是服务器根地址，例如`http://127.0.0.1:8022`。

如果你的whisper.cpp构建暴露的是另一种端点形态，请在它前面放一个轻量封装程序，把请求映射成TomoriBot期望的OpenAI兼容形态。

## 在TomoriBot中注册

运行`/providers`，选择`添加新自定义端点`，并使用语音识别专用的API兼容性：

- API兼容性：`openai-compatible-transcription`
- `endpoint_url`：你的whisper.cpp服务器根地址

保存连接后，选中它，并用它的模型下拉菜单把服务器上报的模型名称添加为语音识别模型。

端点注册和模型设置都在`/providers`里做，之后打开`/config` > 模型 > `切换模型`，选中并激活已注册的端点。

## 使用成绩单

注册后，TomoriBot在后台转录音频附件并将文本添加到聊天上下文中。仅当你还希望在聊天中可见地发布文字记录时，才使用`/config` > 引擎 > 通知。

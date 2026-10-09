---
title: "whisper.cpp轉錄"
sidebar:
  order: 2
---

使用 [whisper.cpp](https://github.com/ggerganov/whisper.cpp) 為TomoriBot運行高效能、輕量級的語音轉文字。

TomoriBot透過其與OpenAI相容的音訊轉錄端點 (`POST /v1/audio/transcriptions`) 連接到tweet.cpp。

## 設定

啟動你的whisper.cpp HTTP伺服器，並確認它提供OpenAI相容的轉錄端點：

- `POST /v1/audio/transcriptions`
- `GET /v1/models`或`GET /models`

在TomoriBot使用期間請保持伺服器運行。端點URL是伺服器的根路徑，例如`http://127.0.0.1:8022`。

如果你的whisper.cpp版本提供不同的端點形狀，請在它前面放一層輕薄包裝，將請求對應到TomoriBot預期的OpenAI相容形狀。

## 在TomoriBot中註冊

執行`/providers`，選擇`新增自訂端點`，並使用轉錄API相容性：

- API Compatibility：`openai-compatible-transcription`
- `endpoint_url`：你的whisper.cpp伺服器根路徑

儲存連線之後，選取它並用它的模型下拉選單加入你的伺服器回報為Transcription模型的模型名稱。

端點註冊與模型設定請用`/providers`。接著開啟`/config` > 模型 > `切換模型`，選取並啟用註冊好的端點。

## 使用成績單

註冊後，TomoriBot在後台轉錄音訊附件並將文字新增至聊天上下文。只有當你也希望在聊天中可見地發布文字記錄時，才使用`/config` > 引擎 > 通知。

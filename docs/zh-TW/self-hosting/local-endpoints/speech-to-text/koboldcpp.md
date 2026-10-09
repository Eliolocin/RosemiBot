---
title: "KoboldCPP轉錄"
sidebar:
  order: 3
---

使用現有的 [KoboldCPP](https://github.com/LostRuins/koboldcpp) 實例轉錄TomoriBot中的音訊附件和語音訊息。

KoboldCPP包含基於Whisper的語音轉文字。TomoriBot使用其相容於OpenAI的音訊轉錄端點 (`POST /v1/audio/transcriptions`) 連接到KoboldCPP。

## 設定

以啟用Whisper與STT的方式啟動KoboldCPP，並確認你的版本提供：

- `POST /v1/audio/transcriptions`
- `GET /v1/models`或`GET /models`

在TomoriBot使用KoboldCPP期間請保持它運行。如果你的版本只提供`/api/extra/transcribe`或其他自訂形狀，請先用一層包裝，等TomoriBot有專屬的轉接器再說。

## 在TomoriBot中註冊

執行`/providers`，選擇`新增自訂端點`，並使用轉錄API相容性：

- API Compatibility：`openai-compatible-transcription`
- `endpoint_url`：你的KoboldCPP伺服器根路徑

儲存連線之後，選取它並用它的模型下拉選單加入你的伺服器回報為Transcription模型的模型名稱。

端點註冊與模型設定請用`/providers`。接著開啟`/config` > 模型 > `切換模型`，選取並啟用註冊好的端點。

## 使用成績單

註冊後，TomoriBot在後台轉錄音訊附件並將文字新增至聊天上下文。只有當你也希望在聊天中可見地發布文字記錄時，才使用`/config` > 引擎 > 通知。

---
title: "語音：TTS與STT"
sidebar:
  order: 3
---

TomoriBot可以在Discord中說和聽：透過文字轉語音 (TTS) 發送語音回复，並透過語音轉文字 (STT) 將音訊訊息轉錄到對話上下文中。

兩者都使用供應商端點系統。ElevenLabs是最快的雲端選項。你也可以使用自架引擎在自己的硬體上執行本機語音模型。

## 文字轉語音
<!-- anchor: text-to-speech -->

### ElevenLabs（雲端，最簡單）

1. 從 [ElevenLabs](https://elevenlabs.io/app/settings/api-keys) 取得API金鑰。
2. 運行`/providers`，選擇`新增供應商`，選擇`ElevenLabs`，然後貼上金鑰。這個流程：
   - 註冊ElevenLabs語音端點和轉錄端點，
   - 啟動兩個端點，
   - （可選）立即將聲音指派給一個人格。
3. 在`/config` > `人格` > 語音中將語音指派給其他人格。在[ElevenLabs語音庫](https://elevenlabs.io/app/voice-library)中瀏覽語音，你也可以在其中複製自己的語音。

在`/providers`中選擇ElevenLabs，然後每當需要更新金鑰時選擇`編輯端點`。

筆記：

- 在免費方案中，只有預製聲音有效。瀏覽[預製語音清單](https://elevenlabs-sdk.mintlify.app/voices/premade-voices)。
- 當她產生語音訊息時，字元數就會被計算在內。免費套餐有每月限制，因此請監控你的ElevenLabs儀表板。
- 語音回覆需要`/config` > `權限`中的`voice_message_enabled`，且活動人格必須指派語音。
- 更改`/config` > `人格` > 語音需要伺服器中的「管理伺服器」權限，並且在DM中仍可供擁有者使用。

在`/help`中，選擇`功能`，然後選擇`語音`，以進行Discord中的互動式演練。

### 本機語音複製引擎（自架）

在自架執行個體上，你可以執行本機語音克隆伺服器。工作流程：啟動伺服器，在`/providers`中註冊其連接和型號，在`/providers`中選擇它，在`/config` > `模型` > TTS參數和語音中上傳參考樣本，然後在`/config` > `人格` >語音中分配它。接受任何音訊格式（自動轉換為單聲道WAV）；沒有背景音樂的10到20秒剪輯效果最佳。

每個引擎都有自己的設定指南：

- [Chatterbox-Turbo/Nano](/zh-TW/self-hosting/local-endpoints/text-to-speech/chatterbox/)：快速英語語音克隆，帶有`[laugh]`等情緒標籤。
- [Qwen3-TTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/qwen3tts/)：多語言（10種語言）加上自然語言VoiceDesign模式。
- [MOSS-TTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/moss/)：多語言克隆和英文或中文語音設計。
- [IrodoriTTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/irodoritts/)：日本專用引擎，將表情符號讀取為情緒線索。

有關硬體指南和完整引擎列表，請參閱[文字轉語音比較表](/zh-TW/self-hosting/local-endpoints/text-to-speech/)。

## 語音轉文字
<!-- anchor: speech-to-text -->

轉錄端點將使用者音訊附件轉換為對話情境的文字。是否在聊天中公開發布文字記錄在`/config` > `行為` > 通知行為中控制。

### ElevenLabs（雲端）

從`/providers`新增ElevenLabs會將轉錄端點與語音一起註冊。使用`/providers`在活動轉錄端點之間切換。

### 本機引擎（自架）

- [WhisperX](/zh-TW/self-hosting/local-endpoints/speech-to-text/whisperx/)：建議本地路徑；約100種語言、GPU加速、多種模型大小。
- [KoboldCPP](/zh-TW/self-hosting/local-endpoints/speech-to-text/koboldcpp/)：當你的建置公開OpenAI相容的轉錄端點時起作用。
- [耳語.cpp](/zh-TW/self-hosting/local-endpoints/speech-to-text/whispercpp/)。

請參閱 [語音轉文字](/zh-TW/self-hosting/local-endpoints/speech-to-text/) 中心以取得完整的引擎清單。對於Discord摘要，執行`/help`，然後選擇`功能`和`轉錄`。

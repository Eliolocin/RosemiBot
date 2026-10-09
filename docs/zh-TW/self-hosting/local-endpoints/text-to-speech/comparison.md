---
title: "TTS 引擎比較"
sidebar:
  order: 1
aiGenerated: false
---

TomoriBot 支援多種本機文字轉語音伺服器，各自適合不同的語言、硬體配置與延遲需求。

本頁提供在同一套測試環境、使用相符的語音複製參考下錄製的實測基準結果、合成時間與音訊比較片段。

## 多語言與英文語音複製

### 基準提示詞

- 標準提示詞 *（用於 Chatterbox Standard、Turbo、Nano、MOSS-TTS、CosyVoice 3、VoxCPM2、Qwen3-TTS）*：
  > *"Pain and pleasure are two sides of the same coin. Go on now... flip it. Either way, I'll let you feel all of me."*
- Fish Audio S2 Pro 提示詞 *（以方括號表情標籤測試）*：
  > *"Pain and pleasure are two sides of the same coin. [laughs] Go on now... flip it. [whispers] Either way, I'll let you feel all of me."*

### 效能與音訊比較

時間同時回報完整生成時間（從請求到音訊完成的總時鐘秒數）與即時係數（RTF），定義為生成時間除以音訊長度：

- RTF < 1.0（粗體）： 引擎生成語音的速度比即時更快（例如 `0.50× RTF` 會在 5 秒內渲染出 10 秒的片段）。只有這些引擎有可能跟上即時語音通話，而 TomoriBot 目前並未實作即時語音通話。
- RTF > 1.0： 生成所需時間比朗讀的音訊更長。TomoriBot 是把每則語音訊息當作完整檔案送出，所以較高的 RTF 只代表等待更久。

| 引擎 | Windows 原生<sup>(1)</sup><br/>（RTX 4070 Ti SUPER） | Linux 與 WSL2 | macOS<br/>（Apple Silicon） | 音訊樣本 |
|---|---|---|---|---|
| [Fish Audio S2 Pro](/zh-TW/self-hosting/local-endpoints/text-to-speech/fishs2/) | 約 8 到 10 分鐘<sup>(2)</sup><br/>*（約 65× RTF）* | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/fish-s2-pro.wav"></audio> |
| [Chatterbox（Turbo，預設）](/zh-TW/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 約 5.0 秒 *（8.7 秒片段）*<br/>0.57× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/chatterbox-turbo.wav"></audio> |
| [Chatterbox（Nano）](/zh-TW/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 約 3.0 秒 *（8.0 秒片段）*<br/>0.38× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/chatterbox-nano.wav"></audio> |
| [Chatterbox（Standard）](/zh-TW/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 約 6.0 秒 *（7.8 秒片段）*<br/>0.77× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/chatterbox.wav"></audio> |
| [MOSS-TTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/moss/) | 約 12.0 秒 *（8.8 秒片段）*<br/>1.36× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/moss-tts.wav"></audio> |
| [CosyVoice 3](/zh-TW/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | 約 6.0 秒 *（13.9 秒片段）*<br/>0.43× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/cosy-voice-3.wav"></audio> |
| [VoxCPM2](/zh-TW/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 約 8.0 秒 *（7.4 秒片段）*<br/>1.09× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/voxcpm2.wav"></audio> |
| [Qwen3-TTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 約 10.0 秒 *（9.2 秒片段）*<br/>1.09× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/qwen3-tts.wav"></audio> |

- <sup>(1)</sup> 測試環境：Windows 11（原生執行）上的 NVIDIA GeForce RTX 4070 Ti SUPER（16 GB GDDR6X，Ada Lovelace），使用一段 26.6 秒、24 kHz 單聲道、附逐字對應逐字稿的參考音訊樣本。
- <sup>(2)</sup> Fish Audio S2 Pro：Windows 執行採用未編譯的 eager 模式（約 65× RTF），原因是每個 token 的 76 次層評估產生 CUDA kernel 啟動延遲。建議在 Linux 或 WSL2 上搭配 OpenAI Triton 編譯器融合（`torch.compile`）運行，以避免這個派送停滯。

---

## 日文語音複製

### 日文基準提示詞

> *「そんな顔して……ほんとは私にやられたいんでしょ？ざぁこざぁこ～♡」*

### 日文效能與音訊比較

| 引擎 | Windows 原生<sup>(1)</sup><br/>（RTX 4070 Ti SUPER） | Linux 與 WSL2 | macOS<br/>（Apple Silicon） | 音訊樣本 |
|---|---|---|---|---|
| [IrodoriTTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/irodoritts/) | 約 4.0 秒 *（8.5 秒片段）*<br/>0.47× RTF | 未測試 | 未測試 | <audio controls preload="none" src="/audio/tts/irodori.wav"></audio> |

- <sup>(1)</sup> 在同一套 RTX 4070 Ti SUPER Windows 11 測試環境中測得。

---

## 你該選哪個引擎？

- 如果你想要最高的聲音保真度、細緻的表情方括號標籤（`[whisper]`、`[laughs]`、`[sigh]`），而且可以使用能啟用 Triton 編譯器融合的 Linux 或 WSL2，請選 [Fish Audio S2 Pro](/zh-TW/self-hosting/local-endpoints/text-to-speech/fishs2/)。
- 若要用小 VRAM 足跡做英文語音複製，請選 [Chatterbox（Turbo、Nano、Standard）](/zh-TW/self-hosting/local-endpoints/text-to-speech/chatterbox/)。Nano（約 3.0 秒，0.38× RTF）在 CPU 與 GPU 上提供最高速度，Turbo（約 5.0 秒，0.57× RTF）支援副語言事件標籤（`[laughter]`、`[sigh]`），而 Standard（約 6.0 秒，0.77× RTF）可啟用創意的 CFG 引導與情緒誇張調校。
- 若要做實驗性的多模態語音複製，以及以文字描述的英中文語音生成，請選 [MOSS-TTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/moss/)。
- 如果你需要高品質的多語言零樣本複製，並能用自然語言指示語氣（`"Speak in English with excitement"`），請選 [CosyVoice 3](/zh-TW/self-hosting/local-endpoints/text-to-speech/cosyvoice3/)。
- 如果你需要完整的多語言支援（30 種語言）、逐字稿輔助的 Ultimate Cloning 與自然的語音設計，請選 [VoxCPM2](/zh-TW/self-hosting/local-endpoints/text-to-speech/voxcpm2/)。
- 如果你想要乾淨的多語言複製、有彈性的語音設計與穩定的提示詞遵循度，請選 [Qwen3-TTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/qwen3tts/)。
- 如果你的 bot 說日文，請選 [IrodoriTTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/irodoritts/)。它是唯一受測的純日文引擎（Windows 上約 4 秒，0.47× RTF），並原生解析 Unicode 表情符號（`😊`、`😭`、`😠`）來調節角色情緒。

---

## 比較各引擎

TomoriBot 目前所有伺服器都回傳完整的 WAV 給 bot。「串流路徑」指的是上游模型或另外的服務後端具備串流能力，不代表 Discord 語音通話串流已經實作。大小是模型參數，不是 VRAM 或下載大小，而 16 GB 那一欄是設定指引，不是實測峰值。速度欄描述每個引擎預期的取捨；上面的實測時間來自同一台 Windows 機器，並不能用來在 Linux 上排名這些引擎。

「參考片段」欄列出的是各引擎在文件中記載、或在執行時套用的參考音訊長度，因此混雜了已發布的指引與從上游程式碼讀出的限制。大多數引擎不會拒絕請求，而是靜默裁切到自己的視窗，所以這一欄說的是引擎讀取的長度，而不只是引擎接受的長度。這是上游行為，不是在本頁測得的結果，也和 TomoriBot 的上傳上限無關。

| 引擎 | 模型大小；16 GB GPU | 語言 | 參考片段 | 語音來源與控制 | 速度與串流路徑 | 適合用來 |
|---|---|---|---|---|---|---|
| [Chatterbox](/zh-TW/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 350M Turbo（預設）、110M Nano 或 500M Standard；可以，Nano 能用 CPU | 英文 | 10 秒；更長的內容一旦超出提示的 10 秒窗就會被靜默忽略 | 參考語音複製、支援的事件標籤；標準模型提供 CFG 與誇張度 | 主打快速與小體積；包裝回傳完整 WAV | 小型的英文複製設定或 CPU 實驗 |
| [Qwen3-TTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 每種模式 1.7B；可以，模型會切換 | 10 種，含英文與日文 | 3 秒起；沒有文件記載的上限 | 複製或以文字描述的 VoiceDesign | 重視品質；上游可串流，包裝會緩衝 | 通用多語言複製與日文 VoiceDesign |
| [MOSS-TTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/moss/) | 4B 複製加上約 1.7B 設計，會切換；16 GB 是試用目標，未經驗證；8B 旗艦大概不行 | 複製：31 種，含日文；設計：英文與中文 | 上游未記載；執行時也沒有上限 | 複製或以文字描述的 VoiceGenerator；複製語言標籤 | 實驗性；本機複製有上游串流後端，包裝會緩衝 | 比較 MOSS 複製品質，或英中文語音設計 |
| [IrodoriTTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/irodoritts/) | 目前 v4.1 Small 約 0.8B；在一次本機執行中觀察到約 3 到 4 GB VRAM | 僅日文 | 約 30 秒；會依檢查點的 120 秒上限裁切 | 複製或 VoiceDesign；表情符號風格提示 | 取樣步數在品質與速度之間取捨；包裝會緩衝 | 小體積的日文語音與表情符號驅動的語氣 |
| [Fish S2 Pro](/zh-TW/self-hosting/local-endpoints/text-to-speech/fishs2/) | 4B；官方 BF16 預設（約 16 到 18 GB），可選 INT8 以塞進 16 GB | 上游聲稱 83 種 | 10 到 30 秒；執行時沒有上限 | 參考語音複製（需要參考逐字稿）、自由形式的方括號表情標籤 | 沉重的 Dual-AR 模型；快速合成需要帶 Triton 的 Linux 或 WSL2（Windows eager 模式約 65× RTF） | 細緻有表情的複製；請檢查研究授權條款 |
| [VoxCPM2](/zh-TW/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 2B；上游回報 BF16 約 8 GB | 30 種 | 5 到 30 秒；這是文件記載的範圍，執行時沒有上限 | 複製、語音設計、逐字稿輔助的 Ultimate Cloning、語氣指示 | 上游在 RTX 4090 上約 0.30 RTF；上游可串流，包裝會緩衝 | 單一多語言模型，具備最廣泛的語音來源控制 |
| [CosyVoice 3](/zh-TW/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | 核心 0.5B；16 GB 舒適，下載與執行時佔用更大 | 9 種，含日文，另有中文方言 | 3 到 30 秒；更長會被截到最前面的 30 秒 | 複製、跨語言複製、自然語言語氣 | 主打低延遲；上游原生支援文字與音訊串流，包裝會緩衝 | 具備跨語言複製的未來串流候選 |

模型大小與語言數量依 [Chatterbox](https://github.com/resemble-ai/chatterbox)、[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)、[MOSS](https://github.com/OpenMOSS/MOSS-TTS)、[Irodori](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small)、[Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro)、[VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) 與 [CosyVoice 3](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) 的上游頁面。各指南另有 OS、驅動程式、授權條款、模型修訂版與記憶體細節，請逐一查看。16 GB 的 GPU 不一定能同時容納一個 TTS 模型與一個大型本機 LLM。

Irodori 的 VRAM 數字是單次本機觀察，不是已發布的最低需求，也不是跨引擎的基準。記憶體用量會隨執行環境、精確度、腳本長度與其他 GPU 工作負載而異。

Qwen3-TTS 的第一次自動請求包含模型載入。MOSS 會在設定期間預先下載兩個模型，並在啟動時預設預熱複製模型，但兩個自動伺服器在切換模式之後仍然必須載入另一個模型。TomoriBot 為每個完整回應最多等待 `TTS_SYNTHESIZE_TIMEOUT_MS`（預設 240000 ms）。

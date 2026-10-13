---
title: "IrodoriTTS"
aiGenerated: true
---

使用 [Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS)，透過語音複製、基於字幕的VoiceDesign和富有表現力的表情符號標記產生自然的日語語音。

Irodori-TTS v4.1是一個專注於日語的文字轉語音模型，支援在單一檢查點內進行語音複製和文字描述的VoiceDesign。TomoriBot透過`servers/tts/irodoritts/`中的本地FastAPI包裝器連接到Irodori，預設為`Aratako/Irodori-TTS-v4.1-Small`。

可使用`IRODORI_TTS_MODEL_ID`選擇相容的擁抱臉部檢查點，包括`phasefield-audio/Irodori-TTS-v4.1-Anime`等社群微調。

## 設定

Irodori使用`uv`進行依賴項和PyTorch後端管理。伺服器維護自己的`pyproject.toml`，並固定Irodori和`dacvae`依賴項，以實現可重複安裝。首先安裝`uv`，然後從TomoriBot儲存庫根執行安裝腳本：

### Windows PowerShell (NVIDIA)

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash (NVIDIA)

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

安裝腳本創建`servers/tts/irodoritts/.venv`，因此`bun run launch --irodoritts`在安裝後繼續工作。

可用的後端：

- `cu128`：Windows與Linux上的NVIDIA CUDA 12.8
- `cpu`：僅CPU，或透過PyPI的macOS CPU/MPS
- `rocm`：Linux/WSL上的AMD ROCm
- `xpu`：Windows與Linux上的英特爾XPU

預設端點URL為`http://127.0.0.1:8013`。

## 使用不同的檢查點

預設型號為`Aratako/Irodori-TTS-v4.1-Small`。可透過環境變數配置相容的Hugging Face儲存庫、社群微調（例如`phasefield-audio/Irodori-TTS-v4.1-Anime`）或本機檢查點檔案。

當你啟動伺服器（直接使用Python或透過`bun run launch --irodoritts`）時，它會自動讀取儲存庫根`.env`（或`servers/tts/irodoritts/`中的本機`.env`）並在啟動時記錄活動模型ID。

### 通過`.env`（持續）

加入TomoriBot根目錄中的`.env`：

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### 透過每個會話的環境變量

在Windows PowerShell中：

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

在Linux Bash上：

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### 使用本地檢查點文件

如果你已在本機下載了檢查點檔案（`.pt`或`.safetensors`），請將`IRODORI_TTS_CHECKPOINT`設定為其路徑：

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

目前Irodori下載檢查點以及Hugging Face儲存庫中捆綁的任何標記器資產。當模型儲存庫提供Hugging Face子資料夾變體時，`IRODORI_TTS_MODEL_ID`也支援它們。

## 註冊TomoriBot

運行`/providers`，選擇`Add New Custom Endpoint`，並使用語音API相容性：

- API相容性：`tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

儲存連線後，選擇它並使用其模型下拉清單新增語音模型。對於v4.1，建議的設定是：

- `語音來源模式`: `自動`
- `腳本標記風格`: `表情符號`

`自動`讓同一個Irodori端點支援兩種TomoriBot語音模式，因此情緒線索在傳送過程中得以保留：

- 在人格 > `語音`下分配了語音樣本的人格發送儲存的參考剪輯以進行語音克隆。
- 在人格 > `語音`下設定了VoiceDesign提示的人格將儲存的自然語言提示作為Irodori字幕條件發送。

如果你只需要參考音訊語音克隆，你仍然可以選擇`語音複製`作為語音來源模式。

使用`/providers`進行端點註冊和模型設定。然後開啟`/config` > `模型` > 切換型號選擇並啟動已註冊的端點。

## 設定人格聲音

### 語音克隆

1. 準備一個乾淨的日文語音片段，只有一個揚聲器，沒有背景音樂。大約30秒就已經足夠了：超過這個時間點，額外的音訊就幾乎無法帶來音色保真度，同時會消耗上傳大小和推理時間。
2. 在模型 > `TTS參數與語音`下開啟`/config`並上傳剪輯。
3. 在人格 > `語音`下開啟`/config`，然後選擇人格和語音樣本。

Irodori v4.1支援比早期型號更長的參考調節，但乾淨的來源音訊仍然比原始持續時間更重要。

v4.1運作時將參考剪輯限制在檢查點預設值，v4.1檢查點將其設定為120秒。任何更長的內容都會被修剪到該上限而不是被拒絕，並且`IRODORI_MAX_REF_SECONDS`會覆蓋它。因此，TomoriBot 130秒上傳上限的剪輯仍然有效：Irodori條件位於其前120秒。

較長的剪輯不會提升語音品質。Upstream報告稱，大約30秒的乾淨參考語音已經捕獲了大部分可測量的說話者相似度增益，並且來自同一說話者的多個較短剪輯擊敗了一個長錄音。較長剪輯附帶的額外參考潛在步驟也會延長每個合成請求。僅當說話者的音色在錄音中出現漂移時才達到30秒以上。

### 聲音設計

1. 在人格 > `語音`下開啟`/config`。
2. 選擇人格人格。
3. 輸入所需語音和交付的自然語言描述。

TomoriBot發送此提示為`instruct`； Irodori包裝器將其對應到v4.1 `caption`條件。VoiceDesign請求不需要儲存的參考剪輯。

在將文字傳送到TTS之前，TomoriBot會剝離Discord自訂表情符號語法。對於`script_markup: emoji`，Unicode表情符號被保留用於Irodori的文字調節。

### 表情符號風格控件

IrodoriTTS支援輸入文字中的表情符號註釋，以影響聲音效果、說話風格和情緒表達。將TomoriBot的`腳本標記風格`設定為`表情符號`後，這些Unicode表情符號將會保留並傳送到Irodori。

| 表情符號 | 意義/情感/風格 |
| --- | --- |
| 👂 | 耳語，聲音靠近耳朵 |
| 😮‍💨 | 呼吸、嘆息、睡眠呼吸 |
| ⏸️ | 暫停、沉默 |
| 🤭 | 輕笑、咯咯笑、壓抑的笑聲 |
| 🥵 | 氣喘吁籲、呻吟、呻吟 |
| 📢 | 迴聲、混響 |
| 😏 | 戲弄、俏皮的甜蜜/哄騙 |
| 🥺 | 聲音顫抖，膽怯/不確定 |
| 🌬️ | 呼吸急促、呼吸沉重 |
| 😮 | 喘氣 |
| 👅 | 舔聲、咀嚼聲、濕聲 |
| 💋 | 咂嘴/嘴唇噪音 |
| 🫶 | 輕輕地、溫柔地 |
| 😭 | 抽泣、哭泣、悲傷/悲傷 |
| 😱 | 尖叫、喊叫、尖叫 |
| 😪 | 困倦地，遲緩地/無精打采地 |
| 😴 | 說夢話、打呼嚕 |
| ⏩ | 語速快、動作快、動作快 |
| 📞 | 透過電話、透過揚聲器 |
| 🐢 | 慢慢地 |
| 🥤 | 吞嚥聲、吞嚥聲 |
| 🤧 | 咳嗽、抽鼻子、打噴嚏、清喉嚨 |
| 😒 | 吐舌頭、咔嚓咔嚓 |
| 😰 | 驚慌、煩躁、緊張、口吃 |
| 😆 | 高興地、高興地 |
| 💥 | 用力/動量，用力 |
| 😠 | 生氣、不高興、生悶氣 |
| 😲 | 驚訝、敬畏/感嘆 |
| 🥱 | 打哈欠 |
| 😖 | 痛苦地、痛苦地 |
| 😟 | 焦急地、擔心地 |
| 🫣 | 害羞的，害羞的 |
| 🙄 | 氣憤的翻白眼 |
| 😊 | 高興地、高興地 |
| 😎 | 自信地、自豪地 |
| 👌 | 反向頻道，一致的聲音 |
| 🙏 | 苦苦哀求、苦苦哀求 |
| 🥴 | 醉酒 |
| 🎵 | 嗡嗡聲 |
| 🤐 | 悶悶不樂（摀住嘴） |
| 😌 | 心曠神怡、心滿意足 |
| 🤔 | 疑問的聲音，疑惑的聲音 |
| 💪 | 憑藉努力、堅強 |
| 👃 | 嗅聞/聞氣味的聲音 |
| 📖 | 旁白、獨白 |

重複相同的表情符號可以增強其效果。表情符號控制並不完全一致，因此將它們視為風格提示而不是保證輸出。有關上游清單和未來更新，請參閱[官方IrodoriTTS表情符號註釋](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md)。

## 長語音留言

Irodori v4.1使用其持續時間預測器來預測輸出長度，而不是產生固定長度的剪輯，因此伺服器不會強加自己的每個話語持續時間上限。TomoriBot在合成之前仍然對長文字進行分塊，並將產生的音訊連接成一個WAV回應，因此Discord收到一條語音訊息；分塊使每個推理過程都很短，這就是限制延遲的原因。

實作從[官方Irodori OpenAI相容伺服器](https://github.com/Aratako/Irodori-TTS-Server/blob/main/src/irodori_openai_tts/app.py) 使用的分塊方法開始，其預設啟用80個非空白字元的分塊。TomoriBot增加了更嚴格的邊界處理，因此結束引號和括號與它們結束的標點符號保持一致，諸如`！？`和`...`之類的標點符號保持在一起，數字旁邊的小數點不會拆分，並且非常短的最終尾部會合併回前一個區塊中。

一旦達到配置的最小長度，分塊更喜歡強句子結尾，例如`。`、`！`、`？`、`.`、`!`、`?`、省略號和換行符。只有當區塊增長到閾值的1.5倍左右時，逗號才用作後備邊界。使用預設的`IRODORI_CHUNK_MIN_CHARS=80`，強邊界在80個非空白字元和大約120個非空白字元處變得合格。如果長段落不包含合格的標點符號，它仍然可以保留為單一合成請求。

對於僅包含字幕的VoiceDesign，第一個區塊產生的Irodori種子將重新用於其餘區塊，以減少接縫之間的隨機變化。重複使用種子並不能保證獨立合成的塊之間具有相同的音色。參考音訊模式繼續將相同的參考剪輯應用於每個區塊。

長輸入需要多次順序推理，並且在較慢的硬體上可能需要更長的時間。TomoriBot的預設TTS使用者端逾時時間為240秒。你可以使用`IRODORI_CHUNKING_ENABLED=false`停用分塊，或使用`IRODORI_CHUNK_MIN_CHARS`調整近似分割閾值。

## 透過搖擺採樣加快推理速度

預設值仍然是Irodori的更高品質40步線性取樣。為了降低延遲，請嘗試使用較少的步驟進行Sway取樣：

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

這是推理品質和速度的權衡，因此在將其永久化之前，請使用你選擇的檢查點和聲音進行測試。

## 環境變數

| 多變的 | 預設 | 目的 |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Hugging Face模型儲存庫或支援的儲存庫/子資料夾來源 |
| `IRODORI_TTS_CHECKPOINT` | 未設定 | 選用本地`.pt`或`.safetensors`檢查點；覆蓋擁抱臉模型 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 伺服器綁定位址；請參閱[網路接入](/zh-TW/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | 伺服器連接埠 |
| `IRODORI_MODEL_DEVICE` | `auto` | 型號設備（`auto`、`cuda`、`cpu`、`mps`、`xpu`） |
| `IRODORI_CODEC_DEVICE` | `auto` | 編解碼器設備 |
| `IRODORI_MODEL_PRECISION` | CUDA上為`bf16`，否則為`fp32` | 模型精度 |
| `IRODORI_CODEC_PRECISION` | `fp32` | 編解碼精度 |
| `IRODORI_COMPILE_MODEL` | `false` | 為Irodori模型啟用`torch.compile` |
| `IRODORI_COMPILE_DYNAMIC` | `false` | 編譯時啟用動態形狀 |
| `IRODORI_NUM_STEPS` | `40` | 歐拉採樣步驟 |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | 抽樣時間表（`linear`或`sway`） |
| `IRODORI_SWAY_COEFF` | `-1.0` | 使用`sway`時間表時的搖擺係數 |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | 文字引導量表 |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | 標題/語音設計指導量表 |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | 參考說話者指導量表 |
| `IRODORI_MAX_REF_SECONDS` | 檢查點預設值 | 參考音訊持續時間的可選上限 |
| `IRODORI_CHUNKING_ENABLED` | `true` | 在符合條件的標點符號邊界處分割長文本並連接產生的區塊 |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | 強句子邊界分割前最少的非空白字元；逗號是後備邊界，約為該值的1.5倍 |

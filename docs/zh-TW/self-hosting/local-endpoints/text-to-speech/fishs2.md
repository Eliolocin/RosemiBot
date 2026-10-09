---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

使用 [Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech) 合成極具表現力的多語言角色語音和細粒度的情感標籤。

Fish Audio S2 Pro是多語言4B參數文字轉語音模型，專為高傳真語音複製而建置。TomoriBot透過`servers/tts/fishs2/`中的本地包裝器連接到模型。它預設為官方BF16權重 (`fishaudio/s2-pro`)，並為具有8至12 GB VRAM的GPU提供可選的INT8量化檢查點 (`Imagilux/fishaudio-s2-pro`)。

Fish S2 Pro支援`[whisper]`、`[excited]`、`[angry]`等括號表達式標籤。使用`方括號標籤`標記配置端點，以便TomoriBot在產生的語音腳本中保留這些控制項。

## 授權條款

Fish Speech的程式碼與S2 Pro模型權重依Fish Audio Research License散布。依其條款允許研究與非商業使用；商業使用需要另外取得Fish Audio授權。

TomoriBot不重新散布模型權重。每位自架使用者都直接從Hugging Face下載Fish S2 Pro，並自行負責遵守Fish Audio Research License。必要的標示是：Built with Fish Audio。

## 硬體和作業系統

> [！重要的]
> Fish Audio正式針對Linux和WSL2。Fish S2 Pro使用双自回归 (Dual-AR) 架构（36个慢速变压器层 + 10个快速码本通道 = 每个令牌76层评估）。在Linux上，OpenAI Triton将此循环编译为融合GPU内核 (`torch.compile(backend="inductor")`)，从而实现实时综合。包装器默认关闭编译；设置`FISH_S2_COMPILE=1`来启用它。>
> 在本機Windows上，Triton不受支持，迫使PyTorch進入未編譯的eager模式，透過Windows WDDM驅動程式調度超過120,000個順序CUDA核心。這會導致嚴重的調度停滯，將完全相同的剪輯的生成速度減慢至約8-10分鐘（每秒音訊計算約65秒）。為了進行可用的推理，請在Linux或WSL2中執行Fish S2 Pro。

推薦硬體：

- **Linux或WSL2（強烈建議）**
- 具有16 GB至24 GB VRAM的NVIDIA GPU（BF16可以輕鬆適應 ~16-18 GB VRAM，具有KV快取和卸載）
- 推薦使用Python 3.12
- `git`、`ffmpeg`以及Fish Speech所需的標準音訊庫

## 設定

### Linux和WSL2（建議）

從TomoriBot儲存庫根目錄：

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

安裝程式：

1. 將`Imagilux/fish-speech`克隆到`servers/tts/fishs2/fish-speech/`並檢查固定的運行時提交；
2. 建立隔離的`.venv`；
3. 安裝Fish Speech以及TomoriBot包裝器相依性；和
4. 將官方BF16 `fishaudio/s2-pro`檢查點下載到`fish-speech/checkpoints/fish-speech-s2-pro/`中。

正常的重新安裝保留在固定的運行時提交`2225e924e7d35cc0a1d24dbc67cd1819e6cf429f`上，而不是跟隨移動分支；遷移到較新的運行時意味著更改安裝程序中的該引腳。型號修訂預設為`main`；當部署必須可重現時，將`FISH_S2_MODEL_REVISION`固定到不可變的Hugging Face修訂版。安裝程式設定列在[安裝程式變數](#installer-variables) 下。

擁抱臉模型是門控的。首先接受Hugging Face的許可。如果下載要求身份驗證，請執行：

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

然後重新運行安裝程式。

### Windows PowerShell（僅限盡力而為）

本機Windows僅供評估使用。由於未編譯的eager模式下的驅動程式調度延遲，生成速度將非常緩慢（每個剪輯約8-10分鐘）：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

預設情況下，PowerShell安裝程式以CUDA GPU加速 (`cu124`) 為目標。若要在沒有NVIDIA GPU的僅CPU電腦上安裝，請傳送`-Cpu`：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

如果Windows上的PyTorch需要手動安裝或更新CUDA支持，請執行：

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot在`TTS_SYNTHESIZE_TIMEOUT_MS`（預設240000毫秒）後停止等待語音訊息，該時間比本機Windows剪輯所需的時間短。在Windows上進行評估時，在TomoriBot的`.env`（例如`TTS_SYNTHESIZE_TIMEOUT_MS=900000`）中提高它。

## 強制性參考成績單

> [！警告]
> 語音克隆需要參考文字（`ref_text`）； Fish S2 Pro的交叉注意力機制需要參考音訊的轉錄來將語音標記與聲學程式碼對齊。>
> 如果你上傳語音樣本而不提供其匹配的參考轉錄本，Fish Speech會默默地丟棄參考音訊標記並回退到隨機零參考語音。TomoriBot Fish包裝器使用`400 Bad Request`驗證並拒絕缺少參考文本的合成請求，以防止意外的無條件生成。

在`Models > `TTS參數與語音``, always fill in the `Reference script`欄位下的`/config`中新增人格語音時，使用參考音訊剪輯中逐字記錄的文字。

## 在TomoriBot中註冊

在`/providers`中選擇`新增自訂端點`，並設定：

- Capability：`Speech`
- API Compatibility：`tts-clone`
- Endpoint URL：`http://127.0.0.1:8015`
- 語音來源模式：`Clone`
- Script Markup：`方括號標籤`
- API key：留空。包裝沒有驗證機制，請參閱[網路存取](/zh-TW/self-hosting/local-endpoints/text-to-speech/#network-access)。

接著加入該端點的模型項目，並透過`/config`的模型 > 切換模型啟用它。

## 加入人格語音

1. 準備一段乾淨、10到20秒、只有一位說話者且背景噪音很少或沒有的參考片段。
2. 在`/config`中開啟模型 > TTS參數與語音並上傳語音樣本。
3. 輸入確切的逐字稿，也就是參考片段中所說的文字，放進參考文字欄位。
4. 在`/config`中開啟人格 > 語音，並將樣本指派給人格。
5. 用`/generate voice-message`生成語音訊息，或讓TomoriBot透過它的語音訊息工具生成。

上游說明，通常可用10到30秒的參考樣本進行準確複製。Fish S2 Pro本身的執行環境不設參考音訊長度上限，因此較長的片段會被接受而不是被裁剪，但文件所述的複製品質來自10到30秒這個範圍。

## 表情控制

Fish S2 Pro可以用方括號標籤在同一段語句中改變語氣。例如：

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

因為端點使用`方括號標籤`標記，TomoriBot會保留這些標籤，而不是在合成前移除它們。

## 設定

| 變數 | 預設 | 用途 |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | S2 Pro檢查點目錄 |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 已設定檢查點的模型repository與健康狀態中繼資料標籤 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 包裝綁定位址; 請參閱[網路存取](/zh-TW/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `FISH_S2_PORT` | `8015` | Fish包裝連接埠 |
| `FISH_S2_UPSTREAM_PORT` | `8025` | 內部Fish API連接埠 |
| `FISH_S2_COMPILE` | `0` | 啟用Fish Speech的`torch.compile`（需要帶Triton的Linux或WSL2） |
| `FISH_S2_HALF` | `0` | 要求FP16執行階段模式 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Fish迭代提示詞的區塊長度 |
| `FISH_S2_TOP_P` | `0.8` | 取樣的top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | 取樣溫度 |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | 重複懲罰 |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | 每個請求生成的語意token上限 |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | 在Fish執行環境中快取編碼後的參考語音 |

### 安裝程式變數

由`install-fishs2.sh`與`install-fishs2.ps1`讀取。請記錄你覆寫的任何值，讓部署可以重現。

| 變數 | 預設 | 用途 |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 要下載的Hugging Face repository |
| `FISH_S2_MODEL_REVISION` | `main` | 要下載的Hugging Face修訂版 |

參考音訊必須是非空、未壓縮、解碼後不超過10 MB的PCM RIFF或WAVE檔。這個上限會在推論之前檢查，以避免過大的base64請求耗用無上限的記憶體；以TomoriBot傳送的22.05 kHz單聲道WAV來說，約可容納237秒。

## 低VRAM選項（INT8量化）

在具有受限VRAM（例如8-12 GB）的GPU上運行且無法滿足官方BF16檢查點的使用者可以選擇使用INT8量化模型 (`Imagilux/fishaudio-s2-pro`)。

要安裝並執行INT8檢查點：

```bash
# In Linux / WSL2:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# In Windows PowerShell:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

從相同shell啟動`server.py`，或在啟動之前設定相同的三個變量，以便包裝器載入INT8目錄而不是預設的BF16目錄。

INT8檢查點將變壓器重量從約10.3 GB減少到約5.1 GB，同時將音訊嵌入和編解碼器層保留在BF16中，適合約10 GB的總VRAM。

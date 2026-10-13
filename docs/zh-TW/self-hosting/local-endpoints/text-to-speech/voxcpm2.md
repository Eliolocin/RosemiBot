---
title: "VoxCPM2"
aiGenerated: true
---

使用OpenBMB的 [VoxCPM2](https://github.com/OpenBMB/VoxCPM) 文字轉語音模型合成跨30種語言的富有表現力的48 kHz語音。

VoxCPM2是一個2B參數多語言語音模型，支援語音克隆、轉錄輔助終極克隆和自然語言語音設計。TomoriBot透過`servers/tts/voxcpm2/`中的伺服器連接到官方`voxcpm` Python函式庫，在16 GB VRAM內輕鬆運行官方未量化的`openbmb/VoxCPM2` BF16檢查點。

## 授權條款

VoxCPM2的程式碼與模型權重依Apache-2.0發布，包含商業使用，但受授權條款約束。TomoriBot不重新散布權重；安裝程式會從官方Hugging Face repository下載它們。

官方上游資源：

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [openbmb/VoxCPM2 on Hugging Face](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPM documentation](https://voxcpm.readthedocs.io/)

## 支援的語言

VoxCPM2官方支援30種語言，不需要語言標記：

阿拉伯文、緬甸文、中文、丹麥文、荷蘭文、英文、芬蘭文、法文、德文、希臘文、希伯來文、印地文、印尼文、義大利文、日文、高棉文、韓文、寮文、馬來文、挪威文、波蘭文、葡萄牙文、俄文、西班牙文、史瓦希里文、瑞典文、他加祿文、泰文、土耳其文與越南文。

OpenBMB另外記載了數種中文方言。TomoriBot仍然可能為了與通用的TTS契約相容而送出`language`欄位，但VoxCPM2會從合成文字偵測語言，包裝不會強制加上語言標記。

## 語音模式

單一VoxCPM2端點就能處理所有實用的TomoriBot語音來源模式：

| TomoriBot請求 | VoxCPM2行為 |
|---|---|
| 只有`text` | 拒絕；請選擇參考樣本或VoiceDesign提示詞 |
| `text`加`instruct` | 依自然語言描述進行語音設計 |
| `text`加`ref_audio` | 參考音訊語音複製 |
| `text`加`ref_audio`加`instruct` | 可控複製：保留說話者，同時引導語氣 |
| `text`加`ref_audio`加`ref_text` | 使用參考音訊與其逐字稿的Ultimate Cloning |
| `text`加`ref_audio`加`ref_text`加`instruct` | 可控複製；單次指示優先，逐字稿不會送出 |

VoxCPM2以在要合成的文字前面加上括號包住的自然語言描述，來表現語音設計與風格控制。TomoriBot已經有為此用途設計的`instruct`欄位，所以包裝會自動完成那個轉換。

請使用`純文字`腳本標記風格。VoxCPM2不需要TomoriBot保留方括號標籤或表情符號控制語法，也不需要新的腳本標記模式。

## 硬體與執行環境

建議起點：

- Python 3.10到3.12
- 官方BF16執行環境需要具備8 GB VRAM以上的NVIDIA GPU；12到16 GB有舒適的餘裕
- 目前的NVIDIA驅動程式，以及支援CUDA的PyTorch建置以進行GPU加速
- 支援CPU作為備援，但明顯較慢

官方套件也提供CPU與Apple MPS裝置選擇。在Windows上的TomoriBot，標準Python套件可以原生運行；不需要WSL。Windows PowerShell安裝程式預設安裝支援CUDA的PyTorch建置（`cu124`）。

若要在純CPU機器上明確安裝，請傳入`-Cpu`參數：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

如果你原生Windows的PyTorch安裝需要手動重裝或重新對齊驅動程式，請直接將支援CUDA的PyTorch建置安裝進伺服器的虛擬環境：

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

OpenBMB回報標準執行環境在RTX 4090上約為0.30 RTF。上游也支援串流生成，並記載更快的Nano-vLLM與vLLM-Omni服務選項。TomoriBot目前的`POST /synthesize`契約回傳單一WAV回應，所以這個伺服器刻意緩衝生成的語句，而不是另外提供串流協定。

## 安裝

伺服器固定目前穩定的`voxcpm` 2.0.3套件並將`openbmb/VoxCPM2`下載到正常的Hugging Face快取中。

### Linux和WSL Bash

從TomoriBot儲存庫根目錄：

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

從TomoriBot儲存庫根目錄：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

第一個設定會下載幾GB的模型權重。要安裝Python環境而不預先取模型，請設定`VOXCPM2_PREFETCH=0`；然後，官方程式庫將在第一次伺服器啟動時下載檢查點。

Linux與WSL：

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

電源外殼：

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

設定完成後，`bun run launch --voxcpm2`與TomoriBot一起啟動伺服器。預設端點是`http://127.0.0.1:8016`。

## 在TomoriBot中註冊

執行`/providers`，選擇`新增自訂端點`，並設定Speech端點：

- Capability：`Speech`
- API Compatibility：`tts-clone`
- Endpoint URL：`http://127.0.0.1:8016`
- 語音來源模式：`Auto`
- Script Markup：`Plain`
- Supports Instruct：`Yes`

儲存連線之後，選取它並用它的模型下拉選單加入一個Speech模型。接著開啟`/config` > 模型 > `切換模型`，選取VoxCPM2語音模型。

建議使用`Auto`，因為同一台伺服器同時支援參考音訊複製與語音設計。兩種模式不需要各自獨立的VoxCPM2行程。

## 人格語音複製

用於應該複製既有說話者的人格：

1. 準備一段乾淨、只有一位說話者且背景音樂很少或沒有的參考片段。上游把5到30秒視為實用範圍。
2. 開啟`/config`，在模型 > TTS參數與語音底下上傳該片段。
3. 在可以取得時加入參考片段的確切逐字稿。VoxCPM2會用它做Ultimate Cloning，並能重現更多參考的節奏、情緒與風格。
4. 開啟`/config`，在人格 > 語音底下選擇人格並指派已儲存的樣本。

如果沒有儲存逐字稿，VoxCPM2仍然會進行一般的參考音訊複製。

5到30秒這個數字是經過記載的品質範圍，而不是強制上限：VoxCPM2本身不施加任何參考音訊長度限制，所以真正擋下更長片段的是TomoriBot的上傳上限。

## 人格聲音設計

對於應該根據書面語音描述而不是樣本創建的人格：

1. 在人格 > `語音`下開啟`/config`並選擇VoiceDesign。
2. 選擇人格人格。
3. 輸入自然語言描述，例如`Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`。

TomoriBot將已儲存的描述傳送為`instruct`。VoxCPM2將其轉換為其原生語音設計控制前綴。

當克隆人格也收到一次性語音指令時，VoxCPM2使用可控克隆：參考樣本提供說話者身份，而指令則控制情緒、節奏或表達等品質。如果也儲存了轉錄本，則該指令優先，因為上游終極克隆路徑不提供可靠的控制指令模式；對於該請求，故意省略了文字記錄。

## 使用`/generate voice-message`進行測試

一旦VoxCPM2成為活動語音模型，`/generate voice-message`就會以與正常語音訊息工具呼叫相同的方式使用人格的設定語音來源：

- 克隆人格發送儲存的`ref_audio`和可選的`ref_text`；
- VoiceDesign人格將其儲存的提示傳送為`instruct`；
- 啟用支援指令的具有克隆能力的端點公開傳送方向欄位並透過`instruct`傳遞一次性指令；
- 當指令與克隆樣本一起存在時，TomoriBot僅使用`reference_wav_path`並且不發送腳本提示欄位。

## 環境變數

| 變數 | 預設 | 用途 |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | Hugging Face模型ID或本機模型目錄 |
| `VOXCPM2_DEVICE` | `auto` | 執行階段裝置：`auto`、`cuda`、`cuda:N`、`cpu`或`mps` |
| `VOXCPM2_OPTIMIZE` | `1` | 啟用官方執行環境的最佳化與編譯路徑 |
| `VOXCPM2_LOAD_DENOISER` | `0` | 載入選用的上游去噪器；預設停用以節省記憶體 |
| `VOXCPM2_CFG_VALUE` | `2.0` | 引導強度 |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | Flow-matching推論步數；更多步可以提升品質，代價是速度 |
| `VOXCPM2_MAX_LEN` | `4096` | 生成長度上限 |
| `VOXCPM2_NORMALIZE` | `0` | 啟用上游文字正規化 |
| `VOXCPM2_RETRY_BADCASE` | `1` | 為異常生成啟用上游重試行為 |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | 自動重試次數上限 |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | 上游的壞例長度門檻 |
| `VOXCPM2_PREFETCH` | `1` | 僅安裝程式：設定時下載模型 |
| `VOXCPM2_PORT` | `8016` | VoxCPM2本機伺服器連接埠 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 本機伺服器綁定位址; 請參閱[網路存取](/zh-TW/self-hosting/local-endpoints/text-to-speech/#network-access) |

參考音訊必須是解碼後不超過10 MB的非空WAV容器，包裝會在寫入暫存檔之前檢查這一點。

## 替代檢查點與執行環境

官方BF16模型已經能塞進預期的16 GB消費級GPU目標，所以TomoriBot不以量化檢查點為預設。社群量化版本是存在的，但它們多了一層相容性與維護負擔，對正常設定而言並不必要。

對高吞吐量的部署，OpenBMB目前指向Nano-vLLM-VoxCPM與vLLM-Omni作為加速的服務選項。那些執行環境可以提供超出這個參考伺服器的串流與並行服務功能。它們不是TomoriBot一般本機語音訊息流程的必要條件，而這個包裝刻意留在官方`voxcpm` API上，讓上游的模型升級容易跟上。

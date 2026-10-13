---
title: "CosyVoice 3"
aiGenerated: true
---

使用阿里巴巴的 [CosyVoice 3](https://github.com/QwenAudio/CosyVoice)，透過基於指令的情感傳遞來合成自然的多語言角色聲音。

CosyVoice 3提供跨9種語言和超過18種中國方言的零樣本、跨語言語音克隆。TomoriBot將官方運行時包裝在`servers/tts/cosyvoice3/`中，以公開標準`POST /synthesize`語音介面。捆綁的安裝程式預設為官方未量化的`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`模型，在16 GB VRAM內運行。

## 它支援什麼

目前的CosyVoice 3版本支援：

- 中文、英文、日文、韓文、德文、西班牙文、法文、義大利文、俄文
- 18+中國方言和口音
- 零樣本語音克隆
- 多語言和跨語言語音克隆
- 針對語言、方言、情緒、語速和音量的自然語言指令
- 上游運轉時中的細粒度控制，包括`[breath]`和`[laughter]`
- 上游運轉時中的文字輸入與音訊輸出流

官方的CosyVoice 3範例包括一個日文警告：日文文字在轉換為片假名後顯示。日語是受支援的語言，但如果正常的日語正字法發音不佳，則將合成文字轉換為片假名是上游推薦的解決方法。

## TomoriBot如何對應請求

包裝器接受標準`tts-clone`欄位：

- `text`
- `ref_audio`
- `ref_text`
- `instruct`
- `language`

它將請求路由到CosyVoice 3個推理函數，如下所示：

| 要求 | CosyVoice 3路 |
|---|---|
| 參考音訊+文字記錄 | `inference_zero_shot` |
| 沒有文字記錄的參考音頻 | `inference_cross_lingual` |
| `instruct`或顯式`language` | `inference_instruct2` |

為了獲得最佳克隆質量，請提供參考音訊及其匹配的轉錄本。CosyVoice 3的目前指令API以參考音訊為條件，不接受參考記錄，因此包含`instruct`的請求切換到官方`inference_instruct2`路徑。

### 風格與情緒控制

使用`純文字`標記註冊端點。傳送方向屬於端點的全域`voice_instructions`欄位。避免使用任意的內嵌括號標籤，因為它們有指令矛盾的風險，例如`[happy] Hello. [sad] Goodbye.`。本機`[breath]`和`[laughter]`標籤被推遲，直到TomoriBot支援特定於引擎的標籤發現。

`/synthesize` `instruct`欄位被傳遞到CosyVoice 3的指令調節。例如`sound relieved but still tired`、`speak as quickly as possible`或`speak quietly with restrained excitement`。

## 串流

CosyVoice 3支援雙向流上行。上游基準測試報告，在最佳化設定中，文字輸入和音訊輸出流的初始音訊延遲約為150毫秒。

TomoriBot的語音介面期望Discord語音訊息有一個完整的音訊回應，因此包裝器會傳回完整的WAV文件，並預設上游推斷為`stream=False`。僅當直接對上游流行為進行基準測試時才設定`COSYVOICE3_UPSTREAM_STREAM=1`；它不會改變TomoriBot延遲。

## 硬體

推薦硬體：

- 具有16 GB VRAM的NVIDIA GPU
- Python 3.10
- 與CUDA 12相容的NVIDIA驅動程式
- `git`
- `ffmpeg`用於語音樣本標準化
- Linux上的`sox`和`libsox-dev`如果出現音訊相容性問題

0.5B參數模型無需量化即可輕鬆裝入16 GB VRAM。檢查點下載包含流模型、語音標記器、文字模型和強化學習權重，需要大約10 GB的磁碟空間以及Python依賴項。

雖然上游在技術上支援CPU推理，但對於Discord語音互動來說速度太慢。

## 安裝

### Linux和WSL2（建議）

從TomoriBot儲存庫根目錄：

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

或是一起啟動配置好的伺服器和TomoriBot：

```bash
bun run launch --cosyvoice3
```

安裝程式：

1. 簽出`QwenAudio/CosyVoice`，將`074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc`遞歸提交到`servers/tts/cosyvoice3/CosyVoice/`；
2. 創建`servers/tts/cosyvoice3/.venv`；
3. 安裝上游CosyVoice要求和包裝器依賴；和
4. 將Hugging Face版本`29e01c4e8d000f4bcd70751be16fa94bf3d85a18`中的`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`下載為`CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B/`。

重新運行腳本會保留這些固定的修訂。安裝程式拒絕使用未提交的本機變更覆蓋簽出。

上游要求安裝PyTorch 2.3.1和CUDA 12.1軟體包、Linux上的CUDA 12 ONNX執行時間軟體包以及Linux上的TensorRT 10.13軟體包。如果你的GPU需要更新的PyTorch版本，請在安裝完成後在虛擬環境中安裝相容的PyTorch版本。

### Windows PowerShell

本機Windows作為盡力而為的路徑提供：

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

強烈建議在Windows上使用NVIDIA GPU使用WSL2。上游要求在Windows上安裝僅包含CPU的ONNX執行時間，而Linux和WSL2安裝GPU加速套件。

## 在TomoriBot中註冊

執行`/providers`，選擇`新增自訂端點`，並設定語音端點：

- Capability：`Speech`
- API Compatibility：`tts-clone`
- Endpoint URL：`http://127.0.0.1:8017`
- 語音來源模式：`Clone`
- Script Markup：`Plain`
- Supports Instruct：`Yes`

儲存連線之後，選取它並加入一個Speech模型。清楚的模型代號是`Fun-CosyVoice3-0.5B-2512`。

接著開啟`/config` > 模型 > `切換模型`，啟用CosyVoice 3語音端點。

## 指派人格語音

對於零樣本語音克隆：

1. 準備一個乾淨的3到30秒音訊剪輯，其中包含一個揚聲器和最小的背景噪音。
2. 在模型 > `TTS參數與語音`下開啟`/config`並上傳範例。
3. 输入匹配的成绩单（如果有）。CosyVoice 3將該轉錄本標記為零樣本克隆的提示前綴；它應該描述音訊的前30秒。
4. 在人格 > `語音`下開啟`/config`並將樣本指派給人格。

CosyVoice強制執行30秒的提示視窗。當音訊超過30秒時，上游引擎會引發錯誤，而TomoriBot的包裝器會自動將剪輯修剪到前30秒，並將修剪結果記錄到控制台。

說話者嵌入和提示語音標記是從開頭30秒開始計算的，因此長度超過30秒的剪輯不會添加語音細節。在10到20秒之間使用乾淨的夾子可確保準確的提示對準。

支援跨語言克隆：參考說話者可以說與生成的文本不同的語言。如果未提供參考記錄，包裝器會將請求路由至CosyVoice 3的專用跨語言引擎路徑。

## 用`/generate voice-message`測試

使用`/generate voice-message`測試綜合，無需等待自動聊天觸發。你可以使用人格分配的樣本進行測試，或上傳包含其轉錄內容的一次性剪輯。

若要引導情感和表達，請在模式中輸入方向或讓人格提示提供`voice_instructions`。保持口語文字為簡單對話；內嵌樣式標籤在合成之前被刪除。

## 環境變數

| 多變的 | 預設 | 目的 |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | 本地檢查點目錄 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 包裝器綁定位址；請參閱[網路接入](/zh-TW/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | 包裝埠 |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | 啟用CosyVoice的內部流發生器 |
| `COSYVOICE3_SPEED` | `1.0` | 全局數字速度乘數傳遞給上游推理 |
| `COSYVOICE3_DEFAULT_INSTRUCT` | 空的 | 當請求未提供可選說明時添加 |
| `COSYVOICE3_FP16` | `0` | 要求官方運行時使用其fp16模式 |
| `COSYVOICE3_LOAD_TRT` | `0` | 正確準備後啟用上游TensorRT加載 |
| `COSYVOICE3_LOAD_VLLM` | `0` | 安裝單獨的依賴項時啟用上游vLLM加載 |

預設情況下，TensorRT、vLLM和fp16會保持停用狀態。標準PyTorch運行時可以在16 GB GPU上輕鬆運行，無需額外的運行時依賴。

## 效能與模型變體

### 預設：base `Fun-CosyVoice3-0.5B-2512`

這是TomoriBot的建議預設值。它提供了很高的说话人相似度，支持所有CosyVoice 3克隆和指令模式，并且不需要在16 GB GPU上进行量化。

### 強化學習權重

檢查點包包括`llm.rl.pt`和基本重量。強化學習權重降低了內容錯誤率，而基本權重在說話者相似性基準測試中得分稍高。由於人格語音保真度優先，因此包裝器預設為`llm.pt`。

上游載入程式期望`llm.pt`。若要在不修改預設檔案的情況下測試RL權重，請複製模型目錄，在副本中將`llm.rl.pt`重新命名為`llm.pt`，並將`COSYVOICE3_MODEL_DIR`設定為複製的資料夾。

### vLLM與TensorRT

CosyVoice 3支援可選的vLLM和TensorRT運行時。上游記錄了具有V1引擎的vLLM 0.11.x+ 和舊版vLLM 0.9.0。由於這些程式庫引入了嚴格的CUDA和依賴版本要求，因此TomoriBot預設不會安裝它們。

## 授權條款

CosyVoice程式碼庫和`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`權重在Apache-2.0授權下發布。

上游模型卡註明演示材料用於學術評估。TomoriBot不分配模型權重。在進行商業部署之前，請查看特定用例的上游許可和條款。

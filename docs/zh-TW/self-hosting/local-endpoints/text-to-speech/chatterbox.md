---
title: "Chatterbox TTS"
aiGenerated: true
---

使用本地 [Chatterbox](https://github.com/resemble-ai/chatterbox) 文字轉語音伺服器複製帶有情緒標籤的英語語音。

Chatterbox透過`servers/tts/chatterbox/server.py`在本地運行。它預設為快速Chatterbox-Turbo模型（350M參數），帶有內聯情緒事件標籤，如`[laugh]`和`[sigh]`。你还可以为CPU设置配置轻量级Chatterbox-Nano模型（110M参数），或为无分类器指导 (`cfg_weight`) 和情感`exaggeration`调整配置标准0.5B模型。此包裝器不載入Chatterbox Multilingual V3。

## 設定

從TomoriBot儲存庫根（克隆TomoriBot的資料夾）執行這些命令：

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

當TomoriBot使用Chatterbox時，請保持該終端開啟。預設端點URL為`http://127.0.0.1:8011`；設定`CHATTERBOX_PORT`使用另一個連接埠。

### 選用：使用Chatterbox-Nano

Nano需要使用`nano=True`載入器選項進行Chatterbox建置。完成上述正常設定後，在同一虛擬環境中安裝固定的上游版本。提交哈希修復了相容的來源版本；這不是安全保證。此命令需要`git`並保留已安裝的執行時間相依性：

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

然後在啟動包裝器之前設定`CHATTERBOX_FAST_MODEL=nano`。保留Turbo的變數未設定。在Windows PowerShell上，使用`$env:CHATTERBOX_FAST_MODEL = "nano"`進行設定；在Linux或macOS上，使用`CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`。`/health`回應報告`fast_model`，以便你可以驗證載入的選擇。Nano和Turbo使用相同的克隆請求和支援的事件標籤。兩者都是純英文的。

`/config`快速模型切換必須保持啟用狀態才能使用Nano或Turbo。停用它會選擇標準Chatterbox 0.5B模型進行CFG權重和誇張調整。

### 標準Chatterbox（0.5B帶CFG和誇張）

原始0.5B基礎Chatterbox模型 (`ChatterboxTTS`) 直接建置到伺服器包裝器中。它使用無分類器指導 (`cfg_weight`) 和情緒`exaggeration`將Turbo的內聯括號事件標籤換成細粒度的聲音控制。

要使用標準模型：
1. 正常啟動伺服器包裝器。
2. 在Discord中，執行`/config` > `模型` > `TTS參數與語音`。
3. 關閉`Fast Model (Turbo)`選項。
4. 在下一代，包裝器會延遲下載標準0.5B模型並將其載入記憶體。

這兩個值都是`編輯參數`模式中的文字欄位。它們始終是可編輯的，頁面指出在啟用快速模型時它們會被忽略：
- **`cfg_weight`**（預設`0.5`）：調整合成音訊與參考速度和聲音風格的吻合程度。
- **`exaggeration`**（預設`0.5`）：控制交付的情感強度和戲劇性變化。

> [！筆記]
> 標準Chatterbox不支援內嵌括號事件標籤（例如`[laughs]`或`[sigh]`）。當快速模型切換關閉時，TomoriBot會自動從提示文字中移除括號標籤。

## 在TomoriBot中註冊

請在端點標籤或模型名稱中包含`Chatterbox`。TomoriBot只靠那個名稱（或包含它的端點URL）辨識Chatterbox端點，所以Turbo的標籤白名單、標準模型的標籤移除，以及`/generate voice-message`中的Chatterbox選項，都只有在它存在時才適用。

執行`/providers`，選擇`新增自訂端點`，並使用語音API相容性：

- API Compatibility：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8011`

儲存連線之後，選取它並用它的模型下拉選單加入一個Speech模型。將
`語音複製`選為語音來源模式，並將`方括號標籤`選為腳本標記風格，讓語氣標籤能撐過送出流程。

端點註冊與模型設定請用`/providers`。接著開啟`/config` > 模型 > `切換模型`，選取並啟用註冊好的端點。

## 設定人格聲音

1. 準備一段乾淨的10秒語音片段，只有一個揚聲器，沒有背景音樂。
2. 在模型 > `TTS參數與語音`下開啟`/config`並上傳剪輯。
3. 在人格 > `語音`下開啟`/config`，然後選擇人格和語音樣本。

更長的剪輯對Chatterbox沒有任何增加，而且也不被拒絕。它的運行時會在調節之前截斷參考，因此經過視窗的音訊會被上傳、存儲，然後被忽略（[`tts_turbo.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts_turbo.py)、[`tts.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py)）：

- 每個變體的前10秒都會發出聲音提示。
- 語音令牌上下文在Turbo和Nano上是前15秒，在Standard上是前6秒。

這些視窗是上游運行時中的常數，而不是已發布的指南：儲存庫自述文件沒有提供參考剪輯長度，其範例檔名僅為`your_10s_ref_clip.wav`。運行時實際強制執行的長度是最小值，斷言提示的長度超過5秒。

因此，十秒是實際目標。它填充聲音提示，這是設定音色和交付的地方，並且10到15秒之間的剪輯僅在Turbo和Nano上添加語音令牌上下文。說話者嵌入仍然是根據整個剪輯計算的，因此更長的時間不會改變說話者身份，只會丟棄多少未讀的提示。

當啟用快速模型切換時，Turbo和Nano可以使用括號事件標籤，例如`[laugh]`和`[sigh]`。

## 可選調整

使用Models > `TTS參數與語音`下的`/config`來調整Chatterbox請求負載：

- 快速模型切換預設啟用。TomoriBot保留受支援的Turbo/Nano事件標籤，並在包裝器呼叫`ChatterboxTurboTTS.generate(...)`之前刪除不支援的括號描述符。
- `cfg_weight`預設為`0.5`。最小值為`0`；TomoriBot沒有設定硬性最大值。僅當`turbo`為`false`時適用；較低的值有助於減慢快速的參考聲音，而較高的值會更強烈地跟隨參考聲音。
- `exaggeration`預設為`0.5`。最小值為`0`；TomoriBot沒有設定硬性最大值。僅當`turbo`為`false`時適用；較高的值使表達更具表現力或戲劇性，並且可能會加快講話速度。

支援的Turbo/Nano事件標籤為`[clear throat]`、`[sigh]`、`[shush]`、`[cough]`、`[groan]`、`[sniff]`、`[gasp]`、`[chuckle]`和`[laugh]`。不支援的描述符（例如`[excited]`、`[whisper]`或`[smiles]`）將被剝離，而不是發送到TTS。

當`turbo`停用時，TomoriBot在將文字傳送到TTS之前刪除所有括號描述符，然後包裝器延遲載入標準`ChatterboxTTS`模型並呼叫`model.generate(..., cfg_weight, exaggeration)`。

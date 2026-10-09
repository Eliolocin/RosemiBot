---
title: "Qwen3-TTS"
aiGenerated: true
---

在語音克隆和文字描述的VoiceDesign模式下使用 [Qwen3-TTS](https://github.com/QwenAudio/Qwen3-TTS) 合成高精度的多語言字元語音。

Qwen3-TTS 12Hz 1.7B提供高精準度本地語音合成。在預設自動模式下執行`servers/tts/qwen3tts/server.py`會根據每個傳入請求動態選擇基本語音複製模型或VoiceDesign模型。

## 設定

從TomoriBot儲存庫根（克隆TomoriBot的資料夾）執行這些命令：

### Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### Linux和macOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

預設自動模式端點URL為`http://127.0.0.1:8012`；設定`QWEN3TTS_PORT`使用另一個連接埠。你也可以明確指定自動模式：

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

自動模式檢查每個`/synthesize`請求：帶有`ref_audio`的請求使用克隆模型，而帶有`instruct`的請求使用VoiceDesign模型。它一次只載入一個模型，並在請求類型變更時交換模型，因此交換後的第一個請求可能會更慢。

## 在TomoriBot中註冊

對大多數使用者而言，請註冊自動模式的伺服器，讓單一端點同時支援語音複製與VoiceDesign人格。

執行`/providers`，選擇`新增自訂端點`，並使用語音API相容性：

- API Compatibility：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8012`

儲存連線之後，選取它並用它的模型下拉選單加入一個Speech模型。模型表單會
詢問`語音來源模式`與`腳本標記風格`；自動模式的伺服器請選`自動`與`純文字`。

端點註冊與模型設定請用`/providers`。接著開啟`/config` > 模型 > `切換模型`，選取並啟用註冊好的端點。

## 設定人格聲音

### 語音克隆

將其用於應模仿參考剪輯的人格：

1. 準備一段乾淨的10-20秒語音片段，只有一個揚聲器，沒有背景音樂。
2. 在模型 > `TTS參數與語音`下開啟`/config`並上傳剪輯。
3. 在人格 > `語音`下開啟`/config`，然後選擇人格和語音樣本。

Qwen3-TTS宣傳從短至3秒的參考音訊進行快速克隆，其運行時既不記錄也不強制執行參考持續時間上限。因此，剪輯長度是你控制的品質權衡，而不是伺服器檢查的限制。

### 聲音設計

將此用於應使用書面語音描述而不是範例的人格：

1. 在人格 > `語音`下開啟`/config`並選擇VoiceDesign。
2. 選擇人格人格。
3. 輸入自然語言語音提示，例如說話者的年齡、語氣、口音和表達方式。

從`/config`中的人格 > `語音`中刪除人格的VoiceDesign提示。生成時，TomoriBot將`/synthesize` JSON體中保存的提示作為`instruct`發送；附加了工具中的一次性`voice_instructions`。

自動模式保留這兩種設定。`/config`中的人格 > `語音`下配置的人格會根據其選擇使用克隆合成或VoiceDesign合成。

## 可選：僅限VoiceDesign的伺服器

為`Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`提供服務時，以VoiceDesign模式啟動相同伺服器。

Windows PowerShell：

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

重擊：

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

你也可以傳遞`--mode voice-design`而不是設定`TOMORI_TTS_MODE`。預設僅限VoiceDesign的端點URL是`http://127.0.0.1:8014`。

註冊方式與自動模式相同，但使用端點URL `http://127.0.0.1:8014`並選擇`VoiceDesign`作為語音模型上的語音來源模式。

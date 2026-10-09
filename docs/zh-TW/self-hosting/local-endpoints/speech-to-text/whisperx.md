---
title: "WhisperX轉錄"
sidebar:
  order: 1
---

使用捆綁的 [WhisperX](https://github.com/m-bain/whisperX) 伺服器為TomoriBot設定本地、準確的語音到文字。WhisperX提供具有字級對齊的快速音訊轉錄。

## 設定

從TomoriBot儲存庫根執行以下命令：

### Windows PowerShell

```powershell
cd servers/stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python whisperx_server.py
```

### Linux/macOS Bash

```bash
cd servers/stt
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python whisperx_server.py
```

當TomoriBot使用WhisperX時，請保持該終端開啟。預設端點URL為`http://127.0.0.1:8021`。

## 在TomoriBot中註冊

執行`/providers`，選擇`新增自訂端點`，並使用轉錄API相容性：

- API Compatibility：`openai-compatible-transcription`
- `endpoint_url`：`http://127.0.0.1:8021`

儲存連線之後，選取它並用它的模型下拉選單加入`large-v3`，或`WHISPERX_MODEL`目前設定的值，作為Transcription模型。

端點註冊與模型設定請用`/providers`。接著開啟`/config` > 模型 > `切換模型`，選取並啟用註冊好的端點。

## 使用成績單

註冊後，TomoriBot在後台轉錄音訊附件並將文字新增至聊天上下文。只有當你也希望在聊天中可見地發布文字記錄時，才使用`/config` > 引擎 > 通知。

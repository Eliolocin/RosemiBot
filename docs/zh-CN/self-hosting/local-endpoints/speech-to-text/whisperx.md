---
title: "WhisperX语音转写"
sidebar:
  order: 1
---

使用捆绑的 [WhisperX](https://github.com/m-bain/whisperX) 服务器为TomoriBot设置本地、准确的语音到文本。WhisperX提供具有字级对齐的快速音频转录。

## 设置

从TomoriBot存储库根运行以下命令：

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

当TomoriBot使用WhisperX时，保持该终端打开。默认端点URL为`http://127.0.0.1:8021`。

## 在TomoriBot中注册

运行`/providers`，选择`添加新自定义端点`，并使用语音识别专用的API兼容性：

- API兼容性：`openai-compatible-transcription`
- `endpoint_url`：`http://127.0.0.1:8021`

保存连接后，选中它，并用它的模型下拉菜单把`large-v3`（或者`WHISPERX_MODEL`所设的值）添加为语音识别模型。

端点注册和模型设置都在`/providers`里做，之后打开`/config` > 模型 > `切换模型`，选中并激活已注册的端点。

## 使用成绩单

注册后，TomoriBot在后台转录音频附件并将文本添加到聊天上下文中。仅当你还希望在聊天中可见地发布文字记录时，才使用`/config` > 引擎 > 通知。

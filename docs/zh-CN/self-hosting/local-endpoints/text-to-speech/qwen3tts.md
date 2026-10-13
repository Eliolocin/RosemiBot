---
title: "Qwen3-TTS"
aiGenerated: true
---

在语音克隆和文本描述的VoiceDesign模式下使用 [Qwen3-TTS](https://github.com/QwenAudio/Qwen3-TTS) 合成高精度的多语言字符语音。

Qwen3-TTS 12Hz 1.7B提供高精度本地语音合成。在默认自动模式下运行`servers/tts/qwen3tts/server.py`会根据每个传入请求动态选择基本语音克隆模型或VoiceDesign模型。

## 设置

从TomoriBot存储库根（克隆TomoriBot的文件夹）运行这些命令：

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

默认自动模式端点URL为`http://127.0.0.1:8012`； 设置`QWEN3TTS_PORT`使用另一个端口。你还可以显式指定自动模式：

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

自动模式检查每个`/synthesize`请求：带有`ref_audio`的请求使用克隆模型，而带有`instruct`的请求使用VoiceDesign模型。它一次只加载一个模型，并在请求类型更改时交换模型，因此交换后的第一个请求可能会更慢。

## 在TomoriBot中注册

对大多数用户来说，请注册自动模式的服务器，这样一个端点就能同时支持语音克隆与VoiceDesign两种人格。

运行`/providers`，选择`添加新自定义端点`，并使用语音合成的API兼容性：

- API兼容性：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8012`

保存连接后，选中它并用它的模型下拉菜单添加一个Speech模型。模型表单会询问`语音来源模式`与`脚本标记风格`；自动模式的服务器请选择`Auto`与`Plain`。

端点注册与模型设置请用`/providers`。然后打开`/config` > 模型 > `切换模型`，选中并启用已注册的端点。

## 设置人格声音

### 语音克隆

将其用于应模仿参考剪辑的人格：

1. 准备一段干净的10-20秒语音片段，只有一个扬声器，没有背景音乐。
2. 在模型 > `TTS参数与语音`下打开`/config`并上传剪辑。
3. 在人格 > `语音`下打开`/config`，然后选择人格和语音样本。

Qwen3-TTS宣传从短至3秒的参考音频进行快速克隆，其运行时既不记录也不强制执行参考持续时间上限。因此，剪辑长度是你控制的质量权衡，而不是服务器检查的限制。

### 声音设计

将此用于应使用书面语音描述而不是示例的人格：

1. 在人格 > `语音`下打开`/config`并选择VoiceDesign。
2. 选择人格人格。
3. 输入自然语言语音提示，例如说话者的年龄、语气、口音和表达方式。

从`/config`中的人格 > `语音`中删除人格的VoiceDesign提示。生成时，TomoriBot将`/synthesize` JSON体中保存的提示作为`instruct`发送； 附加了工具中的一次性`voice_instructions`。

自动模式保留这两种设置。`/config`中的人格 > `语音`下配置的人格根据其选择使用克隆合成或VoiceDesign合成。

## 可选：仅限VoiceDesign的服务器

为`Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`提供服务时，以VoiceDesign模式启动同一服务器。

Windows PowerShell：

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

重击：

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

你也可以传递`--mode voice-design`而不是设置`TOMORI_TTS_MODE`。默认仅限VoiceDesign的端点URL是`http://127.0.0.1:8014`。

注册方式与自动模式相同，但使用端点URL `http://127.0.0.1:8014`并选择`VoiceDesign`作为语音模型上的语音源模式。

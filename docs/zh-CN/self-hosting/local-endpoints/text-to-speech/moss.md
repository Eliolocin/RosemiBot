---
title: "MOSS-TTS"
---

使用 [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS) 通过统一语音端点在本地评估语音克隆和自然语言语音设计。

使用`servers/tts/moss/server.py`，TomoriBot动态路由合成请求：当人格提供`ref_audio`时，它加载克隆模型，并在给出自然语言`instruct`指导时切换到MOSS-VoiceGenerator。GPU内存中一次仅保存一个模型，以便在16 GB VRAM预算内运行。

默认克隆模型是 [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5) (4B)，选择作为16 GB GPU的实用基准。[MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) 是8B旗舰替代品，在BF16时需要更多VRAM。语音设计使用[MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator)（大约1.7B）。克隆和语音设计之间的交换会导致模型加载延迟。

## 设置

使用Python 3.12和与CUDA 12.8兼容的驱动程序从TomoriBot存储库根运行命令：

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### Linux或WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

在启动服务器之前，预取命令会将克隆模型、VoiceGenerator和音频标记器下载到Hugging Face缓存中。如果磁盘空间有限，请将`HF_HOME`设置为更大的分区。要仅下载一种模型，请传递`--mode clone`或`--mode voice-design`。

默认端点是`http://127.0.0.1:8018`。运行`bun run launch --moss`以与TomoriBot一起启动服务器。自动模式从本地缓存预热克隆模型。将`MOSS_TTS_WARM_MODE=voice-design`设置为预热VoiceGenerator，或将`MOSS_TTS_WARM_MODE=none`设置为延迟初始化。检查`GET /health`是否有活动的`warm_mode`、`active_mode`和`model_id`。包装器使用Hugging Face `trust_remote_code=True`，因此在更新之前请检查上游代码。

## 在TomoriBot中注册

在`/providers`中，选择`Add New Custom Endpoint`，将API兼容性设置为`tts-clone`，并使用端点URL `http://127.0.0.1:8018`。添加一个语音模型，其中`声音来源模式`设置为`自动`，`Script Markup`设置为`纯文本`。在`/config` > `模型` > `切换模型`下激活它。

对于语音克隆，请在`/config` > `模型` > `TTS参数与语音`下上传干净的参考剪辑，并将其分配到人格 > `语音`下。较短、干净的音频剪辑可产生最一致的结果。对于语音设计，请在人格 > `语音`下保存自然语言描述。请注意，MOSS-VoiceGenerator是为英语和中文设计的。虽然4B克隆模型支持日语，但显式语言标签提高了合成清晰度。

TomoriBot的克隆适配器不会自动发送语言标签。对于单语言使用，请在启动服务器之前设置`MOSS_TTS_DEFAULT_LANGUAGE=Japanese`（或`简体中文`、`Chinese`等）。手动`/synthesize`调用可以直接通过`language`。

服务器读取自己的shell环境； 机器人`.env`中的设置不适用于独立启动的Python终端。

要在高内存硬件上运行8B模型，请在预取之前设置`MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5`。`MOSS_TTS_PORT`、`MOSS_TTS_DEVICE`、`MOSS_TTS_DTYPE`和`MOSS_TTS_MAX_NEW_TOKENS`可在`.env.optional.example`中配置。如果模型交换或CPU执行导致超时，请增加TomoriBot中的`TTS_SYNTHESIZE_TIMEOUT_MS`。

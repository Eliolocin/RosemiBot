---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

使用 [Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech) 合成极具表现力的多语言角色语音和细粒度的情感标签。

Fish Audio S2 Pro是一款多语言4B参数文本转语音模型，专为高保真语音克隆而构建。TomoriBot通过`servers/tts/fishs2/`中的本地包装器连接到模型。它默认为官方BF16权重 (`fishaudio/s2-pro`)，并为具有8至12 GB VRAM的GPU提供可选的INT8量化检查点 (`Imagilux/fishaudio-s2-pro`)。

Fish S2 Pro支持`[whisper]`、`[excited]`、`[angry]`等括号表达式标签。使用`方括号标签`标记配置端点，以便TomoriBot在生成的语音脚本中保留这些控件。

## 许可证

Fish Speech代码与S2 Pro模型权重按Fish Audio Research License分发。根据其条款，研究与不可商用用途是被允许的；商业用途需要单独的Fish Audio许可。

TomoriBot不分发模型权重。每位自部署用户都直接从Hugging Face下载Fish S2 Pro，并自行负责遵守Fish Audio Research License。要求的署名是：Built with Fish Audio。

## 硬件和操作系统

> [！重要的]
> Fish Audio正式针对Linux和WSL2。Fish S2 Pro使用双自回归 (Dual-AR) 架构（36个慢速变压器层 + 10个快速码本通道 = 每个令牌76层评估）。在Linux上，OpenAI Triton将此循环编译为融合GPU内核 (`torch.compile(backend="inductor")`)，从而实现实时综合。包装器默认关闭编译； 设置`FISH_S2_COMPILE=1`来启用它。>
> 在本机Windows上，Triton不受支持，迫使PyTorch进入未编译的eager模式，通过Windows WDDM驱动程序调度超过120,000个顺序CUDA内核。这会导致严重的调度停滞，将完全相同的剪辑的生成速度减慢至约8-10分钟（音频每秒计算约65秒）。为了进行可用的推理，请在Linux或WSL2中运行Fish S2 Pro。

推荐硬件：

- **Linux或WSL2（强烈推荐）**
- 具有16 GB至24 GB VRAM的NVIDIA GPU（BF16可以轻松适应 ~16-18 GB VRAM，具有KV缓存和卸载）
- 推荐使用Python 3.12
- `git`、`ffmpeg`以及Fish Speech所需的标准音频库

## 设置

### Linux和WSL2（推荐）

从TomoriBot存储库根目录：

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

安装程序：

1. 将`Imagilux/fish-speech`克隆到`servers/tts/fishs2/fish-speech/`并检查固定的运行时提交；
2. 创建隔离的`.venv`；
3. 安装Fish Speech以及TomoriBot包装器依赖项； 和
4. 将官方BF16 `fishaudio/s2-pro`检查点下载到`fish-speech/checkpoints/fish-speech-s2-pro/`中。

正常的重新安装保留在固定的运行时提交`2225e924e7d35cc0a1d24dbc67cd1819e6cf429f`上，而不是跟随移动分支； 迁移到较新的运行时意味着更改安装程序中的该引脚。型号修订默认为`main`； 当部署必须可重现时，将`FISH_S2_MODEL_REVISION`固定到不可变的Hugging Face修订版。安装程序设置列在[安装程序变量](#installer-variables) 下。

拥抱脸模型是门控的。首先接受Hugging Face的许可。如果下载要求身份验证，请运行：

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

然后重新运行安装程序。

### Windows PowerShell（仅限尽力而为）

本机Windows仅供评估之用。由于未编译的eager模式下的驱动程序调度延迟，生成速度将非常慢（每个剪辑约8-10分钟）：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

默认情况下，PowerShell安装程序以CUDA GPU加速 (`cu124`) 为目标。要在没有NVIDIA GPU的仅CPU计算机上安装，请传递`-Cpu`：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

如果Windows上的PyTorch需要手动安装或更新CUDA支持，请运行：

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot在`TTS_SYNTHESIZE_TIMEOUT_MS`（默认240000毫秒）后停止等待语音消息，该时间比本机Windows剪辑所需的时间短。在Windows上进行评估时，在TomoriBot的`.env`（例如`TTS_SYNTHESIZE_TIMEOUT_MS=900000`）中提高它。

## 强制性参考成绩单

> [！警告]
> 语音克隆需要参考文字（`ref_text`）； Fish S2 Pro的交叉注意力机制需要参考音频的转录来将语音标记与声学代码对齐。>
> 如果你上传语音样本而不提供其匹配的参考转录本，Fish Speech会默默地丢弃参考音频标记并回退到随机零参考语音。TomoriBot Fish包装器使用`400 Bad Request`验证并拒绝缺少参考文本的合成请求，以防止意外的无条件生成。

在`Models > `TTS参数与语音``, always fill in the `Reference script`字段下的`/config`中添加人格语音时，使用参考音频剪辑中逐字记录的文本。

## 在TomoriBot中注册

在`/providers`中选择`添加新自定义端点`并配置：

- 功能：`Speech`
- API兼容性：`tts-clone`
- 端点URL：`http://127.0.0.1:8015`
- 语音来源模式：`Clone`
- 脚本标记风格：`方括号标签`
- API密钥：留空。封装程序没有身份验证，参见[网络访问](/zh-CN/self-hosting/local-endpoints/text-to-speech/#network-access)。

然后添加该端点的模型条目，并通过`/config`的模型 > 切换模型启用它。

## 添加人格语音

1. 准备一段干净的10-20秒参考片段，只有一位说话者，背景噪音很小或没有。
2. 在`/config`中打开模型 > TTS参数与语音并上传语音样本。
3. 输入参考片段中逐字说出的文本，填进参考文本字段。
4. 在`/config`中打开人格 > 语音并把样本指定给该人格。
5. 用`/generate voice-message`生成语音消息，或让TomoriBot通过它的语音消息工具生成一条。

上游说明，通常可以用10-30秒的参考样本进行准确克隆。Fish S2 Pro自身的运行时不对参考音频时长设上限，所以更长的片段会被接受而不是被裁剪，但文档所述的克隆质量来自10-30秒这个区间。

## 表达控制

Fish S2 Pro可以用方括号标签在同一句话内部改变表达方式。例如：

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

因为端点使用`方括号标签`标记，TomoriBot会保留这些标签，而不是在合成前把它们去掉。

## 配置

| 变量 | 默认值 | 用途 |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | S2 Pro检查点目录 |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 模型仓库，以及已配置检查点的健康检查元数据标签 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 封装程序的绑定地址; 参见[网络访问](/zh-CN/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `FISH_S2_PORT` | `8015` | Fish封装程序端口 |
| `FISH_S2_UPSTREAM_PORT` | `8025` | 内部Fish API端口 |
| `FISH_S2_COMPILE` | `0` | 启用Fish Speech的`torch.compile`（需要带Triton的Linux/WSL2） |
| `FISH_S2_HALF` | `0` | 请求FP16运行时模式 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Fish迭代式提示词分块长度 |
| `FISH_S2_TOP_P` | `0.8` | 采样top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | 采样温度 |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | 重复惩罚 |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | 每个请求生成的最大语义token数 |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | 在Fish运行时中缓存已编码的参考语音 |

### 安装器变量

由`install-fishs2.sh`与`install-fishs2.ps1`读取。请记录你覆盖的任何取值，以便部署可以复现。

| 变量 | 默认值 | 用途 |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 要下载的Hugging Face仓库 |
| `FISH_S2_MODEL_REVISION` | `main` | 要下载的Hugging Face修订版 |

参考音频必须是非空、未压缩、解码后不超过10 MB的PCM RIFF/WAVE文件。该上限会在推理前检查，以防过大的base64请求消耗不受限的内存；对于TomoriBot发送的22.05 kHz单声道WAV，它约可容纳237秒。

## 低VRAM选项（INT8量化）

在具有受限VRAM（例如8-12 GB）的GPU上运行且无法满足官方BF16检查点的用户可以选择使用INT8量化模型 (`Imagilux/fishaudio-s2-pro`)。

要安装并运行INT8检查点：

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

从同一shell启动`server.py`，或在启动之前设置相同的三个变量，以便包装器加载INT8目录而不是默认的BF16目录。

INT8检查点将变压器重量从约10.3 GB减少到约5.1 GB，同时将音频嵌入和编解码器层保留在BF16中，适合约10 GB的总VRAM。

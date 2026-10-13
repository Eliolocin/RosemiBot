---
title: "VoxCPM2"
aiGenerated: true
---

使用OpenBMB的 [VoxCPM2](https://github.com/OpenBMB/VoxCPM) 文本转语音模型合成跨30种语言的富有表现力的48 kHz语音。

VoxCPM2是一个2B参数多语言语音模型，支持语音克隆、转录辅助终极克隆和自然语言语音设计。TomoriBot通过`servers/tts/voxcpm2/`中的服务器连接到官方`voxcpm` Python库，在16 GB VRAM内轻松运行官方未量化的`openbmb/VoxCPM2` BF16检查点。

## 许可证

VoxCPM2的代码与模型权重以Apache-2.0发布，在遵守许可证条款的前提下也包括商业使用。TomoriBot不分发这些权重；安装程序会从官方Hugging Face仓库下载它们。

官方上游资源：

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [Hugging Face上的openbmb/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPM文档](https://voxcpm.readthedocs.io/)

## 支持的语言

VoxCPM2官方支持30种语言，而且不需要语言标记：

阿拉伯语、缅甸语、中文、丹麦语、荷兰语、英语、芬兰语、法语、德语、希腊语、希伯来语、印地语、印度尼西亚语、意大利语、日语、高棉语、韩语、老挝语、马来语、挪威语、波兰语、葡萄牙语、俄语、西班牙语、斯瓦希里语、瑞典语、他加禄语、泰语、土耳其语和越南语。

OpenBMB还记录了若干中文方言。为了兼容通用的TTS契约，TomoriBot仍然可能发送`language`字段，但VoxCPM2会从合成文本中检测语言，封装程序不会强制加上语言标记。

## 语音模式

一个VoxCPM2端点就能处理TomoriBot所有有用的语音来源模式：

| TomoriBot请求 | VoxCPM2行为 |
|---|---|
| 只有`text` | 会被拒绝；请选择参考样本或VoiceDesign提示词 |
| `text` + `instruct` | 根据自然语言描述进行语音设计 |
| `text` + `ref_audio` | 参考音频语音克隆 |
| `text` + `ref_audio` + `instruct` | 可控克隆：保留说话者，同时调整表达方式 |
| `text` + `ref_audio` + `ref_text` | 使用参考音频及其转写文本进行终极克隆 |
| `text` + `ref_audio` + `ref_text` + `instruct` | 可控克隆；一次性指令优先，转写文本不会发送 |

VoxCPM2把自然语言描述放在待合成文本前的括号里，以此表示Voice Design与风格控制。TomoriBot已经有用于此目的的`instruct`字段，所以封装程序会自动完成这个转换。

请使用Plain脚本标记风格。VoxCPM2不需要TomoriBot保留方括号标签或表情符号控制语法，也不必新增脚本标记模式。

## 硬件与运行时

推荐的起点：

- Python 3.10-3.12
- 用于官方BF16运行时的NVIDIA GPU，8 GB显存或更多；12-16 GB会比较宽裕
- 最新的NVIDIA驱动，以及支持CUDA的PyTorch构建，用于GPU加速
- 也支持CPU作为兜底方案，但速度会慢得多

官方包还提供CPU与Apple MPS设备选择。在Windows上，TomoriBot可以直接原生运行标准Python包；不需要WSL。Windows PowerShell安装程序默认安装支持CUDA的PyTorch构建（`cu124`）。

要在只有CPU的机器上显式安装，请传入`-Cpu`开关：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

如果你的原生Windows PyTorch安装需要手动重装或重新对齐驱动，请把支持CUDA的PyTorch构建直接安装到服务器的虚拟环境里：

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

OpenBMB报告，在RTX 4090上使用标准运行时的RTF约为0.30。上游还支持流式生成，并记录了更快的Nano-vLLM与vLLM-Omni服务方案。TomoriBot当前的`POST /synthesize`契约只返回一个WAV响应，所以这个服务器会有意缓冲生成的语音，而不对外暴露单独的流式协议。

## 安装

服务器固定当前稳定的`voxcpm` 2.0.3包并将`openbmb/VoxCPM2`下载到正常的Hugging Face缓存中。

### Linux和WSL Bash

从TomoriBot存储库根目录：

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

从TomoriBot存储库根目录：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

第一个设置会下载几GB的模型权重。要安装Python环境而不预取模型，请设置`VOXCPM2_PREFETCH=0`； 然后，官方库将在第一次服务器启动时下载检查点。

Linux和WSL：

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

电源外壳：

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

设置完成后，`bun run launch --voxcpm2`与TomoriBot一起启动服务器。默认端点是`http://127.0.0.1:8016`。

## 在TomoriBot中注册

运行`/providers`，选择`添加新自定义端点`，然后配置语音合成端点：

- 功能：`Speech`
- API兼容性：`tts-clone`
- 端点URL：`http://127.0.0.1:8016`
- 语音来源模式：`Auto`
- 脚本标记风格：`Plain`
- 支持指令：`Yes`

保存连接后，选中它，用它的模型下拉菜单添加一个语音合成模型。然后打开`/config` > 模型 > `切换模型`，选择VoxCPM2语音模型。

推荐使用`Auto`，因为同一个服务器同时支持参考音频克隆与语音设计。你不需要为这两种模式分别运行VoxCPM2进程。

## 人格语音克隆

对于应当克隆现有说话者的人格：

1. 准备一段干净的参考音频片段，只有一位说话者，背景音乐很少或没有。上游把5到30秒视为实用范围。
2. 打开`/config`，进入模型 > TTS参数与语音，上传这段片段。
3. 如果拿得到参考片段的准确转写文本，就把它加上。VoxCPM2会用它进行终极克隆，从而复现更多参考音频的节奏、情感与风格。
4. 打开`/config`，进入人格 > 语音，选择该人格，并指定保存好的语音样本。

如果没有存储转写文本，VoxCPM2仍然会执行常规的参考音频克隆。

5到30秒这个数字是经过记载的质量范围，而不是强制上限：VoxCPM2本身不施加任何参考音频时长限制，所以真正阻止更长片段的是TomoriBot的上传上限。

## 人格声音设计

对于应该根据书面语音描述而不是样本创建的人格：

1. 在人格 > `语音`下打开`/config`并选择VoiceDesign。
2. 选择人格人格。
3. 输入自然语言描述，例如`Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`。

TomoriBot将保存的描述发送为`instruct`。VoxCPM2将其转换为其原生语音设计控制前缀。

当克隆人格也收到一次性语音指令时，VoxCPM2使用可控克隆：参考样本提供说话者身份，而指令则控制情感、节奏或表达等品质。如果还存储了转录本，则该指令优先，因为上游终极克隆路径不提供可靠的控制指令模式； 对于该请求，故意省略了文字记录。

## 使用`/generate voice-message`进行测试

一旦VoxCPM2成为活动语音模型，`/generate voice-message`就会以与正常语音消息工具调用相同的方式使用人格的配置语音源：

- 克隆人格发送存储的`ref_audio`和可选的`ref_text`；
- VoiceDesign人格将其保存的提示发送为`instruct`；
- 启用支持指令的具有克隆能力的端点公开传送方向字段并通过`instruct`传递一次性指令；
- 当指令与克隆样本一起存在时，TomoriBot仅使用`reference_wav_path`并且不发送脚本提示字段。

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | Hugging Face模型ID或本地模型目录 |
| `VOXCPM2_DEVICE` | `auto` | 运行时设备：`auto`、`cuda`、`cuda:N`、`cpu`或`mps` |
| `VOXCPM2_OPTIMIZE` | `1` | 启用官方运行时的优化 / 编译路径 |
| `VOXCPM2_LOAD_DENOISER` | `0` | 加载可选的上游降噪器；默认关闭以节省内存 |
| `VOXCPM2_CFG_VALUE` | `2.0` | 引导强度 |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | 流匹配推理步数；增加步数可以提升质量，但会牺牲速度 |
| `VOXCPM2_MAX_LEN` | `4096` | 最大生成长度 |
| `VOXCPM2_NORMALIZE` | `0` | 启用上游的文本规范化 |
| `VOXCPM2_RETRY_BADCASE` | `1` | 启用上游针对异常生成的重试行为 |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | 最大自动重试次数 |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | 上游的异常长度阈值 |
| `VOXCPM2_PREFETCH` | `1` | 仅安装程序：在安装过程中下载模型 |
| `VOXCPM2_PORT` | `8016` | VoxCPM2本地服务器端口 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 本地服务器的绑定地址; 参见[网络访问](/zh-CN/self-hosting/local-endpoints/text-to-speech/#network-access) |

参考音频必须是解码后不超过10 MB的非空WAV容器，封装程序会在写入临时文件之前检查这一点。

## 备用检查点与运行时

官方BF16模型已经能放进预期的16 GB消费级GPU目标，所以TomoriBot默认不使用量化检查点。社区里存在一些量化版本，但它们会额外增加一层兼容性与维护负担，而常规安装并不需要。

对于高吞吐量的部署，OpenBMB目前推荐把Nano-vLLM-VoxCPM和vLLM-Omni作为加速服务方案。那些运行时可以提供超出这个参考服务器的流式与并发服务能力。它们并不是TomoriBot常规本地语音消息工作流所必需的，而这个封装程序有意停留在官方`voxcpm` API上，以便在上游模型升级时仍然容易跟进。

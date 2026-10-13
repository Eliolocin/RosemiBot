---
title: "CosyVoice 3"
aiGenerated: true
---

使用阿里巴巴的 [CosyVoice 3](https://github.com/QwenAudio/CosyVoice)，通过基于指令的情感传递来合成自然的多语言角色声音。

CosyVoice 3提供跨9种语言和超过18种中国方言的零样本、跨语言语音克隆。TomoriBot将官方运行时包装在`servers/tts/cosyvoice3/`中，以公开标准`POST /synthesize`语音接口。捆绑的安装程序默认为官方未量化的`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`模型，在16 GB VRAM内运行。

## 它支持什么

当前的CosyVoice 3版本支持：

- 中文、英语、日语、韩语、德语、西班牙语、法语、意大利语、俄语
- 18+中国方言和口音
- 零样本语音克隆
- 多语言和跨语言语音克隆
- 针对语言、方言、情感、语速和音量的自然语言指令
- 上游运行时中的细粒度控制，包括`[breath]`和`[laughter]`
- 上游运行时中的文本输入和音频输出流

官方的CosyVoice 3示例包括一个日语警告：日语文本在转换为片假名后显示。日语是受支持的语言，但如果正常的日语正字法发音不佳，则将合成文本转换为片假名是上游推荐的解决方法。

## TomoriBot如何映射请求

包装器接受标准`tts-clone`字段：

- `text`
- `ref_audio`
- `ref_text`
- `instruct`
- `language`

它将请求路由到CosyVoice 3个推理函数，如下所示：

| 要求 | CosyVoice 3路 |
|---|---|
| 参考音频+文字记录 | `inference_zero_shot` |
| 没有文字记录的参考音频 | `inference_cross_lingual` |
| `instruct`或显式`language` | `inference_instruct2` |

为了获得最佳克隆质量，请提供参考音频及其匹配的转录本。CosyVoice 3的当前指令API以参考音频为条件，不接受参考记录，因此包含`instruct`的请求切换到官方`inference_instruct2`路径。

### 风格与情绪控制

使用`纯文本`标记注册端点。传送方向属于端点的全局`voice_instructions`字段。避免使用任意的内联括号标签，因为它们存在指令矛盾的风险，例如`[happy] Hello. [sad] Goodbye.`。本机`[breath]`和`[laughter]`标签被推迟，直到TomoriBot支持特定于引擎的标签发现。

`/synthesize` `instruct`字段被传递到CosyVoice 3的指令调节中。示例包括`sound relieved but still tired`、`speak as quickly as possible`或`speak quietly with restrained excitement`。

## 流式传输

CosyVoice 3支持双向流上行。上游基准测试报告，在优化设置中，文本输入和音频输出流的初始音频延迟约为150毫秒。

TomoriBot的语音接口期望Discord语音消息有一个完整的音频响应，因此包装器返回完整的WAV文件，并默认上游推断为`stream=False`。仅当直接对上游流行为进行基准测试时才设置`COSYVOICE3_UPSTREAM_STREAM=1`； 它不会改变TomoriBot延迟。

## 硬件

推荐硬件：

- 具有16 GB VRAM的NVIDIA GPU
- Python 3.10
- 与CUDA 12兼容的NVIDIA驱动程序
- `git`
- `ffmpeg`用于语音样本标准化
- Linux上的`sox`和`libsox-dev`如果出现音频兼容性问题

0.5B参数模型无需量化即可轻松装入16 GB VRAM。检查点下载包括流模型、语音标记器、文本模型和强化学习权重，需要大约10 GB的磁盘空间以及Python依赖项。

虽然上游在技术上支持CPU推理，但对于Discord语音交互来说速度太慢。

## 安装

### Linux和WSL2（推荐）

从TomoriBot存储库根目录：

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

或者一起启动配置好的服务器和TomoriBot：

```bash
bun run launch --cosyvoice3
```

安装程序：

1. 签出`QwenAudio/CosyVoice`，将`074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc`递归提交到`servers/tts/cosyvoice3/CosyVoice/`；
2. 创建`servers/tts/cosyvoice3/.venv`；
3. 安装上游CosyVoice要求和包装器依赖项； 和
4. 将Hugging Face版本`29e01c4e8d000f4bcd70751be16fa94bf3d85a18`中的`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`下载为`CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B/`。

重新运行脚本会保留这些固定的修订。安装程序拒绝使用未提交的本地更改覆盖签出。

上游要求安装PyTorch 2.3.1和CUDA 12.1软件包、Linux上的CUDA 12 ONNX运行时软件包以及Linux上的TensorRT 10.13软件包。如果你的GPU需要更新的PyTorch版本，请在安装完成后在虚拟环境中安装兼容的PyTorch版本。

### Windows PowerShell

本机Windows作为尽力而为的路径提供：

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

强烈建议在Windows上使用NVIDIA GPU使用WSL2。上游要求在Windows上安装仅包含CPU的ONNX运行时，而Linux和WSL2安装GPU加速包。

## 在TomoriBot中注册

运行`/providers`，选择`添加新自定义端点`，并配置语音端点：

- 功能：`Speech`
- API兼容性：`tts-clone`
- 端点URL：`http://127.0.0.1:8017`
- 语音来源模式：`Clone`
- 脚本标记风格：`Plain`
- 支持Instruct：`Yes`

保存连接后，选中它并添加一个Speech模型。一个清晰的模型代码是`Fun-CosyVoice3-0.5B-2512`。

然后打开`/config` > 模型 > `切换模型`，启用CosyVoice 3语音端点。

## 指定人格语音

对于零样本语音克隆：

1. 准备一个干净的3到30秒音频剪辑，其中包含一个扬声器和最小的背景噪音。
2. 在模型 > `TTS参数与语音`下打开`/config`并上传示例。
3. 输入匹配的成绩单（如果有）。CosyVoice 3将此转录本标记为零样本克隆的提示前缀； 它应该描述音频的前30秒。
4. 在人格 > `语音`下打开`/config`并将样本分配给人格。

CosyVoice强制执行30秒的提示窗口。当音频超过30秒时，上游引擎会引发错误，而TomoriBot的包装器会自动将剪辑修剪到前30秒，并将修剪结果记录到控制台。

说话者嵌入和提示语音标记是从开头30秒开始计算的，因此长度超过30秒的剪辑不会添加语音细节。在10到20秒之间使用干净的夹子可确保准确的提示对准。

支持跨语言克隆：参考说话者可以说与生成的文本不同的语言。如果未提供参考记录，包装器会将请求路由到CosyVoice 3的专用跨语言引擎路径。

## 用`/generate voice-message`测试

使用`/generate voice-message`测试综合，无需等待自动聊天触发。你可以使用人格分配的样本进行测试，或上传包含其转录内容的一次性剪辑。

要引导情感和表达，请在模式中输入方向或让人格提示提供`voice_instructions`。保持口语文本为简单对话； 内联样式标签在合成之前被删除。

## 环境变量

| 多变的 | 默认 | 目的 |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | 本地检查点目录 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 包装器绑定地址； 参见[网络接入](/zh-CN/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | 包装端口 |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | 启用CosyVoice的内部流发生器 |
| `COSYVOICE3_SPEED` | `1.0` | 全局数字速度乘数传递给上游推理 |
| `COSYVOICE3_DEFAULT_INSTRUCT` | 空的 | 当请求未提供可选说明时添加 |
| `COSYVOICE3_FP16` | `0` | 要求官方运行时使用其fp16模式 |
| `COSYVOICE3_LOAD_TRT` | `0` | 正确准备后启用上游TensorRT加载 |
| `COSYVOICE3_LOAD_VLLM` | `0` | 安装单独的依赖项后启用上游vLLM加载 |

默认情况下，TensorRT、vLLM和fp16保持禁用状态。标准PyTorch运行时可以在16 GB GPU上轻松运行，无需额外的运行时依赖。

## 性能与模型变体

### 默认：基础版`Fun-CosyVoice3-0.5B-2512`

这是TomoriBot的建议默认值。它提供了很高的说话人相似度，支持所有CosyVoice 3克隆和指令模式，并且不需要在16 GB GPU上进行量化。

### 强化学习权重

检查点包包括`llm.rl.pt`和基本重量。强化学习权重降低了内容错误率，而基本权重在说话者相似性基准测试中得分稍高。由于人格语音保真度优先，因此包装器默认为`llm.pt`。

上游加载程序期望`llm.pt`。要在不修改默认文件的情况下测试RL权重，请复制模型目录，在副本中将`llm.rl.pt`重命名为`llm.pt`，并将`COSYVOICE3_MODEL_DIR`设置为复制的文件夹。

### vLLM与TensorRT

CosyVoice 3支持可选的vLLM和TensorRT运行时。上游记录了带有V1引擎的vLLM 0.11.x+ 和旧版vLLM 0.9.0。由于这些库引入了严格的CUDA和依赖版本要求，因此TomoriBot默认情况下不会安装它们。

## 许可证

CosyVoice代码库和`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`权重在Apache-2.0许可证下发布。

上游模型卡注明演示材料用于学术评估。TomoriBot不分配模型权重。在进行商业部署之前，请查看特定用例的上游许可和条款。

---
title: "IrodoriTTS"
aiGenerated: true
---

使用 [Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS)，通过语音克隆、基于字幕的VoiceDesign和富有表现力的表情符号标记生成自然的日语语音。

Irodori-TTS v4.1是一个专注于日语的文本转语音模型，支持在单个检查点内进行语音克隆和文本描述的VoiceDesign。TomoriBot通过`servers/tts/irodoritts/`中的本地FastAPI包装器连接到Irodori，默认为`Aratako/Irodori-TTS-v4.1-Small`。

可以使用`IRODORI_TTS_MODEL_ID`选择兼容的拥抱面部检查点，包括`phasefield-audio/Irodori-TTS-v4.1-Anime`等社区微调。

## 设置

Irodori使用`uv`进行依赖项和PyTorch后端管理。服务器维护自己的`pyproject.toml`，并固定Irodori和`dacvae`依赖项，以实现可重复安装。首先安装`uv`，然后从TomoriBot存储库根运行安装脚本：

### Windows PowerShell (NVIDIA)

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash (NVIDIA)

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

安装脚本创建`servers/tts/irodoritts/.venv`，因此`bun run launch --irodoritts`在安装后继续工作。

可用的后端：

- `cu128`：Windows和Linux上的NVIDIA CUDA 12.8
- `cpu`：仅CPU，或通过PyPI的macOS CPU/MPS
- `rocm`：Linux/WSL上的AMD ROCm
- `xpu`：Windows和Linux上的英特尔XPU

默认端点URL为`http://127.0.0.1:8013`。

## 使用不同的检查点

默认型号为`Aratako/Irodori-TTS-v4.1-Small`。可以通过环境变量配置兼容的Hugging Face存储库、社区微调（例如`phasefield-audio/Irodori-TTS-v4.1-Anime`）或本地检查点文件。

当你启动服务器（直接使用Python或通过`bun run launch --irodoritts`）时，它会自动读取存储库根`.env`（或`servers/tts/irodoritts/`中的本地`.env`）并在启动时记录活动模型ID。

### 通过`.env`（持续）

添加到TomoriBot根目录中的`.env`：

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### 通过每个会话的环境变量

在Windows PowerShell中：

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

在Linux Bash上：

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### 使用本地检查点文件

如果你已在本地下载了检查点文件（`.pt`或`.safetensors`），请将`IRODORI_TTS_CHECKPOINT`设置为其路径：

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

当前Irodori下载检查点以及Hugging Face存储库中捆绑的任何标记器资产。当模型存储库提供Hugging Face子文件夹变体时，`IRODORI_TTS_MODEL_ID`也支持它们。

## 注册TomoriBot

运行`/providers`，选择`Add New Custom Endpoint`，并使用语音API兼容性：

- API兼容性：`tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

保存连接后，选择它并使用其模型下拉列表添加语音模型。对于v4.1，建议的设置是：

- `声音来源模式`: `自动`
- `脚本标记风格`: `表情`

`自动`让同一个Irodori端点支持两种TomoriBot语音模式，因此情感线索在发送过程中得以保留：

- 在人格 > `语音`下分配了语音样本的人格会发送存储的参考剪辑以进行语音克隆。
- 在人格 > `语音`下设置了VoiceDesign提示的人格将保存的自然语言提示作为Irodori字幕条件发送。

如果你只需要参考音频语音克隆，你仍然可以选择`声音克隆`作为语音源模式。

使用`/providers`进行端点注册和模型设置。然后打开`/config` > `模型` > 切换型号选择并激活已注册的端点。

## 设置人格声音

### 语音克隆

1. 准备一个干净的日语语音片段，只有一个扬声器，没有背景音乐。大约30秒就已经足够了：超过这个时间点，额外的音频就几乎无法带来音色保真度，同时会消耗上传大小和推理时间。
2. 在模型 > `TTS参数与语音`下打开`/config`并上传剪辑。
3. 在人格 > `语音`下打开`/config`，然后选择人格和语音样本。

Irodori v4.1支持比早期型号更长的参考调节，但干净的源音频仍然比原始持续时间更重要。

v4.1运行时将参考剪辑限制在检查点默认值，v4.1检查点将其设置为120秒。任何更长的内容都会被修剪到该上限而不是被拒绝，并且`IRODORI_MAX_REF_SECONDS`会覆盖它。因此，TomoriBot 130秒上传上限的剪辑仍然有效：Irodori条件位于其前120秒。

较长的剪辑不会提高语音质量。Upstream报告称，大约30秒的干净参考语音已经捕获了大部分可测量的说话者相似度增益，并且来自同一说话者的多个较短剪辑击败了一个长录音。较长剪辑附带的额外参考潜在步骤也会延长每个合成请求。仅当说话者的音色在录音中出现漂移时才达到30秒以上。

### 声音设计

1. 在人格 > `语音`下打开`/config`。
2. 选择人格人格。
3. 输入所需语音和交付的自然语言描述。

TomoriBot发送此提示为`instruct`； Irodori包装器将其映射到v4.1 `caption`条件。VoiceDesign请求不需要存储的参考剪辑。

在将文本发送到TTS之前，TomoriBot会剥离Discord自定义表情符号语法。对于`script_markup: emoji`，Unicode表情符号被保留用于Irodori的文本调节。

### 表情符号风格控件

IrodoriTTS支持输入文本中的表情符号注释，以影响声音效果、说话风格和情绪表达。将TomoriBot的`脚本标记风格`设置为`表情`后，这些Unicode表情符号将被保留并发送到Irodori。

| 表情符号 | 意义/情感/风格 |
| --- | --- |
| 👂 | 耳语，声音靠近耳朵 |
| 😮‍💨 | 呼吸、叹息、睡眠呼吸 |
| ⏸️ | 暂停、沉默 |
| 🤭 | 轻笑、咯咯笑、压抑的笑声 |
| 🥵 | 气喘吁吁、呻吟、呻吟 |
| 📢 | 回声、混响 |
| 😏 | 戏弄、俏皮的甜蜜/哄骗 |
| 🥺 | 声音颤抖，胆怯/不确定 |
| 🌬️ | 呼吸急促、呼吸沉重 |
| 😮 | 喘气 |
| 👅 | 舔声、咀嚼声、湿声 |
| 💋 | 咂嘴/嘴唇噪音 |
| 🫶 | 轻轻地、温柔地 |
| 😭 | 抽泣、哭泣、悲伤/悲伤 |
| 😱 | 尖叫、喊叫、尖叫 |
| 😪 | 困倦地，迟缓地/无精打采地 |
| 😴 | 说梦话、打呼噜 |
| ⏩ | 语速快、动作快、动作快 |
| 📞 | 通过电话、通过扬声器 |
| 🐢 | 慢慢地 |
| 🥤 | 吞咽声、吞咽声 |
| 🤧 | 咳嗽、抽鼻子、打喷嚏、清喉咙 |
| 😒 | 吐舌头、咔嚓咔嚓 |
| 😰 | 惊慌、烦躁、紧张、口吃 |
| 😆 | 高兴地、高兴地 |
| 💥 | 用力/动量，用力 |
| 😠 | 生气、不高兴、生闷气 |
| 😲 | 惊讶、敬畏/感叹 |
| 🥱 | 打哈欠 |
| 😖 | 痛苦地、痛苦地 |
| 😟 | 焦急地、担心地 |
| 🫣 | 害羞的，害羞的 |
| 🙄 | 气愤的翻白眼 |
| 😊 | 高兴地、高兴地 |
| 😎 | 自信地、自豪地 |
| 👌 | 反向渠道，一致的声音 |
| 🙏 | 苦苦哀求、苦苦哀求 |
| 🥴 | 醉酒 |
| 🎵 | 嗡嗡声 |
| 🤐 | 闷闷不乐（捂住嘴） |
| 😌 | 心旷神怡、心满意足 |
| 🤔 | 疑问的声音，疑惑的声音 |
| 💪 | 凭借努力、坚强 |
| 👃 | 嗅闻/闻气味的声音 |
| 📖 | 旁白、独白 |

重复相同的表情符号可以增强其效果。表情符号控制并不完全一致，因此将它们视为风格提示而不是保证输出。有关上游列表和未来更新，请参阅[官方IrodoriTTS表情符号注释](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md)。

## 长语音留言

Irodori v4.1使用其持续时间预测器来预测输出长度，而不是生成固定长度的剪辑，因此服务器不会强加自己的每个话语持续时间上限。TomoriBot在合成之前仍然对长文本进行分块，并将生成的音频连接成一个WAV响应，因此Discord收到一条语音消息； 分块使每个推理过程都很短，这就是限制延迟的原因。

该实现从[官方Irodori OpenAI兼容服务器](https://github.com/Aratako/Irodori-TTS-Server/blob/main/src/irodori_openai_tts/app.py) 使用的分块方法开始，其默认启用80个非空白字符的分块。TomoriBot添加了更严格的边界处理，因此结束引号和括号与它们结束的标点符号保持一致，诸如`！？`和`...`之类的标点符号保持在一起，数字旁边的小数点不会拆分，并且非常短的最终尾部会合并回前一个块中。

一旦达到配置的最小长度，分块更喜欢强句子结尾，例如`。`、`！`、`？`、`.`、`!`、`?`、省略号和换行符。仅当块增长到阈值的1.5倍左右时，逗号才用作后备边界。使用默认的`IRODORI_CHUNK_MIN_CHARS=80`，强边界在80个非空白字符和大约120个非空白字符处变得合格。如果长段落不包含合格的标点符号，它仍然可以保留为单个合成请求。

对于仅包含字幕的VoiceDesign，第一个块生成的Irodori种子将重新用于其余块，以减少接缝之间的随机变化。重复使用种子并不能保证独立合成的块之间具有相同的音色。参考音频模式继续将相同的参考剪辑应用于每个块。

长输入需要多次顺序推理，并且在较慢的硬件上可能需要更长的时间。TomoriBot的默认TTS客户端超时时间为240秒。你可以使用`IRODORI_CHUNKING_ENABLED=false`禁用分块，或使用`IRODORI_CHUNK_MIN_CHARS`调整近似分割阈值。

## 通过摇摆采样加快推理速度

默认值仍然是Irodori的更高质量40步线性采样。为了降低延迟，请尝试使用更少的步骤进行Sway采样：

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

这是推理质量和速度的权衡，因此在将其永久化之前，请使用你选择的检查点和声音进行测试。

## 环境变量

| 多变的 | 默认 | 目的 |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Hugging Face模型存储库或支持的存储库/子文件夹源 |
| `IRODORI_TTS_CHECKPOINT` | 未设置 | 可选本地`.pt`或`.safetensors`检查点； 覆盖拥抱脸模型 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 服务器绑定地址； 参见[网络接入](/zh-CN/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | 服务器端口 |
| `IRODORI_MODEL_DEVICE` | `auto` | 型号设备（`auto`、`cuda`、`cpu`、`mps`、`xpu`） |
| `IRODORI_CODEC_DEVICE` | `auto` | 编解码器设备 |
| `IRODORI_MODEL_PRECISION` | CUDA上为`bf16`，否则为`fp32` | 模型精度 |
| `IRODORI_CODEC_PRECISION` | `fp32` | 编解码精度 |
| `IRODORI_COMPILE_MODEL` | `false` | 为Irodori模型启用`torch.compile` |
| `IRODORI_COMPILE_DYNAMIC` | `false` | 编译时启用动态形状 |
| `IRODORI_NUM_STEPS` | `40` | 欧拉采样步骤 |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | 抽样时间表（`linear`或`sway`） |
| `IRODORI_SWAY_COEFF` | `-1.0` | 使用`sway`时间表时的摇摆系数 |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | 文字引导量表 |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | 标题/语音设计指导量表 |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | 参考说话人指导量表 |
| `IRODORI_MAX_REF_SECONDS` | 检查点默认值 | 参考音频持续时间的可选上限 |
| `IRODORI_CHUNKING_ENABLED` | `true` | 在符合条件的标点符号边界处分割长文本并连接生成的块 |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | 强句子边界分割前的最少非空白字符； 逗号是后备边界，约为该值的1.5倍 |

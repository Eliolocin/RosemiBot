---
title: "Chatterbox TTS"
aiGenerated: true
---

使用本地 [Chatterbox](https://github.com/resemble-ai/chatterbox) 文本转语音服务器克隆带有情感标签的英语语音。

Chatterbox通过`servers/tts/chatterbox/server.py`在本地运行。它默认为快速Chatterbox-Turbo模型（350M参数），带有内联情感事件标签，如`[laugh]`和`[sigh]`。你还可以为CPU设置配置轻量级Chatterbox-Nano模型（110M参数），或为无分类器指导 (`cfg_weight`) 和情感`exaggeration`调整配置标准0.5B模型。该包装器不加载Chatterbox Multilingual V3。

## 安装

从TomoriBot存储库根（克隆TomoriBot的文件夹）运行这些命令：

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

当TomoriBot使用Chatterbox时，保持该终端打开。默认端点URL为`http://127.0.0.1:8011`； 设置`CHATTERBOX_PORT`使用另一个端口。

### 可选：使用Chatterbox-Nano

Nano需要使用`nano=True`加载器选项进行Chatterbox构建。完成上述正常设置后，在同一虚拟环境中安装固定的上游版本。提交哈希修复了兼容的源版本； 这不是安全保证。此命令需要`git`并保留已安装的运行时依赖项：

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

然后在启动包装器之前设置`CHATTERBOX_FAST_MODEL=nano`。保留Turbo的变量未设置。在Windows PowerShell上，使用`$env:CHATTERBOX_FAST_MODEL = "nano"`进行设置； 在Linux或macOS上，使用`CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`。`/health`响应报告`fast_model`，以便你可以验证加载的选择。Nano和Turbo使用相同的克隆请求和支持的事件标签。两者都是纯英文的。

`/config`快速模型切换必须保持启用状态才能使用Nano或Turbo。禁用它会选择标准Chatterbox 0.5B模型进行CFG权重和夸张调整。

### 标准Chatterbox（0.5B带CFG和夸张）

原始0.5B基础Chatterbox模型 (`ChatterboxTTS`) 直接构建到服务器包装器中。它使用无分类器指导 (`cfg_weight`) 和情感`exaggeration`将Turbo的内联括号事件标签换成细粒度的声音控制。

要使用标准模型：
1. 正常启动服务器包装器。
2. 在Discord中，运行`/config` > `模型` > `TTS参数与语音`。
3. 关闭`Fast Model (Turbo)`选项。
4. 在下一代，包装器会延迟下载标准0.5B模型并将其加载到内存中。

这两个值都是`编辑参数`模式中的文本字段。它们始终是可编辑的，并且页面指出在启用快速模型时它们会被忽略：
- **`cfg_weight`**（默认`0.5`）：调整合成音频与参考速度和声音风格的吻合程度。
- **`exaggeration`**（默认`0.5`）：控制交付的情感强度和戏剧性变化。

> [！笔记]
> 标准Chatterbox不支持内联括号事件标签（例如`[laughs]`或`[sigh]`）。当快速模型切换关闭时，TomoriBot会自动从提示文本中去除括号标签。

## 在TomoriBot中注册

在端点标签或模型名称里包含`Chatterbox`。TomoriBot只通过这个名称（或包含它的端点URL）来识别Chatterbox端点，所以Turbo的标签白名单、标准模型的标签剔除，以及`/generate voice-message`里的Chatterbox选项，只有在这个名称存在时才会生效。

运行`/providers`，选择`添加新自定义端点`，并使用语音合成的API兼容性：

- API兼容性：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8011`

保存连接后，选中它，用它的模型下拉菜单添加一个语音合成模型。把语音来源模式选为`声音克隆`，把脚本标记风格选为`方括号标签`，这样表达标签在发送时才会保留下来。

端点注册和模型设置都在`/providers`里做，之后打开`/config` > 模型 > `切换模型`，选中并启用已注册的端点。

## 设置人格声音

1. 准备一段干净的10秒语音片段，只有一个扬声器，没有背景音乐。
2. 在模型 > `TTS参数与语音`下打开`/config`并上传剪辑。
3. 在人格 > `语音`下打开`/config`，然后选择人格和语音样本。

更长的剪辑对Chatterbox没有任何增加，而且也不被拒绝。它的运行时会在调节之前截断参考，因此经过窗口的音频会被上传、存储，然后被忽略（[`tts_turbo.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts_turbo.py)、[`tts.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py)）：

- 每个变体的前10秒都会发出声音提示。
- 语音令牌上下文在Turbo和Nano上是前15秒，在Standard上是前6秒。

这些窗口是上游运行时中的常量，而不是已发布的指南：存储库自述文件没有提供参考剪辑长度，其示例文件名仅为`your_10s_ref_clip.wav`。运行时实际强制执行的长度是最小值，断言提示的长度超过5秒。

因此，十秒是实际目标。它填充声音提示，这是设置音色和交付的地方，并且10到15秒之间的剪辑仅在Turbo和Nano上添加语音令牌上下文。说话者嵌入仍然是根据整个剪辑计算的，因此更长的时间不会改变说话者身份，只会丢弃多少未读的提示。

当启用快速模型切换时，Turbo和Nano可以使用括号事件标签，例如`[laugh]`和`[sigh]`。

## 可选调整

使用Models > `TTS参数与语音`下的`/config`来调整Chatterbox请求负载：

- 快速模型切换默认启用。TomoriBot保留受支持的Turbo/Nano事件标签，并在包装器调用`ChatterboxTurboTTS.generate(...)`之前删除不支持的括号描述符。
- `cfg_weight`默认为`0.5`。最小值为`0`； TomoriBot没有设置硬性最大值。仅当`turbo`为`false`时适用； 较低的值有助于减慢快速的参考声音，而较高的值会更强烈地跟随参考声音。
- `exaggeration`默认为`0.5`。最小值为`0`； TomoriBot没有设置硬性最大值。仅当`turbo`为`false`时适用； 较高的值使表达更具表现力或戏剧性，并且可能会加快讲话速度。

支持的Turbo/Nano事件标签为`[clear throat]`、`[sigh]`、`[shush]`、`[cough]`、`[groan]`、`[sniff]`、`[gasp]`、`[chuckle]`和`[laugh]`。不支持的描述符（例如`[excited]`、`[whisper]`或`[smiles]`）将被剥离，而不是发送到TTS。

当`turbo`禁用时，TomoriBot在将文本发送到TTS之前删除所有括号描述符，然后包装器延迟加载标准`ChatterboxTTS`模型并调用`model.generate(..., cfg_weight, exaggeration)`。

---
title: "配置：本地 LLM"
sidebar:
  order: 1
aiGenerated: false
---

TomoriBot 可以使用任何与 OpenAI 兼容的本地 LLM 服务器做文本生成与嵌入。
本指南以 Ollama 为例走一遍流程，因为它最容易上手。

等你摸清门路之后，可以考虑更灵活的服务器，比如
[KoboldCPP](https://github.com/LostRuins/koboldcpp)，并直接从
[Hugging Face](https://huggingface.co) 使用开源模型，因为挑选和试玩各种社区自制模型，正是自己跑 AI 的一半乐趣。

:::note[不需要环境变量]
本地模型通过 Discord 斜杠指令注册，并加密存储在数据库里。它们没有对应的 `.env` 设置。见[本地端点总览](/zh-CN/self-hosting/local-endpoints/)。
:::

## 1. 运行你的模型服务器

安装 [Ollama](https://ollama.com)。下面的示例用的是 Google 的 Gemma 4，但 [Ollama 的模型库](https://ollama.com/library)里的任何模型都可以。

### 该拉哪个尺寸？

本地模型跑在 GPU 的 VRAM 里（显卡自带的内存，与系统 RAM 分开）。经验法则：一个模型至少需要在 VRAM 里留出相当于它下载大小的空间，再加上约 1 到 2 GB 给对话上下文。挑你的显卡装得下的最大 Gemma 4：

| 你的 GPU VRAM | 最合适的选择 | 下载大小（约） |
|---|---|---|
| 约 8 GB | `gemma4:e2b` | 7.2 GB |
| 约 12 GB | `gemma4:12b` | 7.6 GB |
| 约 16 GB | `gemma4:12b`（能完全装下），或 `gemma4:26b` | 7.6 / 18 GB |
| 24 GB 以上 | `gemma4:26b` 或 `gemma4:31b` | 18 / 20 GB |

下载大小是 Ollama 默认量化下的数值；准确数字见
[模型页面](https://ollama.com/library/gemma4)。不确定自己有多少 VRAM？Windows 上：任务管理器 → 性能 → GPU，看「专用 GPU 内存」。

:::tip[为什么 26B 能打出超过体积的表现]
`gemma4:26b` 是一个混合专家（MoE）模型：它持有许多「专家」子网络，但每个词元只激活约 4B 参数。所以即使它约 18 GB 的权重并不完全装得进 16 GB，那点溢出到系统内存的部分也几乎不会像同体积的稠密模型那样拖慢它。这就是它能在许多 16 GB 显卡上愉快运行的原因。
:::

拉取你选定的尺寸并启动服务器：

```sh
ollama pull gemma4:12b     # 换成装得进你 VRAM 的那个标签
ollama serve               # 监听 http://127.0.0.1:11434
```

确认从 TomoriBot 所在的那台机器能访问到它：

```sh
curl http://127.0.0.1:11434/v1/models
```

记下实际安装的确切标签，因为这就是你要注册的模型名称：

```sh
ollama list
# NAME              ID            SIZE
# gemma4:12b        a1b2c3d4...   7.6 GB
```

## 2. 在 Discord 里注册它

运行 `/providers`（对整个服务器生效）或 `/personal providers`（只对你生效），选择 `添加新自定义端点`，然后填入：

| 字段 | Ollama 的取值 |
|-------|------------------|
| `endpoint_label` | 你自己起的名字，例如 `home-ollama` |
| API 兼容性 | `OpenAI-Compatible`（推荐）或 `Ollama` |
| `endpoint_url` | OpenAI 兼容用 `http://127.0.0.1:11434/v1` · Ollama 用 `http://127.0.0.1:11434` |
| `auth_token` | *（留空）* |

:::tip[选与 API 兼容类型匹配的那个 URL]
`OpenAI-Compatible` 和 `Ollama` 都接受裸根地址，并会把它规范化为 `/v1` 基址。
`/chat/completions` 会自动追加，所以不要自己加上。已经带路径的 URL（例如
`https://openrouter.ai/api/v1` 或某个网关前缀）会按原样存储。
:::

保存连接之后，选中它，并从它的模型下拉菜单里选择 添加新的文本模型。
填入：

- 模型名称（确切的 API ID）： `gemma4:12b`，也就是 `ollama list` 里的确切标签。
- 上下文窗口覆盖： 可选，仅 Ollama 与 KoboldCPP。设置它（例如 `8192`、
  `16384`）可以调高 Ollama 默认的 `num_ctx`，否则那个值小到会截断
  TomoriBot 的长上下文。留空则使用服务器默认值。
- 各项开关：如果模型支持函数调用就启用 `工具调用`；只有视觉模型才启用 `图像输入`；如果模型能很好地处理 JSON schema，就启用 `结构化输出`。在我们的例子里，Gemma 4 全都支持，所以把它们都勾上。

TomoriBot 会在你保存时校验连接。如果它报告端点无法访问，常见原因是 `localhost` 与 Docker 不匹配，或者 `/v1` 少写或多写（见
[注意事项与坑](#注意事项与坑)）。

添加模型会自动把它设为当前生效的 `text` 模型。开始聊天试试它。如果它因为某些原因没有生效，运行 `/config` > 模型 > 切换模型，选择你新注册的模型。

注册永远不会改动 `text` 之外的任何模型。如果你勾选了 图像理解，想让这个端点给一个看不见图像的聊天模型充当视觉助手，请用 `/config` > 模型 > 切换模型显式选择它；你以该开关注册过的每个文本端点都会出现在那里。注意视觉模型只在聊天模型看不到图像时才会被使用，所以把视觉模型设在本身能看图像的聊天模型后面，在你切换之前不会有任何效果。

## 3.（可选）给 RAG 用的本地嵌入

选中已保存的端点，用它的模型下拉菜单添加一个嵌入模型（例如
`ollama pull nomic-embed-text`，模型名称 `nomic-embed-text:latest`）。RAG 功能还要求 Postgres 里装好
pgvector。手动安装指南见[手动安装](/zh-CN/self-hosting/manual-setup/)。

## 其他服务器

下面这些都走同一套流程，只是 URL 和几处注意事项不同。

### KoboldCPP

- 以启用 OpenAI 兼容的方式启动（内置）。默认：`http://127.0.0.1:5001/v1`。
- API 兼容性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:5001/v1`。
- 和 Ollama 一样支持 `上下文窗口覆盖`。
- 加载 GGUF 模型；模型名称是已加载模型自己报告的（通常是文件名主干），请查看 KoboldCPP 的 `/v1/models` 响应。

### llama.cpp（`llama-server`）

- 构建或安装 [llama.cpp](https://github.com/ggml-org/llama.cpp)，然后用它自带的 OpenAI 兼容服务器提供某个 GGUF：
  ```sh
  llama-server -m model.gguf -c 16384 --host 0.0.0.0 --port 8080
  ```
- API 兼容性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:8080/v1`。
- 在启动时用 `-c` 设置上下文窗口，而弹窗里的 `上下文窗口覆盖` 仅适用于 Ollama 与 KoboldCPP，在这里没有效果。
- 模型名称是 `/v1/models` 报告的内容；用 `--alias my-model` 给它一个干净的名字。
- 如果你用 `--api-key` 启动它，就把那个密钥填进 `auth_token`。

### LM Studio

- 在 LM Studio 里启动 Local Server（Developer 标签页）。默认：`http://127.0.0.1:1234/v1`。
- API 兼容性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:1234/v1`。
- 模型名称是 LM Studio 为已加载模型显示的标识符。

### vLLM

- 用 OpenAI 兼容服务器提供服务：`vllm serve <model>` → `http://127.0.0.1:8000/v1`。
- API 兼容性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:8000/v1`。
- 如果你带 `--api-key` 启动 vLLM，就把那个密钥填进 `auth_token`。
- 模型名称是所提供模型的路径或名称（与 `/v1/models` 一致）。

### LiteLLM（代理多个后端）

- 运行 LiteLLM 代理；默认：`http://127.0.0.1:4000/v1`。
- API 兼容性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:4000/v1`。
- 模型名称是你在 LiteLLM 配置里定义的模型别名。
- 如果该代理强制要求 master key，就把它填进 `auth_token`。

### ChatMock（ChatGPT 账户或 Codex CLI）

由于涉及一处系统提示词兼容处理，它有自己专门的指南：
[配置：ChatMock](/zh-CN/self-hosting/local-endpoints/setup-chatmock/)。

## 从 Hugging Face 挑选模型

除了 Ollama 精选的模型库，[Hugging Face](https://huggingface.co) 还托管着成千上万的社区模型。KoboldCPP、llama.cpp 和 LM Studio 都能加载 GGUF 格式，那是一种单文件包，你下载下来让服务器指向它即可。

1. 找一个 GGUF。 在 Hugging Face 上搜索你的模型名加上「GGUF」，像
   [bartowski](https://huggingface.co/bartowski) 这样的社区量化者会在大多数热门模型发布后不久就放出 GGUF 构建。优先选 instruct 或 chat 变体（名字以 `-Instruct` 或
   `-Chat` 结尾）；基础模型不会进行对话。
2. 挑一个装得进你 VRAM 的量化版本。 同一个仓库会把同一个模型以很多量化档位列出，而一个文件的体积大致等于它需要的 VRAM（再加上约 1 到 2 GB 给上下文，规则与上面
   [尺寸表](#该拉哪个尺寸)相同）。下载你选定的那个 `.gguf` 文件。
3. 加载它。 用那个文件启动 KoboldCPP 或 `llama-server`（见
   [其他服务器](#其他服务器)），然后照常把端点注册进 Discord。

:::tip[选哪个量化？Q4 或 Q5 是最佳区间]
量化把每个权重存进更少的比特来缩小模型，代价是轻微的质量损失。像 `Q4_K_M` 或 `Q5_K_M` 这样的名字里的代码就是每权重比特数：4 比特（Q4）或 5 比特（Q5）通常是最佳区间，能以大约 8 比特一半的体积保住大部分质量。低于 4 比特会迅速劣化。而在固定的 VRAM 预算下，Q4 的更大模型通常胜过 Q8 的更小模型。
:::

## 注意事项与坑

- 一个标签对应一个端点条目。 要注册共享同一个服务器的多个模型，就选中已保存的端点，再用它的模型下拉菜单。真正不同的服务器或 API 协议，请使用不同的标签。
- 模型名称就是 API 标识符。 它是发送给服务器的确切字符串。填错是连上了但回复失败这一类问题最常见的原因。
- TomoriBot 跑在 Docker 里？ 容器里的 `localhost` 不是你的主机。请使用
  `http://host.docker.internal:<port>`（Windows 与 macOS）或者主机的局域网 IP，并把
  模型服务器绑定到 `0.0.0.0`。

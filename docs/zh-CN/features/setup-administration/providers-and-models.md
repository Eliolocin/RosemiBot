---
title: "提供方与模型"
sidebar:
  order: 1
---

TomoriBot连接到外部AI提供商，而不是托管内置模型。你可以连接Google Gemini、OpenRouter和NovelAI等托管服务，或将其指向本地自部署端点。你至少需要一位提供商才能开始聊天。

## API密钥
<!-- anchor: api-keys -->

在首次设置期间使用`/setup`添加提供商密钥，或者稍后通过选择`+ Add new Provider`从`/providers`添加提供商密钥。密钥在静态时进行加密，因此任何人（包括服务器管理员）都无法读回它们。

`/setup`询问回复应该如何首先到达模型，答案决定它收集的内容：

| 模式 | 它收集什么 |
|---|---|
| 人工智能提供商（推荐） | 目录中的提供者及其API密钥，已作为草稿进行验证和加密。|
| 自定义端点（高级） | 端点连接和一个文本模型，在向导内注册。请参阅[自定义端点](#custom-endpoints)。|
| 用户BYOK（仅限公会） | 什么都没有：工作区不保留自己的提供者，因此成员必须提供个人提供者。|

在你按`完成设置`之前，不会将任何内容写入数据库。废弃或过期的向导不会影响工作区的现有提供程序行。要替换现有密钥，请使用`/providers`，因为`/setup`不会在已配置的工作区上运行。

每个提供商都有自己的密钥生成步骤。在`/help`中，选择`设置`，然后选择`获取API密钥`，然后选择你的提供商进行分步演练，或使用以下起点：

| 提供者 | 笔记 | 获取钥匙 |
|---|---|---|
| Google双子座 | 免费套餐，运行所有功能。建议首先设置。| [AI工作室](https://aistudio.google.com/apikey) |
| OpenRouter | 一键，多种型号（部分免费）。| [OpenRouter键](https://openrouter.ai/settings/keys) |
| NovelAI | 订阅; 未经审查的讲故事和角色扮演（仅限文本）。| [NovelAI](https://novelai.net/) |
| 深度搜索 | 即用即付推理模型。| [DeepSeek](https://platform.deepseek.com/api_keys) |
| NVIDIA NIM | 托管文本、嵌入和图像。| [NVIDIA构建](https://build.nvidia.com/) |
| 人择 | 通过API进行克劳德模型（不是克劳德代码）。| [人择](https://console.anthropic.com/) |
| Z.ai | GLM家族。⚠️ ToS将使用限制于编码和代理场景。| [Z.ai](https://z.ai/) |
| Vertex AI | 通过`gcloud` ADC的Google云（最适合本地运行或开发设置）。| 见下文 |
| Vertex AI Express | Google云API-密钥BYOK（预览版，Gemini子集）。| [快速模式](https://console.cloud.google.com/expressmode) |
| 风俗 | 任何OpenAI兼容端点（Ollama、vLLM、LiteLLM，...）。| 请参阅[自定义端点](#custom-endpoints) |

:::caution
切勿与其他人共享你的API密钥。从`/providers`中的`编辑端点`操作添加或替换自定义端点的承载身份验证令牌。
:::

Vertex AI使用应用程序默认凭证 (ADC) 而不是存储的机密进行身份验证。对于本地托管，ADC可以来自`gcloud`； 托管部署应使用工作负载身份或服务帐户。AI Studio API密钥单独无法验证完整的Vertex AI。所选的Google云项目必须启用计费和Vertex AI API，并且主机身份需要Vertex访问权限。设置指南可从`/help`中的`API Keys`页面上的Google Vertex AI获取。

Google支持的提供程序设置通过经过身份验证的模型列表端点来验证凭据。它不会生成文本，也不依赖于当前标记为目录默认值的聊天模型，因此已停用的默认模型无法阻止保存有效凭据。

### 可选：Brave Search密钥

Brave Search与你的AI提供商分开，并通过图像、视频和新闻结果增强网络搜索。设置为`/providers`。⚠️ Brave包含每月5美元的免费信用，因此请在Brave仪表板中设置5美元的使用限额，以避免意外收费。

## 选择模型

使用`/providers`管理服务器凭据、模型目录和端点注册。然后使用`/config` > `模型` > 交换机模型来选择服务器的每个成员使用的共享功能分配。这两个命令都需要服务器管理权限。

个人成员使用`/personal providers`管理自己的凭据和目录，然后在`/personal config`中选择个人模型。个人设置遵循他们使用TomoriBot的每台服务器。用户设置请参见[个性化](/zh-CN/features/knowledge/personalization/#your-own-providers)。

面板的标题为`服务器提供方`和`个人提供方`，因此打开时所有权很明确。

在`/config` > `模型` > 交换机模型中，你可以跨八个功能槽分配模型和端点：

- **文本**：主要聊天模型。
- **视觉**：当聊天模型无法读取图像时。
- **嵌入**：为[文档知识库](/zh-CN/features/knowledge/memory/#document-knowledge-base-rag)提供支持。
- **标准图像**：标准图像生成（参见[图像生成](/zh-CN/features/capabilities/media-generation/image-generation/)）。
- **NovelAI图像**：NovelAI图像生成。
- **视频**：视频生成。
- **TTS端点**：文本转语音语音端点。
- **STT端点**：语音到文本的音频转录端点。

前六个槽选择模型目录记录。TTS和STT插槽改为选择工作区范围的端点，激活选定的端点而不是编写模型列。在`/providers`中注册并编辑这些端点。`/personal config`保留6个个人模型路由插槽，不包括个人TTS/STT端点选择器。

你还可以管理`/providers`中的自动故障转移和负载平衡的备份密钥。

## 判定模型
<!-- anchor: decision-models -->

判定模型是 `/providers` 和 `/personal providers` 中的一个独立类别。它们以概率形式回答类型化谓词。注册不会改变活动的聊天模型、建立校准或启用回复审查跳过。这些面板尚不选择判定模型。

OpenRouter 是受支持的原生提供商。保存其密钥，打开其模型下拉菜单，然后选择 `+ 添加判定模型`。从其已验证的判定目录中输入 ID。全局目录包含 `typesafe/jev-1.13`；其他注册归属于其服务器或个人所有者。原生发现提供记录在案的输入限制和价格。聊天目录无法建立判定支持。

对于自定义服务，选择 `添加新的自定义端点`，然后在 `API 兼容性` 中选择 `兼容 System One` 或 `兼容 OpenAI Decisions`。保存 API 基础 URL 和可选的 Bearer 凭据。其模型下拉菜单提供 `+ 添加判定模型` 并继承该协议。输入记录在案的模型 ID 和输入 token 限制（至少 512）。Jev、Laya 和 Kev 使用 System One 兼容性。现有的聊天兼容和 Ollama 原生端点不提供此操作。

裸源规范化为 `/v1`。显式版本和网关前缀保持不变：`https://decision.example.invalid/gateway/v1` 在 System One 下调用 `/gateway/v1/systemone`，在 OpenAI Decisions 下调用 `/gateway/v1/decisions`。可达性检查使用 `GET <stored-base>/models` 且不发送对话数据；它不证明模型功能。当自动发现无法建立必要的功能元数据时，自定义模型将根据其服务文档手动注册。

打开已保存的判定注册即可对其进行编辑。自定义编辑会保留其确切的模型和端点身份。在 `注册操作` 下选择 `删除此判定注册` 可以在保留连接和凭据的同时将其删除。删除其父提供商或端点会移除该所有者的注册。其他所有者保留共享条目。模型列表在达到 18 个可编辑注册后使用现有页面控件进行分页。

提供商注册和凭据保留在预设/配置导出和导入之外。重置配置会保留保存的注册；删除父项会显式清理它们。

## 自定义端点
<!-- anchor: custom-endpoints -->

自定义端点允许你将自部署或代理支持的服务（Ollama、LM Studio、LiteLLM、vLLM、ComfyUI、本地TTS/STT）注册为标记的提供商捆绑包。

- **服务器范围**：打开`/providers`进行工作区端点注册和编辑。
- **个人范围**：打开`/personal providers`获取个人模型目录（参见[个性化](/zh-CN/features/knowledge/personalization/#your-own-providers)）。个人语音端点不是从`/personal config`中选择的。

标签是面向用户的菜单名称，当它们共享一个端点URL时，会将功能分组到一个捆绑包中。它永远不会发送到远程服务。从不同URL提供的功能需要不同的标签。

添加自定义端点：

1. 在`/providers`中，选择`Add New Custom Endpoint`。
2. 选择API兼容性并保存连接。保存准备该协议支持的功能，而无需注册任何模型。
3. 选择新端点并使用其模型下拉列表来注册准确的模型代码和功能。添加模型会激活它的该功能。
4. 使用相同的下拉菜单附加更多模型或编辑现有注册。文本模型以这种形式声明自己的功能，图像模型声明它们支持哪些请求模式。

对于TTS和STT，在`/providers`中注册终端及其型号，然后在`/config` > `模型` > 切换型号中选择并激活终端。这些语音槽选择端点而不是模型目录条目。

API兼容性决定了服务实现的请求路径和有效负载，因此它也决定了连接准备哪些功能槽。为这些插槽注册确切的模型是一个单独的步骤，因为无法仅从端点URL可靠地推断出协议。

`/setup`的`自定义端点（高级）`模式在向导中执行相同的两个步骤：`配置连接`在可达性检查后面保存API兼容性、标签、URL和可选的身份验证令牌，`配置文本模型`注册确切的文本模型及其功能声明。模型按钮保持禁用状态，直到连接验证为止，重新保存连接会清除模型声明，因为声明取决于API兼容性。当你按`完成设置`时，向导会同时创建连接、已保存的提供程序、模型和活动模型行。该向导仅注册文本模型； 图像、视频、TTS和STT功能注册在`/providers`中。

OpenCode Go (`https://opencode.ai/zen/go/v1`) 和OpenCode Zen (`https://opencode.ai/zen/v1`) 作为OpenAI兼容的自定义端点。TomoriBot向它们发送所需的每次对话会话ID，该ID源自通道和人格的哈希值，因此Discord ID不会离开机器人。

有关运行本地服务器的完整演练，请参阅：

- [设置：本地LLM](/zh-CN/self-hosting/local-endpoints/setup-local-llm/)：Ollama、KoboldCPP、LM Studio、vLLM、LiteLLM。
- [Setup: ComfyUI](/zh-CN/self-hosting/local-endpoints/setup-comfyui/)：本地图像和视频生成。
- [设置：ChatMock](/zh-CN/self-hosting/local-endpoints/setup-chatmock/)：ChatGPT帐户或Codex CLI。

## 支持的提供方
<!-- anchor: supported-providers -->

如果你没有硬件来托管自己的模型，TomoriBot支持广泛的云服务。并非每个提供商都提供所有功能。

### LLM提供方

| 提供者 | 流媒体 | 工具调用 | 图像输入 | 嵌入 | 笔记 |
|---|---|---|---|---|---|
| Google双子座 | ✅ | ✅ | ✅ | ✅ | 提供免费模型 |
| OpenRouter | ✅ | ✅ | ✅ | ✅ | 提供免费模型 |
| 人择 (API) | ✅ | ✅ | ✅ | - | 不是克劳德·代码 |
| NovelAI | ✅ | ✅ | - | - | 只有GLM 4.6可以使用工具 |
| NVIDIA NIM | ✅ | ✅ | ✅ | ✅ | 提供免费模型 |
| 深度搜索 | ✅ | ✅ | - | - | - |
| Z.ai | ✅ | ✅ | ✅ | - | 免费模型； ⚠️ ToS = 仅限编码和代理使用 |
| Z.ai编码 | ✅ | ✅ | - | - | 认购计划 |
| Google Vertex AI | ✅ | ✅ | ✅ | ✅ | 包括“免费”Express版本 |
| Codex CLI（通过ChatMock） | ✅ | ✅ | ✅ | - | [设置](/zh-CN/self-hosting/local-endpoints/setup-chatmock/) |

### 图像生成

| 提供者 | 文本转图像 | 图像到图像 | 修复 | 笔记 |
|---|---|---|---|---|
| Google | ✅ | ✅ | - | - |
| OpenRouter | ✅ | ✅ | - | - |
| NovelAI | ✅ | ✅ | ✅ | 可以与其他提供商结合 |
| 英伟达 | ✅ | - | - | 仅文本到图像； 参考图像被忽略 |
| Z.ai | ✅ | - | - | - |

这些是提供商的图像模型的起始默认值。NovelAI通过它自己的管道而不是这个表来运行。通过`/providers`注册图像模型，你可以声明该模型自己的模式，这就是你在ComfyUI工作流程或API支持屏蔽编辑的提供程序模型上启用修复的方式。你从未声明的模型将继续遵循上述默认值。仅声明模型支持的内容：TomoriBot仅为你选择的模式提供工具，不支持的模式将在生成时失败。

### 视频生成

| 提供者 | 文本转视频 | 图像转视频 | 笔记 |
|---|---|---|---|
| Google | ✅ | ✅ | 异步轮询工作流程 |
| OpenRouter | ✅ | ✅ | 异步轮询工作流程 |
| Z.ai | ✅ | ✅ | 异步轮询工作流程 |

### 语音与音频

| 提供者 | 文字转语音 | 语音转文本 |
|---|---|---|
| ElevenLabs | ✅ | ✅ |

本地语音引擎包含在[自部署](/zh-CN/self-hosting/) 中。对于内置的网络搜索和URL读取，请参阅[工具和扩展](/zh-CN/features/capabilities/tools-and-extensions/#web-search--url-reading)。

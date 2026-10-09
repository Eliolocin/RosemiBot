---
title: "工具与扩展"
sidebar:
  order: 1
---

除了聊天之外，TomoriBot还可以调用工具来搜索网络、阅读文档、生成媒体、设置提醒以及与Discord消息交互。她根据对话决定何时使用它们。本页介绍了内置工具、如何使用MCP服务器扩展她，以及如何使用Deliberate Tool模式保持提示精简。

以下是一些工具在对话中启用的示例：

- **1. 健康检查器**
  ```text
  Every few hours, do a mandatory wellness check on @bau_h.
  Ask them how they feel right now and if they've taken a break from coding recently.
  Track their emotional state over time with {memory_tool} and/or {memory_update_tool} to report back to them later.
  ```
- **2. 每周尤里新闻**
  ```text
  Every Friday, compile the week's notable yuri manga chapters, anime episodes, and community fanart drops using {web_search_tool}.
  Present findings with {voice_message_tool} in a seductive ASMR voice.
  ```
- **3. 睡眠警察**
  ```text
  If you notice through {message_metadata_tool} that someone is chatting past 2 AM, use {voice_message_tool} to send them a threateningly calm ASMR lullaby telling them to go to bed.
  If they keep talking 10 minutes later, use {manage_message_tool} to delete their message for their own good and remind them that sleep deprivation is a leading cause of their issues.
  ```

## 内置工具
<!-- anchor: built-in-tools -->

工具取决于支持工具调用的活动提供者和模型。许多都受到功能标志（`/config` > `权限`）、Discord权限、模型功能或可选的API密钥的限制。

| 工具 | 提示宏 | 需要 | 它的作用 |
|---|---|---|---|
| 审核能力 | `{capabilities_tool}` | - | 在回答之前检查当前的聊天能力、命令或设置。|
| 创建/更新长期记忆 | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | 保存或替换稳定的服务器事实或用户首选项。|
| 更新短期记忆 | `{short_term_memory_tool}` | （不适用于NovelAI） | 为当前频道或故事线保存临时工作记忆。|
| 创建/更新任务 | `{task_tool}` / `{task_update_tool}` | - | 安排或编辑提醒和自我任务（请参阅[计划任务](/zh-CN/features/capabilities/scheduled-tasks/)）。|
| 跨渠道消息 | `{cross_channel_tool}` | （不适用于NovelAI） | 在另一个渠道或线程中行动，并提供可选的报告。|
| 创建线程 | `{create_thread_tool}` | `thread_creation_enabled` + 子区权限 | 打开公共线程并发布其起始消息。|
| 选择贴纸 | `{sticker_tool}` | `sticker_usage_enabled` | 在回复中添加匹配的服务器贴纸或自定义表达式。|
| 管理消息 | `{manage_message_tool}` | `manage_message_enabled` | 固定、编辑或删除最近的消息（固定需要`管理消息`）。|
| 阻止/取消阻止用户 | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | 人格范围内的用户静音/阻止（不触及记忆）。|
| 与最近的消息互动 | `{message_interaction_tool}` | - | 对最近的消息做出反应或发送简短的回复。|
| 偷看个人资料图片 | `{profile_picture_tool}` | 视觉模型或`vision_llm` | 检查用户或人格的头像。|
| 阅读文档 | `{document_tool}` | - | 从PDF或任何UTF-8文本文件中提取文本：源代码 (`.py`/`.ts`/`.rs`/…)、`.json`、`.yaml`、`.md`、`.txt`和任何非二进制附件。|
| 显示消息元数据 | `{message_metadata_tool}` | - | 使用句柄和时间戳注释最近的转弯，以实现精确定位。|
| 处理YouTube视频 | `{youtube_tool}` | 具有视频支持的模型 | 按需分析特定的YouTube链接。|
| 分析图像 | `{image_analysis_tool}` | 配置为`vision_llm` | 将图像理解委托给单独的视觉模型。|
| 生成图像/动漫图像 | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + 有能力的提供商 | 生成或编辑图像（请参阅[媒体生成](/zh-CN/features/capabilities/media-generation/)）。|
| 生成语音消息 | `{voice_message_tool}` | ElevenLabs键+人格语音+`voice_message_enabled` | 发送语音Discord语音回复。|

:::note[For prompt authors]
自定义系统提示或人格指令时，请通过上表中的**提示宏**来引用工具，而不是硬编码工具名称，因为宏会在上下文组装时扩展为正确的名称，并在工具不可用时优雅地降级。`{pin_tool}`和`{timestamp_refresh_tool}`仍然用作`{manage_message_tool}`和`{message_metadata_tool}`的兼容性别名。下面的网络搜索和URL工具也有宏：`{web_search_tool}`、`{image_search_tool}`、`{video_search_tool}`、`{news_search_tool}`、`{url_fetch_tool}`和`{url_metadata_tool}`。这些动态解析为最佳可用引擎，包括公会MCP替代品。
:::

### 条件提示词区块

支持上述工具宏的提示文本也支持作用域条件：

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

对于启用的TomoriBot设置使用`capability:<name>`，或者当仅当该确切工具可用于活动提供者和模型时才应显示文本时，使用`tool:<function_name>`。当捆绑URL阅读器或公会MCP替代品可用时，请使用`tool_family:url_fetch`。在条件前面加上`!`可将其反转。块可以嵌套，并且可以包含一个`{{else}}`； 不支持一般的`and`/`or`表达式。

支持的功能名称为`tool_use`、`self_teaching`、`personal_memories`、`emoji_usage`、`sticker_usage`、`web_search`、`manage_message`、`thread_creation`、`image_generation`、`video_generation`、`voice_message`、`user_blocking`、`short_term_memory`和`time_awareness`。

工具条件反映了提供程序/模型支持、服务器配置、配置的后端、MCP替换以及当前的故意工具模式白名单。它们不会绕过或预测工具执行时执行的Discord权限检查。未知的功能名称评估为错误并被记录； 格式错误的块被省略。原始聊天消息、模型输出和工具结果永远不会被视为条件模板。

## 网页搜索与URL读取
<!-- anchor: web-search--url-reading -->

该模型看到一个统一的`web_search(query, category)`工具。在其后面，调度程序通过引擎链路由每个调用并返回第一个成功：

Brave → SearXNG → DuckDuckGo

- 当配置了Brave API密钥（使用`/providers`设置）时，**Brave** 首先运行； 它增加了图像、视频和新闻搜索。⚠️ 在Brave仪表板中设置5美元的使用限额，以避免意外收费。
- DuckDuckGo 是未设置密钥时的默认引擎。它仅涵盖文本搜索。当 DuckDuckGo 对 bot 施加速度限制或显示人机验证时，搜索将失败，她会发布通知建议使用 Brave。
- SearXNG和Crawl4AI是可选的自部署服务器，可添加更多类别和浏览器呈现的页面获取； 请参阅[自部署](/zh-CN/self-hosting/)。

为了阅读特定页面，她使用`fetch_url`。NovelAI上不可用。

## MCP服务器
<!-- anchor: mcp-servers -->

[MCP](https://modelcontextprotocol.io/)（Model Context Protocol）服务器能用你自己
登记的外部工具扩展她。

### 添加在线 MCP

使用支持 MCP Streamable HTTP 或 SSE 的提供方直连 HTTPS 端点：

1. 向提供方获取 MCP 端点及其认证要求。
2. 打开 `/config` > 插件 > MCP 服务器，选择 `+ 添加 MCP`。
3. 将端点粘贴到 `URL`，如果需要则在 `认证令牌` 中输入其 Bearer 令牌，并选择所需的 `服务器类型`。默认已选中 **通用型**。

### 添加 Smithery 服务器

托管在 Smithery 上的服务器，地址以 `.run.tools` 结尾。将该地址粘贴到 `URL`，并将你的 Smithery API 密钥粘贴到 `认证令牌`。TomoriBot 只会将密钥发送到 Smithery 位于 `api.smithery.ai` 的 API，绝不会发送到服务器地址本身。随后 Smithery 会将每次工具调用转发给该服务器，因此 Smithery 能看到所有工具请求和结果。在此支持恢复之前保存的注册信息，无需修改即可再次正常工作。

TomoriBot 会在你 Smithery 账号的第一个命名空间中（如果你没有命名空间，Smithery 会自动创建一个），为每个服务器地址保留一个 Smithery 连接并复用它，因此添加、测试和重新连接都不会堆积重复连接。TomoriBot 绝不会删除连接。早期版本的 TomoriBot 每次重新连接都会建立新连接，因此你的账号可能针对同一台服务器留有多个未使用的连接；你可以从 Smithery 控制面板中将它们移除。

部分服务器会要求你登录其所包装的服务。添加这类服务器时会失败并提示需要授权，且 TomoriBot 绝不会在 Discord 中显示登录链接。打开你的 Smithery 控制面板，为名称以 `tomoribot-` 开头的连接完成登录，然后再次添加该服务器。连接和列出工具必须在 15 秒内完成。

禁用已选用于搜索或 URL 抓取的注册项会恢复 TomoriBot 的内置选择；保持其启用则可防止自动切换。保存的工具名仅反映上次发现的内容，因此不能证明连接目前依然有效。

下载时的响应会在达到 8 MiB 时停止。大型工具目录或结果可能导致插件不可用或造成工具调用失败。对于 SSE 连接，此限制涵盖整个响应流，包含后续的连续更新。当工具返回大型文档或嵌入媒体时，请向提供方索取较小的结果、分页或文件链接。

如果服务器不需要认证，请将 `认证令牌` 留空。你的认证令牌在静态存储时会被加密，之后不再显示。打开同一个配置页面可以查看已配置的状态、启用或禁用服务器，或者在明确确认后将其移除。移除会立刻断开连接并释放一个槽位。每一行已保存的记录还会显示它上次成功发现的工具名列表（有数量上限）。`未发现` 是已知的零工具结果；`发现状态未知` 则表示这是一行历史遗留记录，或者是一个还没有成功快照的服务器。打开 MCP 管理界面只会读取已保存的元数据，不会连接远端服务器。

### 本地MCP服务器

本地MCP服务器只在自部署实例上受支持，因为公开托管的bot
要求HTTPS并会拦截本地与私有地址。如果你自己跑实例，见
[设置：本地MCP服务器](/zh-CN/self-hosting/local-endpoints/setup-local-mcp/)。

:::danger[只添加你信任的MCP服务器]
一个恶意的MCP服务器可以用隐藏指令提示词注入她、窃取
用户传给它的工具的数据，或者返回有害或错误的结果让她转发到你的
服务器。把MCP服务器当成浏览器扩展来看：有疑虑就别加。添加之前
一定要先看过这个MCP描述的工具。
:::

## 明确工具模式
<!-- anchor: deliberate-tool-mode -->

每个声明的工具都会增加提示词长度。`明确工具模式`会在消息需要任务工具时才加入工具声明，借此缩短提示词，让较小的本地模型更快回复。不过，只要贴纸使用与工具使用已开启，而且提供方支持，贴纸选择工具仍会保留，让她自然表达情绪。私信、模仿与角色扮演的限制仍然适用。若要阻止贴纸回复，请关闭贴纸使用。短期记忆到了更新期限时，也会加入维护工具，不需要用户提出要求。

- 她首先检查消息中的工具意图。内置触发器涵盖常见请求（提醒、网络搜索、内存更新、跨渠道消息、图像/视频/语音生成、媒体分析、线程创建、消息操作）。有关她当前模型、工具、设置或功能为何不可用的问题会同时暴露功能审核和官方文档访问。后续措辞也有效，例如在语音消息请求后“再做一次，但更生气”。
- 服务器管理员可以使用`/server trigger add`添加文字自定义触发短语，例如将`pic`、`img`或`pfp`映射到图像生成。
- 内置触发器可读取英文短语。其他语言通过每种语言的关键字列表可以使用相同的工具。无论你的语言设置是什么，每条消息都会检查每种发货语言的列表，因此双语服务器可以同时使用两种语言。
- 日语、中文或韩语中的自定义短语也可以匹配较长的单词，因为这些语言不使用空格分隔单词。以`*`结尾的短语与以其开头的任何单词匹配：`remind*`涵盖`reminder`和`reminding`。

### 控制项

- `/server dtm`：服务器管理员切换它。
- `/personal config`：用户自己覆盖它。
- 配置思想日志通道 (`/server thought-logs`) 后，成功的深思熟虑模式工具调用以及暴露该工具的触发器都会记录在那里。

明确工具模式仅决定向模型“显示”哪些工具，但模型仍然必须选择调用一个工具。在`/help`中，选择`行为`，然后选择`明确工具模式`，作为Discord摘要。

:::note
`明确工具模式`（本节）与`明确触发模式`无关，后者控制*she*如何触发； 参见[聊天与触发](/zh-CN/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode)。两者都缩写为“Discord”中的“DTM”。
:::

## 结构化用户信息更新

当你在聊天中直接询问时（例如“叫我队长”或“我的代词是他们/他们”），TomoriBot可以自动更新你的个人资料和人格命名偏好：

| 偏爱 | 范围 | 影响 |
|---|---|---|
| 昵称、前缀、后缀 | 每个人格 | 只有活跃人格才用此名称或头衔称呼你。|
| 性别认同、代词、称呼风格、时区 | 全球的 | 每个人格在所有服务器上使用相同的值。|

- **删除头衔**：要求她停止使用头衔（例如“停止叫我大师”）可以清除该人格。
- **隐私**：限制性隐私级别会阻止新的添加和编辑，同时仍允许你清除现有数据。
- **权限**：服务器管理员可以使用`/config` > `权限`中的`用户信息更新`切换自动更新。你始终可以使用`/personal config`手动编辑你的个人资料。

工具参数架构和数据库存储布局请参见[工具系统架构](/en/architecture/subsystems/tool-system/#structured-user-info-updates)。

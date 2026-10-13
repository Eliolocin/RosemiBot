---
title: "提示词内部"
sidebar:
  order: 2
aiGenerated: false
---

每次触发TomoriBot时，都会按以下顺序组装以下内容并将其发送到你配置的文本模型作为主要提示/上下文：

| 堵塞 | 选修的？ | 命令 | 它是什么 |
|---|---|---|---|
| [系统提示](/zh-CN/features/chatting-personality/behavior-tweaking/#system-prompt) |  | `/config` > 发动机 > 常规 | 上下文最顶部的基本说明。|

> **默认系统提示文本**：仅在未设置服务器系统提示时使用。>
> *“你是 {bot}。{bot} 确保默认情况下做出简短而简洁的回复。{bot} 仅在情况允许的情况下才会做出冗长的回复。>
> 每当有人分享某个细节或 {bot} 注意到对话中确实值得记住的细节（例如偏好、兴趣或重要事实）时，{{if tool:create_long_term_memory}}{bot} 就会主动使用可用的 {memory_tool}，更愿意记住一些事情，即使这些事情很小，只要它不与 {bot} 已经知道的内容重复即可。{{/if}}{{if tool:update_long_term_memory}}{bot} 当新信息更改或添加到 {bot} 已记住的内容时，会使用 {memory_update_tool}，而不是保存重复信息。{{/if}} >
> {{if tool:review_capabilities}}当有人询问 {bot} 可以做什么或为什么某些内容不可用时，{bot} 在回答之前会检查 {capabilities_tool}。{{/if}}{{if tool_family:url_fetch}}当需要更多详细信息时，{bot} 在`https://docs.tomoribot.app/llms.txt`上使用 {url_fetch_tool} 来获取信息。{{/if}}"*

| 堵塞 | 选修的？ | 命令 | 它是什么 |
|---|---|---|---|
| 频道提示（追加） | *（选修的）* | `/config` > `频道` > 通道覆盖 | 每个通道有所不同，在系统提示后立即分层。同一页面的“替换”模式接管上面的系统提示槽，而不是添加新的提示槽。|
| 人格提示 | *（选修的）* | `/config` > `人格` > 高级 | 专门为活动人格编写的提示，与系统提示分开。|
| [人格属性](/zh-CN/features/chatting-personality/multiple-personas/#attributes) |  | `/config` > `人格` > `身份与性格` | 活跃人格的性格特征和言语模式。|
| 服务器信息 |  | *（无，来自Discord）* | 服务器名称、描述和她所在的频道均从Discord本身提取。|
| [人格-用户块](/zh-CN/features/capabilities/tools-and-extensions/#built-in-tools) | *（选修的）* | `/moderation`审核/清除； 由`/config` > `权限`（用户阻止）门控 | 此人格针对特定用户设置的主动静音/阻止限制。|
| [服务器内存](/zh-CN/features/knowledge/memory/#personal-vs-server-memories) |  | `/memories` | 为此服务器保存的长期事实。|
| [服务器表情符号](/zh-CN/features/chatting-personality/behavior-tweaking/#capabilities-what-shes-allowed-to-do) | *（选修的）* | `/config` > `插件` > `上下文补充`（`回复中的表情`）（仅切换），使用`/expressions initialize`初始化 | 服务器中存在的自定义表情符号。|
| [服务器贴纸](/zh-CN/features/chatting-personality/behavior-tweaking/#expressions) | *（选修的）* | `/config` > `插件` > `可用工具`（`贴纸使用`），使用`/expressions initialize`对原生资产进行分类，使用`/expressions manage`进行管理 | 可发送的原生贴纸和符合响应人格的每个自定义表情，包括名称、描述和情感。媒体源和人格访问规则位于提示之外。|
| [人格人格精灵](/zh-CN/features/chatting-personality/multiple-personas/#sprites-emotion-avatars) | *（选修的）* | `/config` > `人格` > 精灵 | 为人格配置的命名表情精灵（如果有）。|
| [对话参加者](/zh-CN/features/knowledge/memory/#personal-vs-server-memories) | *（选修的）* | `/personal memories`（由`/config` > `权限`（个性化）门控） | 对话中的人、他们的昵称和提及句柄，以及保存的关于他们每个人的个人记忆。当此人在上下文中拥有某条消息或提及其姓名/别名时加载。还使用`/config` > Engine > General将当前频道和本地时间作为页脚。|
| [短期记忆](/zh-CN/features/knowledge/memory/#short-term-memory-stm) |  | `/config` > `人格` > 回忆； `/memories`清除条目； 由`/config` > `权限`（短期记忆）门控 | 包含不同渠道的摘要和最新消息 |
| [`文档`](/zh-CN/features/knowledge/memory/#document-knowledge-base-rag) | *（选修的）* | `/memories` | 使用RAG从知识库中提取相关块。|
| [奖励与惩罚](/zh-CN/features/knowledge/memory/#conditioning) | *(可选)* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`, `/punish <bite\|bonk\|pinch\|spank\|squeeze>`; 使用`/conditioning remove`管理 | 此人格在这个服务器中累积的行为偏好。 |
| [对话示例](/zh-CN/features/chatting-personality/multiple-personas/#sample-dialogues) | *（选修的）* | `/config` > `人格` > `身份与性格` | 此人格如何说话的示例（如果有）已配置。|
| [最近消息](/zh-CN/features/chatting-personality/behavior-tweaking/#generation-tuning) |  | `/config` > 发动机 > 常规 | 实际对话，最多这么多消息（默认80条）。你的上下文注释和任何团聚注释都会以可配置的深度内联注入此块内，而不是作为它们自己的单独块。|

当没有什么可说的时，标记为 *(可选)* 的行不贡献任何内容（并且不花费任何代币），例如没有匹配的文档，或者服务器没有自定义表情符号。

最近的消息是最大也是最脆弱的部分，它是一个随着人们谈话而向前滑动的窗口。它们之上的所有内容都是根据保存的设置重建的并且稳定。

`/tool prompt snapshot`将人格的确切包转储到文件中。它是当前记忆活跃的基本事实，文档是否匹配，以及对话的实际内容有多少。

`/context`绘制与模型上下文窗口的彩色网格相同的束，上面每组块一种颜色，因此你可以一目了然地看到它填充了什么以及剩余多少空间。圆圈标记小于一个正方形的组。它还显示每个回复的估计输入成本以及提供商为最后一个真实回复报告的输入令牌数量。

`/tool estimate cost`按大小分解同一个包，这对于在提高任何限制之前确定是什么正在消耗你的上下文很有用。

### 工具在哪里定义？

对于本机支持的每个提供者TomoriBot，工具模式通过提供者自己的`tools`字段发送，因此它取决于提供者/配置的推理引擎。

### 为什么TomoriBot会忘事？

这个顺序几乎解释了每一个“她为什么不记得？”的问题。问题：

| 发生了什么 | 为什么 |
|---|---|
| 她忘记了今天早些时候的一些事情 | 它滚动超过了消息限制。只存在于最近的消息中，如果Tomori不将其保存为长期记忆，那么一旦到达消息窗口之外就会被遗忘。|
| 她在另一个频道忘记了一些东西 | 最近的消息是每个频道的。仅服务器记忆、对话参与者和短期记忆跨渠道。短期记忆通过从不同渠道加载最近的消息来解决这个问题，但它不会转储所有内容。|
| `/refresh`让她忘记了 | 刷新会切断最近的消息并清除该频道的短期记忆，但不应删除长期记忆。删除刷新嵌入以消除截止。|
| 重启后她忘记了什么 | 最近的消息永远不会在重新启动后保存 |

如果你想让某个东西在上述所有情况下幸存下来，它就必须成为长期记忆。请参见[内存](/zh-CN/features/knowledge/memory/#long-term-memory)。

## 技巧与小窍门

- `/config` > 行为 > 常规行为可以加宽对话窗口（20到100条消息）。上下文更多，
  每条回复消耗的token也更多。
- `/config` > 行为 > 常规行为会在选定深度注入一句简短提醒。因为它位于组合的靠后位置、贴近近期消息，
  她比起系统提示词里的内容更可能照做。这是催她更频繁保存记忆的最佳位置。
- `/personal memories`和`/memories`直接写进`服务器记忆`和
  对话参与者，这是让知识在TomoriBot的上下文里永久保留的可靠办法之一。

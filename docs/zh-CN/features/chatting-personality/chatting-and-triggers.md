---
title: "聊天与触发"
sidebar:
  order: 1
---

TomoriBot被召唤时响应。本页介绍了她的触发方式、如何通过自动触发启用免提聊天，以及如何通过故意触发模式防止意外激活。

## 如何触发她
<!-- anchor: how-to-trigger-her -->

默认情况下，当你执行以下操作时，她会回复：

- **提及她**：`@TomoriBot`
- **回复**她的一条消息（包括人格的webhook消息）
- **使用触发词**：消息中任何位置的任何注册触发词
- **使用`/respond`**：手动请求响应

在DM中，直接发送消息，无需任何触发词或提及。

### 管理触发词
<!-- anchor: managing-trigger-words -->

服务器管理员使用`/config` > `人格` > 触发器来添加或删除活动人格的触发词。没有管理服务器的成员可以以只读模式查看现有触发器。

## 表情与回应
<!-- anchor: expressions--reactions -->

回复时，她可以使用服务器自定义表情符号、贴纸和表情符号反应：

- 自定义表情符号在使用`:name:`语法的对话中自然出现。
- 她可以在每个回复之前、之间或之后发送一个贴纸，作为自己的消息。
- 服务器管理员可以使用`/expressions manage`添加[自定义表达式](/zh-CN/features/chatting-personality/behavior-tweaking/#expressions)：反应GIF、图像笑话或任何网站的链接。
- 运行`/expressions initialize`，以便她了解每个服务器表情符号和贴纸何时适合。

## 角色扮演频道
<!-- anchor: roleplay-channels -->

角色扮演频道会在她的回复中隐藏自定义表情符号和贴纸消息。成员还可以在角色扮演频道中使用`/tool delete turn`删除她的最新回合，而无需管理服务器权限。

在`/config` > `频道` > 频道规则中配置角色扮演频道。

## 情境感知

每当她回复时，她都会收到描述对话发生地点和时间的上下文：

- **位置**：服务器名称、频道名称或聊天是否为私信。
- **时间**：来自`/config` > `行为` > `常规行为`的服务器本地时间和时间，以及在`/personal config`中设置时区的用户的本地时钟。
- **参与者**：显示名称、提及句柄、外观标签和待处理提醒。
- **Discord活动**：参与者当前正在播放、流式传输、收听的内容（例如Spotify曲目）或其自定义状态。

活动状态需要Discord的`Guild Presences`意图并尊重用户隐私 (`/personal config`)。提出隐私设置的用户不会包含在状态上下文中。

## 自动触发（免提聊天）

自动触发让TomoriBot加入对话而无需直接提及：

- `/config` > `频道` > 自动触发（或`/server autotrigger channels`）：选择她自主响应的通道。
- `/config` > `频道` > 自动触发（或`/server autotrigger threshold`）：设置她插话之前必须累积多少条消息。
- `/config` > `行为` > 触发行为：为通道配置基于定时器的随机触发。

在你希望机器人自然参与的专用休闲频道中使用自动触发。

## 明确触发模式
<!-- anchor: deliberate-trigger-mode -->

如果在日常对话中经常使用人格的名字，简单的触发词可能会意外激活她。故意触发模式 (DTM) 通过忽略未经修饰的触发字来防止意外激活。

当DTM有效时：

- `@{trigger}`（以`@`为前缀的触发词）触发回复
- Discord提及`@TomoriBot`仍会触发回复
- 消息回复仍然有效
- `/respond`仍然有效
- 没有`@`的普通触发词不再触发她

### 服务器与个人两级控制

- `/server dtm`：服务器管理员切换服务器默认值。
- `/personal config`：各个成员覆盖他们自己的消息的设置：
  - `off`：始终允许普通触发词
  - `follow`：遵循服务器设置
  - `on`：总是需要刻意调用

在`/help`中，选择`行为`，然后选择`明确触发模式`，作为Discord摘要。

:::note
故意触发模式（本页）控制她何时回复。明确工具模式控制在转弯时向模型呈现哪些工具。两者均简写为Discord中的“DTM”； 请参阅[工具和扩展](/zh-CN/features/capabilities/tools-and-extensions/#deliberate-tool-mode)。
:::

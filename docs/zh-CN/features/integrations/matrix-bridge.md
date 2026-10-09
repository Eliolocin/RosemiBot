---
title: "Matrix桥接"
sidebar:
  order: 1
---

将Matrix房间桥接到Discord频道，以便人们可以跨两个平台聊天。从Matrix发送的消息在Discord中显示为Webhook消息，TomoriBot直接回复到Matrix房间。

应用服务托管和部署架构请参见[矩阵桥架构](/en/architecture/integrations/matrix/bridge/)。

## 设置

1. 邀请Matrix机器人帐户到未加密的Matrix房间。
2. 复制该房间的内部房间ID（在大多数客户端中：`Room Settings` > `高级` > `Internal Room ID`，格式如`!abc:matrix.org`）。
3. 在要桥接的Discord通道中运行`/matrix link`，并粘贴房间ID。

机器人加入后，它会在Matrix中发布确认信息，但你必须使用`/matrix link`完成来自Discord的链接。要稍后断开桥接通道，请运行`/matrix unlink`。

## 从Matrix这一侧使用

- 房间连接后即可正常聊天。矩阵消息中继到Discord通道。
- TomoriBot回复Matrix房间。
- 支持的矩阵文本命令为`/kill`和`/refresh`。

## 目前的限制

- Matrix没有斜杠命令（除了`/kill`和`/refresh`）。
- 没有直接消息或基于DM的冷却提醒。
- 机器人的视觉特征看不到矩阵化身。
- 消息固定不可用。
- 自定义表情符号和复杂格式无法可靠呈现； 将中继嵌入为纯文本。
- Matrix用户的个人记忆可追溯到归属服务器记忆。

## 注意事项

- 如果机器人没有自动加入，请手动邀请Matrix机器人帐户并重新运行`/matrix link`。
- 创建房间后无法禁用矩阵加密：必须用新的未加密房间替换加密房间。
- 要取消链接通道，请使用`/matrix unlink`。
- 如果上面未列出问题，请使用`/support discord`在支持服务器中报告该问题。

在`/help`中，选择`插件`，然后选择`Matrix`，以进行Discord中的交互式演练。

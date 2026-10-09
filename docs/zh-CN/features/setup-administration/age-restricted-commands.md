---
title: "年龄限制指令"
sidebar:
  order: 3
---

TomoriBot把仅限成人的`/nsfw`指令分类放在Discord内置的年龄门槛后面，
在你主动开启之前一直隐藏。这一页说明如何访问它、以及在哪些地方可用。

## 启用年龄限制指令

1. 在Discord中，打开`User Settings` > `Privacy & Safety`。
2. 切换至`Allow access to age-restricted commands in apps`。你必须年满18岁。
3. 在标记为`Age-Restricted Channel`的通道中运行年龄限制的命令。要标记频道，请右键单击该频道，选择`Edit Channel`，然后打开`Age-Restricted Channel`（需要管理频道权限）。

如果命令受到限制并且通道未标记年龄限制，则Discord将不会显示或允许运行该命令。

## 哪些内容有门槛

- **NSFW内容设置**：`/nsfw jailbreaks`切换的是绕过*提供方一侧*过严
  内容过滤的手段（TomoriBot本身不加任何自己的安全栏杆）。见
  [不做内容过滤](/zh-CN/features/chatting-personality/behavior-tweaking/#不做内容过滤)。

图像和视频生成由各自配置的提供方和服务器
功能设置单独控制；它们不受`/nsfw`指令分类的门槛限制。

年龄限制内容是仅供成人用户使用的，所以请负责任地使用，并遵守Discord的
[社区准则](https://discord.com/guidelines)。在`/help`里选择`行为`，再选`年龄限制指令`，可以看到Discord里的同一份
讲解。

---
title: "多个人格"
# Keyword-rich <title> targeting "AI companion Discord" queries; replaces
# Starlight's default "{title} | TomoriBot" for this page only. H1 and sidebar
# keep the plain title. The homepage title bets on "AI agent" + "roleplay";
# this page carries the "companion" keyword instead.
head:
  - tag: title
    content: "TomoriBot | 为你的Discord服务器准备的AI伙伴与人格"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "在一个Discord服务器里运行多个AI伙伴。每个人格都有自己的头像、触发设置和说话风格。"
sidebar:
  order: 2
---

TomoriBot的名称、头像、性格、说话风格与行为都保存在人格中。你可以同时使用多个人格，让每个角色通过自己的触发词与Webhook头像参与对话。这一页介绍人格的行为；知识与记忆请见[记忆](/zh-CN/features/knowledge/memory/)。

## 创建人格

- `/persona create`：从头开始构建自定义人格。
- `/persona generate`：让人工智能根据提示和图像生成人格（需要支持结构化输出的提供者）。你还可以提供现有的TomoriBot预设集集或SillyTavern角色卡（请参阅[SillyTavern支持](/zh-CN/features/integrations/sillytavern-support/)）。
- `/persona default`：切换到内置默认角色之一。
- `/persona export`和`/persona import`：备份或共享人格文件。导入支持添加人格作为具有自己的触发器和webhook头像的副人格。
- `/persona remove`：删除副人格。

## 副人格

副人格让多个角色在同一个服务器中共存：

- 每个副人格都有自己的性格、触发词与Webhook头像，所以同一频道里的角色会以各自的名称与图像发言。
- 多个副人格可以回复同一条消息，上限在`/config` > `行为` > `触发行为`中设置。
- 直接回复Webhook消息，就能继续与该人格对话。
- 使用`/persona import`并选择副人格选项来添加，再用`/persona`与`/persona remove`管理。

回复路由与Webhook身份的细节，请见[多个人格架构](/en/architecture/subsystems/multi-persona/)。

## 塑造性格

微调人格的外观、谈话和行为方式：

### 属性
<!-- anchor: attributes -->

打开`/config` > `人格` > 身份和个性来定义个性特征或身体细节（例如`friendly`、`red hair`或`ends sentences with *Nya~*`）。

### 示例对话
<!-- anchor: sample-dialogues -->

打开`/config` > `人格` > 身份和个性，通过使用`{user}`和`{bot}`占位符的示例来教她的说话风格：

- `{user}`：替换为实际用户的显示名称或昵称。
- `{bot}`：替换为她当前的人格名称。

```text
{user}: What's your favorite hobby?
{bot}: Fufu~ I like knitting tiny clothes for tiny plushies~♥
```

有效示例对话的提示：

- 写出自然的交流，展示而不是讲述。
- 展示你希望她使用的语气和词汇。
- 在几个例子中增加多样性，以便她能够很好地概括。

### 名字与头像

打开`/config` > `人格` > 身份和个性，设置她对自己的称呼并上传她的头像。

你还可以在`/config` > `行为` > `常规行为`中设置自定义系统提示； 请参阅[行为调整](/zh-CN/features/chatting-personality/behavior-tweaking/)。

### 命名习惯

服务器管理员可以打开`/config` > `人格` > 命名习惯来设置人格如何称呼成员：

- 配置单独的男性、女性和中性前缀、后缀和地址术语。
- 不同的人格可以用不同的头衔来称呼同一用户（例如，一个称其为“队长”，另一个称其为“前辈”）。
- 个人覆盖遵循跨服务器的每个用户； 参见[个性化](/zh-CN/features/knowledge/personalization/)。

## 立绘（表情头像）
<!-- anchor: sprites-emotion-avatars -->

精灵是人格在对话期间切换的替代化身，以反映情绪（例如`happy`、`mad`或`embarrassed`）。

回复时，她会选择符合她情绪的精灵。要使用其中一个，她以`PersonaName (label):`开始回复行，然后Discord传递带有匹配精灵头像的消息。如果没有合适的精灵，她会用默认头像回复。

在`/config` > `人格` > Sprites中管理sprites（需要管理服务器）：

- **添加或替换**：选择人格，提供标签，上传图像（PNG、JPG或GIF），并可选择编写描述何时显示它的使用说明。
- **编辑**：更新现有精灵的标签、图像或说明。
- **删除**：删除不再需要的精灵。
- **导出和导入**：将人格的完整精灵包共享或备份为文件。

`保存为身份`切换将消息作者显示为Discord中的`Label (Persona)`，这对于具有多种形式的字符非常有用。

替换默认人格的头像会清除其内置精灵，因为它们描绘的是原始人格。你自己添加的精灵保持不变。运行`/persona default`会恢复内置精灵。

## 按频道指定人格

要选择在特定渠道中回复你的人格而不更改服务器范围的设置，请使用Personal Spotlight； 参见[个性化](/zh-CN/features/knowledge/personalization/#personal-spotlight)。

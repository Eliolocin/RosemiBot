---
title: "指令参考"
sidebar:
  order: 6
---

<!--
  GENERATED FILE: do not edit by hand.
  Run `bun run generate-command-reference` from the repository root.
-->

TomoriBot 当前注册的全部斜杠指令，由与 Discord 注册所用的同一批指令构建器和简体中文描述生成（尚未翻译的描述以英文显示）。

顶层指令组：**41**。可执行的斜杠指令：**85**。

## `/comment`

发送一条在聊天里可见、但不会进入上下文的评论嵌入。

| 指令 | 摘要 |
|---|---|
| `/comment` | 发送一条在聊天里可见、但不会进入上下文的评论嵌入。 |

## `/compact`

把最近的对话总结成一条精简的系统记忆。

| 指令 | 摘要 |
|---|---|
| `/compact` | 把最近的对话总结成一条精简的系统记忆。 |

## `/conditioning`

管理持久化的奖励与惩罚偏好记忆。

| 指令 | 摘要 |
|---|---|
| `/conditioning manage` | 管理这个服务器里所有人格记录下来的奖励与惩罚历史。 |
| `/conditioning remove` | 移除这个服务器里每个人格记录的奖励与惩罚条目。 |

## `/config`

配置人格、行为、频道、权限与模型设置。

| 指令 | 摘要 |
|---|---|
| `/config` | 配置人格、行为、频道、权限与模型设置。 |

## `/context`

查看在当前频道中，某个人格的提示词占用了模型上下文窗口的多少。

| 指令 | 摘要 |
|---|---|
| `/context` | 查看在当前频道中，某个人格的提示词占用了模型上下文窗口的多少。 |

## `/contribute`

找到源码，以及参与 TomoriBot 开发的方式。

| 指令 | 摘要 |
|---|---|
| `/contribute github` | 获取 GitHub 仓库链接，了解如何为 TomoriBot 做贡献。 |

## `/donate`

支持 TomoriBot 的开发和托管开销。

| 指令 | 摘要 |
|---|---|
| `/donate kofi` | 通过 Ko-fi 捐赠支持 TomoriBot 的开发。 |

## `/export`

把你的配置或记忆导出成可迁移的文件。

| 指令 | 摘要 |
|---|---|
| `/export config` | 把这个服务器的配置导出成可迁移的文件。 |
| `/export memories` | 把记忆导出成可迁移的文件。 |
| `/export personal config` | 把你的个人配置导出成可迁移的文件。 |
| `/export personal memories` | 把你的账号拥有的记忆导出成可迁移的文件。 |

## `/expressions`

教我什么时候该用这个服务器的自定义表情和贴纸。

| 指令 | 摘要 |
|---|---|
| `/expressions initialize` | 用 AI 视觉分析并分类所有自定义表情和贴纸 |
| `/expressions manage` | 管理表情符号、贴纸、自定义表情及人格访问权限。 |

## `/generate`

生成 AI 图像、视频和语音消息。

| 指令 | 摘要 |
|---|---|
| `/generate image` | 用你自己写的提示词或当前频道场景生成 AI 图像 |
| `/generate scene` | 让选定的人格之间生成一段简短的剧本式文字场景。 |
| `/generate video` | 用 Google Veo、OpenRouter 或 Z.ai 生成 AI 视频 |
| `/generate voice-message` | 用你挑选的声音说出一条消息 |

## `/help`

浏览设置、功能、提供方、记忆、行为、工具、媒体与集成指南。

| 指令 | 摘要 |
|---|---|
| `/help` | 浏览设置、功能、提供方、记忆、行为、工具、媒体与集成指南。 |

## `/impersonate`

扮演人格、扮演用户，或者插入系统提示词。

| 指令 | 摘要 |
|---|---|
| `/impersonate persona` | 以这个服务器的某个人格发送一条消息。 |
| `/impersonate system` | 往对话上下文里插入一条系统消息。 |
| `/impersonate user` | 让 bot 像那位成员一样写一条消息并发送。 |

## `/import`

从可迁移的文件导入配置或记忆。

| 指令 | 摘要 |
|---|---|
| `/import config` | 导入一个服务器配置文件。 |
| `/import memories` | 导入一个服务器记忆文件。 |
| `/import personal config` | 导入一个个人配置文件。 |
| `/import personal memories` | 导入一个个人记忆文件。 |

## `/kill`

立即停止当前的流式输出，并清空这个频道里排队的回复。

| 指令 | 摘要 |
|---|---|
| `/kill` | 立即停止当前的流式输出，并清空这个频道里排队的回复。 |

## `/learn`

学习、提取并把对话历史写入记忆。

| 指令 | 摘要 |
|---|---|
| `/learn history` | 用 AI 从这个频道的消息历史里提取知识。 |

## `/legal`

查看 TomoriBot 的服务条款、隐私政策与许可协议。

| 指令 | 摘要 |
|---|---|
| `/legal license` | 查看 TomoriBot 的开源许可协议 |
| `/legal privacy-policy` | 查看 TomoriBot 的隐私政策 |
| `/legal terms-of-service` | 查看 TomoriBot 的服务条款 |

## `/matrix`

把 Discord 频道连接到 Matrix 房间，实现双向转发。

| 指令 | 摘要 |
|---|---|
| `/matrix link` | 把一个 Discord 频道连接到 Matrix 房间，实现双向转发 |
| `/matrix unlink` | 移除一个 Discord 频道上的 Matrix 桥接连接 |

## `/memories`

查看和管理服务器记忆、文档和短期记忆。

| 指令 | 摘要 |
|---|---|
| `/memories` | 查看和管理服务器记忆、文档和短期记忆。 |

## `/model`

管理这个服务器的默认 AI 模型。

| 指令 | 摘要 |
|---|---|
| `/model override remove` | 移除频道和人格的模型覆盖。 |

## `/moderation`

管理成员权限、黑名单、频道与身份组白名单，以及配额设置。

| 指令 | 摘要 |
|---|---|
| `/moderation` | 管理成员权限、黑名单、频道与身份组白名单，以及配额设置。 |

## `/novelai`

为这个服务器配置 NovelAI 的文字与图像生成。

| 指令 | 摘要 |
|---|---|
| `/novelai generate image` | 用图库式标签和可选的参考图像生成 NovelAI 图像。 |
| `/novelai usage` | 查看这个服务器的 NovelAI Opus 生成用量（需要管理服务器权限）。 |

## `/nsfw`

年龄限制的指令与设置。

| 指令 | 摘要 |
|---|---|
| `/nsfw jailbreaks` | 管理这个服务器上我的提示词使用的可选越狱行为。 |
| `/nsfw persona default` | 应用一套 NSFW 人格预设集 |
| `/nsfw persona import` | 从 PNG、JSON 或 CHARX 文件导入人格，包括 NSFW 人格 |

## `/nuke`

彻底清空所有服务器数据。之后需要重新运行 /setup。

| 指令 | 摘要 |
|---|---|
| `/nuke` | 彻底清空所有服务器数据。之后需要重新运行 /setup。 |

## `/persona`

管理人格预设集

| 指令 | 摘要 |
|---|---|
| `/persona create` | 手动创建一个简单的人格预设集 |
| `/persona default` | 应用一套人格预设集 |
| `/persona export` | 把当前人格导出成可分享的 PNG 文件 |
| `/persona generate` | 用 AI 生成人格（需要兼容的提供方） |
| `/persona import` | 从 PNG、JSON 或 CHARX 文件导入人格 |
| `/persona remove` | 从服务器移除一个副人格 |

## `/personal`

管理你的个人设置

| 指令 | 摘要 |
|---|---|
| `/personal config` | 管理你的个人偏好、隐私、模型和资料。 |
| `/personal language` | 选择 TomoriBot 与你对话时使用的语言。 |
| `/personal memories` | 管理你的个人长期记忆和短期对话上下文。 |
| `/personal nuke` | 抹除 TomoriBot 在所有服务器里存着的关于你的一切。 |
| `/personal providers` | 管理你的个人提供方凭据、端点和模型目录。 |

## `/ping`

查看 bot 的延迟。

| 指令 | 摘要 |
|---|---|
| `/ping` | 查看 bot 的延迟。 |

## `/providers`

添加、查看、编辑和移除提供方凭据、端点和模型目录。

| 指令 | 摘要 |
|---|---|
| `/providers` | 添加、查看、编辑和移除提供方凭据、端点和模型目录。 |

## `/punish`

用俏皮的互动惩罚我。

| 指令 | 摘要 |
|---|---|
| `/punish bite` | 俏皮地咬我一口！ |
| `/punish bonk` | 敲我的头一下！ |
| `/punish pinch` | 捏我一下！ |
| `/punish spank` | 俏皮地打我一下！ |
| `/punish squeeze` | 捏捏我！ |

## `/quota`

管理生成配额的重置。

| 指令 | 摘要 |
|---|---|
| `/quota reset global` | 重置全服务器共用的生成配额池。 |
| `/quota reset user` | 重置某个用户的每日配额用量。 |

## `/refresh`

清空对话历史（仅限这个频道）。

| 指令 | 摘要 |
|---|---|
| `/refresh` | 清空对话历史（仅限这个频道）。 |

## `/reset`

把服务器或个人配置重置为默认值。

| 指令 | 摘要 |
|---|---|
| `/reset config` | 把这个服务器的配置重置为数据库默认值。 |
| `/reset personal config` | 把你的个人配置重置为数据库默认值。 |

## `/respond`

手动触发对当前频道最新消息的回复。

| 指令 | 摘要 |
|---|---|
| `/respond` | 手动触发对当前频道最新消息的回复。 |

## `/reward`

用有趣的互动奖励我。

| 指令 | 摘要 |
|---|---|
| `/reward feed` | 喂我吃好吃的！ |
| `/reward headpat` | 摸摸我的头！ |
| `/reward hug` | 抱抱我！ |
| `/reward kiss` | 亲我一下！ |
| `/reward tickle` | 挠我痒痒！ |

## `/scheduled-task`

管理定时任务和提醒。

| 指令 | 摘要 |
|---|---|
| `/scheduled-task edit` | 编辑定时任务或提醒。 |
| `/scheduled-task remove` | 移除定时任务或提醒。 |

## `/setup`

开始初始设置流程。配置 AI 提供方和人格。

| 指令 | 摘要 |
|---|---|
| `/setup` | 开始初始设置流程。配置 AI 提供方和人格。 |

## `/stats`

查看用量统计

| 指令 | 摘要 |
|---|---|
| `/stats generate` | 生成一张可分享的统计图像卡片。 |
| `/stats persona` | 查看某个人格在这个服务器上的用量统计。 |
| `/stats personal` | 查看你自己的用量统计。 |
| `/stats server` | 查看全服务器的用量统计。 |

## `/status`

查看当前个人、服务器或人格状态。

| 指令 | 摘要 |
|---|---|
| `/status` | 查看当前个人、服务器或人格状态。 |

## `/support`

获取帮助、反馈 bug，并加入 TomoriBot 社区。

| 指令 | 摘要 |
|---|---|
| `/support discord` | 获取官方 Discord 服务器链接，用于反馈 bug、提出建议和社区聊天。 |

## `/tool`

处理对话上下文、提示词与诊断的实用操作。

| 指令 | 摘要 |
|---|---|
| `/tool delete turn` | 从频道里删除人格最近的一轮回复。 |
| `/tool estimate cost` | 估算付费 AI 提供方的 API 费用 |
| `/tool prompt snapshot` | 把某个人格实际的 LLM 提示词导出成文件，用于调试。 |

## `/troubleshoot`

针对 TomoriBot 的行为获取帮助与排查问题。

| 指令 | 摘要 |
|---|---|
| `/troubleshoot chat` | 生成一份关于近期聊天问题的私密诊断文件。 |

## `/update`

查看 TomoriBot 最新的版本更新说明

| 指令 | 摘要 |
|---|---|
| `/update` | 查看 TomoriBot 最新的版本更新说明 |

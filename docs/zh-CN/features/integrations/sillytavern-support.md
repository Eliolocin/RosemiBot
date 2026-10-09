---
title: "SillyTavern支持"
# Keyword-rich <title> targeting "SillyTavern character cards in Discord"
# queries; replaces Starlight's default for this page only. H1 and sidebar
# keep the plain title.
head:
  - tag: title
    content: "TomoriBot | 在Discord里使用SillyTavern角色卡"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "用TomoriBot把SillyTavern角色卡与提示词预设集导入Discord。把你手上的角色带进你的服务器。"
sidebar:
  order: 2
---

TomoriBot可以从 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 导入两种资源：提示管理器预设（控制提示结构）和角色卡（角色定义）。如果你从未使用过SillyTavern，你可以安全地跳过此页面。

## 角色卡导入

使用`/persona import`将现有的SillyTavern角色带入Discord。它接受：

- **PNG卡** 嵌入`chara`或`char`元数据。
- 具有根级属性的 **v2样式JSON** 卡（`name`、`description`、`first_mes`）。
- **v3 JSON** 卡（带有嵌套`data`对象的`spec: "chara_card_v3"`）。
- **`.charx`档案**（角色卡V3包）。

`.charx`文件是包含`card.json`定义的ZIP存档。TomoriBot从`card.json`导入字符文本并跳过捆绑的资源文件（图标、精灵、音频、视频）。你可以在`/config` > `人格` > `身份与性格`中设置头像，在`/config` > `人格` > 精灵中添加精灵。

如果上传的文件是不带TomoriBot元数据的有效SillyTavern卡，则导入会自动将其转换。你还可以将一张卡片传递给`/persona generate`，以创建受该人格启发的新鲜人格。

导入在保存之前进行验证（默认限制：每个文本字段5,000个字符、200个属性、每侧100个示例对话、100个触发词）。有关字段映射和转换机制，请参阅[卡支持架构](/en/architecture/integrations/sillytavern/card-support/)。

## 提示词预设集
<!-- anchor: prompt-presets -->

SillyTavern提示管理器预设控制发送到模型的提示的顺序和布局。打开`/config` > `插件` > SillyTavern预设以导入预设、切换单个节点、切换活动预设或恢复默认格式。

### 一个预设集控制什么

- 及时订购和标记放置
- 自定义提示节点
- 后历史节点和深度注入节点
- 导入节点的初始启用状态

### 预设无法替代的内容

预设结构提示布局； 它不会替换填充它的文本源：

- 系统指令和人格字段：`/config` > `行为` > `常规行为`、`/config` > `人格` > 高级和`/config` > `人格` > 身份和个性。
- 实时聊天历史记录和检索的文档上下文。
- 自动上下文：服务器记忆、表情符号和贴纸数据、参与者列表和短期记忆。

### 原生区块如何映射

本机块直接映射到TomoriBot提示组件：

- `main`：活动系统提示符（`/config` > `行为` > `常规行为`，或默认后备）
- `charDescription`：`/config` > `人格` > 高级
- `charPersonality`: `/config` > `人格` > `身份与性格`
- `dialogueExamples`: `/config` > `人格` > `身份与性格`
- `chatHistory`：直播频道消息历史记录
- `worldInfoBefore`和`worldInfoAfter`：检索到的文档上下文（不是SillyTavern知识手册）

### 系统提示词规则

当导入的预设处于活动状态时，内置后备系统提示将被删除。但是，如果你在`/config` > `行为` > `常规行为`中配置自定义系统提示，则始终包含该提示。

### 兼容性说明

- 在`prompt_order`中禁用的节点将保持非活动状态，直到在`/config` > `插件` > SillyTavern预设中启用为止。空节点和仅注释节点永远不会被发送。
- 阻止顺序是字面意思：将`chatHistory`放在`dialogueExamples`之前会将聊天历史记录放在提示中的第一个位置。
- 历史记录后注入合并到现有对话历史记录中，而不是作为独立消息发送。
- 不支持正则表达式后处理、预设定义的采样参数（温度、top-p）和分层预设。旧版文本完成预设导入时仅删除ST块。

在`/help`中，选择`插件`，然后选择`SillyTavern预设集`，作为Discord指南。内部预置处理参见[预置系统架构](/en/architecture/integrations/sillytavern/preset-system/)。

---
title: "图像生成"
sidebar:
  order: 1
---

TomoriBot可以根据文本提示或编辑参考图像来生成图像。使用`/generate image`，或在聊天中描述你想要的内容（“画一只喝咖啡的小熊猫”）。

## 她能做什么

- **文本到图像**：根据描述生成图像。
- **图像到图像**：编辑或重新设计现有图像。
- **修复**：重画特定区域，同时保留其余区域。
- **外画**：将画布延伸到原始框架之外。
- **可定制的宽高比**。
- **参考图像**：从消息附件、贴纸、表情符号或用户和人格头像中提取。提及用户或人格以将其头像作为参考。

可用的编辑模式取决于活动后端。文本到图像和图像到图像在云提供商（Google、Vertex、OpenRouter）上工作。本地 [ComfyUI](/zh-CN/self-hosting/local-endpoints/setup-comfyui/) 自定义端点支持修复和修复，并且取决于该端点声明的功能。你的设置不支持的模式会自动从模型中隐藏。

当她生成图像时，她会将你的人格的外观标签与服务器范围的正面和负面标签（如果支持）结合起来。结果以Discord媒体库的形式出现，其中包含生成详细信息，包括任何引用的用户或人格。

## 标签自定义
<!-- anchor: tag-customization -->

每个标签源都可以使用预填充模式进行就地编辑：

- **`/config` > `人格` > `图像生成细节`**：所选人格的`外貌`标签（她的外观）。需要管理服务器权限。
- **`/personal config`**：你自己的外观标签，每当图像生成引用你时就会应用。跟随你穿越每台服务器（请参阅[个性化](/zh-CN/features/knowledge/personalization/)）。
- **`/config` > `模型` > `图像生成默认值`**：使用`编辑正向`和`编辑负向`设置添加到每一代或远离每一代的默认标签。负标签仅在后端支持负提示时适用。提交空框将重置为内置默认值。

## 设置

1. 通过`/config` > `模型` > `切换模型`配置图像模型。
2. 在`/config` > `权限` (`imagegen_enabled`) 中启用图像生成。
3. 在聊天中询问她，或者运行`/generate image`。

## 提供方支持

本机图像生成可在Google、Vertex AI、Vertex AI Express、OpenRouter、Z.ai、NVIDIA NIM和NovelAI（动漫风格）上使用。有关完整的提供商矩阵，请参阅[提供商和模型](/zh-CN/features/setup-administration/providers-and-models/#supported-providers)。

对于通过ComfyUI在你自己的硬件上进行本地生成，请参阅[设置：ComfyUI](/zh-CN/self-hosting/local-endpoints/setup-comfyui/)。

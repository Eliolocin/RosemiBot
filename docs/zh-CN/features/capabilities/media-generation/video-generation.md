---
title: "视频生成"
sidebar:
  order: 2
---

TomoriBot可以根据文本提示或通过对现有图像进行动画处理来生成短视频。使用`/generate video`，或者直接在聊天中询问她。

## 她能做什么

- **文本转视频**：根据描述生成短片。
- **图像到视频**：将图像动画化。引用消息中的第一个图像成为起始帧。
- **循环图像到视频**：当通过聊天请求时，支持的模型可以重复使用起始图像作为最终帧。
- **可定制的宽高比**。

图像到视频和循环取决于所选模型的第一帧和最后一帧支持。TomoriBot在提交生成之前检查OpenRouter的模型目录，并提示你是否需要为所选模型删除图像或循环。

生成视频需要时间：TomoriBot将作业提交给提供商，在后台检查是否完成，并在准备好后将完成的视频发布到频道。

## 设置

1. 在“`/config` > `模型` > 切换型号”中选择视频型号。
2. 确认`/config` > `权限` (`video_generation_enabled`) 中启用了视频生成。
3. 在聊天中询问她，或者运行`/generate video`。

## 提供方支持

本机视频生成功能可在Google、OpenRouter和Z.ai上使用。请参阅[提供商和模型](/zh-CN/features/setup-administration/providers-and-models/#supported-providers) 中的完整矩阵。

对于通过ComfyUI生成本地视频（例如WAN图像到视频工作流程），请参阅[设置：ComfyUI](/zh-CN/self-hosting/local-endpoints/setup-comfyui/)。

对于内部生成和轮询架构，请参阅[视频生成](/en/architecture/subsystems/video-generation/)上的参考。

---
title: "配置：ComfyUI"
sidebar:
  order: 2
aiGenerated: false
---

TomoriBot 可以通过你自己的
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) 实例生成图像和视频。它驱动 ComfyUI 的方式是提交一份API 格式工作流，其中替换进你的提示词与尺寸，然后轮询
ComfyUI 的 `/history` 端点，直到输出就绪。

本指南覆盖 ComfyUI 的安装、运行与注册。要编写或编辑一份与 TomoriBot 兼容的工作流（那些 `{TOMORI_*}` 占位符），请用 Discord 内的深入讲解：打开 `/help`，选择 `功能`，再选 `自定义端点`，并使用 GitHub 上的
[workflow README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)。

:::note[不需要环境变量]
ComfyUI 通过 Discord 斜杠指令注册，并加密存储在数据库里。
见[本地端点总览](/zh-CN/self-hosting/local-endpoints/)。
:::

## 硬件要求

图像与视频生成是 GPU 受限的：主要开销在 VRAM（显卡自带的内存，与系统 RAM 分开），它由你的工作流加载的模型检查点决定，而不是由 ComfyUI 本身决定。强烈建议使用 NVIDIA GPU。TomoriBot 自带的两份工作流都基于现代的、比 SDXL 更重的模型：

| 自带工作流 | 基础模型 | 实际所需 VRAM | 备注 |
|---|---|---|---|
| Anima v1（图像） | Qwen-Image（约 20B），fp8 | 约 16 GB 起步 · 24 GB 更从容 | 文本编码器加 VAE 会额外带来约 8 到 10 GB 开销。低于 16 GB 时，请用 GGUF 版本加 `--lowvram`。 |
| WAN i2v loop（视频） | Wan 2.2 14B，fp8 加 4 步 LightX2V LoRA | 约 16 GB 可用 · 24 GB 以上更从容 | 最重的一个，预计每个片段要几分钟。在较小的显卡上把 UMT5 文本编码器卸载到内存（`t5_cpu`，需要 24 GB 以上系统内存）。 |

自带的两份检查点都已经做过 fp8 量化，以便装进消费级显卡。如果你的 VRAM 更少，就把 UNET 换成更小的量化版本，并启用 ComfyUI 的 `--lowvram` 或 CPU 卸载。纯 CPU 扩散不实用（每张图要好几分钟，视频更糟），而且可能超出 TomoriBot 的轮询窗口，所以日常使用实际上必须有 GPU。

:::tip[想再降一档：选一个 GGUF 量化]
量化把每个模型权重存进更少的比特，以削减 VRAM 和磁盘占用，代价是轻微的精度损失。自带的 fp8 文件就是它的一种温和形式；想进一步缩小，就从 Hugging Face 下载该模型的
GGUF 版本：像 `Q4_K_M` 或 `Q5_K_M` 这样的名字里的数字就是每权重比特数，而 4 比特（Q4）或 5 比特（Q5）通常是最佳区间，能以 fp8 或 fp16 的一小部分体积保住大部分质量。低于 4 比特还能更小，但质量会迅速下降。在 ComfyUI 里加载 GGUF UNET 需要
[ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) 自定义节点。
:::


## 1. 启用 API 运行 ComfyUI

按[它的 README](https://github.com/comfyanonymous/ComfyUI) 安装 ComfyUI，并以监听网络的方式启动它：

```sh
python main.py --listen 0.0.0.0 --port 8188
```

如果 TomoriBot 跑在 Docker 里或另一台机器上，`--listen 0.0.0.0` 就很重要：默认只绑定回环地址。请确认从 bot 所在的那台机器能访问到它：

```sh
curl http://127.0.0.1:8188/system_stats
```

如果你想先测一下，就加载你选定的工作流所需要的模型检查点，并在 ComfyUI 网页界面里手动生成一次，确认端到端能跑通，再接上 TomoriBot。

## 2. 取一份 TomoriBot 工作流

下载一份开箱可用的 API 格式工作流。示例可以在仓库的
[`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) 下找到：

| 工作流 | 模式 |
|----------|-------|
| Anima v1（图像）：`tomoribot-anima-v1-comfyui.json` | `txt2img`、`img2img`、`inpaint` |
| WAN i2v loop（视频）：`tomoribot-wan-i2v-loop-video.json` | 图生视频 |

这些是 API 格式（ComfyUI 通过 *Save (API Format)* 导出的 JSON），不是普通的界面保存格式。如果你自己写一份，它必须包含 TomoriBot 会替换的 `{TOMORI_*}` 占位符（提示词、宽高、种子、参考图等）。见 workflow README，以及 `/help` 里 Providers 下的 `自定义端点` 页面。

## 3. 在 Discord 里注册它

运行 `/providers`（或 `/personal providers`），选择 `添加新自定义端点`，然后填入：

| 字段 | ComfyUI 的取值 |
|-------|-------------------|
| `endpoint_label` | 你自己起的名字，例如 `home-comfy` |
| API 兼容性 | `ComfyUI` |
| `endpoint_url` | `http://127.0.0.1:8188`（根地址，不要加 `/v1`） |
| `auth_token` | *（留空，除非你的 ComfyUI 位于认证之后）* |

保存连接之后，选中它，并用它的模型下拉菜单添加一个图像或视频模型。填入检查点的确切代号，并上传你从第 2 步下载的工作流 `.json`。模型能力必须与工作流匹配（图像工作流 → `image`，视频工作流 → `video`）。

图像模型还会询问它的 `图像能力`：文生图、参考图、局部重绘和负面提示词。只勾选你的工作流真正实现的模式，因为 Tomori 只会把已声明的模式提供给工具。局部重绘只会在 ComfyUI 连接里出现，因为没有其他 API 兼容类型接受遮罩。之后编辑该模型会带着当前选择重新打开表单，所以改代号不会清空它。

添加模型会把它自动设为当前生效的 `image` 或 `video` 模型。在聊天里直接问 Tomori 就能触发生成。如果它因为某些原因没有生效，运行 `/config` > 模型 > 切换模型
并选择你注册的 ComfyUI 端点。

## 故障排查

- 添加时无法访问： ComfyUI 绑定了回环地址，而 bot 在 Docker 里或在另一台主机上。用 `--listen 0.0.0.0` 启动它，并使用 `http://host.docker.internal:8188` 或局域网 IP。
- 生成永远不完成： TomoriBot 会轮询 `/history`，直到输出出现。冷启动和在 CPU 上跑大模型都可能超出轮询窗口。
- 提示词或尺寸被忽略，或者输出尺寸不对： 工作流缺少必需的 `{TOMORI_*}` 占位符，或者你上传的是界面格式导出而不是 API 格式。
- 能力选错： 把 `image` 工作流注册在 `video` 下（或反过来）不会运行。请按匹配的能力重新添加。

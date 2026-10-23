---
title: "设置：本地判断模型"
sidebar:
  order: 7
aiGenerated: true
---

在自己的机器上运行一个小型的判断模型，并将其注册到 TomoriBot。判断模型会以概率回答关于文本的问题，例如“是”或“否”，或者几个主题中哪一个最契合。[Kev](https://github.com/jaredpalmer/kev) 是一个开源的判断模型，支持 System One 协议，这也是 TypeSafe 托管的 Jev 所使用的相同协议。

:::note[在何处使用]
在 `/config` > 模型 中选择，或在 `/config` > 插件 > Natural Nudges 中选为主动搭话检查器后，判断模型会决定 [Natural Nudges](/features/chatting-personality/natural-nudges/#active-nudges) 何时加入对话，要求它从多个主题中挑选一个。详见[判断模型](/features/setup-administration/providers-and-models/#decision-models)。
:::

## 1. 运行 Kev

Kev 需要 [Git](https://git-scm.com)、[uv](https://docs.astral.sh/uv/) 以及 Python 3.12 或 3.13（uv 会自动代为安装）。选择适合你显存大小的型号：

| 模型 | Hub ID | 权重（约） | 说明 |
|---|---|---|---|
| Kev-0.8B | `jaredpalmer/kev-0.8b` | 2 GB | 可在 4 GB 显存的显卡上运行。准确率最低。 |
| Kev-4B | `jaredpalmer/kev-4b` | 8-9 GB | 如果显存允许，推荐作为 Kev 的首选起步模型。 |

Kev 的 README 列出了 CUDA、ROCm 和 Apple Silicon。下面的 Windows 步骤已在搭载 NVIDIA GPU 的原生 Windows 环境中验证。如果服务器无法在你的配置上启动，请在 WSL2 中执行相同的步骤。

将其克隆到 TomoriBot 文件夹之外的任意位置：

```powershell
git clone https://github.com/jaredpalmer/kev.git
cd kev
uv sync --extra serve
```

在搭载 NVIDIA GPU 的 Windows 上，`uv sync` 会默认安装仅支持 CPU 的 PyTorch，速度极慢。请将其替换为 CUDA 构建版本，并检查其是否能识别你的显卡：

```powershell
uv pip install --reinstall-package torch "torch>=2.6,<2.9" --index-url https://download.pytorch.org/whl/cu128
uv run --no-sync python -c "import torch; print(torch.cuda.is_available())"
```

输出必须为 `True`。此后请始终使用 `uv run --no-sync` 启动 Kev，因为普通的 `uv run` 会重新同步并换回 CPU 构建版本。在 Linux 和 macOS 上，请改用 `uv run --extra serve`。

启动服务器。首次运行需要下载模型，因此会花费几分钟：

```powershell
uv run --no-sync python -m kev.serve --run jaredpalmer/kev-4b --port 8009 --device cuda
```

`--device cuda` 会使 Kev 在无法使用显卡时直接报错退出，而不是静默回退到 CPU 运行。如果 Kev-4B 出现显存不足（OOM），请改用 `jaredpalmer/kev-0.8b`。在 Mac 上，去掉 `--device cuda`。

保持其运行，并在另一个 PowerShell 窗口中进行验证。第一条命令会列出模型名称，第二条命令会针对是非题返回一个介于 0 和 1 之间的概率：

```powershell
Invoke-RestMethod http://127.0.0.1:8009/v1/models
$body = '{"state":"The fictional door is blue.","model":"kev-latest","questions":{"q":{"type":"noul","instructions":"Is the door blue?"}}}'
Invoke-RestMethod http://127.0.0.1:8009/v1/systemone -Method Post -ContentType "application/json" -Body $body
```

Kev 会打印一条关于缺失 `flash-linear-attention` 的警告。此时它会采用稍慢的处理路径但输出完全相同的结果，因此可以忽略该警告。

## 2. 在 Discord 中注册

运行 `/providers`（全服范围）或 `/personal providers`（仅限个人），选择 `Add New Custom Endpoint`，并输入：

| 字段 | 值 |
|---|---|
| `Endpoint Label` | `kev` |
| `Endpoint URL` | `http://127.0.0.1:8009/v1` |
| `API Compatibility` | `System One compatible` |
| `Auth Token` | 留空，除非你设置了 `KEV_API_KEY` |

TomoriBot 会在保存时检查 `GET /v1/models`。即使服务器返回 `404` 或 `405` 仍可被接受。

打开已保存的 `kev` 端点，在其模型下拉菜单中选择 `+ 添加判断模型`，并输入：

- `Code Name`：`kev-latest`（Kev 示例中使用的模型名称）。
- `Context Window`：`8192`（Kev-0.8B 和 Kev-4B 已验证的最大文本长度）。Kev 会拒绝任何超过 65,536 个 token 的请求。

## 3. 选择模型

打开 `/config` > `模型` > `切换模型`，在 `判断` 槽位中选择 `kev-latest`。选择 `- 无模型` 可在不删除注册的情况下清除配置。

## 注意事项

- **停止服务器**：按 `Ctrl+C`。TomoriBot 不会为你自动启动或停止 Kev。
- **TomoriBot 运行在 Docker 中？** 容器内部的 `127.0.0.1` 不是你的宿主机。请使用 `http://host.docker.internal:8009/v1` 并使用 `--host 0.0.0.0` 启动 Kev。Kev 默认无密码登录，因此请先设置 `KEV_API_KEY` 并在 `Auth Token` 中填入相同的值。
- **生产环境运行时**：强制要求 HTTPS 并阻止服务商端点使用私有地址。本地 HTTP URL 仅在 `RUN_ENV=development` 时有效。详见[本地 LLM](/self-hosting/local-endpoints/setup-local-llm/#notes--gotchas)。
- **其他 System One 服务器**：如 Laya，使用其自身的 URL 和模型名称遵循相同步骤。如果服务器实现的是 OpenAI Decisions API，请改选 `OpenAI Decisions compatible`。

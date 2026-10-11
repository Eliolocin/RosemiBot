---
title: "配置：slop-guard"
sidebar:
  order: 8
aiGenerated: true
---

将基于规则的文本校对器 [slop-guard](https://github.com/eric-tramel/slop-guard) 作为 [回复审核](/zh-CN/features/chatting-personality/behavior-tweaking/#response-drafting) 的规则检查器运行。它会对每个暂扣的回复进行公式化写作模式的评分，并将报告传递给审查者。该检查基于规则，因此不消耗 token。

slop-guard 仅作为本地 stdio 进程发布。`servers/slop-guard/` 将锁定的版本（`0.5.0`）打包在一个小型容器中，通过 MCP Streamable HTTP 提供相同的工具，这也是 TomoriBot 连接到 MCP 服务器的方式。

## 启动服务器

### 选项 A：Docker Compose（当 TomoriBot 在 Docker 中运行时）

```sh
docker compose --profile slop-guard up -d
```

容器会以 `slop-guard` 身份加入 TomoriBot 的 Docker 网络。它不发布任何主机端口。

### 选项 B：独立 Docker（当 TomoriBot 在你的本机电脑上运行时）

使用校对器启动 bot，而不是 `bun run dev`：

```sh
bun run launch --slopguard
```

这会构建镜像，在 `127.0.0.1:8765` 上启动 `slop-guard` 容器，等待它接受连接，然后以 watch 模式运行 bot。容器在 `Ctrl+C` 后仍会保持运行；使用 `docker stop slop-guard` 停止它。修改 `servers/slop-guard/` 后，请删除旧容器（`docker rm -f slop-guard`），以便 launch 能从重建的镜像创建新容器。

## 注册服务器

1. 打开 `/config` > 插件 > MCP 服务器，然后选择 `+ 添加 MCP`。
2. 将 `服务器 URL` 设置为 `http://slop-guard:8765/mcp`（选项 A）或 `http://localhost:8765/mcp`（选项 B）。将 `身份验证令牌` 留空。
3. 将 `服务器类型` 设置为 `文本校对器`。
4. 打开 `/config` > 插件 > 回复审核，并在 `规则检查` 下选择 `<服务器名称> / check_slop`。

`文本校对器` 可以防止服务器的工具暴露给 Tomori 本人。slop-guard 还包含 `check_slop_file`，它会读取容器内部的文件路径；规则检查器绝不会提供此工具，因为它不接受回复文本。

本地地址可以正常工作，因为自部署的 TomoriBot 在运行时带有 `RUN_ENV=development`（Compose 会固定此值）。在 `RUN_ENV=production` 下，TomoriBot 会拒绝解析为私有或环回地址的 MCP URL。

## 设置

| 变量 | 默认值 | 用途 |
|---|---|---|
| `SLOP_GUARD_CONFIG` | 打包的规则 | 容器内 JSONL 规则配置文件路径。挂载该文件并将此变量指向它。 |
| `SLOP_GUARD_PORT` | `8765` | 监听端口。 |
| `SLOP_GUARD_ALLOWED_HOSTS` | `slop-guard:*,localhost:*,127.0.0.1:*` | 服务器接受的 `Host` 标头值。如果填入 `服务器 URL` 的主机名不在列表中，请将其添加；任何其他主机都会收到 HTTP 421。 |

slop-guard 的默认规则主要针对文档和文章中生成的文本。随性的角色扮演回复可能会触发其中的一部分检查（例如项目符号和三项列举检查），因此该报告仅供参考：由审查者决定命中的项目是否对该人格重要。如果你希望审查者以特定方式权衡该报告，请在审查者提示词中提及它。slop-guard 的 `sg-fit` 工具可以根据你自己的良好与不良示例调整规则配置。

## 升级

修改 `servers/slop-guard/Dockerfile` 中的版本，重新构建镜像，并在开启回复审核的情况下发送测试消息。新版本可能会改变规则以及审查者所读取的报告格式。

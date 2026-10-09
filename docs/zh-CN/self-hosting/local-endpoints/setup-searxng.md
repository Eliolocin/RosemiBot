---
title: "配置：SearXNG"
sidebar:
  order: 3
---

使用 [SearXNG](https://docs.searxng.org/) 将私有、自部署的Web搜索添加到TomoriBot。

`web_search`工具查询引擎后备链：Brave、SearXNG和DuckDuckGo。当外部提供商达到速率限制或失败时，运行本地SearXNG实例可提供自部署搜索源，并启用专门的搜索类别：`science`、`it`、`files`和`music`。

选择安装路径：

### 选项A：Docker Compose（当TomoriBot在Docker中运行时）

如果你使用存储库的Docker Compose堆栈运行TomoriBot，请使用此路径。然后使用`searxng`配置文件运行：

```sh
docker compose --profile searxng up -d
```

在启动此配置文件之前，请在`.env`中设置`SEARXNG_BASE_URL=http://searxng:8080/`。机器人使用该地址访问`searxng`服务。当配置文件关闭时，让变量保持未设置状态。

如果你直接与`bun run dev`一起运行TomoriBot，请改用下面的独立路径。

将`.env`中的`SEARXNG_SECRET`设置为容器签名密钥的单独随机值。

---

### 选项B：独立Docker（运行`bun run dev`时）

首先，在`.env`中设置`SEARXNG_BASE_URL=http://localhost:8080/`，以便机器人知道连接到哪里。

然后，不要直接使用`bun run dev`运行TomoriBot，而是使用`bun run launch --searxng`。这会自动处理容器生命周期，并在启动机器人之前等待容器健康：

```sh
bun run launch --searxng
```

如果你希望自己管理容器，请将`SEARXNG_BASE_URL=http://localhost:8080/`保留在`.env`中。首先构建存储库的映像，以便加载JSON搜索设置并替换签名密钥：

```sh
docker build -t tomoribot-searxng:latest -f servers/searxng/Dockerfile servers/searxng
```

然后运行它：

电源外壳：

```powershell
docker run -d --name searxng -p 8080:8080 `
  --tmpfs /etc/searxng `
  tomoribot-searxng:latest
```

Bash（Linux/macOS）：

```bash
docker run -d --name searxng -p 8080:8080 \
  --tmpfs /etc/searxng \
  tomoribot-searxng:latest
```

然后在容器正常运行后运行`bun run dev`（`docker ps`显示`(healthy)`）。如果容器环境中没有`SEARXNG_SECRET`，则镜像会生成临时签名密钥。

---

### 选项C：无SearXNG

保留`SEARXNG_BASE_URL`未设置。链条回落至`Brave → DuckDuckGo`。

当未配置SearXNG服务器时，组装的`web_search`模式不再通告仅SearXNG类别。配置Brave时，常见类别（`text`、`image`、`video`、`news`）仍会显示，并且当仅内置的DuckDuckGo后备可用时，会显示纯文本搜索。

---

## 图像结果调整

SearXNG图像结果经过HEAD验证，可选择压缩，并作为Discord附件发布：与Brave图像相同的UX。如果所有候选URL均未通过验证，SearXNG将返回图像链接的文本列表，而不是硬失败。

| 多变的 | 默认 | 描述 |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3`（最多10个） | 有多少张有效图像发送到Discord。被LLM的`count`参数覆盖。|
| `SEARXNG_IMAGE_POOL` | `10` | LLM未指定`count`时的候选URL池。当指定`count`时，池为`count × 3`（上限为30）以吸收热链接保护故障。|
| `WEB_SEARCH_TIMEOUT_MS` | — | 每个引擎请求超时。|

*（有关所有可调参数，请参阅`.env.optional.example`。）*

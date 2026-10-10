---
title: "配置：Crawl4AI"
sidebar:
  order: 4
---

使用本地 [Crawl4AI](https://github.com/unclecode/crawl4ai) 服务器将JavaScript密集型网页渲染为TomoriBot的干净Markdown。

内置的`fetch_url`工具默认使用轻量级的`safe_http`引擎。Crawl4AI添加了一个可选的无头Playwright浏览器，该浏览器在将Markdown返回给机器人之前执行客户端脚本并提取页面内容。

由于Crawl4AI遵循TomoriBot受保护的HTTP客户端外部的重定向，因此仅在允许私网获取的情况下才允许其进行。外部生产（`RUN_ENV`！= `production`），私网抓取会自动启用。在生产环境中，需要设置`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

:::caution[TomoriBot 能检查什么与不能检查什么]
TomoriBot 在请求 Crawl4AI 打开 URL 之前，会拒绝主机名无法解析或解析为云元数据地址的 URL。但它无法控制浏览器接下来的操作：Crawl4AI 会自行重新解析域名、跟踪重定向并加载图片和脚本。TomoriBot 的全天候元数据拦截不涵盖这些请求。

固定镜像（`unclecode/crawl4ai:0.9.4`）会使其浏览器通过自身代理发送请求，该代理会在每次请求和重定向时拦截私有地址、回环地址和元数据地址。请保留 `CRAWL4AI_ALLOW_INTERNAL_URLS` 未设置：将其设置为 `true` 会关闭该代理，包括元数据拦截。
:::

Crawl4AI 0.9.4 在接受来自其自身容器外部的连接之前需要 API 令牌。请生成一个令牌（例如 `openssl rand -hex 32`）并在下方所有设置路径中将其设置为 `.env` 中的 `CRAWL4AI_TOKEN`。若缺少该令牌，容器虽然能启动，但 TomoriBot 无法连接并会回退到 `safe_http`。

选择安装路径：

### 选项A：Docker Compose（当TomoriBot在Docker中运行时）

如果你使用仓库的 Docker Compose 栈运行 TomoriBot，请使用此路径。首先在 `.env` 中设置 `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` 与 `CRAWL4AI_TOKEN`。生产环境之外无需开启私有网络访问；只有在以 `RUN_ENV=production` 运行此栈时才添加 `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

然后，从以下开始：

```sh
docker compose --profile fetch-crawl4ai up -d
```

这将使用TomoriBot的Docker网络上的Crawl4AI容器启动Compose堆栈。Compose 会将 `CRAWL4AI_TOKEN` 作为 `CRAWL4AI_API_TOKEN` 传递给容器，而 TomoriBot 会将其作为 Bearer 令牌发送。端口 11235 仅发布在 `127.0.0.1` 上以供本地调试；TomoriBot 本身通过 Docker 网络进行连接。

如果你直接与`bun run dev`一起运行TomoriBot，请改用下面的独立路径。

如果你还想要SearXNG，请链接配置文件：

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

---

### 选项B：独立Docker（运行`bun run dev`时）

首先在 `.env` 中设置 `CRAWL4AI_BASE_URL=http://localhost:11235/` 与 `CRAWL4AI_TOKEN`，以便 bot 连接到发布在 `127.0.0.1` 上的容器端口。生产环境之外无需开启私有网络访问；只有在以 `RUN_ENV=production` 运行时才添加 `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

然后，不要直接使用`bun run dev`运行TomoriBot，而是使用`bun run launch --crawl4ai`。这会自动处理容器生命周期，并在启动机器人之前等待服务器就绪。如果缺少 `CRAWL4AI_TOKEN`，它将报错停止：

```sh
bun run launch --crawl4ai
```

如果你还想要SearXNG：

```sh
bun run launch --searxng --crawl4ai
```

如果你更喜欢自己管理容器，请将`CRAWL4AI_BASE_URL=http://localhost:11235/`保留在`.env`中并运行：

电源外壳：

```powershell
docker run -d --name crawl4ai -p 127.0.0.1:11235:11235 --shm-size=3g `
  -e CRAWL4AI_API_TOKEN=<your-token> unclecode/crawl4ai:0.9.4
```

Bash（Linux/macOS）：

```bash
docker run -d --name crawl4ai -p 127.0.0.1:11235:11235 --shm-size=3g \
  -e CRAWL4AI_API_TOKEN=<your-token> unclecode/crawl4ai:0.9.4
```

`<your-token>` 使用与 `.env` 中 `CRAWL4AI_TOKEN` 相同的值。

然后在容器正常运行后运行`bun run dev`（`docker ps`显示`(healthy)`）。

---

### 选项C：无浏览器渲染服务器

保留`CRAWL4AI_BASE_URL`未设置。`fetch_url`工具使用受保护的`safe_http`引擎。

---

## 起始订单

TomoriBot在启动后第一次调用`fetch_url`时探测服务器运行状况，并将结果缓存60秒。如果在第一个探测器触发时容器尚未准备好，机器人将在下一分钟将其视为不可用。

对于独立的Docker，请在启动TomoriBot之前启动Crawl4AI容器。`bun run launch --crawl4ai`已经为你做到了这一点。

### 首次设置

1. 启动容器，等待`docker ps`中显示`(healthy)`：
   ```powershell
   docker ps
   ```
2. 使用上面设置路径的值在`.env`中设置`CRAWL4AI_BASE_URL`。
3. 启动TomoriBot（`bun run dev`或`docker compose up`）。

### 从 `latest` 升级

现有的 `crawl4ai` 容器保留创建它时使用的镜像，因此 `docker start` 不会升级它。将其删除一次，然后重新使用你的设置路径：

```powershell
docker rm -f crawl4ai
```

使用 Compose 时，`docker compose --profile fetch-crawl4ai up -d` 会从固定镜像重新创建容器。

### 重启后返回

如果容器在上次运行中已存在，请使用`docker start`而不是`docker run`以避免命名冲突：

```powershell
# Start an existing container
docker start crawl4ai

# Confirm healthy before starting TomoriBot
docker ps
```

然后正常启动TomoriBot。重新启动`bun run dev`会重置内存中的运行状况缓存，因此只要容器先准备好，就会立即选择正确的引擎。

---

## Cookie注入

Crawl4AI支持注入浏览器级cookie，因此无头浏览器在获取页面时会显示为已登录。这对于需要会话来查看内容的网站（例如付费新闻、私人论坛、登录控制仪表板）非常有用。

`safe_http`后备不支持cookie注入。Cookie仅在Crawl4AI处于活动状态时适用。

:::note[Bot detection limits]
Cookie注入绕过登录墙，但不能绕过机器人指纹识别。具有积极反机器人检测功能的网站（特别是Twitter/X）通过画布/WebGL指纹识别来检测无头剧作家，并提供空页面，即使具有有效的会话cookie。Cookie注入对于仅进行身份验证的网站效果很好。
:::

### 获取你的cookie

1. 打开浏览器并登录目标站点。
2. 打开DevTools (`F12`) > `Application`选项卡 > `Storage` > `Cookies` > 选择站点的域。
3. 复制每个所需cookie的`Value`（通常是会话令牌；检查站点的cookie名称）。

### Crawl4AI

将`.env`中的`CRAWL4AI_COOKIES_JSON`设置为JSON数组：

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

设置此值后，`fetch_url`自动从`/md`端点切换到`/crawl`和`browser_config.cookies`。`/md`不支持cookie注入。

### Cookie对象字段

| 场地 | 必需的 | 描述 |
|---|---|---|
| `name` | 是的 | 饼干名称 |
| `value` | 是的 | Cookie值 |
| `domain` | 不 | 域范围（例如`.x.com`）。推荐的正确性。|
| `path` | 不 | 路径范围。如果省略，则默认为`/`。|

:::caution[Protect session tokens]
Cookie值很敏感，因此请将它们视为密码。他们授予你帐户的完整会话访问权限。不要将`.env`提交到版本控制。
:::

---

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CRAWL4AI_BASE_URL` | 未设置 | 设置后启用 Crawl4AI：TomoriBot 会优先尝试它，并在服务不可用或抓取失败时回退到 `safe_http`。在生产环境中会被忽略，除非设置了 `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。在 Docker Compose 中使用 `http://crawl4ai:11235/`，在 TomoriBot 直接在宿主机上运行时使用 `http://localhost:11235/`。 |
| `CRAWL4AI_TOKEN` | 未设置 | 必需的 Bearer 令牌。必须与 Crawl4AI 容器上的 `CRAWL4AI_API_TOKEN` 匹配，否则容器会拒绝外部连接。 |
| `FETCH_URL_TIMEOUT_MS` | `15000` | Crawl4AI和其他URL获取引擎的每个引擎请求超时。|
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | 在需要继续之前，一次fetch调用返回的最大字符数。|
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | 仅限生产选择加入。外部生产（`RUN_ENV`！= `production`）SSRF防护自动放松，因此localhost/private/internal获取和Crawl4AI调度工作无需设置。仅设置`true`以允许在受信任的生产部署中进行专用网络提取。|
| `FETCH_URL_FILTER_MODE` | `fit` | Crawl4AI `/md`滤波模式。`fit`保持降价更干净，供LLM使用； `fetch_url(..., raw=true)`根据请求覆盖它。|

---
title: "Docker Compose"
sidebar:
  order: 3
---

Docker Compose在容器中一起运行TomoriBot和PostgreSQL。它是与[安装向导](/zh-CN/self-hosting/setup-wizard/)和[手动安装](/zh-CN/self-hosting/manual-setup/)并列的第三个安装选项：当你想要运行Docker中的所有内容而不在主机系统上安装Bun或PostgreSQL时，请选择它。它绕过交互式安装向导并自动配置数据库连接。

:::caution[Host tools for updates]
`bun run update --docker`需要主机Bun和Git来拉取代码更改。其数据库备份在应用程序容器内运行。你还可以通过Compose运行手动备份和恢复； 参见[维护与备份](/zh-CN/self-hosting/maintenance/)。
:::

## 1. 获取代码

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. 必须的`.env`值

从示例文件开始：

```sh
cp .env.example .env
```

在`.env`中设置这些必需的变量：

| 多变的 | 价值 |
|---|---|
| `DISCORD_TOKEN` | 你的Discord机器人令牌（启用`GuildMembers`、`MessageContent`和`GuildPresences`特权意图）。|
| `CRYPTO_SECRET` | 用于加密存储的API密钥的32字符加密密钥。|
| `POSTGRES_PASSWORD` | 数据库密码。每个其他`POSTGRES_*`值都是自动配置的。|

使用Docker为`CRYPTO_SECRET`生成一个随机的32个字符值，然后将其复制到`.env`中：

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

为`POSTGRES_PASSWORD`生成单独的密码。你可以从`.env.optional.example`复制可选的调谐设置。

:::note[Database connection is automatic]
Compose PostgreSQL服务在内部Docker网络上以开发模式（无SSL）运行。捆绑的映像包括`pgvector`和`pg_cron`，因此文档内存、矢量搜索和计划清理可以立即进行。不要在`.env`中设置`POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER`或`POSTGRES_DB`； Compose会自动配置它们。
:::

在Linux上，在启动容器之前在主机上创建绑定安装目录并将所有权分配给UID 1001。Docker以root身份创建丢失的挂载点，这会阻止bot容器保存备份、日志或上传：

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. 构建并运行

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

对于以后的启动，单独`docker compose up`就足够了，除非你更改代码或依赖项。一旦机器人连接到Discord，请在任何服务器通道中运行`/setup`以添加你的AI提供商密钥。有关Discord中的设置选项，请参阅[快速入门](/zh-CN/introduction/quickstart/)。

在其服务定义中组合引脚`RUN_ENV=development`，以便`.env`机密和本地HTTP端点正常工作。容器健康检查报告bot进程是否正在运行； 它不测试Discord网关连接。有关生产模式（`RUN_ENV=production`）差异（秘密管理器、网络限制和指标），请参阅[安全架构](/en/architecture/subsystems/security/)。

## 4. 可选本地服务器（Compose profile）

使用Compose配置文件运行可选的本地帮助服务器，以便你只启动你需要的内容：

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

当启用SearXNG时，请在`.env`中设置`SEARXNG_BASE_URL=http://searxng:8080/`。否则请保持未设置状态。将`SEARXNG_SECRET`设置为SearXNG请求签名的单独随机值。

有关特定于服务器的设置，请参阅 [SearXNG](/zh-CN/self-hosting/local-endpoints/setup-searxng/)、[Crawl4AI](/zh-CN/self-hosting/local-endpoints/setup-crawl4ai/) 和 [本地监控](/zh-CN/self-hosting/local-monitoring/)。

## 维护、更新和备份

使用`bun run update --docker`在Compose部署上进行备份优先更新。要备份或恢复Compose数据库，请参阅[维护和备份](/zh-CN/self-hosting/maintenance/)。在拉取新版本之前，请先查看[安全迁移](/zh-CN/self-hosting/safe-migration/)。

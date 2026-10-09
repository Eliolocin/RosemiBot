---
title: "手动安装"
sidebar:
  order: 2
aiGenerated: false
---

:::note
想用Docker Compose的人请跳过这个向导，容器化安装路径见
[Docker Compose](/zh-CN/self-hosting/docker-compose/)。
:::

这是给不想用引导式向导的技术用户准备的手动安装流程。如果你想要一步一步带做的那种，请改用[安装向导](/zh-CN/self-hosting/setup-wizard/)，它会替你创建`.env`、生成安全的`CRYPTO_SECRET`、配置PostgreSQL，并运行安装。

## 环境要求

- [Bun](https://bun.sh/)
- PostgreSQL，可以原生安装，也可以跑在Docker容器里（见第2步）

PostgreSQL的数据库结构、`pgcrypto`、种子数据和迁移都会在bot启动时自动初始化。

## 1. 安装

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
bun install --frozen-lockfile
```

## 2. 配置

根据示例创建环境文件并填写所需的值：

```sh
cp .env.example .env
```

必需的：

- `DISCORD_TOKEN`：你的Discord机器人令牌（启用`GuildMembers`、`MessageContent`和`GuildPresences`特权意图）。
- `CRYPTO_SECRET`：32个字符的加密密钥（用于加密存储的API密钥）。
- PostgreSQL连接：`POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`。

请将加密密钥的受保护副本与数据库备份分开保存。新的备份不包含 `.env`。对于密钥轮换，请使用 `CRYPTO_SECRET_V1`、`CRYPTO_SECRET_V2` 或任何后续的正整数版本，并可选择使用 `CRYPTO_SECRET_CURRENT`。`CRYPTO_SECRET` 仍为 V1。启动和维护命令加载相同的配置来源：开发环境中为本地环境变量值，生产环境中为挂载的 JSON 或 AWS Secrets Manager。在替换密钥之前，请参阅[轮换加密密钥](/zh-CN/self-hosting/maintenance/#rotating-encryption-keys)。

在 JSON 密钥源中，主密钥必须是字符串。`CRYPTO_SECRET_CURRENT` 接受指示可用版本的字符串（如 `"2"`）或正安全整数数值（如 `2`）。

:::note[No native PostgreSQL?]
仅运行容器中的数据库，然后将`POSTGRES_*`值指向它：

```sh
docker run -d --name tomori-db \
  -e POSTGRES_USER=tomori -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=tomori \
  -p 5432:5432 pgvector/pgvector:pg16
```

然后设置`POSTGRES_HOST=localhost`，`POSTGRES_PORT=5432`，以及上面的用户/密码/db。`pgvector/pgvector`映像预装了RAG扩展； 如果不需要文档/RAG内存，请将其交换为`postgres:16`。这仅运行Docker中的数据库，并且机器人仍然在主机Bun上运行。对于完全容器化的机器人和数据库，请改用 [Docker Compose](/zh-CN/self-hosting/docker-compose/)。
:::

`.env.optional.example`中有可选的调音功能。复制你想要自定义的任何值（限制、超时、功能切换、本地服务器URL等）。

自定义表达式默认上传到`data/custom-expressions/`下的本地文件。将该目录保留在持久存储中。`EXPRESSION_STORAGE_BACKEND`接受`local`、`gcs`或`s3`。云后端需要`EXPRESSION_STORAGE_BUCKET`和相应的SDK凭证。S3还使用`AWS_REGION`（默认`us-east-1`）和可选`S3_ENDPOINT`。GCS使用应用程序默认凭据。表达式使用自己的存储桶设置； 头像存储设置未选择表情桶。对象仍然可以通过SDK读取，并以字节形式附加，因此不需要公开提供的媒体URL。恢复现有引用时保留后端、存储桶和对象键。

`MAX_CUSTOM_EXPRESSIONS_PER_SERVER` 限制每个服务器的自定义表情数量（默认 `20`，最小 `1`）。链接和上传的文件在所有预设之间共享该限制；原生表情符号和贴图不计入。更改后请重启机器人。调低限制会保留现有表情并允许编辑和删除，但会阻止新增，直到数量低于限制为止。

## 3. 运行

```sh
bun run dev
```

当你看到`TomoriBot up and running!`时，去Discord在你的服务器里运行`/setup`，接入AI提供方并初始化bot。该指令会打开一个引导式清单面板，在你按下`完成设置`之前不会写入任何内容；步骤说明见
[`/setup`指令](/zh-CN/self-hosting/setup-wizard/#setup-指令)，Discord里那一侧的操作见
[快速上手](/zh-CN/introduction/quickstart/)。

如果你想让可选的本地服务器（SearXNG、Crawl4AI、本地TTS/STT）与bot一起启动，请用`bun run launch`代替`bun run dev`：

```sh
bun run launch --searxng --crawl4ai
bun run launch --help        # see all flags
```

## 可选附加项（手动版的「完整安装」）
<!-- anchor: optional-extras-the-manual-full-install -->

[安装向导](/zh-CN/self-hosting/setup-wizard/)的完整安装路径会在基础安装之上叠加四个轻量附加项。它们都不是运行bot的必需项，但每一项都会解锁一个功能。如果你是手动安装，想加哪个就加哪个：

### `pgvector`：文档与RAG记忆

RAG（文档上传与跨频道回忆）会把嵌入向量存进`vector`列，这需要
[pgvector](https://github.com/pgvector/pgvector) 扩展。请按你的PostgreSQL主版本安装：

```sh
# Debian/Ubuntu, e.g. for PostgreSQL 16
sudo apt-get install -y postgresql-16-pgvector
```

然后在你的数据库上启用它一次。用`.env`里的`POSTGRES_*`值通过`psql`连接：它会提示你输入`POSTGRES_PASSWORD`：

:::note[Windows]
原生的Windows PostgreSQL没有预编译的pgvector包。要装它就得用Visual Studio C++ 和`nmake`
针对你的确切PostgreSQL版本从源码编译（见pgvector的
[Windows说明](https://github.com/pgvector/pgvector#windows)）。Windows上更简单的路子是把数据库跑在
上面[配置](#2-配置)一节里给出的`pgvector/pgvector`容器里，该镜像已经预装了这个扩展。
:::

```sh
# Native / host psql (substitute your own POSTGRES_USER and POSTGRES_DB):
psql -h localhost -p 5432 -U tomori -d tomodb

# Or, if the database runs in the Docker container from step 2:
docker exec -it tomori-db psql -U tomori -d tomori
```

连接之后运行：

```sql
CREATE EXTENSION vector;
```

没有pgvector，bot照样能跑，但RAG功能会完全不可用。还原备份之前，目标数据库上也必须装好这个扩展；细节见
[安全迁移](/zh-CN/self-hosting/safe-migration/)。

### `pg_cron`：定时清理任务

`pg_cron`支撑可选的周期性数据库维护（冷却行与提醒行的清理）。本仓库的Docker Compose已经替你配置好了。

:::caution[提醒和触发并不需要它]
`pg_cron`纯粹是打扫卫生，它只清理过期数据行。提醒的发送与随机触发都在应用内部运行，所以有没有`pg_cron`这些功能都照常工作。
:::

对于自己管理的PostgreSQL，先找到生效中的配置文件：

```sql
SHOW config_file;
```

在`postgresql.conf`里启用该扩展：如果`shared_preload_libraries`已经列了其他库，就追加：

```ini
shared_preload_libraries = 'pg_cron'   # e.g. 'pg_stat_statements,pg_cron'
cron.database_name = 'your_dbname'
```

重启PostgreSQL，然后：

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### 分词器资源：按模型处理的词元偏置

词元偏置（表情与词语重复惩罚）需要本地的分词器资源：

```sh
bun run setup:tokenizers
```

有些模型家族（例如Gemma）是受限的，需要你先接受它们的许可，再用一个
[HuggingFace令牌](https://huggingface.co/settings/tokens)：

```sh
# Windows (PowerShell)
$env:HF_TOKEN="hf_xxx"; bun run setup:tokenizers

# macOS/Linux
HF_TOKEN=hf_xxx bun run setup:tokenizers
```

不做这一步，词元偏置会被静默禁用，其他一切照常工作。

安全的 `fetch_url` 回退和 DuckDuckGo 的 `web_search` 回退均在进程内运行，因此两者都不需要额外安装。

## 维护、更新与备份

装好之后，主机端脚本（`bun run update`、`bun run backup`、`bun run restore-backup`、`bun run nuke-db`、`bun run rotate-keys`等）以及更新和备份流程，都写在
[维护与备份](/zh-CN/self-hosting/maintenance/)页面。如果你准备拉取新版本，请先看[安全迁移](/zh-CN/self-hosting/safe-migration/)。

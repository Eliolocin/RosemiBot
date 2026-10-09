---
title: "安装向导"
sidebar:
  label: "安装向导"
  order: 1
aiGenerated: false
---

:::note
想用 Docker Compose 的人请跳过这个向导，容器化安装路径见
[Docker Compose](/zh-CN/self-hosting/docker-compose/)。
:::

`bun run setup` 是本地 Bun 自部署的推荐路径。它会创建你的 `.env`、生成一个 `CRYPTO_SECRET`、询问你的 Discord bot 令牌、配置 PostgreSQL，并按 `bun.lock` 交互式安装完全一致的依赖，所以你只要跟着提示走就行。重复运行也是安全的；既有的 `.env` 值会保留，除非你选择重新配置它们。

## 获取代码

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 选择一条路径

运行命令之后，你会从两条路径中选一条：

```bash
bun run setup
```


| 路径 | 什么情况下选 | 它会做什么 |
|---|---|---|
| 完整安装（Full Install） | 你想要推荐的安装方式，外加几个轻量附加项。 | 先跑基础安装，然后尝试安装下面四个附加项。 |
| 基础安装（Base Install） | 你只要一个能跑起来的最小 bot。 | 创建并配置 `.env`、Discord 令牌、PostgreSQL 和依赖。 |



## 需要提前准备什么

- [Bun](https://bun.sh/)，用来运行 bot 和向导本身。
- 一个 Discord bot 令牌，并已开启 `GuildMembers`、`MessageContent`、`GuildPresences`
  这三项特权 intent。
- 一个数据库。 TomoriBot 把所有数据都存进 PostgreSQL。你不用手动配置，向导会替你做：
  如果你已经装好 PostgreSQL，它就用现成的；如果没装，它会用 [Docker](https://www.docker.com/)
  帮你跑一个。只要确保开始之前这两者里有一个装好了就行。

:::caution
- 向导附带的 Docker PostgreSQL 只在 Docker 里跑数据库。 bot 本身、启动备份、
  `bun run backup` 和 `restore-backup` 仍然走主机端的 Bun 和主机的 PostgreSQL 客户端工具。
  如果你更想全部跑在 Docker 里，请改用 [Docker Compose](/zh-CN/self-hosting/docker-compose/)。
:::

如果缺少 `psql` 或者自动配置失败，向导会打印出让你手动执行的 SQL。不管哪种情况，TomoriBot 都会在首次启动时自动初始化它的数据库结构、种子数据、迁移、`pgcrypto` 和 RAG 结构。

## 完整安装的附加项

完整安装会先跑基础安装，然后尝试安装下面的附加项。任何一项失败，它都会打印出需要手动完成的命令或指南，然后继续往下走：

| 附加项 | 用途 |
|---|---|
| `pgvector` | 文档与 RAG 记忆的向量检索。 |
| `pg_cron` | 可选的冷却与提醒行定时清理。 |
| 分词器资源 | 用于按模型处理词元偏置的本地分词器资源。 |

想手动安装其中任何一项，见
[手动安装的附加项](/zh-CN/self-hosting/manual-setup/#可选附加项手动版的完整安装)。

## 安装之后

```bash
bun run dev                          # 只启动 bot
bun run launch --searxng --crawl4ai  # bot 加本地服务器（见 bun run launch --help）
```

bot 上线后，在 Discord 里运行 `/setup` 来接入 AI 提供方。没有自己的提供方的工作区无法回复，除非它以用户 BYOK 模式运行，由每位成员的个人提供方代为回答，所以这是每条安装路径的最后一步。

## `/setup` 指令
<!-- anchor: the-setup-command -->

`/setup` 会打开一个只有执行者本人能操作的临时清单面板。在服务器里它需要 管理服务器 权限；在私信里它对该用户自己的工作区可用。面板上的每一行都是草稿值：只有 `完成设置` 会真正写入任何内容，所以打开、编辑、取消或重新开始都不会改动任何数据库行。

| 步骤 | 出现条件 | 收集什么 |
|---|---|---|
| 政策 | 仅 `RUN_ENV=production` | 在一个弹窗里同时接受服务条款与隐私政策。 |
| AI 提供方 | 所有环境 | 回复如何抵达模型。即下面三种接入模式之一。 |
| 初始设置 | 所有环境 | 初始人格、回复风格、时区，以及工作区默认系统提示词。 |

其他任何 `RUN_ENV` 值都只会渲染两步式布局，完全不显示政策文案。以 `RUN_ENV=production` 运行的部署会注册 `/legal terms-of-service` 和 `/legal privacy-policy`，与 `/legal license` 并列；其他任何值只注册 `/legal license`。

### 提供方接入模式

- **AI 提供方（推荐）**：从目录里挑一个提供方，粘贴它的 API 密钥。密钥会向该提供方校验，并加密进草稿；面板只显示已存有密钥，从不显示密钥本身。运行 `/help`，然后打开 `设置` > `获取 API 密钥` 查看逐个提供方的操作说明。
- **自定义端点（高级）**：一个由两个按钮组成的子区域，用于自部署或代理端点。`配置连接` 收集 API 兼容类型、标签、URL，以及可选的认证令牌，并检查该端点是否有响应。`配置文本模型` 收集模型代号、它的上下文大小和它的能力声明，在连接校验通过之前一直处于禁用状态。再次保存连接会清空模型声明，因为这些声明取决于所选定的 API 兼容类型。这与 `/providers` 所做的注册完全相同，只是搬进了向导里，并且在 `完成设置` 之前不会创建任何数据行。
- 用户 BYOK（高级）（仅服务器，私信里从不提供）：工作区不保留自己的提供方，每条由成员触发的回复都改为解析出一个个人提供方。在弹窗里确认后，让成员用 `/personal providers` 注册自己的提供方。见
  [服务器管理](/zh-CN/features/setup-administration/server-moderation/#user-byok-bring-your-own-key)。

### 初始设置

一个四行弹窗收集人格、回复风格、时区偏移和默认系统提示词。时区是可选项，默认 UTC。系统提示词提供 `内置默认（推荐）` 以及工作区目录里的每个预设集：选择内置项时完全不存储任何提示词文本，所以它会持续跟随随版本发布的默认值；选择某个预设集则会把该预设集在提交时的文本存下来。从目录里删除已存储的人格或提示词，会重新打开这一步，直到另选一个为止。

### 完成与取消

完成设置 会一直处于禁用状态，直到渲染出来的每一步都完成。它会重新校验目录与工作区状态，在一个事务里提交整份草稿，然后用回执替换面板。`取消` 会丢弃草稿，并让面板上的每个控件失效。

草稿保存在 bot 进程里，而不是数据库里，所以它只会在被取消、被完成或进程重启时结束。最多同时保留 200 份草稿，达到上限时丢弃最旧的那份。对已不存在的会话操作控件不会写入任何内容。

## 更新

使用先备份再更新的指令：`bun run update`

它会依次运行 `bun run backup`、`git pull --rebase --autostash`、`bun install --frozen-lockfile`。如果你从 `dist/` 运行，加上 `--build`；如果是 Compose 部署，加上 `--docker`。完整细节见
[维护与备份](/zh-CN/self-hosting/maintenance/)页面。

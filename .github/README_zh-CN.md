### [English](../README.md) | [日本語](README_ja.md) | [繁體中文](README_zh-TW.md) | 简体中文 | [Español](README_es-419.md) | [Português (Brasil)](README_pt-BR.md) | [Tiếng Việt](README_vi.md)

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

> [!NOTE]
> 这份 README 只是一份快速概览。完整且最新的文档（安装指南、功能讲解、提供方信息等等）请见 **[docs.tomoribot.app](https://docs.tomoribot.app/zh-CN/)**。

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="../assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

一套可自部署、可自由定制的 Discord 个人 AI 助理与角色扮演系统，具备记忆、多个人格、工具调用、多模态，并支持 API 与本地模型。

<p align="center">
  <strong><a href="https://tomoribot.app/">官方网站</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">邀请 TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Discord 服务器</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">最新版本</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">报告 Bug</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">请求新功能</a>
  <br />
  <br />

[![GitHub Stars](https://img.shields.io/github/stars/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/forks)
[![GitHub Issues](https://img.shields.io/github/issues/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/pulls)
[![License](https://img.shields.io/github/license/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE)


  </p>

  




<!-- PROJECT LOGO -->
![TomoriBot Banner](../assets/img/tomobanner.png)
[![Bun][Bun.sh]][Bun-url][![Discord.js][Discord.js]][Discord-url][![TypeScript][TypeScript.js]][TypeScript-url][![PostgreSQL][PostgreSQL.org]][PostgreSQL-url]

  
</div>

<!-- ABOUT THE PROJECT -->
## 关于这个项目

TomoriBot 是一套免费开源的 Discord 自部署个人 AI 助理与角色扮演系统，灵感来自 SillyTavern 与 Discord 已经停运的 Clyde。她既可以当作实用的助理、可定制的好伙伴，也可以在私信（DM）里只陪你一个人，或者在你的 Discord 服务器里陪所有人角色扮演。

TomoriBot 支持长期记忆、多人格行为、Web 与 MCP 工具、聊天内媒体生成、200 多条 Discord 斜杠指令，以及多个提供方，包括自定义代理和自部署你自己的模型，覆盖从文本生成到视频生成的各个环节。

### 快速上手

你可以[邀请公开版 TomoriBot](https://discord.com/oauth2/authorize?client_id=841644102059556915)加入你的 Discord 服务器，如果希望完全掌控自己的隐私和 API 密钥，也可以[自部署你自己的实例](#自部署)。TomoriBot 采用最佳安全实践与加密来保护数据，而自部署能确保所有数据完全留在你的设备上。

用上面任意一种方式把她加进服务器后，运行 `/setup` 指令查看说明。之后只要叫她的名字（或者 @ 提及她）就能得到回复。

## 功能展示


![Screenshots 1](../assets/img/scs/1.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-CN/features/capabilities/tools-and-extensions/">由 AI 代理驱动的对话</a></h3>
<p align="center">TomoriBot 有非常多的工具，让她不只停留在聊天：搜索网页、设置重复任务与提醒、用上你服务器的表情与贴纸，还有 RAG 和短期记忆（STM）这类记忆功能，让她跨频道、跨服务器记住上下文。</p>

<br />


![Screenshots 2](../assets/img/scs/2.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-CN/features/capabilities/media-generation/">完整的多模态输入输出</a></h3>
<p align="center">TomoriBot 能处理直接在 Discord 里发送的图像、音频和视频，也能用你自己的本地模型端点或 API 密钥生成它们再发回来，而这些数据都加密存放在持久化数据库里。开箱即用的 ComfyUI 工作流在 <code>assets/comfyui-workflows/</code>，本地音频推理服务器在 <code>servers/</code>！</p>

<br />

![Screenshots 3](../assets/img/scs/3.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-CN/features/chatting-personality/multiple-personas/">多个人格支持</a></h3>
<p align="center">TomoriBot 在服务器里的性格、行为和头像都能轻松修改、创建，也能作为人格导出给别人（类似可以分享的 AI 角色卡）。你可以通过 <code>/persona generate</code> 导入甚至转换你最喜欢的 SillyTavern 角色卡。一个服务器里可以放无限个人格，每个都有自己的记忆和目标。你还能编排它们互相配合，在服务器里一起干活（或者只是互相闹着玩）。</p>

<br />


![Screenshots 4](../assets/img/scs/4.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-CN/features/command-reference/">200 多条原生配置指令</a></h3>
<p align="center">一切都通过 Discord 原生的斜杠指令和交互界面管理。人格、提示词、模型参数、MCP 工具服务器、权限、记忆、服务器成员速率限制等等都能完整管理，远不止这些！你也可以直接问 TomoriBot 自己能做什么、有哪些斜杠指令。目前我们还在开发 Web 控制面板，让管理更轻松。</p>

<br />


![Screenshots 6](../assets/img/scs/6.png)

<h3 align="center"><a href="https://docs.tomoribot.app/zh-CN/features/integrations/sillytavern-support/">SillyTavern 集成（Beta）</a></h3>
<p align="center">用 TomoriBot 直接在 Discord 里使用你最喜欢的 SillyTavern 预设集，她会完整调整自己的提示词，你只要通过 <code>st-preset</code> 把 .json 丢进去就行。Discord 新的原生弹窗复选框分组让开关节点像在 SillyTavern 里一样简单。你也可以通过 <code>/persona import</code> 直接导入 SillyTavern 角色卡，或者先用 <code>/persona generate</code> 改一改。</p>

![Screenshots 5](../assets/img/scs/5.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-CN/features/">还有更多功能，而且还在增加！</a></h3>
<p align="center">一堆好玩又容易设置的功能，从给新成员自动发欢迎消息、跨频道移动这类实用的，到模仿别人来整活的搞怪功能都有。新功能一直在开发中，遇到 Bug（或者想分享有趣的建议）请通过 GitHub Issues 或官方 Discord 反馈。</p>

## 实用资源

- [支持的提供方完整列表](https://docs.tomoribot.app/zh-CN/features/setup-administration/providers-and-models/#支持的提供方)
- [如何运行本地模型](https://docs.tomoribot.app/zh-CN/self-hosting/local-endpoints/)
- [安全与威胁模型](https://docs.tomoribot.app/en/wiki/threat-models/)
- [TomoriBot 官方路线图](https://github.com/users/Bredrumb/projects/1/views/1)
- [用于定制提示词的工具宏](https://docs.tomoribot.app/zh-CN/features/capabilities/tools-and-extensions/)

<!-- GETTING STARTED -->
## 自部署

从下面选一条安装路径：

- **A. 本地 Bun 安装（推荐）：** 需要 Bun，以及数据库所需的 PostgreSQL 或 Docker。
- **B. Docker Compose 安装：** 只需要 Docker 就能运行 bot 和数据库，但主机端的维护脚本仍需要主机上装好工具。

对大多数自部署用户来说，推荐路径是本地 Bun 的安装向导。它默认的**完整安装**会创建 `.env`、生成安全的 `CRYPTO_SECRET`、询问你的 Discord bot token、配置 PostgreSQL、运行 `bun install --frozen-lockfile`，然后尝试安装轻量的数据库与 AI 辅助组件。

### A. 本地 Bun 安装

1. **克隆仓库**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   ```

2. **运行安装向导**（更多信息见**[安装向导指南](https://docs.tomoribot.app/zh-CN/self-hosting/setup-wizard/)**）
   ```sh
   bun run setup
   ```

3. **启动 TomoriBot**
    ```sh
    bun run dev
    ```

看到 `TomoriBot up and running!` 之后，在 Discord 里运行 `/setup`。

### B. Docker Compose 安装

Docker Compose 会构建并运行 TomoriBot 与 PostgreSQL。它不使用安装向导。

**Docker Compose 必需的 `.env` 变量：**
- `DISCORD_TOKEN` - 你的 Discord bot token
- `CRYPTO_SECRET` - 32 个字符的加密密钥
- `POSTGRES_PASSWORD` - 数据库密码（其他数据库设置会自动配置）

使用 Docker Compose 时，从 `.env.example` 开始，如果还没设置就再加上 `POSTGRES_PASSWORD`。可选的 Docker 或运行时调优值仍然可以从 `.env.optional.example` 复制。

```sh
# 构建并启动 TomoriBot 和她的数据库
docker compose up --build
```

之后的启动，只要没改过代码或依赖，`docker compose up` 就够了。

### C. 可选的本地服务器

无论选哪条安装路径，TomoriBot 都支持按需启用的本地服务器来增强她的工具并加入本地监控：用于网页搜索的 SearXNG、用于抓取浏览器渲染页面的 Crawl4AI，以及本地 TTS 和 STT 语音服务器。

**用本地 Bun 安装（A）时**，用 `bun run launch` 代替 `bun run dev`，运行示例：

```sh
# 同时启用 SearXNG 与 Crawl4AI 的 Docker 容器
bun run launch --searxng --crawl4ai

# 按照语音安装文档配置完之后，启用本地 TTS 服务器
bun run launch --qwen3tts
bun run launch --voxcpm2
bun run launch --cosyvoice3

# 查看所有可用参数
bun run launch --help
```

可用参数：`--searxng`、`--crawl4ai`、`--qwen3tts`、`--chatterbox`、`--irodoritts`、`--voxcpm2`、`--fishs2`、`--cosyvoice3`、`--moss`、`--whisperx`、`--help`

**Ctrl+C** 会停止 bot 以及所有 Python 服务器进程。Docker 容器（`--searxng`、`--crawl4ai`）会被刻意留在运行状态，用完请手动停止：`docker stop searxng` / `docker stop crawl4ai`。

**用 Docker Compose 安装（B）时**，本地服务器改为通过 Compose profile 按需启用：

```sh
# + SearXNG 网页搜索（自部署的元搜索引擎）
docker compose --profile searxng up

# + Crawl4AI 浏览器渲染页面抓取
docker compose --profile fetch-crawl4ai up

# + 两个一起启用
docker compose --profile searxng --profile fetch-crawl4ai up
```

完整安装细节见下面的指南：

- **[SearXNG 网页搜索](https://docs.tomoribot.app/zh-CN/self-hosting/local-endpoints/setup-searxng/)** - 自部署的元搜索引擎实例，让 `web_search` 工具不受单一引擎的 API 限制。
- **[Crawl4AI](https://docs.tomoribot.app/zh-CN/self-hosting/local-endpoints/setup-crawl4ai/)** - 带浏览器渲染的服务器，为 `fetch_url` 工具抓取并处理 JavaScript 较重的网页。
- **[文本转语音](https://docs.tomoribot.app/zh-CN/self-hosting/local-endpoints/text-to-speech/)** / **[语音转文字](https://docs.tomoribot.app/zh-CN/self-hosting/local-endpoints/speech-to-text/)** - TomoriBot 语音消息所用的 Python 语音服务器，需要事先配置好一次它们的 venv。

### 更新 TomoriBot

要把自部署的实例更新到最新版本，先停止 bot（这样备份和可能的迁移都是在安静的数据库上运行），然后运行先备份再更新的更新脚本：

```sh
bun run update
```

该指令按下面的顺序执行，任何一步失败都会立刻停止：

1. **`bun run backup`** - 在动任何代码*之前*把数据库完整备份到 `/backups/`。如果备份失败，更新会中止，你的部署保持原样。
2. **`git pull --rebase --autostash`**
3. **`bun install --frozen-lockfile`**

然后用 `bun run dev` 或 `bun run launch` 重启 TomoriBot

可用参数：

| 参数 | 作用 |
|---|---|
| `--build` | 安装依赖后再运行 `bun run build` |
| `--docker` | Docker Compose 路径：把第 3 步换成 `docker compose build` + `docker compose up -d` |
| `--skip-backup` | 跳过更新前的备份（不推荐） |
| `--yes` | 跳过开始前的确认提示 |

关于所有主机端脚本的更多细节，见完整的**[维护文档](https://docs.tomoribot.app/zh-CN/features/command-reference/)**。

<!-- AFTER SETUP -->
### 邀请或安装之后

#### 基本指令

- `/setup` - 为你的服务器做初始 bot 设置
- `/config` - 多种调整 TomoriBot 的方式
- `/personal memories` - 管理你的个人记忆
- `/memories` - 管理服务器记忆、文档和短期记忆
- `/moderation` - 管理成员访问权限、用户黑名单、频道、人格和身份组限制

所有斜杠指令见完整的**[指令参考](https://docs.tomoribot.app/zh-CN/features/command-reference/)**。

#### 聊天互动

在服务器里提及 bot，或者用配置好的触发词就能开始一段对话：
```
@TomoriBot yo wassup
```

也可以直接发 TomoriBot 的私信打个招呼！

<!-- CONTRIBUTING -->
## 贡献

非常欢迎为 TomoriBot 做贡献！在提交拉取请求之前，请先看看这些资源：

- **[贡献文档](https://docs.tomoribot.app/en/contributing/)**：添加斜杠指令、工具、事件处理器、新的 AI 提供方和语言版本的完整分步指南。
- **[贡献准则](.github/CONTRIBUTING.md)**：涵盖分支流程、质量门检查，以及无需事先讨论就欢迎的贡献范围的仓库规则。

<!-- LEGAL -->
## 法律与许可

### 面向官方托管版 TomoriBot 实例的用户
- **[服务条款](https://docs.tomoribot.app/zh-CN/legal/terms-of-service/)** - 使用 bot 的规则与指引
- **[隐私政策](https://docs.tomoribot.app/zh-CN/legal/privacy-policy/)** - 我们如何处理你的数据

这些文档也可以在 Discord 里通过 `/legal terms-of-service` 和 `/legal privacy-policy` 指令查看。

### 面向自部署或使用分支版本的用户
数据由你自己掌控，你的部署是否符合 [**GNU Affero General Public License v3.0**](https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE) 也由你负责。

<!-- CONTACT -->
## 联系与链接

**官方网站**：[https://tomoribot.app](https://tomoribot.app/)

**项目链接**：[https://github.com/Bredrumb/TomoriBot](https://github.com/Bredrumb/TomoriBot)

**Email**：bredrumb@gmail.com

**Discord**：[官方支持服务器](https://discord.gg/bjCfHm9QsB)

<!-- SUPPORT -->
## 支持这个项目

如果你觉得 TomoriBot 有帮助，想支持它持续开发，可以考虑在 GitHub 上点个 ⭐，或者通过 Ko-fi 支持！

<p align="left">

  &nbsp;
  <a href="https://ko-fi.com/bredrumb">
    <img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi">
  </a>
</p>

<!-- MARKDOWN LINKS & IMAGES -->
[TypeScript.js]: https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Bun.sh]: https://img.shields.io/badge/Bun-f472b6?style=for-the-badge&logo=bun&logoColor=white
[Bun-url]: https://bun.sh/
[Discord.js]: https://img.shields.io/badge/Discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white
[Discord-url]: https://discord.js.org/
[PostgreSQL.org]: https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white
[PostgreSQL-url]: https://www.postgresql.org/
[Google.ai]: https://img.shields.io/badge/Google%20AI-4285F4?style=for-the-badge&logo=google&logoColor=white
[Google-url]: https://ai.google.dev/

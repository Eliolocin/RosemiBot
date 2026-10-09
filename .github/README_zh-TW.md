### [English](../README.md) | [日本語](README_ja.md) | 繁體中文 | [简体中文](README_zh-CN.md) | [Español](README_es-419.md) | [Português (Brasil)](README_pt-BR.md) | [Tiếng Việt](README_vi.md)

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

> [!NOTE]
> 這份 README 只是快速概覽。完整且最新的文件（設定指南、功能導覽、供應商資訊等）請見 **[docs.tomoribot.app](https://docs.tomoribot.app/zh-TW/)**。

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="../assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

可在自己的伺服器上自架、自由客製的 Discord 個人 AI 助理與角色扮演系統，具備記憶、多個人格、工具呼叫、多模態，並支援 API 與本機模型。

<p align="center">
  <strong><a href="https://tomoribot.app/">官方網站</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">邀請 TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Discord 伺服器</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">最新版本</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">回報錯誤</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">建議功能</a>
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
## 關於專案

TomoriBot 是一套免費且開源的 Discord 自架個人 AI 助理與角色扮演系統，靈感來自 SillyTavern 與 Discord 已停止服務的 Clyde。你可以把它當成實用的助理、可客製的夥伴或角色扮演對象，在私訊裡自己用，也能讓整個 Discord 伺服器一起用。

TomoriBot 支援長期記憶、多個人格運作、網頁與 MCP 工具、聊天室內的媒體生成、200 多個 Discord 斜線指令，以及多種供應商，包含自訂代理與自架自己的模型，從文字生成到影片生成都涵蓋在內。

### 開始使用

你可以[邀請公開版 TomoriBot](https://discord.com/oauth2/authorize?client_id=841644102059556915) 加入你的 Discord 伺服器，如果希望完全掌控自己的隱私與 API 金鑰，也可以[自架自己的執行個體](#自架)。TomoriBot 採用最佳安全實務與加密來保護資料，不過自架能確保所有資料都完全留在你的裝置上。

用上述任一方式把她加入伺服器後，執行 `/setup` 指令取得說明。之後只要喊她的名字（或 @ 提及她）就能得到回應。

## 功能展示


![Screenshots 1](../assets/img/scs/1.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/capabilities/tools-and-extensions/">AI 代理驅動的對話</a></h3>
<p align="center">TomoriBot 內建非常多工具，讓她不只是聊天，還能搜尋網頁、設定重複任務與提醒、使用伺服器的表情符號與貼圖，並透過 RAG、STM 等記憶功能記住跨頻道、跨伺服器的脈絡。</p>

<br />


![Screenshots 2](../assets/img/scs/2.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/capabilities/media-generation/">完整的多模態輸入輸出</a></h3>
<p align="center">TomoriBot 能處理直接傳進 Discord 的圖片、音訊與影片，並用你自己的本機模型端點或 API 金鑰生成這些內容，全部都會加密存放在持久化資料庫中。現成可用的 ComfyUI 工作流程放在 <code>assets/comfyui-workflows/</code>，本機音訊推論伺服器則在 <code>servers/</code>！</p>

<br />

![Screenshots 3](../assets/img/scs/3.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/chatting-personality/multiple-personas/">多個人格支援</a></h3>
<p align="center">TomoriBot 在伺服器裡的人格、行為與頭像都能輕鬆修改、建立，也能匯出成「人格」分享給其他人（類似可分享的 AI 角色卡）。你可以透過 <code>/persona generate</code> 匯入甚至轉換自己喜歡的 SillyTavern 角色卡。單一伺服器能擁有無限多個不同人格，每個都有自己的記憶與目標。你也可以安排它們互相合作，在伺服器裡一起做事（或只是互相打鬧）。</p>

<br />


![Screenshots 4](../assets/img/scs/4.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/command-reference/">200 多個原生設定指令</a></h3>
<p align="center">所有設定都能透過 Discord 原生的斜線指令與互動介面完成。完整管理人格與提示詞、調整模型參數、設定 MCP 工具伺服器、調整權限、設定記憶、設定伺服器成員的速率限制，還有更多！你也可以直接問 TomoriBot 她會做什麼、有哪些斜線指令。目前正在開發網頁儀表板，讓管理更方便。</p>

<br />


![Screenshots 6](../assets/img/scs/6.png)

<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/integrations/sillytavern-support/">SillyTavern 整合（Beta）</a></h3>
<p align="center">你可以透過 TomoriBot 在 Discord 裡直接使用自己喜歡的 SillyTavern 預設集，她會完整調整自己的提示詞，只要用 <code>st-preset</code> 把 .json 丟進來就好。Discord 為表單新增的原生核取方塊群組，讓你能像在 SillyTavern 一樣輕鬆開關節點。你也可以用 <code>/persona import</code> 直接匯入 SillyTavern 角色卡，或先用 <code>/persona generate</code> 修改它們。</p>

![Screenshots 5](../assets/img/scs/5.png)
<h3 align="center"><a href="https://docs.tomoribot.app/zh-TW/features/">還有更多功能，持續增加中！</a></h3>
<p align="center">還有一堆容易設定的有趣功能，從實用的新成員自動問候、跨頻道移動，到使用者模仿這種純粹來亂的都有。新功能持續開發中，如果有任何錯誤（或想分享有趣的建議），請透過 GitHub issues 或官方 Discord 回報。</p>

## 實用資源

- [支援的供應商完整清單](https://docs.tomoribot.app/zh-TW/features/setup-administration/providers-and-models/#支援的供應商)
- [如何執行本機模型](https://docs.tomoribot.app/zh-TW/self-hosting/local-endpoints/)
- [安全性與威脅模型](https://docs.tomoribot.app/en/wiki/threat-models/)
- [官方 TomoriBot 開發藍圖](https://github.com/users/Bredrumb/projects/1/views/1)
- [自訂提示詞用的工具巨集](https://docs.tomoribot.app/zh-TW/features/capabilities/tools-and-extensions/)

<!-- GETTING STARTED -->
## 自架

選擇一種安裝方式：

- **A. 本機 Bun 安裝（建議）：**需要 Bun，以及 PostgreSQL 或 Docker 作為資料庫。
- **B. Docker Compose 安裝：**只要 Docker 就能執行 bot 與資料庫，但主機端的維護腳本仍需要主機上的工具。

對大多數自架者來說，建議走本機 Bun 設定精靈。預設的 **Full Install** 路徑會建立 `.env`、產生安全的 `CRYPTO_SECRET`、詢問你的 Discord bot token、設定 PostgreSQL、執行 `bun install --frozen-lockfile`，接著嘗試安裝輕量的資料庫與 AI 輔助額外項目。

### A. 本機 Bun 安裝

1. **複製儲存庫**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   ```

2. **執行設定精靈**（更多資訊請見**[設定精靈指南](https://docs.tomoribot.app/zh-TW/self-hosting/setup-wizard/)**）
   ```sh
   bun run setup
   ```

3. **啟動 TomoriBot**
    ```sh
    bun run dev
    ```

看到 `TomoriBot up and running!` 之後，在 Discord 執行 `/setup`。

### B. Docker Compose 安裝

Docker Compose 會建置並執行 TomoriBot 與 PostgreSQL，不會使用設定精靈。

**Docker Compose 必填的 `.env` 變數：**
- `DISCORD_TOKEN` - 你的 Discord bot token
- `CRYPTO_SECRET` - 32 字元的加密金鑰
- `POSTGRES_PASSWORD` - 資料庫密碼（其他資料庫設定會自動處理）

使用 Docker Compose 時，從 `.env.example` 開始，如果還沒設定就補上 `POSTGRES_PASSWORD`。選用的 Docker 或執行階段調校值仍然可以從 `.env.optional.example` 複製。

```sh
# 建置並啟動 TomoriBot 與她的資料庫
docker compose up --build
```

之後要再啟動時，只要沒有改過程式碼或相依套件，執行 `docker compose up` 就夠了。

### C. 選用的本機伺服器

不論用哪種安裝方式，TomoriBot 都支援自行選擇啟用的本機伺服器，用來強化她的工具並加入本機監控：用於網頁搜尋的 SearXNG、用於瀏覽器渲染頁面抓取的 Crawl4AI，以及本機 TTS/STT 語音伺服器。

**使用本機 Bun 安裝（A）時**，改用 `bun run launch` 取代 `bun run dev`，執行範例：

```sh
# 搭配 SearXNG 與 Crawl4AI 的 Docker 容器
bun run launch --searxng --crawl4ai

# 依照語音設定文件完成後，搭配本機 TTS 伺服器
bun run launch --qwen3tts
bun run launch --voxcpm2
bun run launch --cosyvoice3

# 查看所有可用旗標
bun run launch --help
```

可用旗標：`--searxng`、`--crawl4ai`、`--qwen3tts`、`--chatterbox`、`--irodoritts`、`--voxcpm2`、`--fishs2`、`--cosyvoice3`、`--moss`、`--whisperx`、`--help`

**Ctrl+C** 會停止 bot 與所有 Python 伺服器程序。Docker 容器（`--searxng`、`--crawl4ai`）刻意保持執行，結束時請用 `docker stop searxng` / `docker stop crawl4ai` 手動停止。

**使用 Docker Compose（B）時**，本機伺服器改為透過 Compose profile 選擇性啟用：

```sh
# + SearXNG 網頁搜尋（自架的元搜尋引擎）
docker compose --profile searxng up

# + Crawl4AI 瀏覽器渲染頁面抓取
docker compose --profile fetch-crawl4ai up

# + 兩者同時啟用
docker compose --profile searxng --profile fetch-crawl4ai up
```

完整設定細節請見以下指南：

- **[SearXNG 網頁搜尋](https://docs.tomoribot.app/zh-TW/self-hosting/local-endpoints/setup-searxng/)** - 自架的元搜尋引擎執行個體，讓 `web_search` 工具不受單一引擎的 API 限制。
- **[Crawl4AI](https://docs.tomoribot.app/zh-TW/self-hosting/local-endpoints/setup-crawl4ai/)** - 瀏覽器渲染的伺服器，為 `fetch_url` 工具抓取並處理大量 JavaScript 的網頁。
- **[文字轉語音](https://docs.tomoribot.app/zh-TW/self-hosting/local-endpoints/text-to-speech/)** / **[語音轉文字](https://docs.tomoribot.app/zh-TW/self-hosting/local-endpoints/speech-to-text/)** - 供 TomoriBot 語音訊息使用的 Python 語音伺服器；需要事先設定一次它們的 venv。

### 更新 TomoriBot

要把自架的執行個體更新到最新版本，請先停止 bot（讓備份與任何移轉都在資料庫沒有寫入負載時執行），然後執行先備份再更新的指令：

```sh
bun run update
```

這個指令會依序執行以下步驟，任何一步失敗就立刻停止：

1. **`bun run backup`** - 在動到任何程式碼*之前*，把完整的資料庫備份存到 `/backups/`。如果備份失敗，更新會中止，你的部署完全不會被改動。
2. **`git pull --rebase --autostash`**
3. **`bun install --frozen-lockfile`**

接著用 `bun run dev` 或 `bun run launch` 重新啟動 TomoriBot

實用旗標：

| 旗標 | 效果 |
|---|---|
| `--build` | 安裝相依套件後也會執行 `bun run build` |
| `--docker` | Docker Compose 路徑：把步驟 3 換成 `docker compose build` + `docker compose up -d` |
| `--skip-backup` | 略過更新前的備份（不建議） |
| `--yes` | 開始前略過確認提示 |

所有主機端腳本的詳細說明，請見完整的**[維護文件](https://docs.tomoribot.app/zh-TW/features/command-reference/)**。

<!-- AFTER SETUP -->
### 邀請或設定完成後

#### 基本指令

- `/setup` - 伺服器的 bot 初始設定
- `/config` - 多種調整 TomoriBot 的方式
- `/personal memories` - 管理你的個人記憶
- `/memories` - 管理伺服器記憶、文件與短期記憶
- `/moderation` - 管理成員存取、使用者黑名單，以及頻道、人格與身分組限制

所有斜線指令請見完整的**[指令參考](https://docs.tomoribot.app/zh-TW/features/command-reference/)**。

#### 聊天互動

只要在伺服器裡提及 bot，或使用設定好的觸發詞，就能開始對話：
```
@TomoriBot yo wassup
```

或者直接私訊 TomoriBot 跟她打招呼！

<!-- CONTRIBUTING -->
## 貢獻

非常歡迎大家為 TomoriBot 貢獻！送出 pull request 之前，請先看過以下資源：

- **[貢獻文件](https://docs.tomoribot.app/en/contributing/)**：新增斜線指令、工具、事件處理器、新的 AI 供應商與 locale 的完整逐步指南。
- **[貢獻準則](CONTRIBUTING.md)**：涵蓋分支流程、品質檢查，以及不需事先討論就歡迎的貢獻範圍等儲存庫規則。

<!-- LEGAL -->
## 法律與授權

### 給使用官方代管 TomoriBot 執行個體的使用者
- **[服務條款](https://docs.tomoribot.app/zh-TW/legal/terms-of-service/)** - 使用 bot 的規則與指引
- **[隱私權政策](https://docs.tomoribot.app/zh-TW/legal/privacy-policy/)** - 我們如何處理你的資料

這些文件也能在 Discord 裡用 `/legal terms-of-service` 與 `/legal privacy-policy` 指令開啟。

### 給自架或使用分支版本的使用者
資料由你自己掌控，你的部署也必須自行負責遵循 [**GNU Affero General Public License v3.0**](https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE) 的規範。

<!-- CONTACT -->
## 聯絡與連結

**官方網站**：[https://tomoribot.app](https://tomoribot.app/)

**專案連結**：[https://github.com/Bredrumb/TomoriBot](https://github.com/Bredrumb/TomoriBot)

**電子郵件**：bredrumb@gmail.com

**Discord**：[官方支援伺服器](https://discord.gg/bjCfHm9QsB)

<!-- SUPPORT -->
## 支持專案

如果你覺得 TomoriBot 有幫助，也想支持她持續開發，歡迎在 GitHub 留下一顆 ⭐，或透過 Ko-fi 贊助！

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

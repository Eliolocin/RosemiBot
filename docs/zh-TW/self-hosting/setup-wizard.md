---
title: "設定精靈"
sidebar:
  label: "設定精靈"
  order: 1
aiGenerated: false
---

:::note
想用 Docker Compose 的人請跳過這個精靈，容器化安裝路徑請看
[Docker Compose](/zh-TW/self-hosting/docker-compose/)。
:::

`bun run setup` 是推薦的本機 Bun 自架路徑。它會建立你的 `.env`、產生 `CRYPTO_SECRET`、詢問你的 Discord bot 權杖、設定 PostgreSQL，並以互動方式安裝 `bun.lock` 裡指定的確切相依套件，所以你只要照著提示走就好。重複執行也沒有問題；既有的 `.env` 值會保留，除非你選擇重新設定它們。

## 取得程式碼

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 選擇一條路徑

執行指令之後，你會從兩條路徑中挑一條：

```bash
bun run setup
```


| 路徑 | 什麼時候用 | 它會做什麼 |
|---|---|---|
| 完整安裝 | 你想要推薦的設定，加上幾個輕量的額外項目。 | 先跑基礎安裝，接著嘗試底下四個額外項目。 |
| 基礎安裝 | 你只想要最低限度可運作的 bot。 | 建立並設定 `.env`、Discord 權杖、PostgreSQL 與相依套件。 |



## 事前要準備好的東西

- [Bun](https://bun.sh/)，用來執行 bot 與精靈本身。
- 一個 Discord bot 權杖，並已啟用 `GuildMembers`、`MessageContent` 與 `GuildPresences`
  特權意圖。
- 一個資料庫。 TomoriBot 把所有東西都存在 PostgreSQL。你不需要手動設定，精靈會幫你處理：
  你已經裝了 PostgreSQL 的話它就沿用，沒有的話它會在 [Docker](https://www.docker.com/) 幫你跑一個。
  只要確定開始之前兩者之一已經裝好就好。

:::caution
- 內附的 Docker PostgreSQL 只把資料庫放進 Docker。 bot 本身、啟動備份、`bun run backup`
  與 `restore-backup` 仍然透過主機的 Bun 與主機的 PostgreSQL 用戶端工具執行。如果你想把所有東西
  都放進 Docker，請改用 [Docker Compose](/zh-TW/self-hosting/docker-compose/)。
:::

如果缺少 `psql` 或自動佈建失敗，精靈會印出手動執行的 SQL。不論是哪一種，TomoriBot 都會在首次啟動時自動初始化它的結構描述、種子資料、移轉、`pgcrypto` 與 RAG 結構描述。

## 完整安裝的額外項目

完整安裝會先跑基礎安裝，再嘗試安裝底下的額外項目。任何一項失敗，它會印出完成該項目的指令或指南，然後繼續往下走：

| 額外項目 | 用途 |
|---|---|
| `pgvector` | 文件與 RAG 記憶用的向量搜尋。 |
| `pg_cron` | 選用的排程冷卻與提醒資料列清理。 |
| Tokenizer 資產 | 本機 tokenizer 資產，支援依模型調整的 logit 偏權值。 |

想手動安裝其中任何一項，請看
[手動設定的額外項目](/zh-TW/self-hosting/manual-setup/#選用額外項目手動的完整安裝)。

## 設定完成之後

```bash
bun run dev                          # 只有 bot
bun run launch --searxng --crawl4ai  # bot 加本機伺服器（請看 bun run launch --help）
```

bot 上線之後，在 Discord 執行 `/setup` 來連接 AI 供應商。自己的工作區沒有自帶供應商就無法回覆，除非它以使用者 BYOK 模式運行，改由每位成員的個人供應商回答，所以這是每一條安裝路徑的最後一步。

## `/setup` 指令
<!-- anchor: the-setup-command -->

`/setup` 會開啟一個只有執行者本人能操作、只有自己看得到的檢查清單面板。在伺服器裡它需要
管理伺服器權限；在私訊裡，那個人自己的工作區就能使用。面板上的每一列都是草稿值：
完成設定是唯一會寫入任何東西的控制項，所以開啟、編輯、取消或重新開始都不會動到任何資料庫資料列。

| 步驟 | 出現時機 | 它收集什麼 |
|---|---|---|
| 政策 | 僅 `RUN_ENV=production` | 接受服務條款與隱私權政策，兩者在同一個表單中。 |
| AI 供應商 | 每一種環境 | 回覆如何送達模型。底下三種存取模式的其中一種。 |
| 起始設定 | 每一種環境 | 起始人格、回覆風格、時區，以及工作區預設的系統提示詞。 |

其他任何 `RUN_ENV` 值都會呈現兩步驟的版面，而且完全不顯示政策文字。以
`RUN_ENV=production` 運行的部署會在 `/legal license` 旁邊註冊 `/legal terms-of-service` 與
`/legal privacy-policy`；其他任何值只註冊 `/legal license`。

### 供應商存取模式

- **AI 供應商（推薦）**：從目錄挑一個供應商，貼上它的 API 金鑰。金鑰會向供應商驗證後加密進草稿；
  面板只會顯示已儲存金鑰，永遠不會顯示金鑰本身。執行 `/help`，然後看 `設定` > **步驟 1：取得
  API 金鑰**，取得各供應商的逐步說明。
- **自訂端點（進階）**：給自架或代理端點用的兩顆按鈕子區域。
  設定連線會收集 API 相容性、標籤、URL 與選填的驗證權杖，並檢查端點是否有回應。
  設定文字模型會收集模型代號、它的脈絡大小與它的功能宣告，並且在連線通過驗證之前維持停用。
  再次儲存連線會清除模型宣告，因為那些宣告取決於所選的 API 相容性。這與 `/providers` 執行的是
  同一套註冊流程，只是改在精靈裡完成，而且在按下`完成設定`之前不會建立任何資料列。
- 使用者 BYOK（僅限伺服器，私訊永遠不適用）：工作區不自帶供應商，每一位成員觸發的回覆都改為
  解析個人供應商。在表單中確認之後，請成員用 `/personal providers` 註冊自己的供應商。請看
  [伺服器管理](/zh-TW/features/setup-administration/server-moderation/#user-byok-bring-your-own-key)。

### 起始設定

一個四列的表單會收集人格、回覆風格、時區位移與預設系統提示詞。時區是選填的，預設為 UTC。系統提示詞提供
內建預設（推薦），以及工作區目錄中的每一個預設集：內建選項完全不儲存提示詞文字，所以它會持續跟著
出廠預設值走；預設集選項則會把該預設集在提交當下的文字存下來。從目錄刪除已儲存的人格或提示詞，會讓這個
步驟重新開啟，直到選了另一個為止。

### 完成與取消

完成設定會維持停用，直到畫面上的每一個步驟都完成。它會重新驗證目錄與工作區狀態、在單一交易中提交整份
草稿，並用收據取代面板。`取消`會丟棄草稿，並讓面板上每一個控制項失效。

草稿存在 bot 行程中，不在資料庫裡，所以它只會在取消、完成或行程重新啟動時結束。同時最多保留
200 份草稿；達到上限時最舊的會被丟棄。工作階段已不存在時，對應的控制項不會寫入任何東西。

## 更新

使用備份優先的更新指令：`bun run update`

它會先執行 `bun run backup`，接著執行
`git pull --rebase --autostash`，再執行 `bun install --frozen-lockfile`。如果你是從 `dist/` 執行，加上
`--build`，Compose 部署則加上 `--docker`。完整細節在
[維護與備份](/zh-TW/self-hosting/maintenance/)頁面。

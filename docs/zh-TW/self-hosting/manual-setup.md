---
title: "手動設定"
sidebar:
  order: 2
aiGenerated: false
---

:::note
想使用Docker Compose的人請跳過這個精靈，容器化安裝路徑請看
[Docker Compose](/zh-TW/self-hosting/docker-compose/)。
:::

這是給偏好不用引導式精靈的技術背景使用者的手動安裝流程。如果你想要有人一步步帶著走，請改用[設定精靈](/zh-TW/self-hosting/setup-wizard/)，它會建立`.env`、產生安全的`CRYPTO_SECRET`、設定PostgreSQL，並幫你跑完安裝。

## 事前需求

- [Bun](https://bun.sh/)
- 原生安裝的PostgreSQL，或跑在Docker容器裡（請看步驟2）

PostgreSQL結構描述、`pgcrypto`、種子資料與移轉會在bot啟動時自動初始化。

## 1. 安裝

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
bun install --frozen-lockfile
```

## 2. 設定

根據範例建立環境文件並填寫所需的值：

```sh
cp .env.example .env
```

必需的：

- `DISCORD_TOKEN`：你的Discord機器人令牌（啟用`GuildMembers`、`MessageContent`和`GuildPresences`特權意圖）。
- `CRYPTO_SECRET`：32個字元的加密金鑰（用於加密儲存的API金鑰）。
- PostgreSQL連接：`POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`。

請將加密金鑰的受保護複本與資料庫備份分開儲存。新的備份不包含 `.env`。對於金鑰輪換，請使用 `CRYPTO_SECRET_V1`、`CRYPTO_SECRET_V2` 或任何後續的正整數版本，並可選擇使用 `CRYPTO_SECRET_CURRENT`。`CRYPTO_SECRET` 仍為 V1。啟動與維護命令載入相同的設定來源：開發環境中為本機環境變數值，生產環境中為掛載的 JSON 或 AWS Secrets Manager。在替換金鑰之前，請參閱[輪換加密金鑰](/zh-TW/self-hosting/maintenance/#rotating-encryption-keys)。

在 JSON 金鑰來源中，主金鑰必須是字串。`CRYPTO_SECRET_CURRENT` 接受指示可用版本的字串（如 `"2"`）或正安全整數數值（如 `2`）。

:::note[No native PostgreSQL?]
僅運行容器中的資料庫，然後將`POSTGRES_*`值指向它：

```sh
docker run -d --name tomori-db \
  -e POSTGRES_USER=tomori -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=tomori \
  -p 5432:5432 pgvector/pgvector:pg16
```

然後設定`POSTGRES_HOST=localhost`，`POSTGRES_PORT=5432`，以及上面的使用者/密碼/db。`pgvector/pgvector`映像預先安裝了RAG擴充；如果不需要文件/RAG內存，請將其交換為`postgres:16`。這僅運行Docker中的資料庫，並且機器人仍然在主機Bun上運行。對於完全容器化的機器人和資料庫，請改用 [Docker Compose](/zh-TW/self-hosting/docker-compose/)。
:::

`.env.optional.example`中有選購的調音功能。複製你想要自訂的任何值（限制、逾時、功能切換、本機伺服器URL等）。

自訂表達式預設上傳到`data/custom-expressions/`下的本機檔案。將該目錄保留在持久性儲存中。`EXPRESSION_STORAGE_BACKEND`接受`local`、`gcs`或`s3`。雲端後端需要`EXPRESSION_STORAGE_BUCKET`和對應的SDK憑證。S3也使用`AWS_REGION`（預設`us-east-1`）和選購`S3_ENDPOINT`。GCS使用應用程式預設憑證。表達式使用自己的儲存桶設定；頭像儲存設定未選擇表情桶。物件仍然可以透過SDK讀取，並以位元組形式附加，因此不需要公開提供的媒體URL。恢復現有參考時保留後端、儲存桶和物件鍵。

`MAX_CUSTOM_EXPRESSIONS_PER_SERVER` 限制每個伺服器的自訂表情數量（預設 `20`，最小 `1`）。連結與上傳的檔案在所有預設之間共用該限制；原生表情符號與貼圖不計入。變更後請重啟機器人。調低限制會保留現有表情並允許編輯與刪除，但會阻止新增，直到數量低於限制為止。

## 3. 執行

```sh
bun run dev
```

當你看到`TomoriBot up and running!`，就到Discord並在你的伺服器執行`/setup`，連接一個AI供應商並初始化bot。這個指令會開啟一個引導式檢查清單面板，而且在你按下`完成設定`之前不會寫入任何東西；步驟請看
[`/setup`指令](/zh-TW/self-hosting/setup-wizard/#setup-指令)，Discord那一側請看
[快速開始](/zh-TW/introduction/quickstart/)。

如果你想讓選用的本機伺服器（SearXNG、Crawl4AI、本機TTS/STT）跟著bot一起啟動，請用`bun run launch`取代`bun run dev`：

```sh
bun run launch --searxng --crawl4ai
bun run launch --help        # see all flags
```

## 選用額外項目（手動的「完整安裝」）
<!-- anchor: optional-extras-the-manual-full-install -->

[設定精靈](/zh-TW/self-hosting/setup-wizard/)的完整安裝路徑會在基礎安裝之上疊加四個輕量的額外項目。它們都不是執行bot的必要條件，但每一項都會解鎖一個功能。如果你是手動安裝，想要哪一項就加哪一項：

### `pgvector`：文件與RAG記憶

RAG（文件上傳與跨頻道回想）會把嵌入向量存在`vector`欄位，這需要
[pgvector](https://github.com/pgvector/pgvector) 擴充功能。請依你的PostgreSQL主版本安裝：

```sh
# Debian/Ubuntu, e.g. for PostgreSQL 16
sudo apt-get install -y postgresql-16-pgvector
```

接著在你的資料庫上啟用一次。用`.env`裡的`POSTGRES_*`值透過`psql`連線，它會提示你輸入`POSTGRES_PASSWORD`：

:::note[Windows]
原生Windows PostgreSQL沒有預先建置的pgvector套件。要安裝就得用Visual Studio C++ 與`nmake`，
針對你的確切PostgreSQL版本從原始碼建置（請看pgvector的
[Windows說明](https://github.com/pgvector/pgvector#windows)）。Windows上比較簡單的路徑，是把資料庫跑在
上面[設定](#2-設定)一節所示的`pgvector/pgvector`容器裡，那個映像檔已預先安裝擴充功能。
:::

```sh
# Native / host psql (substitute your own POSTGRES_USER and POSTGRES_DB):
psql -h localhost -p 5432 -U tomori -d tomodb

# Or, if the database runs in the Docker container from step 2:
docker exec -it tomori-db psql -U tomori -d tomori
```

連線之後，執行：

```sql
CREATE EXTENSION vector;
```

沒有pgvector，bot仍然可以執行，但RAG功能會完全無法使用。還原備份之前，目標資料庫也必須先有這個擴充功能；詳情請看
[安全移轉](/zh-TW/self-hosting/safe-migration/)。

### `pg_cron`：排程清理工作

`pg_cron`提供選用的定期資料庫維護（冷卻與提醒資料列的清理）。本repo的Docker Compose已經設定好它。

:::caution[提醒與觸發不需要它]
`pg_cron`純粹是做日常家務，因為它只清理過期的資料列。提醒的送達與隨機觸發都在應用程式本身執行，
所以那些功能有沒有`pg_cron`都能運作。
:::

如果是你自己管理的PostgreSQL，請找出目前生效的設定檔：

```sql
SHOW config_file;
```

在`postgresql.conf`啟用擴充功能。如果`shared_preload_libraries`已經列出其他函式庫，就附加在後面：

```ini
shared_preload_libraries = 'pg_cron'   # e.g. 'pg_stat_statements,pg_cron'
cron.database_name = 'your_dbname'
```

重新啟動PostgreSQL，然後：

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### Tokenizer資產：依模型調整的logit偏權值

Logit偏權值（表情符號與詞彙重複懲罰）需要本機的tokenizer資產：

```sh
bun run setup:tokenizers
```

有些模型家族（例如Gemma）有使用門檻，在你接受授權之後需要一組
[HuggingFace權杖](https://huggingface.co/settings/tokens)：

```sh
# Windows (PowerShell)
$env:HF_TOKEN="hf_xxx"; bun run setup:tokenizers

# macOS/Linux
HF_TOKEN=hf_xxx bun run setup:tokenizers
```

沒有這一步，logit偏權值會默默停用，其他一切照常運作。

安全的 `fetch_url` 後備與 DuckDuckGo 的 `web_search` 後備均在處理程序內執行，因此兩者都不需要額外安裝。

## 維護、更新與備份

安裝完成之後，主機端指令稿（`bun run update`、`bun run backup`、
`bun run restore-backup`、`bun run nuke-db`、`bun run rotate-keys`……）與更新、備份流程都放在
[維護與備份](/zh-TW/self-hosting/maintenance/)頁面。如果你正準備拉取新版本，請先從
[安全移轉](/zh-TW/self-hosting/safe-migration/)開始。

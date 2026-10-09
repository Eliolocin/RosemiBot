---
title: "設定：Crawl4AI"
sidebar:
  order: 4
---

使用本地 [Crawl4AI](https://github.com/unclecode/crawl4ai) 伺服器將JavaScript密集型網頁渲染為TomoriBot的乾淨Markdown。

內建的`fetch_url`工具預設使用輕量級的`safe_http`引擎。Crawl4AI新增了一個可選的無頭Playwright瀏覽器，該瀏覽器在將Markdown返回給機器人之前執行使用者端腳本並提取頁面內容。

由於Crawl4AI遵循TomoriBot受保護的HTTP使用者端外部的重定向，因此僅在允許專用網路取得的情況下才允許其進行。外部生產（`RUN_ENV`！= `production`），私網抓取會自動啟用。在生產環境中，需要設定`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

:::caution[TomoriBot 能檢查什麼與不能檢查什麼]
TomoriBot 在請求 Crawl4AI 開啟 URL 之前，會拒絕主機名稱無法解析或解析為雲端中繼資料位址的 URL。但它無法控制瀏覽器接下來的操作：Crawl4AI 會自行重新解析網域名稱、跟隨重新導向並載入圖片與指令碼。TomoriBot 的全天候中繼資料攔截不涵蓋這些請求。

固定映像檔（`unclecode/crawl4ai:0.9.4`）會使其瀏覽器透過自身 Proxy 發送請求，該 Proxy 會在每次請求與重新導向時攔截私有位址、回環位址和中繼資料位址。請保留 `CRAWL4AI_ALLOW_INTERNAL_URLS` 未設定：將其設定為 `true` 會關閉該 Proxy，包括中繼資料攔截。
:::

Crawl4AI 0.9.4 在接受來自其自身容器外部的連線之前需要 API 權杖。請產生一個權杖（例如 `openssl rand -hex 32`）並在下方所有設定路徑中將其設定為 `.env` 中的 `CRAWL4AI_TOKEN`。若缺少該權杖，容器雖然能啟動，但 TomoriBot 無法連線並會後備到 `safe_http`。

選擇安裝路徑：

### 選項A：Docker Compose（當TomoriBot在Docker中運作時）

如果你使用存储库的Docker Compose堆栈运行TomoriBot，请使用此路径。首先，在`.env`中設定`CRAWL4AI_BASE_URL=http://crawl4ai:11235/`、`CRAWL4AI_TOKEN`以及`FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http`。外部制作无需选择加入专用网络；仅当你使用`RUN_ENV=production`运行此堆栈时才添加`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

然後，從以下開始：

```sh
docker compose --profile fetch-crawl4ai up -d
```

這將使用TomoriBot的Docker網路上的Crawl4AI容器啟動Compose堆疊。Compose 會將 `CRAWL4AI_TOKEN` 作為 `CRAWL4AI_API_TOKEN` 傳遞給容器，而 TomoriBot 會將其作為 Bearer 權杖發送。連接埠 11235 僅發布在 `127.0.0.1` 上以供本機偵錯；TomoriBot 本身透過 Docker 網路進行連線。

如果你直接與`bun run dev`一起運行TomoriBot，請改用下面的獨立路徑。

如果你還想要SearXNG，請連結設定檔：

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

---

### 選項B：獨立Docker（運行`bun run dev`時）

首先，在`.env`中設定`CRAWL4AI_BASE_URL=http://localhost:11235/`、`CRAWL4AI_TOKEN`以及`FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http`，以便機器人連接到發布在 `127.0.0.1` 上的容器連接埠。外部製作無需選擇加入專用網路；如果你使用`RUN_ENV=production`運行，則僅新增`FETCH_URL_ALLOW_PRIVATE_NETWORK=true`。

然後，不要直接使用`bun run dev`運行TomoriBot，而是使用`bun run launch --crawl4ai`。這會自動處理容器生命週期，並在啟動機器人之前等待伺服器就緒。如果缺少 `CRAWL4AI_TOKEN`，它將報錯停止：

```sh
bun run launch --crawl4ai
```

如果你還想要SearXNG：

```sh
bun run launch --searxng --crawl4ai
```

如果你喜歡自行管理容器，請將`CRAWL4AI_BASE_URL=http://localhost:11235/`保留在`.env`中並執行：

電源外殼：

```powershell
docker run -d --name crawl4ai -p 127.0.0.1:11235:11235 --shm-size=3g `
  -e CRAWL4AI_API_TOKEN=<your-token> unclecode/crawl4ai:0.9.4
```

Bash（Linux/macOS）：

```bash
docker run -d --name crawl4ai -p 127.0.0.1:11235:11235 --shm-size=3g \
  -e CRAWL4AI_API_TOKEN=<your-token> unclecode/crawl4ai:0.9.4
```

`<your-token>` 使用與 `.env` 中 `CRAWL4AI_TOKEN` 相同的值。

然後在容器正常運作後執行`bun run dev`（`docker ps`顯示`(healthy)`）。

---

### 選項C：無瀏覽器渲染伺服器

保留`CRAWL4AI_BASE_URL`未設定。`fetch_url`工具使用受保護的`safe_http`引擎。

---

## 起始訂單

TomoriBot在啟動後第一次呼叫`fetch_url`時探測伺服器運作狀況，並將結果快取60秒。如果在第一個探測器觸發時容器尚未準備好，機器人將在下一分鐘將其視為不可用。

對於獨立的Docker，請在啟動TomoriBot之前啟動Crawl4AI容器。`bun run launch --crawl4ai`已經為你做到了這一點。

### 首次設定

1. 啟動容器，等待`docker ps`中顯示`(healthy)`：
   ```powershell
   docker ps
   ```
2. 使用上面設定路徑的值在`.env`中設定`CRAWL4AI_BASE_URL`。
3. 啟動TomoriBot（`bun run dev`或`docker compose up`）。

### 從 `latest` 升級

現有的 `crawl4ai` 容器保留建立它時使用的映像檔，因此 `docker start` 不會升級它。將其刪除一次，然後重新使用你的設定路徑：

```powershell
docker rm -f crawl4ai
```

使用 Compose 時，`docker compose --profile fetch-crawl4ai up -d` 會從固定映像檔重新建立容器。

### 重啟後返回

如果容器在上次運行中已存在，請使用`docker start`而不是`docker run`以避免命名衝突：

```powershell
# Start an existing container
docker start crawl4ai

# Confirm healthy before starting TomoriBot
docker ps
```

然後正常啟動TomoriBot。重新啟動`bun run dev`會重置記憶體中的運行狀況緩存，因此只要容器先準備好，就會立即選擇正確的引擎。

---

## Cookie注入

Crawl4AI支援注入瀏覽器級cookie，因此無頭瀏覽器在取得頁面時會顯示為已登入。這對於需要會話來查看內容的網站（例如付費新聞、私人論壇、登入控制儀表板）非常有用。

`safe_http`後備不支援cookie注入。Cookie僅在Crawl4AI處於活動狀態時適用。

:::note[Bot detection limits]
Cookie注入繞過登入牆，但無法繞過機器人指紋辨識。具有積極反機器人檢測功能的網站（特別是Twitter/X）透過畫布/WebGL指紋識別來偵測無頭劇作家，並提供空白頁面，即使具有有效的會話cookie。Cookie注入對於僅進行身份驗證的網站效果很好。
:::

### 取得你的cookie

1. 開啟瀏覽器並登入目標網站。
2. 開啟DevTools (`F12`) > `Application`標籤 > `Storage` > `Cookies` > 選擇網站的網域。
3. 複製每個所需cookie的`Value`（通常是會話令牌；檢查網站的cookie名稱）。

### Crawl4AI

將`.env`中的`CRAWL4AI_COOKIES_JSON`設定為JSON陣列：

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

設定此值後，`fetch_url`會自動從`/md`端點切換到`/crawl`和`browser_config.cookies`。`/md`不支援cookie注入。

### Cookie物件字段

| 場地 | 必需的 | 描述 |
|---|---|---|
| `name` | 是的 | 餅乾名稱 |
| `value` | 是的 | Cookie值 |
| `domain` | 不 | 域範圍（例如`.x.com`）。推薦的正確性。|
| `path` | 不 | 路徑範圍。如果省略，則預設為`/`。|

:::caution[Protect session tokens]
Cookie值很敏感，因此請將它們視為密碼。他們授予你帳戶的完整會話存取權限。不要將`.env`提交到版本控制。
:::

---

## 引擎順序和環境變量

| 多變的 | 預設 | 描述 |
|---|---|---|
| `CRAWL4AI_BASE_URL` | 未設定 | 設定後啟用Crawl4AI。使用Docker Compose中的`http://crawl4ai:11235/`，或當TomoriBot直接在電腦上執行時使用`http://localhost:11235/`。|
| `CRAWL4AI_TOKEN` | 未設定 | 必需的 Bearer 權杖。必須與 Crawl4AI 容器上的 `CRAWL4AI_API_TOKEN` 相符，否則容器會拒絕外部連線。|
| `FETCH_URL_ENGINE_ORDER` | `safe_http` | 逗號分隔的引擎列表。`safe_http` 始終作為最終後備附加。在不允許私有網路擷取的環境中（未選擇加入的生產環境），Crawl4AI 項目會被忽略。|
| `FETCH_URL_TIMEOUT_MS` | `15000` | Crawl4AI和其他URL取得引擎的每個引擎請求逾時。|
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | 在需要繼續之前，一次fetch呼叫傳回的最大字元數。|
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | 僅限生產選擇加入。外部生產（`RUN_ENV`！= `production`）SSRF防護自動放鬆，因此localhost/private/internal獲取和Crawl4AI調度工作無需設定。僅設定`true`以允許在受信任的生產部署中進行專用網路提取。|
| `FETCH_URL_FILTER_MODE` | `fit` | Crawl4AI `/md`濾波模式。`fit`保持降價更乾淨，供LLM使用；`fetch_url(..., raw=true)`根據請求覆蓋它。|

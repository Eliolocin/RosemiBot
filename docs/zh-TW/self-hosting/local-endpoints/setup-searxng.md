---
title: "設定：SearXNG"
sidebar:
  order: 3
---

使用 [SearXNG](https://docs.searxng.org/) 將私有、自架的Web搜尋新增至TomoriBot。

`web_search`工具查詢引擎後備鏈：Brave、SearXNG和DuckDuckGo。當外部供應商達到速率限製或失敗時，執行本機SearXNG執行個體可提供自架搜尋來源，並啟用專屬的搜尋類別：`science`、`it`、`files`和`music`。

選擇安裝路徑：

### 選項A：Docker Compose（當TomoriBot在Docker中運作時）

如果你使用儲存庫的Docker Compose堆疊來執行TomoriBot，請使用此路徑。然後使用`searxng`設定檔運行：

```sh
docker compose --profile searxng up -d
```

在啟動此設定檔之前，請在`.env`中設定`SEARXNG_BASE_URL=http://searxng:8080/`。機器人使用該位址存取`searxng`服務。當設定檔關閉時，讓變數保持未設定狀態。

如果你直接與`bun run dev`一起運行TomoriBot，請改用下面的獨立路徑。

將`.env`中的`SEARXNG_SECRET`設定為容器簽署金鑰的單獨隨機值。

---

### 選項B：獨立Docker（運行`bun run dev`時）

首先，在`.env`中設定`SEARXNG_BASE_URL=http://localhost:8080/`，以便機器人知道連接到哪裡。

然後，不要直接使用`bun run dev`運行TomoriBot，而是使用`bun run launch --searxng`。這會自動處理容器生命週期，並在啟動機器人之前等待容器健康：

```sh
bun run launch --searxng
```

如果你希望自行管理容器，請將`SEARXNG_BASE_URL=http://localhost:8080/`保留在`.env`中。首先建立儲存庫的映像，以便載入JSON搜尋設定並取代簽名金鑰：

```sh
docker build -t tomoribot-searxng:latest -f servers/searxng/Dockerfile servers/searxng
```

然後運行它：

電源外殼：

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

然後在容器正常運作後執行`bun run dev`（`docker ps`顯示`(healthy)`）。如果容器環境中沒有`SEARXNG_SECRET`，則鏡像會產生臨時簽章金鑰。

---

### 選項C：無SearXNG

保留`SEARXNG_BASE_URL`未設定。鏈條回落至`Brave → DuckDuckGo`。

當未設定SearXNG伺服器時，組裝的`web_search`模式不再通告僅SearXNG類別。配置Brave時，常見類別（`text`、`image`、`video`、`news`）仍會顯示，並且當僅內建的DuckDuckGo後備可用時，會顯示純文字搜尋。

---

## 影像結果調整

SearXNG影像結果經過HEAD驗證，可選擇壓縮，並作為Discord附件發布：與Brave影像相同的UX。如果所有候選URL均未通過驗證，SearXNG將返回圖像連結的文字列表，而不是硬失敗。

| 多變的 | 預設 | 描述 |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3`（最多10個） | 有多少張有效影像傳送到Discord。被LLM的`count`參數覆蓋。|
| `SEARXNG_IMAGE_POOL` | `10` | LLM未指定`count`時的候選URL池。當指定`count`時，池為`count × 3`（上限為30）以吸收熱鏈結保護故障。|
| `WEB_SEARCH_TIMEOUT_MS` | — | 每個引擎請求逾時。|

*（有關所有可調參數，請參閱`.env.optional.example`。）*

---
title: "設定：slop-guard"
sidebar:
  order: 8
aiGenerated: true
---

將基於規則的文章檢查器 [slop-guard](https://github.com/eric-tramel/slop-guard) 作為 [回覆審查](/zh-TW/features/chatting-personality/behavior-tweaking/#response-drafting) 的規則檢查器運行。它會對每個暫扣的回覆進行制式寫作模式的評分，並將報告傳遞給審查者。此檢查基於規則，因此不消耗 token。

slop-guard 僅作為本機 stdio 行程發行。`servers/slop-guard/` 將鎖定的版本（`0.5.0`）封裝在一個小型容器中，透過 MCP Streamable HTTP 提供相同的工具，這也是 TomoriBot 連線至 MCP 伺服器的方式。

## 啟動伺服器

### 選項 A：Docker Compose（當 TomoriBot 在 Docker 中運行時）

```sh
docker compose --profile slop-guard up -d
```

容器會以 `slop-guard` 身分加入 TomoriBot 的 Docker 網路。它不公開任何主機連接埠。

### 選項 B：獨立 Docker（當 TomoriBot 在你的本機電腦上運行時）

使用檢查器啟動 bot，而不是 `bun run dev`：

```sh
bun run launch --slopguard
```

這會建立映像檔，在 `127.0.0.1:8765` 上啟動 `slop-guard` 容器，等待它接受連線，然後以監看模式運行 bot。容器在 `Ctrl+C` 後會保持運行；使用 `docker stop slop-guard` 停止它。修改 `servers/slop-guard/` 後，請刪除舊容器（`docker rm -f slop-guard`），以便 launch 能從重建的映像檔建立新容器。

## 註冊伺服器

1. 開啟 `/config` > 外掛 > MCP 伺服器，然後選擇 `+ 新增 MCP`。
2. 將 `伺服器 URL` 設為 `http://slop-guard:8765/mcp`（選項 A）或 `http://localhost:8765/mcp`（選項 B）。將 `身分驗證權杖` 保持為空。
3. 將 `伺服器類型` 設為 `文章檢查器`。
4. 開啟 `/config` > 外掛 > 回覆審查，並在 `規則檢查` 下選擇 `<伺服器名稱> / check_slop`。

`文章檢查器` 可以防止伺服器的工具被 Tomori 本人使用。slop-guard 還包含 `check_slop_file`，它會讀取容器內部的檔案路徑；規則檢查器絕不會提供此工具，因為它不接受回覆文字。

本機位址可以正常運作，因為自架的 TomoriBot 在運行時帶有 `RUN_ENV=development`（Compose 會固定此值）。在 `RUN_ENV=production` 下，TomoriBot 會拒絕解析為私人或回送位址的 MCP URL。

## 設定

| 變數 | 預設值 | 用途 |
|---|---|---|
| `SLOP_GUARD_CONFIG` | 打包的規則 | 容器內 JSONL 規則設定檔案的路徑。掛載該檔案並將此變數指向它。 |
| `SLOP_GUARD_PORT` | `8765` | 監聽連接埠。 |
| `SLOP_GUARD_ALLOWED_HOSTS` | `slop-guard:*,localhost:*,127.0.0.1:*` | 伺服器接受的 `Host` 標頭值。如果填入 `伺服器 URL` 的主機名稱不在清單中，請將其新增；任何其他主機都會收到 HTTP 421。 |

slop-guard 的預設規則主要針對文件和文章中生成的文字。隨性的角色扮演回覆可能會觸發其中的一部分檢查（例如項目符號和三項列舉檢查），因此該報告僅供參考：由審查者決定命中的項目是否對該角色重要。如果你希望審查者以特定方式權衡該報告，請在審查者提示詞中提及它。slop-guard 的 `sg-fit` 工具可以根據你自己的良好與不良範例調整規則設定。

## 升級

變更 `servers/slop-guard/Dockerfile` 中的版本，重新建立映像檔，並在開啟回覆審查的情況下發送測試訊息。新版本可能會變更規則以及審查者所讀取的報告格式。

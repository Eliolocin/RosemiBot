---
title: "工具與擴充"
sidebar:
  order: 1
---

除了聊天之外，TomoriBot還可以呼叫工具來搜尋網路、閱讀文件、產生媒體、設定提醒以及與Discord訊息互動。她根據對話決定何時使用它們。本頁介紹了內建工具、如何使用MCP伺服器擴充她，以及如何使用Deliberate Tool模式保持提示精簡。

以下是一些工具在對話中啟用的範例：

- **1.健康檢查器**
  ```text
  Every few hours, do a mandatory wellness check on @bau_h.
  Ask them how they feel right now and if they've taken a break from coding recently.
  Track their emotional state over time with {memory_tool} and/or {memory_update_tool} to report back to them later.
  ```
- **2.每週尤里新聞**
  ```text
  Every Friday, compile the week's notable yuri manga chapters, anime episodes, and community fanart drops using {web_search_tool}.
  Present findings with {voice_message_tool} in a seductive ASMR voice.
  ```
- **3.睡眠警察**
  ```text
  If you notice through {message_metadata_tool} that someone is chatting past 2 AM, use {voice_message_tool} to send them a threateningly calm ASMR lullaby telling them to go to bed.
  If they keep talking 10 minutes later, use {manage_message_tool} to delete their message for their own good and remind them that sleep deprivation is a leading cause of their issues.
  ```

## 內建工具
<!-- anchor: built-in-tools -->

工具取決於支援工具呼叫的活動供應商和模型。許多都受到功能標誌（`/config` > `權限`）、Discord權限、模型功能或可選的API金鑰的限制。

| 工具 | 提示巨集 | 需要 | 它的作用 |
|---|---|---|---|
| 審核能力 | `{capabilities_tool}` | - | 在回答之前檢查當前的聊天能力、命令或設定。|
| 創建/更新長期記憶 | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | 儲存或替換穩定的伺服器事實或使用者首選項。|
| 更新短期記憶 | `{short_term_memory_tool}` | （不適用於NovelAI） | 為目前頻道或故事線儲存臨時工作記憶。|
| 建立/更新任務 | `{task_tool}` / `{task_update_tool}` | - | 安排或編輯提醒和自我任務（請參閱[計劃任務](/zh-TW/features/capabilities/scheduled-tasks/)）。|
| 跨通路訊息 | `{cross_channel_tool}` | （不適用於NovelAI） | 在另一個管道或線程中採取行動，並提供可選的報告。|
| 創建線程 | `{create_thread_tool}` | `thread_creation_enabled` + 討論串權限 | 打開公共線程並發布其起始訊息。|
| 選擇貼圖 | `{sticker_tool}` | `sticker_usage_enabled` | 在回覆中加入相符的伺服器貼圖或自訂表達式。|
| 管理訊息 | `{manage_message_tool}` | `manage_message_enabled` | 固定、編輯或刪除最近的訊息（固定需要`管理訊息`）。|
| 封鎖/取消封鎖使用者 | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | 人格範圍內的使用者靜音/阻止（不觸及記憶）。|
| 與最近的消息互動 | `{message_interaction_tool}` | - | 對最近的訊息做出反應或發送簡短的回應。|
| 偷看個人資料圖片 | `{profile_picture_tool}` | 視覺模型或`vision_llm` | 檢查使用者或人格的頭像。|
| 閱讀文件 | `{document_tool}` | - | 從PDF或任何UTF-8文字檔案中提取文字：原始程式碼 (`.py`/`.ts`/`.rs`/…)、`.json`、`.yaml`、`.md`、`.txt`和任何非二進位配件。|
| 顯示訊息元數據 | `{message_metadata_tool}` | - | 使用句柄和時間戳註釋最近的轉彎，以實現精確定位。|
| 處理YouTube影片 | `{youtube_tool}` | 具有視訊支援的模型 | 按需分析特定的YouTube連結。|
| 分析影像 | `{image_analysis_tool}` | 配置為`vision_llm` | 將圖像理解委託給單獨的視覺模型。|
| 生成影像/動漫影像 | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + 有能力的供應商 | 產生或編輯圖像（請參閱[媒體生成](/zh-TW/features/capabilities/media-generation/)）。|
| 產生語音訊息 | `{voice_message_tool}` | ElevenLabs鍵+人格語音+`voice_message_enabled` | 發送語音Discord語音回覆。|

:::note[For prompt authors]
自訂系統提示或人格指令時，請透過上表中的**提示巨集**來引用工具，而不是硬編碼工具名稱，因為巨集會在上下文組裝時擴展為正確的名稱，並在工具不可用時優雅地降級。`{pin_tool}`和`{timestamp_refresh_tool}`仍然用作`{manage_message_tool}`和`{message_metadata_tool}`的兼容性別名稱。下面的網路搜尋和URL工具也有巨集：`{web_search_tool}`、`{image_search_tool}`、`{video_search_tool}`、`{news_search_tool}`、`{url_fetch_tool}`和`{url_metadata_tool}`。這些動態解析為最佳可用引擎，包括公會MCP替代品。
:::

### 條件式提示詞區塊

支援上述工具巨集的提示文字也支援作用域條件：

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

對於啟用的TomoriBot設定使用`capability:<name>`，或當僅當該確切工具可用於活動供應商和模型時才應顯示文字時，請使用`tool:<function_name>`。當捆綁URL閱讀器或公會MCP替代品可用時，請使用`tool_family:url_fetch`。在条件前面加上`!`可将其反转。區塊可以嵌套，並且可以包含一個`{{else}}`；不支援一般的`and`/`or`表達式。

支援的功能名稱包括`tool_use`、`self_teaching`、`personal_memories`、`emoji_usage`、`sticker_usage`、`web_search`、`manage_message`、`thread_creation`、`image_generation`、`video_generation`、`voice_message`、`user_blocking`、`short_term_memory`、`time_awareness`。

工具條件反映了供應商/模型支援、伺服器配置、配置的後端、MCP替換以及當前的故意工具模式白名單。它們不會繞過或預測工具執行時執行的Discord權限檢查。未知的功能名稱評估為錯誤並被記錄；格式錯誤的區塊被省略。原始聊天訊息、模型輸出和工具結果永遠不會被視為條件模板。

## 網頁搜尋與URL讀取
<!-- anchor: web-search--url-reading -->

該模型看到一個統一的`web_search(query, category)`工具。在其後面，調度程序通過引擎鏈路由每個調用並返回第一個成功：

Brave → SearXNG → DuckDuckGo

- 當配置了Brave API密鑰（使用`/providers`設定）時，**Brave** 首先運行；它增加了圖像、視訊和新聞搜尋。⚠️ 在Brave儀表板中設定5美元的使用限額，以避免意外收費。
- DuckDuckGo 是未設定金鑰時的預設引擎。它僅涵蓋文字搜尋。當 DuckDuckGo 對 bot 進行速率限制或顯示機器人驗證時，搜尋將會失敗，她會發布通知建議使用 Brave。
- SearXNG和Crawl4AI是選購的自架伺服器，可新增更多類別和瀏覽器呈現的頁面取得；請參閱[自架](/zh-TW/self-hosting/)。

為了閱讀特定頁面，她使用`fetch_url`。NovelAI上不可用。

## MCP伺服器
<!-- anchor: mcp-servers -->

[MCP](https://modelcontextprotocol.io/)（Model Context Protocol）伺服器可以用你自己註冊的外部工具擴充她。

### 新增線上 MCP

使用支援 MCP Streamable HTTP 或 SSE 的供應商直連 HTTPS 端點：

1. 向供應商取得 MCP 端點及其驗證要求。
2. 開啟 `/config` > 外掛 > MCP 伺服器，選擇 `+ 新增 MCP`。
3. 將端點貼入 `URL`，若有需要則在 `驗證權杖` 輸入其 Bearer 權杖，並選擇需要的 `伺服器類型`。預設已選取 **一般用途**。

### 新增 Smithery 伺服器

託管在 Smithery 上的伺服器，位址結尾為 `.run.tools`。將該位址貼入 `URL`，並將你的 Smithery API 金鑰貼入 `驗證權杖`。TomoriBot 只會將金鑰傳送至 Smithery 位於 `api.smithery.ai` 的 API，絕不會傳送到伺服器位址本身。接著 Smithery 會將每次工具呼叫轉發給該伺服器，因此 Smithery 能看到所有工具請求與結果。在此支援恢復前儲存的註冊資料，無需修改即可再次正常運作。

TomoriBot 會在你 Smithery 帳號的第一個命名空間中（若你沒有命名空間，Smithery 會自動建立一個），為每個伺服器位址保留一個 Smithery 連線並重複使用它，因此新增、測試與重新連線都不會累積重複連線。TomoriBot 絕不會刪除連線。早期版本的 TomoriBot 每次重新連線都會建立新連線，因此你的帳號可能針對同一台伺服器留有多個未使用的連線；你可以從 Smithery 控制面板將它們移除。

部分伺服器會要求你登入其所封裝的服務。新增這類伺服器時會失敗並提示需要授權，且 TomoriBot 絕不會在 Discord 中顯示登入連結。請開啟你的 Smithery 控制面板，為名稱以 `tomoribot-` 開頭的連線完成登入，然後再次新增該伺服器。連線與列出工具必須在 15 秒內完成。

停用已選用於搜尋或 URL 讀取的註冊項目會還原 TomoriBot 的內建選擇；保持其啟用則可防止自動切換。儲存的工具名稱僅反映上次探索到的內容，因此無法證明連線目前依然有效。

下載時的回應會在達到 8 MiB 時停止。大型工具目錄或結果可能導致外掛無法使用或造成工具呼叫失敗。對於 SSE 連線，此限制涵蓋整個回應串流，包含後續的連續更新。當工具回傳大型文件或嵌入媒體時，請向供應商要求較小的結果、分頁或檔案連結。

如果伺服器不需要驗證，請將 `驗證權杖` 留空。你的驗證權杖會加密儲存，而且不會再顯示。開啟同一個設定頁面即可檢視已設定的狀態、啟用或停用伺服器，或在明確確認後將其移除。移除會立刻中斷連線並釋出名額。每一列已儲存的紀錄也會顯示上次成功探索到的工具名稱（有數量上限）。`未探索到任何工具` 是已知的零工具結果；`探索狀態未知` 則代表舊版紀錄或尚未成功取得快照的伺服器。開啟 MCP 管理介面只會讀取已儲存的中繼資料，不會連線至遠端伺服器。

### 本機MCP伺服器

本機MCP伺服器只支援自架執行個體：公開託管的bot要求HTTPS，並封鎖本機與私人位址。如果你自己跑執行個體，請看[設定：本機MCP伺服器](/zh-TW/self-hosting/local-endpoints/setup-local-mcp/)。

:::danger[只新增你信任的MCP伺服器]
惡意的MCP伺服器可以用隱藏的指示對她進行提示詞注入、外洩使用者傳給它工具的資料，或回傳有害或錯誤的結果，再由她轉達到你伺服器。把MCP伺服器當成瀏覽器擴充功能看待：有疑慮就不要新增。新增之前一定要先檢視MCP所描述的工具。
:::

## 明確工具模式
<!-- anchor: deliberate-tool-mode -->

每個宣告的工具都會增加提示詞長度。`明確工具模式`會在訊息需要任務工具時才加入工具宣告，藉此縮短提示詞，讓較小的本機模型更快回覆。不過，只要貼圖使用與工具使用已開啟，而且供應商支援，貼圖選擇工具仍會保留，讓她自然表達情緒。私訊、模仿與角色扮演的限制仍然適用。若要阻止貼圖回覆，請關閉貼圖使用。短期記憶到了更新期限時，也會加入維護工具，不需要使用者提出要求。

- 她首先檢查訊息中的工具意圖。內建觸發器涵蓋常見請求（提醒、網路搜尋、記憶體更新、跨頻道訊息、圖像/視訊/語音產生、媒體分析、執行緒建立、訊息操作）。有關她當前模型、工具、設定或功能為何不可用的問題會同時暴露功能審核和官方文件存取。後續措辭也有效，例如在語音訊息請求後「再做一次，但更生氣」。
- 伺服器管理員可以使用`/server trigger add`新增文字自訂觸發短語，例如將`pic`、`img`或`pfp`對應到影像產生。
- 內建觸發器可讀取英文片語。其他語言透過每種語言的關鍵字清單可以使用相同的工具。無論你的語言設定是什麼，每個訊息都會檢查每種出貨語言的列表，因此雙語伺服器可以同時使用兩種語言。
- 日語、中文或韓語中的自訂短語也可以匹配較長的單詞，因為這些語言不使用空格分隔單字。以`*`結尾的短語與以其開頭的任何單字相符：`remind*`涵蓋`reminder`和`reminding`。

### 控制項

- `/server dtm`：伺服器管理員切換它。
- `/personal config`：用戶自己覆蓋它。
- 配置思想日誌通道 (`/server thought-logs`) 後，成功的深思熟慮模式工具呼叫以及暴露該工具的觸發器都會記錄在那裡。

有意工具模式僅決定向模型「顯示」哪些工具，但模型仍必須選擇呼叫一個工具。在`/help`中，選擇`行為`，然後選擇`明確工具模式`，作為Discord摘要。

:::note
`明確工具模式`（本節）與`明確觸發模式`無關，後者控制*she*如何觸發；參見[聊天與觸發](/zh-TW/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode)。兩者都縮寫為“Discord”中的“DTM”。
:::

## 結構化的使用者資訊更新

當你在聊天中直接詢問時（例如“叫我隊長”或“我的代名詞是他們/他們”），TomoriBot可以自動更新你的個人資料和人格命名偏好：

| 偏愛 | 範圍 | 影響 |
|---|---|---|
| 暱稱、前綴、後綴 | 每個人格 | 只有活躍人格才會用此名稱或頭銜稱呼你。|
| 性別認同、代名詞、稱呼風格、時區 | 全球的 | 每個人格在所有伺服器上使用相同的值。|

- **刪除頭銜**：要求她停止使用頭銜（例如“停止叫我大師”）可以清除該人格。
- **隱私**：限制性隱私等級會阻止新的新增和編輯，同時仍允許你清除現有資料。
- **權限**：伺服器管理員可以使用`/config` > `權限`中的`使用者資訊更新`切換自動更新。你始終可以使用`/personal config`手動編輯你的個人資料。

工具參數架構與資料庫儲存佈局請參考[工具系統架構](/en/architecture/subsystems/tool-system/#structured-user-info-updates)。

---
title: "提示詞內部"
sidebar:
  order: 2
aiGenerated: false
---

每次觸發TomoriBot時，都會按以下順序組裝以下內容並將其發送到你配置的文字模型作為主要提示/上下文：

| 堵塞 | 選修的？ | 命令 | 它是什麼 |
|---|---|---|---|
| [系統提示](/zh-TW/features/chatting-personality/behavior-tweaking/#system-prompt) |  | `/config` > 引擎 > 常規 | 上下文最頂部的基本說明。|

> **預設系統提示文字**：僅在未設定伺服器系統提示時使用。>
> *「你是 {bot}。{bot} 確保預設情況下做出簡短而簡潔的回應。{bot} 僅在情況允許的情況下才會做出冗長的回應。>
> 每當有人分享某個細節或 {bot} 注意到對話中確實值得記住的細節（例如偏好、興趣或重要事實）時，{{if tool:create_long_term_memory}}{bot} 就會主動使用可用的 {memory_tool}，更願意記住一些事情，即使這些事情很小，只要它不與 {bot} 已經知道的內容重複即可。{{/if}}{{if tool:update_long_term_memory}}{bot} 當新資訊變更或新增至 {bot} 已記住的內容時，會使用 {memory_update_tool}，而不是儲存重複資訊。{{/if}} >
> {{if tool:review_capabilities}}當有人詢問 {bot} 可以做什麼或為什麼某些內容不可用時，{bot} 在回答之前會檢查 {capabilities_tool}。{{/if}}{{if tool_family:url_fetch}}當需要更多詳細資訊時，{bot} 在`https://docs.tomoribot.app/llms.txt`上使用 {url_fetch_tool} 來取得資訊。{{/if}}"*

| 堵塞 | 選修的？ | 命令 | 它是什麼 |
|---|---|---|---|
| 頻道提示（追加） | *（選修的）* | `/config` > `頻道` > 頻道覆蓋 | 每個通道有所不同，在系統提示後立即分層。同一頁面的「替換」模式接管上面的系統提示槽，而不是新增新的提示槽。|
| 人格提示 | *（選修的）* | `/config` > `人格` > 高級 | 專為活動人格所寫的提示，與系統提示分開。|
| [人格屬性](/zh-TW/features/chatting-personality/multiple-personas/#attributes) |  | `/config` > `人格` > `身分與個性` | 活躍人格的性格特徵和言語模式。|
| 伺服器資訊 |  | *（無，來自Discord）* | 伺服器名稱、描述和她所在的頻道均從Discord本身提取。|
| [人格-使用者區塊](/zh-TW/features/capabilities/tools-and-extensions/#built-in-tools) | *（選修的）* | `/moderation`審核/清除；由`/config` > `權限`（使用者封鎖）門控 | 此人格針對特定使用者設定的主動靜音/封鎖限制。|
| [伺服器記憶體](/zh-TW/features/knowledge/memory/#personal-vs-server-memories) |  | `/memories` | 為此伺服器保存的長期事實。|
| [伺服器表情符號](/zh-TW/features/chatting-personality/behavior-tweaking/#capabilities-what-shes-allowed-to-do) | *（選修的）* | `/config` > `外掛` > 上下文新增（回復中的表情符號）（僅切換），使用`/expressions initialize`初始化 | 伺服器中存在的自訂表情符號。|
| [伺服器貼圖](/zh-TW/features/chatting-personality/behavior-tweaking/#expressions) | *（選修的）* | `/config` > `外掛` > `可用工具`（`貼圖使用`），使用`/expressions initialize`將原生資產分類，使用`/expressions manage`進行管理 | 可傳送的原生貼圖和符合回應人格的每個自訂表情，包括名稱、描述和情緒。媒體來源和人格存取規則位於提示之外。|
| [人格人格精靈](/zh-TW/features/chatting-personality/multiple-personas/#sprites-emotion-avatars) | *（選修的）* | `/config` > `人格` > 精靈 | 為人格配置的命名表情精靈（如果有）。|
| [對話參加者](/zh-TW/features/knowledge/memory/#personal-vs-server-memories) | *（選修的）* | `/personal memories`（由`/config` > `權限`（個人化）閘控） | 對話中的人、他們的暱稱和提及句柄，以及保存的關於他們每個人的個人記憶。當此人在上下文中擁有某則訊息或提及其姓名/別名時載入。也使用`/config` > Engine > General將目前頻道和本地時間作為頁腳。|
| [短期記憶](/zh-TW/features/knowledge/memory/#short-term-memory-stm) |  | `/config` > `人格` > 回想；`/memories`清除條目；由`/config` > `權限`（短期記憶）閘控 | 包含不同管道的摘要和最新消息 |
| [`文件`](/zh-TW/features/knowledge/memory/#document-knowledge-base-rag) | *（選修的）* | `/memories` | 使用RAG從知識庫中提取相關區塊。|
| [獎勵與懲罰](/zh-TW/features/knowledge/memory/#conditioning) | *(選用)* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`, `/punish <bite\|bonk\|pinch\|spank\|squeeze>`; 使用`/conditioning remove`管理 | 此人格在這個伺服器中累積的行為偏好。 |
| [對話範例](/zh-TW/features/chatting-personality/multiple-personas/#sample-dialogues) | *（選修的）* | `/config` > `人格` > `身分與個性` | 此人格如何說話的範例（如果有）已配置。|
| [最近消息](/zh-TW/features/chatting-personality/behavior-tweaking/#generation-tuning) |  | `/config` > 引擎 > 常規 | 實際對話，最多這麼多訊息（預設80條）。你的上下文註釋和任何團聚註釋都會以可配置的深度內聯注入此區塊內，而不是作為它們自己的單獨區塊。|

當沒有什麼可說的時，標記為 *(可選)* 的行不貢獻任何內容（並且不花費任何代幣），例如沒有匹配的文件，或者伺服器沒有自訂表情符號。

最近的消息是最大也是最脆弱的部分，它是一個隨著人們談話而向前滑動的視窗。它們之上的所有內容都是根據已儲存的設定重建的並且穩定。

`/tool prompt snapshot`將人格的確切包轉儲到檔案中。它是當前記憶活躍的基本事實、文件是否匹配以及對話的實際內容有多少。

`/context`繪製與模型上下文視窗的彩色網格相同的束，上面每組塊一種顏色，因此你可以一目了然地看到它填充了什麼以及剩餘多少空間。圓圈標記小於一個正方形的組。它還顯示每個回應的估計輸入成本以及供應商為最後一個真實回覆報告的輸入令牌數量。

`/tool estimate cost`按大小分解同一個包，這對於在提高任何限制之前確定是什麼正在消耗你的上下文很有用。

### 工具是在哪裡定義的？

對於本機支援的每個供應商TomoriBot，工具模式透過供應商自己的`tools`欄位發送，因此它取決於供應商/配置的推理引擎。

### 為什麼TomoriBot會忘記？

這個順序幾乎解釋了每一個「她為什麼不記得？」的問題。問題：

| 發生了什麼事 | 為什麼 |
|---|---|
| 她忘記了今天早些時候的一些事情 | 它滾動超過了訊息限制。只存在於最近的消息中，如果Tomori不將其保存為長期記憶，那麼一旦到達訊息視窗之外就會被遺忘。|
| 她在另一個頻道忘記了一些東西 | 最近的消息是每個頻道的。僅伺服器記憶、對話參與者和短期記憶跨渠道。短期記憶透過從不同管道載入最近的訊息來解決這個問題，但它不會轉儲所有內容。|
| `/refresh`讓她忘了 | 刷新會切斷最近的訊息並清除該頻道的短期記憶，但不應刪除長期記憶。刪除刷新嵌入以消除截止。|
| 重啟後她忘了什麼 | 最近的消息永遠不會在重新啟動後保存 |

如果你想讓某個東西在上述所有情況下倖存下來，它就必須成為長期記憶。请参见[内存](/zh-TW/features/knowledge/memory/#long-term-memory)。

## 提示與技巧

- `/config` > 行為 > 一般行為可以加寬對話視窗（20到100則訊息）。脈絡越多，每次回覆的token也越多。
- `/config` > 行為 > 一般行為會在選定的深度注入一則簡短提醒。因為它位於組合中較低的位置、接近最近的訊息，她更可能照著做，而不是理會系統提示詞裡的內容。這裡是提醒她更常儲存記憶的最佳位置。
- `/personal memories`與`/memories`會直接寫入`伺服器記憶`與對話參與者，這是讓知識在TomoriBot的脈絡中永久留存的保證方法之一。

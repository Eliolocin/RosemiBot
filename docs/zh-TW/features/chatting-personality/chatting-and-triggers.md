---
title: "聊天與觸發"
sidebar:
  order: 1
---

TomoriBot被召喚時會回應。本頁介紹了她的觸發方式、如何透過自動觸發啟用免持聊天，以及如何透過故意觸發模式防止意外啟動。

## 如何觸發她
<!-- anchor: how-to-trigger-her -->

預設情況下，當你執行以下操作時，她會回覆：

- **提及她**：`@TomoriBot`
- **回覆**她的一則訊息（包括人格的webhook訊息）
- **使用觸發詞**：訊息中任何位置的任何註冊觸發詞
- **使用`/respond`**：手動請求回應

在DM中，直接發送訊息，無需任何觸發詞或提及。

### 管理觸發詞
<!-- anchor: managing-trigger-words -->

伺服器管理員使用`/config` > `人格` > 觸發器來新增或刪除活動人格的觸發詞。沒有管理伺服器的成員可以以唯讀模式查看現有觸發器。

## 表情符號與回應
<!-- anchor: expressions--reactions -->

回覆時，她可以使用伺服器自訂表情符號、貼圖和表情符號反應：

- 自訂表情符號在使用`:name:`語法的對話中自然出現。
- 她可以在每個回覆之前、之間或之後發送一個貼圖，作為自己的訊息。
- 伺服器管理員可以使用`/expressions manage`新增[自訂表達式](/zh-TW/features/chatting-personality/behavior-tweaking/#expressions)：反應GIF、圖像笑話或任何網站的連結。
- 運行`/expressions initialize`，以便她了解每個伺服器表情符號和貼圖何時適合。

## 角色扮演頻道
<!-- anchor: roleplay-channels -->

角色扮演頻道會抑制她的回覆中的自訂表情符號和貼圖訊息。成員還可以在角色扮演頻道中使用`/tool delete turn`刪除她的最新回合，而無需管理伺服器權限。

在`/config` > `頻道` > 頻道規則中設定角色扮演頻道。

## 情境感知

每當她回覆時，她都會收到描述對話發生地點和時間的上下文：

- **位置**：伺服器名稱、頻道名稱或聊天是否為私訊。
- **時間**：來自`/config` > `行為` > `一般行為`的伺服器本地時間和時間，以及在`/personal config`中設定時區的使用者的本地時鐘。
- **參與者**：顯示名稱、提及句柄、外觀標籤和待處理提醒。
- **Discord活動**：參與者目前正在播放、串流、聆聽的內容（例如Spotify曲目）或其自訂狀態。

活動狀態需要Discord的`Guild Presences`意圖並尊重使用者隱私 (`/personal config`)。提出隱私設定的使用者不會包含在狀態上下文中。

## 自動觸發（免手動聊天）

自動觸發讓TomoriBot加入對話而無需直接提及：

- `/config` > `頻道` > 自動觸發（或`/server autotrigger channels`）：選擇她自主回應的通道。
- `/config` > `頻道` > 自動觸發（或`/server autotrigger threshold`）：設定她插話前必須累積多少個訊息。
- `/config` > `行為` > 觸發行為：為通道配置基於定時器的隨機觸發。

在你希望機器人自然參與的專用休閒頻道中使用自動觸發。

## 明確觸發模式
<!-- anchor: deliberate-trigger-mode -->

如果在日常對話中經常使用人格的名字，簡單的觸發詞可能會意外啟動她。故意觸發模式 (DTM) 透過忽略未經修飾的觸發字來防止意外啟動。

當DTM有效時：

- `@{trigger}`（以`@`為前綴的觸發詞）觸發回复
- Discord提及`@TomoriBot`仍會觸發回复
- 訊息回應仍然有效
- `/respond`仍然有效
- 沒有`@`的普通觸發詞不再觸發她

### 伺服器與個人控制

- `/server dtm`：伺服器管理員切換伺服器預設值。
- `/personal config`：各個成員覆蓋他們自己的訊息的設定：
  - `off`：始終允許普通觸發詞
  - `follow`：遵循伺服器設置
  - `on`：總是需要刻意調用

在`/help`中，選擇`行為`，然後選擇`明確觸發模式`，作為Discord摘要。

:::note
故意觸發模式（本頁）控制她何時回覆。有意工具模式控制在轉彎時會向模型呈現哪些工具。兩者皆簡寫為Discord中的「DTM」；請參閱[工具與擴充](/zh-TW/features/capabilities/tools-and-extensions/#deliberate-tool-mode)。
:::

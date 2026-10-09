---
title: "SillyTavern支援"
# 針對「SillyTavern character cards in Discord」查詢的關鍵字豐富
# <title>，只取代這一頁Starlight的預設值。H1與側邊欄
# 仍使用單純的標題。
head:
  - tag: title
    content: "TomoriBot | 在Discord中使用SillyTavern角色卡"
# 手寫的搜尋摘要，會覆寫routeData.ts中介層自動產生的description。
description: "用TomoriBot把SillyTavern角色卡與提示詞預設集匯入Discord。把你既有的角色帶進你的伺服器。"
sidebar:
  order: 2
---

TomoriBot可以從 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 匯入兩種資源：提示管理員預設（控制提示結構）和角色卡（角色定義）。如果你從未使用過SillyTavern，你可以安全地跳過此頁面。

## 角色卡匯入

使用`/persona import`將現有的SillyTavern角色帶入Discord。它接受：

- **PNG卡** 具有嵌入式`chara`或`char`元資料。
- 具有根級屬性的 **v2樣式JSON** 卡（`name`、`description`、`first_mes`）。
- **v3 JSON** 卡（帶有巢狀`data`物件的`spec: "chara_card_v3"`）。
- **`.charx`檔案**（角色卡V3套件）。

`.charx`檔案是包含`card.json`定義的ZIP檔案。TomoriBot從`card.json`匯入字元文字並跳過捆綁的資源檔案（圖示、精靈、音訊、視訊）。你可以在`/config` > `人格` > `身分與個性`中設定頭像，在`/config` > `人格` > 精靈中新增精靈。

如果上傳的檔案是不含TomoriBot元資料的有效SillyTavern卡，則匯入會自動轉換。你還可以將一張卡片傳遞給`/persona generate`，以創建受該人格啟發的新鮮人格。

導入在儲存之前進行驗證（預設限制：每個文字欄位5,000個字元、200個屬性、每側100個範例對話、100個觸發詞）。有關欄位對映和轉換機制，請參閱[卡片支援架構](/en/architecture/integrations/sillytavern/card-support/)。

## 提示詞預設集
<!-- anchor: prompt-presets -->

SillyTavern提示管理員預設控制傳送到模型的提示的順序和佈局。開啟`/config` > `外掛` > SillyTavern預設以匯入預設、切換單一節點、切換活動預設或還原預設格式。

### 預設集控制什麼

- 及時訂購和標記放置
- 自訂提示節點
- 後歷史節點和深度注入節點
- 導入節點的初始啟用狀態

### 預設無法取代的內容

預設結構提示佈局；它不會取代填滿它的文字來源：

- 系統指令和人格欄位：`/config` > `行為` > `一般行為`、`/config` > `人格` > 進階和`/config` > `人格` > 身分和個性。
- 即時聊天歷史記錄和檢索的文件上下文。
- 自動情境：伺服器記憶、表情符號和貼圖資料、參與者清單和短期記憶。

### 原生區塊如何對應

本機塊直接對應到TomoriBot提示元件：

- `main`：活動系統提示字元（`/config` > `行為` > `一般行為`，或預設後備）
- `charDescription`：`/config` > `人格` > 高級
- `charPersonality`: `/config` > `人格` > `身分與個性`
- `dialogueExamples`: `/config` > `人格` > `身分與個性`
- `chatHistory`：直播頻道訊息歷史記錄
- `worldInfoBefore`和`worldInfoAfter`：檢索到的文件上下文（不是SillyTavern知識手冊）

### 系統提示詞規則

當匯入的預設處於活動狀態時，內建後備系統提示將會被刪除。但是，如果你在`/config` > `行為` > `一般行為`中設定自訂系統提示，則始終包含該提示。

### 相容性注意事項

- 在`prompt_order`中停用的節點將保持非活動狀態，直到在`/config` > `外掛` > SillyTavern預設中啟用為止。空節點和僅註釋節點永遠不會被發送。
- 阻止順序是字面意思：將`chatHistory`放在`dialogueExamples`之前會將聊天歷史記錄放在提示中的第一個位置。
- 歷史記錄後注入合併到現有對話歷史記錄中，而不是作為獨立訊息發送。
- 不支援正規表示式後處理、預設定義的採樣參數（溫度、top-p）和分層預設。舊版文字完成預設導入時僅刪除ST區塊。

在`/help`中，選擇`外掛`，然後選擇`SillyTavern預設集`，作為Discord指南。內部預置處理請參考[預置系統架構](/en/architecture/integrations/sillytavern/preset-system/)。

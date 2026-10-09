---
title: "多個人格"
# 針對「AI companion Discord」查詢的關鍵字豐富 <title>，只取代這一頁
# Starlight的預設 "{title} | TomoriBot"。H1與側邊欄仍使用單純的標題。
# 首頁標題主打 "AI agent" 加 "roleplay"，這一頁則改扛 "companion" 關鍵字。
head:
  - tag: title
    content: "TomoriBot | 你的Discord伺服器上的AI夥伴與人格"
# 手寫的搜尋摘要，會覆寫routeData.ts中介層自動產生的description。
description: "在同一個Discord伺服器裡跑多個AI夥伴。自訂人格各自擁有頭像、觸發詞與說話風格。"
sidebar:
  order: 2
---

TomoriBot的名稱、頭像、性格、說話風格與行為都保存在人格中。你可以同時使用多個人格，讓每個角色透過自己的觸發詞與網路鉤子頭像參與對話。這一頁介紹人格的行為；知識與記憶請見[記憶](/zh-TW/features/knowledge/memory/)。

## 建立人格

- `/persona create`：從頭開始建立自訂人格。
- `/persona generate`：讓人工智慧根據提示和影像產生人格（需要支援結構化輸出的供應商）。你也可以提供現有的TomoriBot預設集集或SillyTavern角色卡（請參閱[SillyTavern支援](/zh-TW/features/integrations/sillytavern-support/)）。
- `/persona default`：切換到內建預設角色之一。
- `/persona export`和`/persona import`：備份或共用人格檔案。匯入時可以新增alter人格，並設定其觸發詞與網路鉤子頭像。
- `/persona remove`：刪除alter人格。

## alter人格

alter人格讓多個角色在同一個伺服器中共存：

- 每個alter都有自己的性格、觸發詞與網路鉤子頭像，所以同一頻道裡的角色會以各自的名稱與圖片發文。
- 多個alter可以回覆同一則訊息，上限在`/config` > `行為` > `觸發行為`中設定。
- 直接回覆網路鉤子訊息，就能繼續與該人格對話。
- 使用`/persona import`並選擇alter選項來新增，再用`/persona`與`/persona remove`管理。

回覆路由與網路鉤子身分的細節，請見[多人格架構](/en/architecture/subsystems/multi-persona/)。

## 塑造人格

微調人格的外觀、對話和行為方式：

### 屬性
<!-- anchor: attributes -->

開啟`/config` > `人格` > 身分和個性來定義個性特徵或身體細節（例如`friendly`、`red hair`或`ends sentences with *Nya~*`）。

### 範例對話
<!-- anchor: sample-dialogues -->

開啟`/config` > `人格` > 身份和個性，透過使用`{user}`和`{bot}`佔位符的範例來教她的說話風格：

- `{user}`：替換為實際使用者的顯示名稱或暱稱。
- `{bot}`：替換為她目前的人格名稱。

```text
{user}: What's your favorite hobby?
{bot}: Fufu~ I like knitting tiny clothes for tiny plushies~♥
```

有效範例對話的提示：

- 寫出自然的交流，展示而不是講述。
- 展現你希望她使用的語氣和詞彙。
- 在幾個例子中增加多樣性，以便她能夠很好地概括。

### 名稱與頭像

開啟`/config` > `人格` > 身份和個性，設定她對自己的稱呼並上傳她的頭像。

你也可以在`/config` > `行為` > `一般行為`中設定自訂系統提示；請參閱[行為調整](/zh-TW/features/chatting-personality/behavior-tweaking/)。

### 命名習慣

伺服器管理員可以開啟`/config` > `人格` > 命名習慣來設定人格如何稱呼成員：

- 配置單獨的男性、女性和中性前綴、後綴和地址術語。
- 不同的人格可以用不同的頭銜來稱呼同一使用者（例如，一個稱其為“隊長”，另一個稱其為“前輩”）。
- 個人覆蓋遵循跨伺服器的每個使用者；參見[個人化](/zh-TW/features/knowledge/personalization/)。

## 立繪（表情頭像）
<!-- anchor: sprites-emotion-avatars -->

精靈是人格在對話期間切換的替代化身，以反映情緒（例如`happy`、`mad`或`embarrassed`）。

回覆時，她會選擇符合她情緒的精靈。要使用其中一個，她以`PersonaName (label):`開始回覆行，然後Discord傳遞帶有匹配精靈頭像的訊息。如果沒有合適的精靈，她會用預設頭像回覆。

在`/config` > `人格` > Sprites中管理sprites（需要管理伺服器）：

- **新增或取代**：選擇人格，提供標籤，上傳圖像（PNG、JPG或GIF），並可選擇撰寫描述何時顯示它的使用說明。
- **編輯**：更新現有精靈的標籤、圖像或說明。
- **刪除**：刪除不再需要的精靈。
- **匯出和匯入**：將人格的完整精靈包共用或備份為檔案。

`儲存為身分`切換將訊息作者顯示為Discord中的`Label (Persona)`，這對於具有多種形式的字元非常有用。

替換預設人格的頭像會清除其內建精靈，因為它們描繪的是原始人格。你自己添加的精靈保持不變。運行`/persona default`會恢復內建精靈。

## 各頻道的人格選擇

若要選擇在特定頻道中回覆你的人格而不更改伺服器範圍的設置，請使用Personal Spotlight；請參閱[個人化](/zh-TW/features/knowledge/personalization/#personal-spotlight)。

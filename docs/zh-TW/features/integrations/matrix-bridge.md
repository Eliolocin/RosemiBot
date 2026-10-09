---
title: "Matrix橋接"
sidebar:
  order: 1
---

將Matrix房間橋接到Discord頻道，以便人們可以跨兩個平台聊天。從Matrix發送的訊息在Discord中顯示為Webhook訊息，TomoriBot直接回覆到Matrix房間。

應用程式服務託管與部署架構請參閱[矩陣橋架構](/en/architecture/integrations/matrix/bridge/)。

## 設定

1. 邀請Matrix機器人帳號到未加密的Matrix房間。
2. 複製該房間的內部房間ID（在大多數客戶端：`Room Settings` > `進階` > `Internal Room ID`，格式如`!abc:matrix.org`）。
3. 在要橋接的Discord通道中運行`/matrix link`，並貼上房間ID。

機器人加入後，它會在Matrix中發布確認訊息，但你必須使用`/matrix link`完成來自Discord的連結。若要稍後斷開橋接通道，請執行`/matrix unlink`。

## 從Matrix使用它

- 房間連接後即可正常聊天。矩陣訊息中繼到Discord頻道。
- TomoriBot回覆Matrix房間。
- 支援的矩陣文字指令為`/kill`和`/refresh`。

## 目前的限制

- Matrix沒有斜線指令（除了`/kill`和`/refresh`）。
- 沒有直接訊息或基於DM的冷卻提醒。
- 機器人的視覺特徵看不到矩陣化身。
- 訊息固定不可用。
- 自訂表情符號和複雜格式無法可靠呈現；將中繼嵌入為純文字。
- Matrix使用者的個人記憶可追溯到歸屬伺服器記憶。

## 注意事項

- 如果機器人沒有自動加入，請手動邀請Matrix機器人帳號並重新執行`/matrix link`。
- 建立房間後無法停用矩陣加密：必須用新的未加密房間取代加密房間。
- 若要取消連結通道，請使用`/matrix unlink`。
- 如果上面未列出問題，請使用`/support discord`在支援伺服器中報告該問題。

在`/help`中，選擇`外掛`，然後選擇`Matrix`，以進行Discord中的互動式演練。

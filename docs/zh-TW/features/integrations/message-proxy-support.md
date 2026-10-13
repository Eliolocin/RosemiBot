---
title: "訊息代理支援"
description: "選擇支援的 Discord 訊息代理服務，讓 TomoriBot 安全跟隨已驗證的 Webhook 轉發訊息。"
sidebar:
  order: 3
---

訊息代理支援讓 TomoriBot 能跟隨外部 Discord bot 透過 Webhook 刪除並重新轉發的訊息。

## 選擇服務

執行 `/personal message-proxy service:pluralkit` 或 `/personal message-proxy service:pluralbuddy`。選擇 `service:none`（顯示為「關閉」）以停用代理處理。這是發送原始訊息之 Discord 帳號的個人設定，並會跟隨該帳號跨伺服器生效。

在 TomoriBot 看到某位 alter 的第一則驗證訊息後，可以用 `/personal config identity:` 編輯其個人檔案，並用 `/personal memories identity:` 編輯其記憶。即使代理處理已關閉，自動補全也會包含來自這兩個服務的已儲存身分。帳號介面、隱私與模型設定仍保留在宿主帳號上。在 TomoriBot 中設定的暱稱會一直保留到被清除為止；否則服務的顯示名稱會在收到驗證訊息時重新整理。關於成員與簡介詳情，請參閱 [PluralKit 支援](/zh-TW/features/integrations/pluralkit-support/)。

## 安全檢查的意義

Tomori 絕不會從 Webhook 的名稱或頭像指派身分。所選的服務必須驗證轉發 ID、宿主帳號以及穩定的 alter ID。PluralKit 還能標記確切的原始訊息，因此 TomoriBot 可以轉移其觸發判定與回覆目標。PluralBuddy 不提供該原始 ID。TomoriBot 會以盡力而為的方式，比對來自同一宿主與頻道的近期訊息。若轉發在原始等待時間結束後才到達，或有多個原始訊息重疊，轉發可能會被忽略或引發第二次回覆。驗證失敗或發生衝突時絕不會建立身分。

這就是為什麼目前不提供 Tupperbox 作為選項的原因。其公開文件雖描述了代理功能，但並未提供 TomoriBot 可以安全使用的公開權威訊息證明 API。

## 短暫的訊息延遲

選定服務後，Tomori 在處理來自你帳號的每則一般伺服器訊息前會短暫等待。這給了該服務刪除並重新轉發的時間。未經代理的訊息會在等待後繼續處理。PluralKit 轉發會繼承原始觸發判定與回覆目標。PluralBuddy 則使用已驗證的轉發內容與盡力而為的近期訊息比對。

自架使用者可以透過 `MESSAGE_PROXY_WAIT_MS` 調整此機制。服務傳輸設定保持獨立，例如 PluralKit 的 API 逾時與選用權杖。PluralBuddy 訊息查詢需要在部署中設定 OAuth 應用程式憑證：`PLURALBUDDY_CLIENT_ID` 與 `PLURALBUDDY_CLIENT_SECRET`。個別使用者不需要提供權杖。目前的配接器僅查詢 `pluralbuddy.app`；不支援自架的 PluralBuddy 執行個體。

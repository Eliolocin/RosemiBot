---
title: "指令參考"
sidebar:
  order: 6
---

<!--
  GENERATED FILE: do not edit by hand.
  Run `bun run generate-command-reference` from the repository root.
-->

TomoriBot 目前註冊的每一個斜線指令，都是從 Discord 註冊時使用的同一批指令建構器與繁體中文說明產生的（尚未翻譯的說明會以英文顯示）。

頂層指令群組：**41**。可執行的斜線指令：**85**。

## `/comment`

送出一則在聊天中看得到，但不會進入脈絡的留言嵌入。

| 指令 | 摘要 |
|---|---|
| `/comment` | 送出一則在聊天中看得到，但不會進入脈絡的留言嵌入。 |

## `/compact`

把最近的對話摘要成一則精簡的系統記憶。

| 指令 | 摘要 |
|---|---|
| `/compact` | 把最近的對話摘要成一則精簡的系統記憶。 |

## `/conditioning`

管理長期保留的獎勵與懲罰制約記憶。

| 指令 | 摘要 |
|---|---|
| `/conditioning manage` | 管理這個伺服器所有注入的制約紀錄。 |
| `/conditioning remove` | 移除這個伺服器所有人格的制約紀錄。 |

## `/config`

設定人格、行為、頻道、權限與模型。

| 指令 | 摘要 |
|---|---|
| `/config` | 設定人格、行為、頻道、權限與模型。 |

## `/context`

查看在目前頻道中，某個人格的提示詞占用了模型脈絡視窗的多少空間。

| 指令 | 摘要 |
|---|---|
| `/context` | 查看在目前頻道中，某個人格的提示詞占用了模型脈絡視窗的多少空間。 |

## `/contribute`

找到原始碼，以及協助打造 TomoriBot 的方式。

| 指令 | 摘要 |
|---|---|
| `/contribute github` | 取得 GitHub 儲存庫連結，並了解如何為 TomoriBot 貢獻。 |

## `/donate`

支持 TomoriBot 的開發與主機費用。

| 指令 | 摘要 |
|---|---|
| `/donate kofi` | 透過 Ko-fi 捐款支持 TomoriBot 的開發。 |

## `/export`

把你的設定或記憶匯出成可攜檔案。

| 指令 | 摘要 |
|---|---|
| `/export config` | 把這個伺服器的設定匯出成可攜檔案。 |
| `/export memories` | 把記憶匯出成可攜檔案。 |
| `/export personal config` | 把你的個人設定匯出成可攜檔案。 |
| `/export personal memories` | 把你帳號擁有的記憶匯出成可攜檔案。 |

## `/expressions`

教導 TomoriBot 什麼時候該用這個伺服器的自訂表情符號與貼圖。

| 指令 | 摘要 |
|---|---|
| `/expressions initialize` | 用 AI 視覺分析並分類所有自訂表情符號與貼圖 |
| `/expressions manage` | 管理表情符號、貼圖、自訂表情及人格存取權。 |

## `/generate`

生成 AI 圖片、影片與語音訊息。

| 指令 | 摘要 |
|---|---|
| `/generate image` | 用你自己的提示詞或目前頻道的場景生成 AI 圖片 |
| `/generate scene` | 在所選人格之間生成一段簡短的腳本式文字場景。 |
| `/generate video` | 用 Google Veo、OpenRouter 或 Z.ai 生成 AI 影片 |
| `/generate voice-message` | 用你挑選的語音說出一則訊息 |

## `/help`

瀏覽設定、功能、供應商、記憶、行為、工具、媒體與整合的說明。

| 指令 | 摘要 |
|---|---|
| `/help` | 瀏覽設定、功能、供應商、記憶、行為、工具、媒體與整合的說明。 |

## `/impersonate`

模擬人格或使用者，或注入系統提示詞。

| 指令 | 摘要 |
|---|---|
| `/impersonate persona` | 以這個伺服器的其中一個人格傳送訊息。 |
| `/impersonate system` | 在對話脈絡中注入一則系統訊息。 |
| `/impersonate user` | 讓 bot 以那位成員的語氣撰寫並傳送訊息。 |

## `/import`

從可攜式檔案匯入設定或記憶。

| 指令 | 摘要 |
|---|---|
| `/import config` | 匯入伺服器設定檔。 |
| `/import memories` | 匯入伺服器記憶檔。 |
| `/import personal config` | 匯入個人設定檔。 |
| `/import personal memories` | 匯入個人記憶檔。 |

## `/kill`

立刻停止目前的串流，並清除這個頻道中排隊的回覆。

| 指令 | 摘要 |
|---|---|
| `/kill` | 立刻停止目前的串流，並清除這個頻道中排隊的回覆。 |

## `/learn`

學習、擷取並將對話紀錄收進記憶。

| 指令 | 摘要 |
|---|---|
| `/learn history` | 用 AI 從這個頻道的訊息紀錄擷取知識。 |

## `/legal`

查看 TomoriBot 的服務條款、隱私權政策與授權條款。

| 指令 | 摘要 |
|---|---|
| `/legal license` | 查看 TomoriBot 的開源授權條款 |
| `/legal privacy-policy` | 查看 TomoriBot 的隱私權政策 |
| `/legal terms-of-service` | 查看 TomoriBot 的服務條款 |

## `/matrix`

把 Discord 頻道連結到 Matrix 房間，進行雙向轉送。

| 指令 | 摘要 |
|---|---|
| `/matrix link` | 把 Discord 頻道連結到 Matrix 房間，進行雙向轉送 |
| `/matrix unlink` | 移除 Discord 頻道上的 Matrix 橋接連結 |

## `/memories`

查看與管理伺服器記憶、文件與短期記憶。

| 指令 | 摘要 |
|---|---|
| `/memories` | 查看與管理伺服器記憶、文件與短期記憶。 |

## `/model`

管理這個伺服器的預設 AI 模型。

| 指令 | 摘要 |
|---|---|
| `/model override remove` | 移除頻道與人格的模型覆寫。 |

## `/moderation`

管理成員權限、黑名單、頻道與身分組白名單，以及額度設定。

| 指令 | 摘要 |
|---|---|
| `/moderation` | 管理成員權限、黑名單、頻道與身分組白名單，以及額度設定。 |

## `/novelai`

設定這個伺服器的 NovelAI 文字與圖片生成。

| 指令 | 摘要 |
|---|---|
| `/novelai generate image` | 使用圖板風格標籤與選填的角色參考生成 NovelAI 圖片。 |
| `/novelai usage` | 顯示這個伺服器的 NovelAI Opus 生成用量表（需要管理伺服器權限）。 |

## `/nsfw`

年齡限制的指令與設定。

| 指令 | 摘要 |
|---|---|
| `/nsfw jailbreaks` | 管理這個伺服器上我提示詞的選用越獄行為。 |
| `/nsfw persona default` | 套用 NSFW 的預設人格設定 |
| `/nsfw persona import` | 從 PNG、JSON 或 CHARX 檔匯入人格，包含 NSFW 人格 |

## `/nuke`

完全清空所有伺服器資料。之後需要重新執行 /setup。

| 指令 | 摘要 |
|---|---|
| `/nuke` | 完全清空所有伺服器資料。之後需要重新執行 /setup。 |

## `/persona`

管理人格預設集

| 指令 | 摘要 |
|---|---|
| `/persona create` | 手動建立簡單的人格預設集 |
| `/persona default` | 套用預設的人格設定 |
| `/persona export` | 將目前的人格匯出成可分享的 PNG 檔 |
| `/persona generate` | AI 生成人格（需要相容的供應商） |
| `/persona import` | 從 PNG、JSON 或 CHARX 檔匯入人格 |
| `/persona remove` | 從伺服器移除 alter 人格 |

## `/personal`

管理你的個人設定

| 指令 | 摘要 |
|---|---|
| `/personal config` | 管理你的個人偏好、隱私、模型與個人檔案。 |
| `/personal language` | 選擇 TomoriBot 對你說話時使用的語言。 |
| `/personal memories` | 管理你的個人長期記憶與短期對話脈絡。 |
| `/personal nuke` | 清除 TomoriBot 在每個伺服器儲存的、關於你的一切。 |
| `/personal providers` | 管理你的個人供應商憑證、端點與模型目錄。 |

## `/ping`

檢查 bot 的延遲。

| 指令 | 摘要 |
|---|---|
| `/ping` | 檢查 bot 的延遲。 |

## `/providers`

新增、查看、編輯與移除供應商憑證、端點與模型目錄。

| 指令 | 摘要 |
|---|---|
| `/providers` | 新增、查看、編輯與移除供應商憑證、端點與模型目錄。 |

## `/punish`

用有趣的互動懲罰我。

| 指令 | 摘要 |
|---|---|
| `/punish bite` | 咬我一口！ |
| `/punish bonk` | 敲我的頭一下！ |
| `/punish pinch` | 捏我一下！ |
| `/punish spank` | 打我一下屁股！ |
| `/punish squeeze` | 緊抱我一下！ |

## `/quota`

管理生成額度的重置。

| 指令 | 摘要 |
|---|---|
| `/quota reset global` | 重置整個伺服器的生成額度池。 |
| `/quota reset user` | 重置某位使用者的每日額度用量。 |

## `/refresh`

清除對話歷史紀錄（僅限這個頻道）。

| 指令 | 摘要 |
|---|---|
| `/refresh` | 清除對話歷史紀錄（僅限這個頻道）。 |

## `/reset`

將伺服器或個人設定重設為預設值。

| 指令 | 摘要 |
|---|---|
| `/reset config` | 將這個伺服器的設定重設為資料庫預設值。 |
| `/reset personal config` | 將你的個人設定重設為資料庫預設值。 |

## `/respond`

手動觸發對這個頻道最新訊息的回應。

| 指令 | 摘要 |
|---|---|
| `/respond` | 手動觸發對這個頻道最新訊息的回應。 |

## `/reward`

用有趣的互動獎勵我。

| 指令 | 摘要 |
|---|---|
| `/reward feed` | 餵我吃好吃的點心！ |
| `/reward headpat` | 摸摸我的頭！ |
| `/reward hug` | 給我一個擁抱！ |
| `/reward kiss` | 親我一下！ |
| `/reward tickle` | 搔我癢！ |

## `/scheduled-task`

管理排程任務與提醒。

| 指令 | 摘要 |
|---|---|
| `/scheduled-task edit` | 編輯排程任務或提醒。 |
| `/scheduled-task remove` | 移除排程任務或提醒。 |

## `/setup`

開始初始設定流程。設定 AI 供應商與人格。

| 指令 | 摘要 |
|---|---|
| `/setup` | 開始初始設定流程。設定 AI 供應商與人格。 |

## `/stats`

查看使用統計

| 指令 | 摘要 |
|---|---|
| `/stats generate` | 生成可分享的統計圖片卡。 |
| `/stats persona` | 查看某個人格在這個伺服器的使用統計。 |
| `/stats personal` | 查看你自己的使用統計。 |
| `/stats server` | 查看整個伺服器的使用統計。 |

## `/status`

顯示目前的個人、伺服器或人格狀態。

| 指令 | 摘要 |
|---|---|
| `/status` | 顯示目前的個人、伺服器或人格狀態。 |

## `/support`

取得協助、回報錯誤，並加入 TomoriBot 社群。

| 指令 | 摘要 |
|---|---|
| `/support discord` | 取得官方 Discord 伺服器連結，用來回報錯誤、提供意見與社群交流。 |

## `/tool`

對話脈絡、提示詞與診斷的實用工具。

| 指令 | 摘要 |
|---|---|
| `/tool delete turn` | 從頻道刪除人格的最後一輪發言。 |
| `/tool estimate cost` | 估算付費 AI 供應商的 API 費用 |
| `/tool prompt snapshot` | 將某個人格的完整 LLM 提示詞匯出成檔案，方便除錯。 |

## `/troubleshoot`

針對 TomoriBot 的行為取得協助與排查問題。

| 指令 | 摘要 |
|---|---|
| `/troubleshoot chat` | 建立一份關於近期聊天問題的私人診斷檔案。 |

## `/update`

查看最新的 TomoriBot 版本資訊

| 指令 | 摘要 |
|---|---|
| `/update` | 查看最新的 TomoriBot 版本資訊 |

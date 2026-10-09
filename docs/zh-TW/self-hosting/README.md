---
title: "自架"
# 針對「self-host AI Discord bot」查詢、富含關鍵字的 <title>，只取代這一頁的
# Starlight 預設值。H1 與側邊欄仍維持原本的標題。
head:
  - tag: title
    content: "TomoriBot | 免費開源 AI Discord bot 自架"
# 手寫的搜尋摘要，會覆寫 routeData.ts 中介層自動產生的描述。
description: "用 KoboldCPP、ComfyUI 等工具，輕鬆自架全本機、私密的 AI Discord bot。"
sidebar:
  label: "總覽"
  groupLabel: "自架"
  order: 3
aiGenerated: false
---

<!-- STUB（第一階段結構）。第二階段會寫入：需求 + 模組目錄。
     manual-setup.md 的來源：`git show HEAD:README.md` 的「Self-Hosting」段落。 -->

用下列任一種安裝路徑，開始運行你自己的 TomoriBot 執行個體：

1. [`setup-wizard`](./setup-wizard)：引導式的 `bun run setup` 安裝
2. [`manual-setup`](./manual-setup)：手動流程，適合技術背景的使用者
3. [`docker-compose`](./docker-compose)：容器化的 bot 加資料庫，主機不需要 Bun 或 PostgreSQL

選用模組（本機 LLM、ComfyUI、SearXNG、Crawl4AI、本機 TTS/STT、ChatMock、本機 MCP
伺服器）各自有獨立頁面，完整目錄請看
[`local-endpoints`](./local-endpoints)。

等她跑起來之後，[`maintenance`](./maintenance) 會介紹主機端指令稿、更新，以及資料庫的備份與還原。

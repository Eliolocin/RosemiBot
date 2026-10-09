---
title: "自部署"
# 针对「self-host AI Discord bot」这类查询、富含关键词的 <title>，只取代这一页的
# Starlight 默认值。H1 与侧边栏仍保留原本的标题。
head:
  - tag: title
    content: "TomoriBot | 免费开源自部署的 Discord AI bot"
# 手写的搜索摘要，覆盖 routeData.ts 中间件自动生成的描述。
description: "用 KoboldCPP、ComfyUI 等工具，轻松自部署一套完全本地、私密的 AI Discord bot。"
sidebar:
  label: "总览"
  groupLabel: "自部署"
  order: 3
aiGenerated: false
---

<!-- STUB（第一阶段结构）。第二阶段会写入：环境要求 + 模块目录。
     manual-setup.md 的来源：`git show HEAD:README.md` 的「Self-Hosting」一节。 -->

按下面任意一条安装路径，开始运行你自己的 TomoriBot 实例：

1. [`setup-wizard`](./setup-wizard)：引导式的 `bun run setup` 安装
2. [`manual-setup`](./manual-setup)：手动流程，适合技术背景的用户
3. [`docker-compose`](./docker-compose)：容器化的 bot 加数据库，主机不需要 Bun 或 PostgreSQL

可选模块（本地 LLM、ComfyUI、SearXNG、Crawl4AI、本地 TTS/STT、ChatMock、本地 MCP
服务器）各自有独立页面，完整目录见
[`local-endpoints`](./local-endpoints)。

等她跑起来之后，[`maintenance`](./maintenance) 会介绍主机端脚本、更新，以及数据库的备份与还原。

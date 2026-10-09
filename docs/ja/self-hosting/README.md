---
title: "セルフホスト"
# Keyword-rich <title> targeting "self-host AI Discord bot" queries; replaces
# Starlight's default for this page only. H1 and sidebar keep the plain title.
head:
  - tag: title
    content: "TomoriBot | 無料のオープンソースAI Discordボットをセルフホスト"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "セットアップウィザード、Docker Compose、または手動でTomoriBotをセルフホスト。ローカルLLMを追加して完全プライベートなAIボットを構築します。"
sidebar:
  label: "概要"
  groupLabel: "セルフホスト"
  order: 3
aiGenerated: false
---

<!-- STUB (Phase 1 structural). Phase 2 writes: requirements + module directory.
     Source for manual-setup.md: `git show HEAD:README.md` "Self-Hosting" section. -->

以下のいずれかのインストール方法を使用して、独自のTomoriBotインスタンスの実行を開始します。

1. [`setup-wizard`](./setup-wizard) : ガイド付きの `bun run setup` によるインストール
2. [`manual-setup`](./manual-setup) : 技術的なユーザー向けの手動手順
3. [`docker-compose`](./docker-compose) : コンテナ化されたボットとデータベース。ホストにBunやPostgreSQLは不要

オプションモジュール（ローカルLLM、ComfyUI、SearXNG、Crawl4AI、ローカルTTS/STT、ChatMock、ローカルMCPサーバー）についてはそれぞれ独自のページがあります。全ディレクトリについては[`local-endpoints`](./local-endpoints)を参照してください。

トモリが稼働した後は、[`maintenance`](./maintenance)にて、ホスト側のスクリプト、更新、およびデータベースのバックアップと復元について説明します。

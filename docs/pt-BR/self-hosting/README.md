---
title: "Hospedagem Própria"
# Keyword-rich <title> targeting "self-host AI Discord bot" queries; replaces
# Starlight's default for this page only. H1 and sidebar keep the plain title.
head:
  - tag: title
    content: "TomoriBot | Hospede um Bot de Discord de IA Aberto e Gratuito"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "Hospede facilmente um bot de Discord de IA totalmente local e privado com KoboldCPP, ComfyUI e mais."
sidebar:
  label: "Visão Geral"
  groupLabel: "Hospedagem Própria"
  order: 3
aiGenerated: false
---

<!-- STUB (Phase 1 structural). Phase 2 writes: requirements + module directory.
     Source for manual-setup.md: `git show HEAD:README.md` "Self-Hosting" section. -->

Comece a executar sua própria instância do TomoriBot através de qualquer um destes caminhos de instalação:

1. [`setup-wizard`](/pt-BR/self-hosting/setup-wizard/) : instalação guiada com `bun run setup`
2. [`manual-setup`](/pt-BR/self-hosting/manual-setup/) : o procedimento manual, para usuários técnicos
3. [`docker-compose`](/pt-BR/self-hosting/docker-compose/) : bot em contêiner + banco de dados, sem Bun/PostgreSQL no host

Os módulos opcionais (LLMs locais, ComfyUI, SearXNG, Crawl4AI, TTS/STT local, ChatMock, servidores MCP locais) têm cada um sua própria página, veja [`local-endpoints`](/pt-BR/self-hosting/local-endpoints/) para o diretório completo.

Assim que ela estiver funcionando, a página [`maintenance`](/pt-BR/self-hosting/maintenance/) cobre os scripts no lado do host, como atualizar e fazer backup/restauração do seu banco de dados.

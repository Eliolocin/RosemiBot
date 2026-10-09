---
title: "Autoalojamiento"
# Keyword-rich <title> targeting "self-host AI Discord bot" queries; replaces
# Starlight's default for this page only. H1 and sidebar keep the plain title.
head:
  - tag: title
    content: "TomoriBot | Autoaloja un bot de Discord con IA gratuito y de código abierto"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "Autoaloja fácilmente un bot de Discord con IA totalmente local y privado con KoboldCPP, ComfyUI y más."
sidebar:
  label: "Resumen"
  groupLabel: "Autoalojamiento"
  order: 3
aiGenerated: false
---

<!-- STUB (Phase 1 structural). Phase 2 writes: requirements + module directory.
     Source for manual-setup.md: `git show HEAD:README.md` "Self-Hosting" section. -->

Comienza a ejecutar tu propia instancia de TomoriBot mediante cualquiera de estas rutas de instalación:

1. [`setup-wizard`](./setup-wizard) : instalación guiada con `bun run setup`
2. [`manual-setup`](./manual-setup) : el procedimiento manual, para usuarios técnicos
3. [`docker-compose`](./docker-compose) : bot y base de datos en contenedores, sin necesidad de Bun/PostgreSQL en el host

Los módulos opcionales (LLMs locales, ComfyUI, SearXNG, Crawl4AI, TTS/STT local, ChatMock,
servidores MCP locales) tienen cada uno su propia página; consulta
[`local-endpoints`](./local-endpoints) para ver el directorio completo.

Una vez que esté en funcionamiento, [`maintenance`](./maintenance) cubre los scripts del lado del host, las
actualizaciones y las copias de seguridad/restauración de tu base de datos.

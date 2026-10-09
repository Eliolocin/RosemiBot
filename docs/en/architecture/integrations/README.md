---
title: "Integrations"
sidebar:
  label: "Overview"
  groupLabel: "Integrations"
  order: 40
---

Integration documentation covers platform adapters, external network bridges, and third-party data
formats that connect to TomoriBot's core pipelines.

## Integration areas

### Discord UI primitives

- [Message Components V2](/architecture/integrations/discord/message-components-v2/): Discord UI
  rendering using container blocks, media galleries, and interactive buttons, with fallback paths
  for legacy message views.
- [Modal Input Components](/architecture/integrations/discord/modal-input-components/): Interactive
  modal dialogs, encoded custom IDs for state transmission, and raw interaction interception.

### External bridges

- [Matrix Bridge](/architecture/integrations/matrix/bridge/): Bi-directional Discord-to-Matrix message
  bridging using the Matrix Application Service API, virtual ghost users, loop prevention, and
  permission mapping.

### Specialized model services

- [NovelAI Inpainting](/architecture/integrations/novelai/inpainting/): Image inpainting workflows and
  coordinate space translation.
- [NovelAI Limitations](/architecture/integrations/novelai/limitations/): Context window caps, prompt
  prefix requirements, and token-level constraints.
- [NovelAI Tool Calling](/architecture/integrations/novelai/tool-calling/): Deliberate tool calling
  emulation and retry suppression for models lacking native function calling.

### Character and preset formats

- [SillyTavern Card Support](/architecture/integrations/sillytavern/card-support/): Ingestion and
  extraction of V2 and V3 character cards, embedded lorebook entries, and creator metadata.
- [SillyTavern Preset System](/architecture/integrations/sillytavern/preset-system/): Custom context
  assembly templates, token marker mapping, and prompt section reordering.

### Audio infrastructure

- [Voice Integration](/architecture/integrations/voice/): Voice channel connection management,
  in-place speech-to-text audio transcription, and text-to-speech delivery.

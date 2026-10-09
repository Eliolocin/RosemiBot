---
title: "Geração de Vídeos"
sidebar:
  order: 2
---

TomoriBot pode gerar vídeos curtos a partir de um prompt de texto ou animando uma imagem existente. Use `/generate video` ou pergunte diretamente no chat.

## O Que Ela Pode Fazer

- **Texto para vídeo**: gere um pequeno clipe a partir de uma descrição.
- **Imagem para vídeo**: anime uma imagem. A primeira imagem de uma mensagem referenciada torna-se o quadro inicial.
- **Loop de imagem para vídeo**: quando solicitado por chat, os modelos compatíveis podem reusar a imagem inicial como quadro final.
- **Proporções personalizáveis**.

A imagem para vídeo e o loop dependem do suporte do primeiro e do último quadro do modelo selecionado. TomoriBot verifica o catálogo de modelos de OpenRouter antes de enviar uma geração e pergunta se uma imagem ou loop precisa ser removido para o modelo escolhido.

A geração de vídeo leva tempo: TomoriBot envia o trabalho ao provedor, verifica a conclusão em segundo plano e publica o vídeo finalizado no canal quando estiver pronto.

## Configuração

1. Selecione um modelo de vídeo em `/config` > `Modelos` > Switch Models.
2. Confirme se a geração de vídeo está habilitada em `/config` > `Permissões` (`video_generation_enabled`).
3. Pergunte a ela no chat ou execute `/generate video`.

## Suporte de Provedores

A geração de vídeo nativo está disponível em Google, OpenRouter e Z.ai. Veja a matriz completa em [Provedores e Modelos](/pt-BR/features/setup-administration/providers-and-models/#supported-providers).

Para geração de vídeo local via ComfyUI (como fluxos de trabalho de imagem para vídeo WAN), consulte [Configuração: ComfyUI](/pt-BR/self-hosting/local-endpoints/setup-comfyui/).

Para geração interna e arquitetura de pesquisa, consulte a referência em [geração de vídeo](/en/architecture/subsystems/video-generation/).

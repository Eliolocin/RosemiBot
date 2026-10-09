---
title: "Geração de Imagens"
sidebar:
  order: 1
---

TomoriBot pode gerar imagens a partir de um prompt de texto ou editando uma imagem de referência. Use `/generate image`, ou descreva o que deseja no chat (“desenhe um panda vermelho tomando café”).

## O Que Ela Pode Fazer

- **Texto para imagem**: gera uma imagem a partir de uma descrição.
- **Imagem para imagem**: edite ou remodele uma imagem existente.
- **Inpainting**: redesenhe uma região específica enquanto mantém o resto.
- **Pintura adicional**: estenda a tela além da moldura original.
- **Proporções personalizáveis**.
- **Imagens de referência**: utilize anexos de mensagens, figurinhas, emojis ou avatares de usuários e personas. Mencione um usuário ou persona para obter seu avatar como referência.

Os modos de edição disponíveis dependem do back-end ativo. Trabalho de texto para imagem e imagem para imagem em provedores de nuvem (Google, Vertex, OpenRouter). Inpainting e outpainting são suportados por endpoints personalizados locais [ComfyUI](/pt-BR/self-hosting/local-endpoints/setup-comfyui/) e dependem dos recursos declarados desse endpoint. Os modos que sua configuração não suporta são ocultados automaticamente do modelo.

Quando ela gera uma imagem, ela combina as tags de aparência da sua persona com tags positivas e negativas de todo o servidor (quando houver suporte). O resultado chega como uma galeria de mídia Discord com detalhes de geração, incluindo quaisquer usuários ou personas referenciados.

## Personalização de Tags
<!-- anchor: tag-customization -->

Cada fonte de tag pode ser editada no local com um modal pré-preenchido:

- **`/config` > `Persona` > `Detalhes de Geração de Imagem`**: tags `Aparência Física` da persona selecionada (sua aparência). Requer a permissão Gerenciar Servidor.
- **`/personal config`**: suas próprias tags de aparência, aplicadas sempre que uma geração de imagem fizer referência a você. Acompanha você em todos os servidores (consulte [Personalização](/pt-BR/features/knowledge/personalization/)).
- **`/config` > `Modelos` > `Padrões de Geração de Imagem`**: use `Editar Positivas` e `Editar Negativas` para definir tags padrão adicionadas ou excluídas de cada geração. Tags negativas só se aplicam quando o back-end oferece suporte a prompts negativos. O envio de uma caixa vazia redefine os padrões integrados.

## Configuração

1. Configure um modelo de imagem com `/config` > `Modelos` > Switch Models.
2. Habilite a geração de imagem em `/config` > `Permissões` (`imagegen_enabled`).
3. Pergunte a ela no chat ou execute `/generate image`.

## Suporte de Provedores

A geração de imagem nativa está disponível em Google, Vertex AI, Vertex AI Express, OpenRouter, Z.ai, NVIDIA NIM e NovelAI (estilo anime). Para ver a matriz completa de provedores, consulte [Provedores e Modelos](/pt-BR/features/setup-administration/providers-and-models/#supported-providers).

Para geração local em seu próprio hardware via ComfyUI, consulte [Configuração: ComfyUI](/pt-BR/self-hosting/local-endpoints/setup-comfyui/).

---
title: "Suporte ao SillyTavern"
# Keyword-rich <title> targeting "SillyTavern character cards in Discord"
# queries; replaces Starlight's default for this page only. H1 and sidebar
# keep the plain title.
head:
  - tag: title
    content: "TomoriBot | Use SillyTavern Character Cards in Discord"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "Importe cards de personagem e predefinições de prompt do SillyTavern no Discord com a TomoriBot. Traga seus personagens existentes para o seu servidor."
sidebar:
  order: 2
---

TomoriBot pode importar dois ativos de [SillyTavern](https://github.com/SillyTavern/SillyTavern): predefinições do Prompt Manager (que controlam a estrutura do prompt) e cartões de caracteres (a definição de caracteres). Se você nunca usou SillyTavern, pode pular esta página com segurança.

## Importação de Cards de Personagem

Traga um personagem SillyTavern existente para Discord com `/persona import`. Aceita:

- **Cartões PNG** com metadados `chara` ou `char` integrados.
- **Cartões JSON estilo v2** com propriedades de nível raiz (`name`, `description`, `first_mes`).
- Cartões **v3 JSON** (`spec: "chara_card_v3"` com um objeto `data` aninhado).
- **Arquivos `.charx`** (pacotes de cartões de personagem V3).

Um arquivo `.charx` é um arquivo ZIP que contém uma definição `card.json`. TomoriBot importa o texto do caractere de `card.json` e ignora os arquivos de ativos agrupados (ícones, sprites, áudio, vídeo). Você pode definir um avatar em `/config` > `Persona` > `Identidade e Personalidade` e adicionar sprites em `/config` > `Persona` > Sprites.

Se um arquivo carregado for um cartão SillyTavern válido sem metadados TomoriBot, a importação o converterá automaticamente. Você também pode passar um cartão para `/persona generate` para criar uma nova personalidade inspirada no personagem.

As importações são validadas antes de serem salvas (limites padrão: 5.000 caracteres por campo de texto, 200 atributos, 100 exemplos de diálogos por lado, 100 palavras de gatilho). Para mapeamento de campo e mecânica de conversão, consulte [arquitetura de suporte de cartão](/en/architecture/integrations/sillytavern/card-support/).

## Predefinições de Prompt
<!-- anchor: prompt-presets -->

Uma predefinição do Prompt Manager SillyTavern controla a ordem e o layout do prompt enviado ao modelo. Abra `/config` > `Plug-ins` > SillyTavern Predefinições para importar predefinições, alternar nós individuais, alternar predefinições ativas ou restaurar a formatação padrão.

### O Que uma Predefinição Controla

- Pedido imediato e colocação de marcadores
- Nós de prompt personalizados
- Nós de pós-histórico e injeção de profundidade
- Estado inicial habilitado para nós importados

### O que uma predefinição não substitui

Um layout de prompt de estruturas predefinidas; não substitui as fontes de texto que o preenchem:

- Instruções do sistema e campos de persona: `/config` > `Comportamento` > `Comportamento Geral`, `/config` > `Persona` > Avançado e `/config` > `Persona` > `Identidade e Personalidade`.
- Histórico de chat ao vivo e contexto do documento recuperado.
- Contexto automático: memórias do servidor, dados de emojis e figurinhas, listas de participantes e memórias de curto prazo.

### Como os Blocos Nativos São Mapeados

Os blocos nativos são mapeados diretamente para os componentes do prompt TomoriBot:

- `main`: o prompt do sistema ativo (`/config` > `Comportamento` > `Comportamento Geral` ou o substituto padrão)
- `charDescription`: `/config` > `Persona` > Avançado
- `charPersonality`: `/config` > `Persona` > `Identidade e Personalidade`
- `dialogueExamples`: `/config` > `Persona` > `Identidade e Personalidade`
- `chatHistory`: histórico de mensagens do canal ao vivo
- `worldInfoBefore` e `worldInfoAfter`: contexto do documento recuperado (não livros de história SillyTavern)

### Regra do Prompt de Sistema

Quando uma predefinição importada está ativa, o prompt do sistema substituto integrado é removido. No entanto, se você configurar um prompt de sistema personalizado em `/config` > `Comportamento` > `Comportamento Geral`, esse prompt será sempre incluído.

### Notas de Compatibilidade

- Os nós desabilitados em `prompt_order` permanecem inativos até serem habilitados em `/config` > `Plug-ins` > SillyTavern Predefinições. Nós vazios e somente comentários nunca são enviados.
- A ordem de bloqueio é literal: colocar `chatHistory` à frente de `dialogueExamples` coloca o histórico de bate-papo primeiro no prompt.
- As injeções pós-histórico se fundem no histórico de conversas existente, em vez de serem enviadas como mensagens independentes.
- Pós-processamento Regex, parâmetros de amostragem predefinidos (temperatura, top-p) e predefinições em camadas não são suportados. Importação de predefinições legadas de conclusão de texto com blocos somente ST eliminados.

Em `/help`, escolha `Plug-ins` e depois `Predefinições do SillyTavern` para o guia Discord. Para processamento interno de predefinições, consulte [arquitetura do sistema predefinido](/en/architecture/integrations/sillytavern/preset-system/).

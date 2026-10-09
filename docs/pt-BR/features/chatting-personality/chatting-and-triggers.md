---
title: "Bate-papo & Gatilhos"
sidebar:
  order: 1
---

TomoriBot responde quando convocado. Esta página aborda as maneiras como ela pode ser acionada, como ativar o bate-papo com viva-voz com acionamento automático e como evitar ativações acidentais com o modo de acionamento deliberado.

## Como Acioná-la
<!-- anchor: how-to-trigger-her -->

Por padrão, ela responde quando você:

- **Mencione ela**: `@TomoriBot`
- **Responder** a uma de suas mensagens (incluindo a mensagem de webhook de uma pessoa)
- **Use uma palavra-gatilho**: qualquer palavra-gatilho registrada em qualquer lugar da mensagem
- **Use `/respond`**: solicite uma resposta manualmente

Em um DM, envie uma mensagem diretamente, sem qualquer palavra-gatilho ou menção.

### Gerenciando Palavras-Gatilho
<!-- anchor: managing-trigger-words -->

Os gerentes de servidor usam `/config` > `Persona` > Gatilhos para adicionar ou remover palavras-gatilho para a persona ativa. Os membros sem o Manage Server podem visualizar os gatilhos existentes no modo somente leitura.

## Expressões & Reações
<!-- anchor: expressions--reactions -->

Ao responder, ela pode usar emojis, figurinhas e reações de emoji personalizados do servidor:

- Emojis personalizados aparecem naturalmente em conversas com a sintaxe `:name:`.
- Ela pode enviar um figurinha por resposta, como uma mensagem própria antes, entre ou depois do texto.
- Os gerentes de servidor podem adicionar [expressões personalizadas](/pt-BR/features/chatting-personality/behavior-tweaking/#expressions) com `/expressions manage`: GIFs de reação, piadas de imagem ou links para qualquer site.
- Execute `/expressions initialize` para que ela saiba quando cada emoji e figurinha do servidor cabe.

## Canais de Roleplay
<!-- anchor: roleplay-channels -->

Os canais de roleplay suprimem emojis personalizados e mensagens de figurinhas em suas respostas. Os membros também podem usar `/tool delete turn` em canais de RPG para excluir seu último turno sem precisar da permissão Gerenciar Servidor.

Configure canais de roleplay em `/config` > `Canais` > Regras de Canal.

## Consciência Situacional

Sempre que ela responde, ela recebe um contexto descrevendo onde e quando a conversa está acontecendo:

- **Local**: o nome do servidor, nome do canal ou se o chat é uma mensagem direta.
- **Hora**: hora local do servidor e hora do dia em `/config` > `Comportamento` > `Comportamento Geral`, além de relógios locais para usuários que definiram um fuso horário em `/personal config`.
- **Participantes**: nomes de exibição, identificadores de menção, tags de aparência e lembretes pendentes.
- **Atividade Discord**: o que os participantes estão tocando, transmitindo, ouvindo no momento (como faixas do Spotify) ou seu status personalizado.

O status da atividade requer a intenção `Guild Presences` de Discord e respeita a privacidade do usuário (`/personal config`). Os usuários que aumentam suas configurações de privacidade não são incluídos no contexto de presença.

## Gatilho Automático (Bate-papo Sem as Mãos)

O acionamento automático permite que TomoriBot participe de conversas sem ser mencionado diretamente:

- `/config` > `Canais` > Auto-Trigger (ou `/server autotrigger channels`): escolha os canais onde ela responde de forma autônoma.
- `/config` > `Canais` > Auto-Trigger (ou `/server autotrigger threshold`): defina quantas mensagens devem ser acumuladas antes que ela intervenha.
- `/config` > `Comportamento` > Comportamento do gatilho: configure gatilhos aleatórios baseados em temporizador para um canal.

Use o acionamento automático em canais casuais dedicados onde você deseja que o bot participe naturalmente.

## Modo de Gatilho Deliberado
<!-- anchor: deliberate-trigger-mode -->

Se o nome de uma pessoa for usado com frequência em conversas regulares, palavras simples podem ativá-la acidentalmente. O modo de gatilho deliberado (DTM) evita a ativação acidental, ignorando palavras de gatilho sem adornos.

Quando DTM está ativo:

- `@{trigger}` (a palavra acionadora prefixada com `@`) aciona uma resposta
- Discord menciona que `@TomoriBot` ainda aciona uma resposta
- As respostas às mensagens ainda funcionam
- `/respond` ainda funciona
- Palavras-gatilho simples sem `@` não a ativam mais

### Controle do Servidor e Pessoal

- `/server dtm`: gerenciadores de servidores alternam o padrão do servidor.
- `/personal config`: membros individuais substituem a configuração de suas próprias mensagens:
  - `off`: sempre permita palavras-gatilho simples
  - `follow`: siga a configuração do servidor
  - `on`: sempre requer invocação deliberada

Em `/help`, escolha `Comportamento` e depois `Modo de Gatilho Deliberado` para o resumo Discord.

:::note
O modo de gatilho deliberado (esta página) controla quando ela responde. O Modo Ferramenta Deliberada controla quais ferramentas são apresentadas ao modelo em um turno. Ambos são abreviados como "DTM" em Discord; consulte [Ferramentas e Extensões](/pt-BR/features/capabilities/tools-and-extensions/#deliberate-tool-mode).
:::

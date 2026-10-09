---
title: "Moderação do Servidor"
sidebar:
  order: 2
---

TomoriBot fornece aos gerentes de servidores controle refinado sobre uso, custos, permissões e canais por meio de `/moderation` e `/config`. A maioria desses controles requer a permissão `Gerenciar servidor`. Para obter uma lista completa de comandos, consulte a [Referência de comandos](/pt-BR/features/command-reference/).

## Controle de Custo: Cotas
<!-- anchor: cost-control-quotas -->

A geração custa dinheiro, seja pago pela conta do seu provedor ou pelos seus membros. Uso do limite de cotas por usuário e em todo o servidor:

- **Configurar limites**: em `/moderation` > `Cotas`, configure limites diários por usuário e pools de redefinição em todo o servidor para geração de texto, imagem e vídeo. Defina um limite por usuário para `0` ilimitado.
- **Reinicializações manuais**: execute `/quota reset user` para limpar o uso diário de um membro ou `/quota reset global` para redefinir todo o pool do servidor.

Os pools de todo o servidor são redefinidos automaticamente em um intervalo configurável em dias.

## BYOK de Usuário (Traga Sua Própria Chave)
<!-- anchor: user-byok-bring-your-own-key -->

Em `/moderation` > `Acesso de Membros`, você pode controlar se os membros podem usar IA financiada pelo servidor:

- **Modelos de servidor permitidos** (padrão): os membros usam provedores configurados no servidor.
- **Provedores pessoais necessários**: os membros devem configurar suas próprias chaves API via `/personal providers`. O servidor não paga nada por mensagens iniciadas por membros. As ações iniciadas pelo servidor (como saudações automatizadas ou tarefas agendadas) ainda usam o provedor do servidor.

Os membros configuram seus provedores pessoais em [Personalização](/pt-BR/features/knowledge/personalization/#your-own-providers).

Você também pode inicializar um servidor sem um provedor de texto do lado do servidor escolhendo `BYOK do Usuário` durante `/setup`.

## Controle de Acesso: Listas de Permissões

Use `/moderation` > `Lista Branca` para restringir onde e como TomoriBot responde:

- **Canais**: escolha quais canais permitem respostas de bot e defina substituições de resfriamento específicas do canal. Os canais herdam o resfriamento global, a menos que uma substituição seja definida.
- **Personas**: restrinja quais canais uma persona específica pode acionar.
- **Funções**: restrinja as interações do bot a membros com funções Discord específicas.

Configure o resfriamento da resposta global em todo o servidor em `/config` > `Comportamento` > Comportamento do acionador.

## Controles de Aprendizado & Privacidade

- **Permissões de membro**: em `/moderation` > `Acesso de Membros`, clique em `Editar Permissões` para controlar se os membros sem `Gerenciar servidor` podem gerenciar memórias do servidor, atributos de personalidade, exemplos de diálogos ou inspecionar instantâneos de prompt.
- **Lista negra de usuários**: em `/moderation` > `Lista Negra de Usuários`, escolha membros para TomoriBot ignorar completamente. Os membros da lista negra não podem acioná-la ou executar comandos, e suas mensagens nunca alcançam o contexto imediato. Você também pode definir bloqueios de membros específicos para cada pessoa.
- **Regras de canal**: em `/config` > `Canais` > Regras de canal, marque canais privados (onde a memória de curto prazo permanece isolada e os registros de pensamento são suprimidos) e listas de bloqueio de ferramentas entre canais.

## Transparência: Registros de Pensamento

Em `/config` > `Canais` > Logs e boas-vindas, clique em `Definir Canal de Logs` para designar um canal onde TomoriBot publica seu raciocínio interno, avisos de fallback e chamadas de ferramenta bem-sucedidas. Isso é útil para auditar o que ela está fazendo, incluindo qual gatilho expôs uma ferramenta no [Modo Ferramenta Deliberada](/pt-BR/features/capabilities/tools-and-extensions/#deliberate-tool-mode).

O registro só copia de canais que todos os membros do seu servidor já podem ver. A atividade em um canal ou tópico que alguns membros não conseguem abrir fica fora do registro, de modo que o registro nunca exibe conteúdos que eles não poderiam ler onde ocorreram. O canal de registros deve estar no mesmo servidor.

## Saudações de Boas-Vindas

Em `/config` > `Canais` > Logs e boas-vindas, configure saudações automatizadas para novos membros em um canal escolhido. TomoriBot espera até que o novo membro conclua a triagem e integração das regras do Discord antes de enviar a saudação. Se um membro sair antes de terminar a triagem, nenhuma saudação será enviada. Clique em `Limpar Boas-vindas` na mesma página para desativar as saudações.

## Expressões

Execute `/expressions initialize` para indexar os emojis e figurinhas personalizados do seu servidor para que as pessoas possam usá-los com precisão nas conversas. Para saber como as personas usam emojis, figurinhas e reações, consulte [Expressões e reações](/pt-BR/features/chatting-personality/chatting-and-triggers/#expressions--reactions).

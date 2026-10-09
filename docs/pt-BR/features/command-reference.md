---
title: "Referência de Comandos"
sidebar:
  order: 6
---

<!--
  GENERATED FILE: do not edit by hand.
  Run `bun run generate-command-reference` from the repository root.
-->

Todos os comandos de barra (slash commands) atualmente registrados pela TomoriBot, gerados a partir dos mesmos construtores de comando e descrições em português usados para o registro no Discord (descrições ainda não traduzidas aparecem em inglês).

Grupos de comandos de nível superior: **41**. Comandos de barra executáveis: **85**.

## `/comment`

Envie um embed de comentário visível no chat, mas invisível no contexto.

| Comando | Resumo |
|---|---|
| `/comment` | Envie um embed de comentário visível no chat, mas invisível no contexto. |

## `/compact`

Resuma a conversa recente em uma memória de sistema compacta.

| Comando | Resumo |
|---|---|
| `/compact` | Resuma a conversa recente em uma memória de sistema compacta. |

## `/conditioning`

Gerencie memórias persistentes de condicionamento de recompensa e punição.

| Comando | Resumo |
|---|---|
| `/conditioning manage` | Gerencie o histórico de condicionamento injetado em todas as personas neste servidor. |
| `/conditioning remove` | Remova entradas de condicionamento de todas as personas neste servidor. |

## `/config`

Configure as configurações de persona, comportamento, canal, permissão e modelo.

| Comando | Resumo |
|---|---|
| `/config` | Configure as configurações de persona, comportamento, canal, permissão e modelo. |

## `/context`

Veja quanto da janela de contexto do modelo o prompt de uma persona preenche neste canal.

| Comando | Resumo |
|---|---|
| `/context` | Veja quanto da janela de contexto do modelo o prompt de uma persona preenche neste canal. |

## `/contribute`

Encontrar o código-fonte e maneiras de ajudar a construir o TomoriBot.

| Comando | Resumo |
|---|---|
| `/contribute github` | Obter o link do repositório do GitHub e aprender como contribuir para o TomoriBot. |

## `/donate`

Apoiar o desenvolvimento e os custos de hospedagem do TomoriBot.

| Comando | Resumo |
|---|---|
| `/donate kofi` | Apoiar o desenvolvimento do TomoriBot através de doações no Ko-fi. |

## `/export`

Exporte sua configuração ou memórias como um arquivo portátil.

| Comando | Resumo |
|---|---|
| `/export config` | Exporte a configuração deste servidor como um arquivo portátil. |
| `/export memories` | Exporte memórias como um arquivo portátil. |
| `/export personal config` | Exporte sua configuração pessoal como um arquivo portátil. |
| `/export personal memories` | Exporte as memórias que sua conta possui como um arquivo portátil. |

## `/expressions`

Ensine o TomoriBot quando usar os emojis e figurinhas personalizados deste servidor.

| Comando | Resumo |
|---|---|
| `/expressions initialize` | Analisa e classifica todos os emojis e figurinhas personalizados usando visão de IA |
| `/expressions manage` | Gerencie emojis, figurinhas, expressões personalizadas e acesso das personas. |

## `/generate`

Gere imagens, vídeos e mensagens de voz por IA.

| Comando | Resumo |
|---|---|
| `/generate image` | Gere uma imagem por IA do seu próprio prompt ou da cena do canal |
| `/generate scene` | Gere uma curta cena de texto roteirizada entre as personas selecionadas. |
| `/generate video` | Gere um vídeo por IA usando Google Veo, OpenRouter, ou Z.ai |
| `/generate voice-message` | Fale uma mensagem com uma voz que você escolher |

## `/help`

Navegue por configurações, recursos, provedores, memória, ferramentas e guias de integração.

| Comando | Resumo |
|---|---|
| `/help` | Navegue por configurações, recursos, provedores, memória, ferramentas e guias de integração. |

## `/impersonate`

Imita personas, usuários ou injeta prompts de sistema.

| Comando | Resumo |
|---|---|
| `/impersonate persona` | Envia uma mensagem como uma das personas deste servidor. |
| `/impersonate system` | Injeta uma mensagem de sistema no contexto da conversa. |
| `/impersonate user` | Faz o bot escrever e enviar uma mensagem como se fosse aquele membro. |

## `/import`

Importar configuração ou memórias de um arquivo portátil.

| Comando | Resumo |
|---|---|
| `/import config` | Importar um arquivo de configuração do servidor. |
| `/import memories` | Importar um arquivo de memória do servidor. |
| `/import personal config` | Importar um arquivo de configuração pessoal. |
| `/import personal memories` | Importar um arquivo de memória pessoal. |

## `/kill`

Pare imediatamente a stream atual e limpe as respostas na fila neste canal.

| Comando | Resumo |
|---|---|
| `/kill` | Pare imediatamente a stream atual e limpe as respostas na fila neste canal. |

## `/learn`

Aprenda, extraia e ingira o histórico de conversas na memória.

| Comando | Resumo |
|---|---|
| `/learn history` | Extraia conhecimento do histórico de mensagens deste canal usando IA. |

## `/legal`

Ver os termos de serviço, política de privacidade e licença do TomoriBot.

| Comando | Resumo |
|---|---|
| `/legal license` | Ver a licença de código aberto do TomoriBot |
| `/legal privacy-policy` | Ver a Política de Privacidade do TomoriBot |
| `/legal terms-of-service` | Ver os Termos de Serviço do TomoriBot |

## `/matrix`

Vincule canais do Discord a salas do Matrix para retransmissão bidirecional.

| Comando | Resumo |
|---|---|
| `/matrix link` | Vincule um canal do Discord a uma sala do Matrix para retransmissão bidirecional |
| `/matrix unlink` | Remova a conexão da ponte Matrix de um canal do Discord |

## `/memories`

Inspecione e gerencie memórias do servidor, documentos e memória de curto prazo.

| Comando | Resumo |
|---|---|
| `/memories` | Inspecione e gerencie memórias do servidor, documentos e memória de curto prazo. |

## `/model`

Gerencia os modelos de IA padrão deste servidor.

| Comando | Resumo |
|---|---|
| `/model override remove` | Remove substituições de modelos de canais e personas. |

## `/moderation`

Gerencie permissões de membros, lista negra, lista branca de canais e cargos e cotas.

| Comando | Resumo |
|---|---|
| `/moderation` | Gerencie permissões de membros, lista negra, lista branca de canais e cargos e cotas. |

## `/novelai`

Configure a geração de texto e imagem da NovelAI para este servidor.

| Comando | Resumo |
|---|---|
| `/novelai generate image` | Gere uma imagem NovelAI usando tags estilo imageboard e uma referência de personagem opcional. |
| `/novelai usage` | Mostre o medidor de uso de geração Opus da NovelAI deste servidor (requer Gerenciar Servidor). |

## `/nsfw`

Configurações e comandos com restrição de idade.

| Comando | Resumo |
|---|---|
| `/nsfw jailbreaks` | Gerenciar comportamentos opcionais de jailbreak para meus prompts neste servidor. |
| `/nsfw persona default` | Aplicar uma predefinição de personalidade NSFW |
| `/nsfw persona import` | Importar uma persona a partir de um arquivo PNG, JSON ou CHARX, incluindo personas NSFW |

## `/nuke`

Apagar totalmente os dados do servidor. Requer executar /setup novamente depois.

| Comando | Resumo |
|---|---|
| `/nuke` | Apagar totalmente os dados do servidor. Requer executar /setup novamente depois. |

## `/persona`

Gerenciar predefinições de personalidade

| Comando | Resumo |
|---|---|
| `/persona create` | Criar uma predefinição de personalidade simples manualmente |
| `/persona default` | Aplicar uma predefinição de personalidade |
| `/persona export` | Exportar a personalidade atual como um arquivo PNG compartilhável |
| `/persona generate` | Geração de personalidade baseada em IA (requer um provedor compatível) |
| `/persona import` | Importar uma persona a partir de um arquivo PNG, JSON ou CHARX |
| `/persona remove` | Remover um alter do servidor |

## `/personal`

Gerencie suas configurações pessoais

| Comando | Resumo |
|---|---|
| `/personal config` | Gerencie suas preferências pessoais, privacidade, modelos e perfil. |
| `/personal language` | Escolha o idioma em que a TomoriBot fala com você. |
| `/personal memories` | Gerencie suas memórias pessoais de longo prazo e contexto conversacional de curto prazo. |
| `/personal nuke` | Apague tudo que o TomoriBot armazena sobre você, em todos os servidores. |
| `/personal providers` | Gerencie suas credenciais de provedor pessoais, endpoints e catálogos de modelos. |

## `/ping`

Verifique a latência do bot.

| Comando | Resumo |
|---|---|
| `/ping` | Verifique a latência do bot. |

## `/providers`

Adicione, veja, edite e remova credenciais de provedores, endpoints e catálogos de modelos.

| Comando | Resumo |
|---|---|
| `/providers` | Adicione, veja, edite e remova credenciais de provedores, endpoints e catálogos de modelos. |

## `/punish`

Puna-me com interações lúdicas.

| Comando | Resumo |
|---|---|
| `/punish bite` | Dê-me uma mordida lúdica! |
| `/punish bonk` | Dê-me uma pancada na cabeça! |
| `/punish pinch` | Dê-me um beliscão! |
| `/punish spank` | Dê-me um tapa lúdico! |
| `/punish squeeze` | Dê-me um apertão! |

## `/quota`

Gerencie as redefinições de cota de geração.

| Comando | Resumo |
|---|---|
| `/quota reset global` | Redefina o pool de cota de geração para todo o servidor. |
| `/quota reset user` | Redefina o uso diário de cota para um usuário. |

## `/refresh`

Limpe o histórico de conversa (apenas neste canal).

| Comando | Resumo |
|---|---|
| `/refresh` | Limpe o histórico de conversa (apenas neste canal). |

## `/reset`

Redefine a configuração do servidor ou pessoal para os padrões.

| Comando | Resumo |
|---|---|
| `/reset config` | Redefine a configuração deste servidor para os padrões do banco de dados. |
| `/reset personal config` | Redefine sua configuração pessoal para os padrões do banco de dados. |

## `/respond`

Acione manualmente a resposta à última mensagem neste canal.

| Comando | Resumo |
|---|---|
| `/respond` | Acione manualmente a resposta à última mensagem neste canal. |

## `/reward`

Recompense-me com interações divertidas.

| Comando | Resumo |
|---|---|
| `/reward feed` | Alimente-me com um lanche delicioso! |
| `/reward headpat` | Dê-me um cafuné! |
| `/reward hug` | Dê-me um abraço! |
| `/reward kiss` | Dê-me um beijo! |
| `/reward tickle` | Faça cócegas em mim! |

## `/scheduled-task`

Gerenciar tarefas agendadas e lembretes.

| Comando | Resumo |
|---|---|
| `/scheduled-task edit` | Edita uma tarefa agendada ou lembrete. |
| `/scheduled-task remove` | Remove uma tarefa agendada ou lembrete. |

## `/setup`

Inicie o processo de configuração inicial. Configure o provedor de IA e a personalidade.

| Comando | Resumo |
|---|---|
| `/setup` | Inicie o processo de configuração inicial. Configure o provedor de IA e a personalidade. |

## `/stats`

Ver estatísticas de uso

| Comando | Resumo |
|---|---|
| `/stats generate` | Gere um cartão de imagem de estatísticas compartilhável. |
| `/stats persona` | Veja as estatísticas de uso de uma persona neste servidor. |
| `/stats personal` | Veja suas próprias estatísticas de uso. |
| `/stats server` | Veja as estatísticas de uso de todo o servidor. |

## `/status`

Mostra o status atual da persona, servidor ou pessoal.

| Comando | Resumo |
|---|---|
| `/status` | Mostra o status atual da persona, servidor ou pessoal. |

## `/support`

Obter ajuda, relatar bugs e juntar-se à comunidade do TomoriBot.

| Comando | Resumo |
|---|---|
| `/support discord` | Obter o link do servidor oficial do Discord para bugs, feedback e bate-papo da comunidade. |

## `/tool`

Ações utilitárias para contexto de conversa, prompts e diagnósticos.

| Comando | Resumo |
|---|---|
| `/tool delete turn` | Excluir o turno da última persona do canal. |
| `/tool estimate cost` | Estimar custos de API para provedores de IA pagos |
| `/tool prompt snapshot` | Despeje o prompt exato do LLM para uma persona em um arquivo para depuração. |

## `/troubleshoot`

Obtenha ajuda com algo que a TomoriBot fez.

| Comando | Resumo |
|---|---|
| `/troubleshoot chat` | Cria um arquivo privado sobre um problema recente no chat. |

## `/update`

Ver as notas de lançamento mais recentes do TomoriBot

| Comando | Resumo |
|---|---|
| `/update` | Ver as notas de lançamento mais recentes do TomoriBot |

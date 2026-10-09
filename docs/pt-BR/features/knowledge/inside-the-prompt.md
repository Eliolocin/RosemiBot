---
title: "Por Dentro do Prompt"
sidebar:
  order: 2
aiGenerated: false
---

Cada vez que você aciona TomoriBot, o seguinte é montado e enviado ao seu modelo de texto configurado como prompt/contexto principal, nesta ordem:

| Bloquear | Opcional? | Comandos | O que é isso |
|---|---|---|---|
| [Prompt do sistema](/pt-BR/features/chatting-personality/behavior-tweaking/#system-prompt) |  | `/config` > Motor > Geral | Instruções básicas no topo do contexto. |

> **Texto padrão do prompt do sistema**: usado somente enquanto nenhum prompt do sistema do servidor estiver definido. >
> *"Você é {bot}. {bot} responde de forma curta e concisa por padrão. {bot} só dá respostas longas se a situação justificar. >
> {{if tool:create_long_term_memory}}{bot} usa proativamente o {memory_tool} disponível sempre que alguém compartilha um detalhe ou {bot} percebe algum na conversa que realmente vale a pena lembrar, como uma preferência, um interesse ou um fato importante, preferindo lembrar de coisas mesmo que sejam menores, desde que não sejam uma duplicata do que {bot} já sabe. {{/if}}{{if tool:update_long_term_memory}}{bot} usa {memory_update_tool} quando novas informações são alteradas ou adicionadas a algo que {bot} já lembra, em vez de salvar uma duplicata.{{/if}} >
> {{if tool:review_capabilities}}Quando alguém pergunta o que {bot} pode fazer ou por que algo não está disponível, {bot} verifica {capabilities_tool} antes de responder. {{/if}}{{if tool_family:url_fetch}}Quando mais detalhes são necessários, {bot} usa {url_fetch_tool} em `https://docs.tomoribot.app/llms.txt` para obter informações.{{/if}}"*

| Bloquear | Opcional? | Comando | O que é isso |
|---|---|---|---|
| Prompt de canal (anexar) | *(Opcional)* | `/config` > `Canais` > Substituições de canal | Varia por canal, em camadas logo após o prompt do sistema. O modo *substituir* da mesma página assume o slot de prompt do sistema acima em vez de adicionar um novo. |
| Solicitação de personalidade | *(Opcional)* | `/config` > `Persona` > Avançado | Um prompt escrito especificamente para a persona ativa, separado do prompt do sistema. |
| [Atributos da pessoa](/pt-BR/features/chatting-personality/multiple-personas/#attributes) |  | `/config` > `Persona` > `Identidade e Personalidade` | Os traços de personalidade e padrões de fala da persona ativa. |
| Informações do servidor |  | *(nenhum, de Discord)* | O nome do servidor, a descrição e o canal em que ela está, extraídos do próprio Discord. |
| [Bloqueios de usuário pessoal](/pt-BR/features/capabilities/tools-and-extensions/#built-in-tools) | *(Opcional)* | `/moderation` para revisar/limpar; bloqueado por `/config` > `Permissões` (bloqueio de usuário) | Restrições ativas de silenciamento/bloqueio que esta pessoa mantém contra usuários específicos. |
| [Memórias do servidor](/pt-BR/features/knowledge/memory/#personal-vs-server-memories) |  | `/memories` | Os fatos de longo prazo salvos para este servidor. |
| [Emojis de servidor](/pt-BR/features/chatting-personality/behavior-tweaking/#capabilities-what-shes-allowed-to-do) | *(Opcional)* | `/config` > `Plug-ins` > `Adições de Contexto` (`Emojis nas Respostas`) (somente alternância), inicializar com `/expressions initialize` | Os emojis personalizados presentes no servidor. |
| [Figurinhas do servidor](/pt-BR/features/chatting-personality/behavior-tweaking/#expressions) | *(Opcional)* | `/config` > `Plug-ins` > `Ferramentas Disponíveis` (uso de figurinhas), classificar ativos nativos com `/expressions initialize`, gerenciar com `/expressions manage` | Figurinhas nativos enviáveis e todas as expressões personalizadas elegíveis para a pessoa que responde, com nomes, descrições e emoções. As fontes de mídia e as regras de acesso pessoal ficam fora do prompt. |
| [Sprites de personalidade](/pt-BR/features/chatting-personality/multiple-personas/#sprites-emotion-avatars) | *(Opcional)* | `/config` > `Persona` > Sprites | Sprites de expressão nomeada configurados para a persona, se houver. |
| [Participantes da Conversa](/pt-BR/features/knowledge/memory/#personal-vs-server-memories) | *(Opcional)* | `/personal memories` (bloqueado por `/config` > `Permissões` (Personalização)) | As pessoas na conversa, seus apelidos e menções, e as memórias pessoais salvas sobre cada uma delas. Carregado quando a pessoa possui uma mensagem no contexto ou se seu nome/alias for mencionado. Também carrega o canal atual e a hora local como rodapé, usando `/config` > Engine > General. |
| [Memória de curto prazo](/pt-BR/features/knowledge/memory/#short-term-memory-stm) |  | `/config` > `Persona` > Memórias; `/memories` para limpar entradas; bloqueado por `/config` > `Permissões` (memória de curto prazo) | Contém resumos e mensagens recentes de diferentes canais |
| [`Documentos`](/pt-BR/features/knowledge/memory/#document-knowledge-base-rag) | *(Opcional)* | `/memories` | Pedaços relevantes extraídos da base de conhecimento usando RAG. |
| [Condicionamento](/pt-BR/features/knowledge/memory/#conditioning) | *(Opcional)* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`, `/punish <bite\|bonk\|pinch\|spank\|squeeze>`; gerenciado com `/conditioning remove` | Preferências de comportamento acumuladas para esta persona neste servidor. |
| [Exemplos de diálogos](/pt-BR/features/chatting-personality/multiple-personas/#sample-dialogues) | *(Opcional)* | `/config` > `Persona` > `Identidade e Personalidade` | Exemplos de como essa persona fala, se houver algum configurado. |
| [Mensagens recentes](/pt-BR/features/chatting-personality/behavior-tweaking/#generation-tuning) |  | `/config` > Motor > Geral | A conversa real, até esse número de mensagens (padrão 80). Sua nota de contexto e qualquer nota de reunião são injetadas em linha dentro deste bloco, em uma profundidade configurável, em vez de como um bloco separado próprio. |

As linhas marcadas com *(Opcional)* não contribuem com nada (e não custam tokens) quando não há nada a dizer, por exemplo. nenhum documento corresponde ou o servidor não possui emojis personalizados.

As mensagens recentes são a parte maior e mais frágil, são uma janela que desliza à medida que as pessoas falam. Tudo acima deles é reconstruído a partir das configurações salvas e é estável.

`/tool prompt snapshot` despeja o pacote exato de uma persona em um arquivo. É a verdade básica para quais memórias estão atualmente ativas, se um documento corresponde e quanto da conversa realmente cabe.

`/context` desenha o mesmo pacote que uma grade colorida da janela de contexto do modelo, uma cor por grupo de blocos acima, para que você possa ver rapidamente o que o preenche e quanto espaço resta. Um círculo marca um grupo menor que um quadrado. Também mostra o custo estimado de entrada por resposta e quantos tokens de entrada o provedor relatou para a última resposta real.

`/tool estimate cost` divide o mesmo pacote por tamanho, o que é útil para descobrir o que está consumindo seu contexto antes de aumentar qualquer limite.

### Onde as Ferramentas são definidas?

Para cada provedor que TomoriBot suporta nativamente, os esquemas de ferramentas são enviados por meio do próprio campo `tools` do provedor, portanto, depende do mecanismo de inferência configurado/provedor.

### Por que a TomoriBot esquece?

Essa ordem explica quase todos os "por que ela não se lembra?" pergunta:

| O que aconteceu | Por que |
|---|---|
| Ela esqueceu algo de hoje cedo | Ele ultrapassou o limite de mensagens. Estava apenas nas mensagens recentes, se Tomori não salvá-lo como uma memória de longo prazo, ele será esquecido quando chegar fora da janela de mensagens. |
| Ela esqueceu algo em outro canal | As mensagens recentes são por canal. Somente memórias de servidor, participantes de conversa e canais cruzados de memória de curto prazo. A memória de curto prazo resolve isso carregando mensagens recentes de canais diferentes, mas não descarta tudo. |
| `/refresh` a fez esquecer | A atualização corta as mensagens recentes e limpa a memória de curto prazo deste canal, mas não deve remover a memória de longo prazo. Exclua a incorporação de atualização para remover o corte. |
| Ela esqueceu algo depois de reiniciar | Mensagens recentes nunca sobrevivem a reinicializações |

Se você deseja que algo sobreviva a todos os itens acima, isso deve se tornar uma memória de longo prazo. Consulte [Memória](/pt-BR/features/knowledge/memory/#long-term-memory).

## Dicas e Truques

- `/config` > Engine > General amplia a janela de conversa (20-100 mensagens). Mais
  contexto, mais tokens por resposta.
- `/config` > Engine > General injeta um lembrete curto em uma profundidade escolhida. Como ele fica
  baixo no pacote, próximo às mensagens recentes, ela é mais propensa a agir sobre ele do que sobre
  algo no prompt de sistema. Este é o melhor lugar para incentivá-la a salvar memórias
  com mais frequência.
- `/personal memories` e `/memories` escrevem diretamente nas Memórias do servidor e
  nos Participantes da Conversa, o que é uma das formas garantidas de tornar o conhecimento permanente no contexto da TomoriBot.

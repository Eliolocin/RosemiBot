---
title: "Natural Nudges"
description: "Permita que as personas do TomoriBot iniciem conversas quando um canal do Discord ficar silencioso e entrem naquelas que combinam com seus interesses, em um ritmo adaptado à atividade do seu servidor."
sidebar:
  order: 4
aiGenerated: true
---

O Natural Nudges permite que o TomoriBot fale sem ser mencionado, de duas maneiras:

- **Toques Ociosos**: quando um canal fica silencioso, uma de suas personas escolhe algo para fazer, como saber como alguém está, retomar uma conversa anterior, trazer um novo assunto ou encenar uma breve conversa com outra persona, postando com a própria voz.
- **Toques Ativos**: quando os membros estão conversando sobre algo de que uma persona gosta, essa persona entra na conversa.

Os toques foram pensados para parecer um amigo que aparece para conversar:

- **O ritmo acompanha o servidor**: servidores que conversam com o TomoriBot todos os dias recebem cerca de um toque ocioso por dia; servidores que raramente falam com ela não recebem nenhum, nem toques ativos.
- **Ela espera uma pausa natural**: um toque ocioso só começa em um canal que esteve silencioso por uma a três horas, durante o horário em que o servidor costuma estar ativo.
- **Ela fica em silêncio quando ninguém responde**: cada toque ocioso sem resposta faz com que o próximo espere mais tempo, e após três consecutivos sem resposta ela para até que alguém volte a falar com ela.
- **Na dúvida, ela não diz nada**: se alguém postar primeiro, o canal ficar movimentado ou nada se encaixar, o toque é descartado.

O Natural Nudges funciona apenas em servidores, nunca em mensagens diretas (DMs).

## Toques Ativos
<!-- anchor: active-nudges -->

Um toque ativo acontece quando uma persona entra em uma conversa em andamento porque o assunto trata de algo de que ela gosta. Veja como acontece:

1. Enquanto os membros conversam em um canal qualificado, o TomoriBot conta as mensagens. Tópicos contam como parte do canal principal, e a contagem reinicia sempre que uma persona fala.
2. De tempos em tempos (mais rápido em servidores mais movimentados e com maior frequência para toques ativos), ela lê as últimas cinco mensagens e avalia se a conversa realmente trata dos interesses de alguma de suas personas. Uma menção passageira não conta.
3. A persona com esse interesse responde. Se várias personas compartilharem o mesmo interesse, a que esteve mais quieta recentemente costuma ser a escolhida, enquanto a que acabou de falar aguarda a vez. De vez em quando outra persona assume a vez, com mais frequência uma com quem o servidor raramente conversa.
4. A resposta chega de 15 a 45 segundos depois, com a personalidade habitual da persona. Se outra persona falar primeiro, os membros mudarem de assunto ou o canal ficar movimentado, ela não diz nada.

Há no máximo um toque ativo por canal (incluindo tópicos) por hora, além de um limite diário para todo o servidor. A persona precisa ter interesses cadastrados em sua página de Toques para participar, e personas Silenciosas nunca participam.

## Toques Ociosos
<!-- anchor: idle-nudges -->

Cada toque ocioso pertence a uma categoria:

| Categoria | O que acontece |
|---|---|
| **Mencionar Usuário** | Uma persona menciona um membro que conhece: para saber como está, dar seguimento a algo comentado, compartilhar um link interessante, brincar sobre o jogo que está jogando ou oferecer um lembrete. |
| **Retomar Tópico** | Uma persona retoma uma conversa que ficou pendente: uma pergunta sem resposta, uma segunda opinião ou algo que ela pesquisou. |
| **Iniciar Tópico** | Uma persona traz algo novo, geralmente baseado em seus próprios interesses: um pensamento, uma opinião controversa, um dilema de escolha, uma notícia, uma imagem ou uma nota de voz. |
| **Encenar Cena** | Duas ou três personas conversam entre si em uma cena curta de duas a quatro mensagens: uma discussão divertida, um plano "secreto" para um membro, pedir conselhos mútuos ou mostrar uma imagem. |

O `/nudge-studio` (requer Gerenciar Servidor) tem uma aba para cada categoria. Cada aba lista os toques ociosos daquela categoria com um ponto colorido:

- 🟢 **Ativado**: pode ser selecionado.
- 🟡 **Ativado, mas não pode ser executado aqui ainda**: nenhuma persona tem a ferramenta necessária, uma cena não tem uma segunda persona ou nenhuma das personas restritas pode intervir. A linha informa o que está faltando.
- 🔴 **Desativado**.

**Alternar Disponibilidade...** abre um toque ocioso com uma caixa de seleção para cada persona:

- **Todas marcadas**: qualquer persona pode usá-lo, incluindo as que você adicionar depois.
- **Algumas marcadas**: apenas essas personas, e a linha exibe os nomes, como "Lembrar você? (apenas Mirri e Juno)". Uma persona adicionada posteriormente permanece de fora até que você a marque.
- **Nenhuma marcada**: o toque ocioso fica desativado.

Abaixo da lista você pode adicionar até 25 toques personalizados para todo o servidor. Ao clicar em um, ele é aberto para edição; **Remover Toques Personalizados** lista seus toques, e desmarcar um remove o toque. Cada um contém:

- **Nome**.
- **Instrução**: o que a persona pretende fazer. Escreva `{persona}` onde vai o nome dela, `{partner}` para a outra persona em uma cena e `{target}` para o membro envolvido.
- **Objetivo oculto** (opcional): a pequena meta pessoal que a persona mantém após sua abertura.
- **Pré-requisitos**: o que precisa estar presente antes que o toque possa ser executado, como uma memória recente ou uma ferramenta disponível. Cada categoria já traz os seus: um membro para mencionar, uma conversa pendente ou uma segunda persona.
- **Ferramentas recomendadas**: ferramentas que a persona é incentivada a usar quando as possui. O toque ocioso ainda é executado sem elas. Uma ferramenta escolhida nos Pré-requisitos já é considerada obrigatória, por isso é removida desta lista ao salvar.

### Mencionar Usuário
<!-- anchor: ping-user -->

Esse tipo de toque ocioso menciona um membro pelo nome, portanto só escolhe pessoas que a persona realmente conhece:

- **Eles conversaram com esta persona recentemente**: apenas membros que iniciaram uma conversa com essa persona neste servidor nos últimos 14 dias podem ser escolhidos. Ter sido mencionado ou citado em uma conversa não conta, e ter proximidade com a mesma persona em outro servidor também não conta.
- **A persona os conhece**: o membro tem uma memória com essa persona nos últimos 30 dias, ou uma memória de curto prazo (STM) recente com ela.
- **Eles não desativaram a opção**: qualquer pessoa pode desativar as Menções de Personas para si mesma em `/personal config` > Privacidade. Membros com privacidade Completa, membros na lista de bloqueio de personalização do servidor e membros bloqueados pela persona nunca são escolhidos.

Entre esses membros, os mais próximos são escolhidos com mais frequência: cada mensagem enviada para essa persona neste servidor nos últimos 14 dias, e cada canal em que conversaram recentemente, aumenta suas chances. Alguém que uma persona mencionou nos últimos três dias tem menos chance de ser escolhido novamente. A menção vai apenas para esse membro individual; um toque de menção nunca menciona cargos, `@everyone` ou qualquer outra pessoa. Qualquer resposta no canal conta como resposta.

### Encenar Cena
<!-- anchor: play-scene -->

Uma cena é um breve diálogo entre personas, com duas a quatro mensagens de duração. A persona que toma a iniciativa abre a cena e escolhe um parceiro (às vezes dois) entre as outras personas permitidas naquele canal. Personas mais comunicativas entram com mais frequência, e personas Silenciosas nunca participam.

- **Os membros vêm primeiro**: quando alguém posta no canal durante a cena, as mensagens restantes da cena são descartadas e a persona que estava prestes a falar responde à pessoa, como em uma conversa em que alguém acabou de entrar. Se a postagem nomeou ou mencionou uma persona específica, essa persona responde no lugar.
- **Planos permanecem em segredo**: as personas podem planejar uma surpresa inofensiva para alguém que conhecem, mas a cena não menciona esse membro.

### Objetivos ocultos

Junto com a abertura, cada toque ocioso dá à persona uma pequena meta privada, como "descobrir quem mais gosta desse anime". A meta fica anexada acima da abertura e apenas essa persona a vê, para que continue buscando o objetivo em respostas posteriores. Em uma cena, cada persona recebe seu próprio objetivo, que as outras nunca veem. Quando a abertura sai do contexto que a persona lembra, a meta desaparece. Objetivos ocultos nunca pedem dados pessoais, dinheiro ou qualquer coisa fora do chat. Membros com permissão para usar o snapshot de prompt podem visualizá-los.

## Configurações

O Natural Nudges vem ativado por padrão e nada precisa ser configurado previamente. Assim que as pessoas no servidor começarem a conversar regularmente com o TomoriBot, toques ociosos e ativos começarão nos canais onde conversam com ela.

Para alterar o funcionamento, abra `/config` > Plugins > Natural Nudges (requer Gerenciar Servidor):

- **Toques Ociosos** e **Toques Ativos**: ativam ou desativam cada modalidade separadamente.
- **Canais**: funciona de forma automática com os canais onde as pessoas conversaram com o TomoriBot nos últimos 14 dias (exceto canais de roleplay). Você pode escolher canais manualmente ou limpar a lista para voltar ao modo automático. Um canal onde outros bots postam frequentemente nunca fica silencioso, portanto é ignorado.
- **Seleção de Modelos**: escolhe os dois modelos de IA utilizados pelo Natural Nudges. Modelos gratuitos do Google estão sujeitos aos termos de uso gratuito do Google, que permitem que o Google utilize as conversas enviadas a eles.
  - **Planejador de Toques Ociosos**: planeja os toques ociosos. Por padrão, é o modelo de chat do servidor. Nem todos os modelos conseguem realizar essa tarefa; se o seu não puder, o painel avisará e permitirá escolher outro.
  - **Verificador de Toques Ativos**: analisa a conversa de tempos em tempos para ver se combina com algum interesse. Ele roda com muito mais frequência do que o planejador, por isso um modelo pequeno e econômico é o mais indicado. Por padrão, o TomoriBot escolhe um para você: um modelo de Decisão (um modelo pequeno criado para responder a perguntas de escolha única) se o servidor tiver uma chave da OpenRouter, Gemma 4 31B se tiver uma chave do Google, ou o Planejador de Toques Ociosos caso contrário. Você pode escolher qualquer um desses manualmente, incluindo modelos de Decisão.

A página mostra o nível de atividade do servidor, quantos toques ociosos esperar a cada semana e com que frequência ela verifica as conversas para toques ativos.

### Frequência

- **Frequência**: define o ritmo separadamente para toques ociosos e para toques ativos: Rara, Suave (o padrão), Normal ou Animada. Mesmo no nível Animada, ela permanecerá quieta em um servidor que raramente conversa com o TomoriBot.
- **Limites diários**: acompanham o nível de frequência: Rara permite 1 toque ocioso e 1 ativo por dia; Suave 3 de cada; Normal 5 toques ociosos e 6 ativos; Animada 8 toques ociosos e 10 ativos.
- **Limites de verificação**: evitam que toques ativos esgotem uma chave de IA: o TomoriBot verifica conversas no máximo 10 vezes ao dia no modo Rara, 20 no Suave, 40 no Normal e 60 no Animada. Depois que uma verificação não encontra nada, aquele canal espera mais tempo antes da próxima, de 10 minutos até 3 horas. Se o provedor de IA indicar que a chave atingiu seu limite, os toques ativos são pausados por 3 horas.

### Quando permanece desligado

- **Estatísticas de uso desativadas**: o TomoriBot avalia a atividade de um servidor por meio de suas estatísticas de uso. Se quem hospeda o bot desativou as estatísticas, os toques nunca começarão.
- **Membros pagam com suas próprias chaves (BYOK)**: se o seu servidor faz com que cada membro use sua própria chave de IA, nenhuma chave cobre uma mensagem que ninguém solicitou, portanto o Natural Nudges permanece desligado.

## Configurações de Persona

Cada persona tem sua própria página de **Toques** em `/config` > Persona:

- **Loquacidade**: com que frequência essa persona é quem toma a iniciativa de falar. Personas Silenciosas nunca iniciam toques ociosos nem participam de toques ativos; tímidas falam menos e tagarelas com mais frequência.
- **Interesses**: até 8 tópicos que a persona gosta de trazer e participar, cada um com uma breve descrição e exemplos (por exemplo, **anime de mecha**: ficção sobre robôs gigantes pilotados, como Gundam).

Predefinições oficiais vêm com seus próprios interesses e loquacidade. O comando `/persona generate` sugere interesses para novos personagens, e as exportações de personas os incluem.

## O Que É Armazenado

O Natural Nudges armazena suas configurações, toques ociosos personalizados e interesses de personas junto com o restante das configurações do servidor. Ele também registra quais toques ociosos e ativos foram executados recentemente, se alguém respondeu e para quem um toque de menção foi direcionado por 30 dias, e cada objetivo oculto por até 90 dias. Executar `/reset` restaura as configurações e remove os toques personalizados. `/export config` e `/import config` transferem as configurações e toques personalizados, mas não a lista de canais escolhidos (que pertence a um servidor específico). Sua própria preferência de Menções de Personas faz parte de suas configurações pessoais: `/reset personal config` a mantém, `/export personal config` a transfere e `/personal nuke` a apaga junto com os seus demais dados.

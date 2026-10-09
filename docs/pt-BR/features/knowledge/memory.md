---
title: "Memória"
sidebar:
  order: 1
aiGenerated: false
---

A TomoriBot possui um sistema de memória persistente para que ela se lembre de fatos entre conversas. Esta
página é sobre *o que ela sabe* (fatos, contexto, documentos). Para *como ela se comporta*
(personalidade, tom), veja [Múltiplas Personas](/pt-BR/features/chatting-personality/multiple-personas/).

## Hierarquia de Memória

Da mais permanente à mais efêmera

| Nível | O que é | Quanto tempo dura |
|---|---|---|
| Memória de longo prazo (LTM) | Fatos salvos sobre um usuário ou servidor, documentos enviados e condicionamento | Para sempre, até que alguém remova. Sobrevive a `/refresh`, reinícios, tudo |
| Memória de curto prazo (STM) | Um resumo que ela escreve para um canal, mais algumas mensagens recentes | 24 horas. Pode alcançar outros canais |
| Histórico de chat | As mensagens recentes no canal em que ela está respondendo | Apenas este canal, apenas até que saiam do alcance de `/config` > Engine > General (padrão de 80 mensagens mais recentes). `/refresh` corta imediatamente |

Quase tudo que ela parece "saber" em uma conversa é apenas o histórico de chat recente, e é por isso
que ela parece esquecer uma mensagem quando a conversa fica muito longa. **Apenas a memória de longo prazo é
permanente.** A STM fica no meio: útil para manter uma cena entre canais sem
salvar nada definitivamente, mas ainda expira.

Para ver exatamente o que é entregue a ela em qualquer turno, veja
[Por Dentro do Prompt](/pt-BR/features/knowledge/inside-the-prompt/).

## Memória de Longo Prazo
<!-- anchor: long-term-memory -->

Memórias de longo prazo são a única coisa que ela mantém permanentemente. Elas não são afetadas por
`/refresh`, por reinícios ou por mudança de canal.

### Memórias Pessoais vs. do Servidor
<!-- anchor: personal-vs-server-memories -->

Existem dois tipos de memória de longo prazo:

- Memórias pessoais (`/personal memories`): fatos sobre um usuário individual, ex.:
  "Amaori ama gatos", "prefere modo escuro", "alérgico a amendoim". Elas são vinculadas a *você*
  e acompanham você em todos os servidores, mas ela só as utiliza em conversas das quais você está participando ativamente.
- Memórias do servidor (`/memories`): informações relevantes para todo o servidor,
  ex.: "Noite de jogos é toda sexta às 20h", "proibido NSFW", "#geral é para
  avisos". Elas ficam dentro do servidor e estão sempre presentes lá.

As memórias são isoladas por persona por padrão. Cada persona (incluindo alters) mantém seu
próprio conjunto separado de memórias pessoais e do servidor, então personas diferentes significam que ela não consegue lembrar
o que outra persona aprendeu. A única exceção é uma memória pessoal adicionada a partir da página Global
em `/personal memories`, que então se aplica a todas as personas especificamente para você. Memórias
do servidor não possuem essa opção; o conjunto de memórias do servidor de cada persona sempre permanece separado, mesmo
dentro do mesmo servidor.

Use `/memories` para navegar, adicionar, editar, remover ou mover memórias do servidor para a
base de conhecimento de documentos. `/personal memories` gerencia os fatos vinculados a você.
As memórias persistem até que você as remova.

Em servidores novos, o acesso de membros não gerentes para criar, editar ou remover memórias compartilhadas do servidor está desabilitado por padrão. Membros com permissão `Gerenciar Servidor` mantêm acesso o tempo todo, e gerentes podem habilitar o acesso para outros membros através de `/moderation` Acesso de Membros.


### Como as Memórias São Salvas

Existem exatamente duas maneiras de criar uma memória de longo prazo:

1. Você salva com `/personal memories` ou `/memories`.
2. Ela salva sozinha quando decide que algo vale a pena guardar.

Quando ela salva sozinha, ela publica um embed dizendo que aprendeu algo. **Esse embed é
a confirmação.** Se você disser algo a ela e nenhum embed aparecer, nada foi salvo: ainda é
apenas histórico de chat, então ela vai perder quando a conversa avançar, e não terá
a informação em um canal diferente.

Se ela não está salvando coisas que você quer que sejam mantidas, você tem três opções, em ordem crescente de
força:

- Peça diretamente a ela para lembrar.
- Adicione um lembrete com `/config` > Engine > General, ou com qualquer um dos outros comandos que carregam
  prompts de [Por Dentro do Prompt](/pt-BR/features/knowledge/inside-the-prompt/) (`/config` > Persona > Avançado,
  `/config` > Engine > General, `/config` > Channels > Channel Overrides). Uma nota de contexto em particular fica
  posicionada mais abaixo no prompt dela, o que torna mais provável que ela atue sobre ela. Algo tão simples como *"É
  encorajado criar memórias de longo prazo para informações que valem a pena ser lembradas"* geralmente é
  suficiente. Para referenciar a ferramenta de salvar memória pelo nome sem fixar algo que pode
  variar por provedor, use a
  [macro de prompt](/pt-BR/features/capabilities/tools-and-extensions/#ferramentas-integradas) `{memory_tool}`
  em vez disso, ex.: *"Use {memory_tool} sempre que..."*.
- Salve você mesmo com `/personal memories`, que é um método garantido.

Administradores do servidor podem desativar o salvamento automático dela inteiramente com `/config` > Permissions.

### Quantas Memórias
<!-- anchor: how-many-memories -->

Por padrão, ela armazena até 100 memórias pessoais e 100 memórias do servidor. Quem faz hospedagem própria pode alterar esses valores com as variáveis .env `MAX_PERSONAL_MEMORIES`, `MAX_SERVER_MEMORIES` e
`MAX_MEMORY_LENGTH`. Aumentar o *comprimento* custa muito mais contexto do que aumentar a *quantidade*, então
prefira mais memórias curtas em vez de poucas longas.

Essas quantidades são por persona, não por usuário ou por servidor. Cada persona mantém seu próprio conjunto,
então um servidor rodando quatro personas tem quatro cotas separadas. Suas próprias memórias pessoais
globais contam contra a cota pessoal de cada persona.


### Base de Conhecimento de Documentos (RAG)
<!-- anchor: document-knowledge-base-rag -->

Administradores do servidor podem fornecer a ela documentos para referência usando RAG. Os documentos são fragmentados e armazenados como embeddings pesquisáveis; ela automaticamente recupera
  conteúdo relevante ao responder. Em servidores novos, o gerenciamento de documentos também é restrito a membros com `Gerenciar Servidor` por padrão; gerentes podem conceder acesso a membros através de `/moderation` Acesso de Membros.

Requer um modelo de embedding, configurado com `/config` > Models > Switch Models. Veja
[Provedores & Modelos](/pt-BR/features/setup-administration/providers-and-models/). A
página de Documentos em `/memories` fornece escopos por persona e por servidor, contagens de documentos
e fragmentos ao vivo, uploads, navegação de documentos e remoção:

- Envie arquivos de texto, PDF ou Markdown como conhecimento do servidor. O escopo define se ele é
  vinculado apenas a esta persona (o padrão) ou ao servidor inteiro para que todas as personas possam referenciá-lo.
- `/learn history`: extrai o histórico do canal em conhecimento pesquisável.
- Navegue pelos documentos armazenados fragmento por fragmento. Administradores do servidor podem editar fragmentos individuais, atualizar
  tags de canal dos documentos ou excluir um único fragmento sem remover o documento inteiro.
- Remova documentos armazenados ou fragmentos individuais diretamente do painel.

#### Prompts de Importação de Histórico

Ao importar o histórico de um canal com `/learn history`, a opção `prompt` muda como a TomoriBot extrai
memórias:

- Conversa extrai fatos isolados de chats normais. Ele resolve pronomes e usa timestamps absolutos quando datas ou horários são mencionados ou podem ser inferidos.
- Roleplay procura cenas, lore, relacionamentos e eventos memoráveis sem tentar preservar cada pequeno detalhe.
- In-Character extrai memórias do ponto de vista da persona selecionada, usando o prompt, atributos, memórias existentes e documentos relevantes dessa persona como contexto.

O prompt é exibido antes da importação para que você possa ajustá-lo para o canal ou cena.

Importações de histórico são armazenadas como documentos, então `/memories` também funciona com elas.

### Condicionamento
<!-- anchor: conditioning -->

`/conditioning` é uma memória por persona, por servidor, que direciona o comportamento de uma persona ao
longo do tempo. Um empurrãozinho mais leve do que um atributo completo ou prompt de sistema. Use para reforçar
como um personagem específico deve agir em um servidor específico.

Cada `/reward` ou `/punish` é contabilizado independentemente, mas só
se torna uma memória sobre a qual ela realmente age quando você fornece uma `reason`, que aparece assim no prompt dela:

```text
## Rewarded Behaviors
Here are past things Tomori did that got rewarded for. Strive to do them again:
- [Tomori was fed by Amaori. Reason: `being extra helpful today` with `cookies`] (2 times)

## Punished Behaviors
Here are past things Tomori did that got punished for. Avoid doing them again:
- [Tomori was bonked by Amaori. Reason: `spamming pings after being told to stop`]
```

Sem uma `reason`, a contagem é
registrada mas nunca aparece no prompt dela. Revise ou limpe entradas com `/conditioning remove`.

## Controlando Quando as Memórias São Ativadas

O escopo filtra tudo antes de qualquer outra coisa: uma memória do servidor só chega aos prompts
no seu próprio servidor, uma memória pessoal apenas quando aquele usuário é visível na conversa,
e ambas apenas para a persona que as possui. Dentro desse escopo, **toda memória é enviada
com todo prompt** por padrão. A marcação por tags restringe ainda mais, para que uma memória seja ativada apenas por
uma palavra-chave ou apenas em um canal. Ative com `/config` > Engine > Memory & STM.

### Tags de Palavra-chave
<!-- anchor: keyword-tags -->

- Memórias sem tags de palavra-chave estão sempre ativas (o padrão).
- Memórias com tags de palavra-chave só são ativadas quando a palavra-chave aparece no
  contexto visível.
- Use `/tool prompt snapshot` para ver quais memórias estão ativando no momento.

### Tags de Canal

- Memórias com uma tag `#canal` são ativadas apenas naquele canal.
- Tags de canal se combinam com tags de palavra-chave.
- Se você usa a base de conhecimento de documentos (RAG), tags de canal também se aplicam a documentos e
  históricos extraídos.

Em `/help`, escolha `Memória`, depois `Marcação de Memória`, para o mesmo resumo no Discord.

## Memória de Curto Prazo (STM)
<!-- anchor: short-term-memory-stm -->

A TomoriBot consegue ler facilmente as mensagens do canal atual em que está conversando, mas a STM permite que ela faça o seguinte sem salvar uma memória de longo prazo de fato:
1. Reforçar temporariamente o cenário/situação atual do canal no contexto
2. Lembrar temporariamente de conversas de outros canais/servidores

Ela só lembra de conversas das quais participou. Ela atualiza a memória de um canal quando
responde, e em nenhum outro momento, então um canal movimentado onde ninguém fala com ela não deixa
rastro.

A STM de cada canal expira após 24 horas por padrão e, se você optou por sair com `/personal config`, suas mensagens nunca entram nela de forma alguma.

### O que ela pode e não pode ver

| Onde | O que isso significa |
|---|---|
| Em um servidor | Uma memória compartilhada por canal, não uma por pessoa. Ela não está fazendo anotações sobre você individualmente. |
| Em DMs | Apenas suas. |
| Outros canais | Ela pode relembrar suas conversas recentes de alguns outros canais no mesmo servidor. |
| Canais privados | Qualquer coisa configurada com `/config` > Channels > Channel Rules permanece lá e não aparece em outro lugar. |
| Outros servidores | Nunca, a menos que você ative `/personal config` → `crossserver`. Mesmo assim, apenas *suas próprias* conversas acompanham você. |
| Cada persona | Mantém sua própria memória separada, então trocar de persona troca a memória. |

A memória de cada canal contém as últimas mensagens mais um resumo curto que ela mesma escreve
e atualiza conforme a conversa avança. Ela desaparece sozinha após algumas horas de silêncio.

### Comandos

| Comando | O que faz |
|---|---|
| `/config` > Persona > Memories | Ver o resumo que ela está mantendo para este canal |
| `/config` > Persona > Memories | Corrigir ou escrever você mesmo |
| `/personal config` / `/personal memories` | Optar pelo recall entre servidores, ou limpar o seu |
| `/refresh` | Fazer ela esquecer este canal agora |
| `/config` > Engine > Memory & STM | Com que frequência ela atualiza, e quanto detalhe ela mantém |
| `/config` > Engine > Memory & STM | Trocar o resumo por até 5 campos rotulados (*Cena atual*, *Humor*, …) |
| `/config` > Engine > Memory & STM | Reformular como ela é instruída a mantê-lo |
| `/memories` | Revisar e limpar seletivamente entradas ativas do servidor a partir de um painel de gerenciamento |
| `/config` > Permissions | Permitir que memórias de canais privados apareçam em outros lugares |
| `/config` > Permissions | Ativar ou desativar o recurso (memórias armazenadas são mantidas de qualquer forma) |

Qualquer pessoa pode executar `/config` > Persona > Memories, `/personal config` e `/personal memories`. O restante requer Gerenciar Servidor.

### Configuração da STM

Gerentes do workspace podem ajustar a memória de curto prazo em `/config` → `Comportamento` → Memory & STM.
Essas configurações se aplicam aos registros de STM ativos do workspace:

- Frequência de atualização controla quantos turnos do bot passam entre os empurrões de atualização. O intervalo permitido é 1-100.
- Modo de renderização escolhe se os valores das categorias substituem os turnos recentes ou aparecem como um resumo bruto.
- Mensagens brutas controla quantas mensagens recentes são retidas, de 1 até o máximo do canal.
- Profundidade do toque posiciona o empurrão de atualização a partir do final do contexto montado, de 0-20.
- Profundidade do conteúdo posiciona o conteúdo da STM a partir do final do contexto montado, de −1-20.

Categorias STM substitui o campo padrão Summary por até cinco campos rotulados. Insira cada campo como
`Rótulo: Descrição`; deixar todos os campos em branco restaura a categoria padrão Summary. Salvar categorias
limpa as STM ativas de canais do servidor que são incompatíveis, e o painel informa os canais afetados antes de salvar.

Prompt STM permite que gerentes substituam a descrição da ferramenta e o empurrão de atualização. Substituições em branco restauram os
valores padrão efetivos, incluindo o empurrão que considera as categorias quando elas estão habilitadas.

:::tip
Esses comandos de STM são apenas para usuários avançados; é recomendado manter as configurações padrão, a menos que você queira permitir que ela se lembre de você entre servidores com `/personal config`
:::

---

## Privacidade
Para saber exatamente o que ela armazena e como exportar ou excluir, veja
[Manuseio de Dados](/pt-BR/features/knowledge/data-handling/) e `/legal privacy-policy`. Você pode optar por sair da memória
inteiramente com `/personal config`.

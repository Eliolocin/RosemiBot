---
title: "Ajuste de Comportamento"
sidebar:
  order: 3
---

Você pode ajustar o que a TomoriBot pode fazer e como ela gera respostas em `/config`, incluindo a página de permissões. Para personalidade, veja [Múltiplas personas](/pt-BR/features/chatting-personality/multiple-personas/); para conhecimento, veja [Memória](/pt-BR/features/knowledge/memory/). Esta página cobre as configurações mais comuns.

## Capacidades: O Que Ela Tem Permissão para Fazer
<!-- anchor: capabilities-what-shes-allowed-to-do -->

`/config` > `Plugins` controla ferramentas, adições de contexto e revisão opcional de respostas:

- **`Ferramentas Disponíveis`**: geração de imagens, uso de figurinhas, criação de tópicos, gerenciamento de mensagens, bloqueio de usuários, autoaprendizagem, mensagens de voz e muito mais. Cada alternância controla a ferramenta correspondente (consulte [Ferramentas e extensões](/pt-BR/features/capabilities/tools-and-extensions/)), portanto, desativar o `Uso de Ferramenta` desativa todas elas de uma vez.
- **`Adições de Contexto`**: personalização, emojis nas respostas e reconhecimento de tempo. Eles adicionam informações ao prompt dela, para que continuem funcionando quando o `Uso de Ferramenta` estiver desativado.

O resumo automático da memória de curto prazo é alternado em `/config` > `Comportamento` > `Memória Avançada`. Quando um recurso está desativado, ela não pode executar essa ação, independentemente das solicitações do usuário.

## Revisão de respostas

Abra `/config` > `Plugins` > `Revisão de respostas` para ativar a revisão. Ela inicia desativada e se aplica a todas as personas naquele espaço de trabalho, incluindo respostas na fila e cenas geradas. Administradores do servidor alteram as configurações do servidor; seu espaço de trabalho de DM tem suas próprias configurações.

Quando ativada, Tomori segura sua resposta enquanto um revisor verifica a voz do personagem e a coerência com a cena. O revisor pode solicitar uma revisão completa. Solicitações de ferramentas também entram em revisão antes da execução; solicitações rejeitadas podem receber uma correção limitada. Ações bem-sucedidas são retidas enquanto a resposta é revisada. O texto ainda utiliza a identidade de persona usual, o tratamento de emojis e a formatação. A revisão e as correções podem aumentar o tempo de resposta e o custo de tokens; a página mostra isso em ambos os estados.

`Escolher Modelo Revisor` seleciona um modelo de texto registrado elegível. `Usar modelo de resposta atual` usa o modelo e as credenciais que realmente respondem, incluindo seu provedor pessoal ou um modelo de fallback. Um revisor fixado usa o registro e as credenciais próprios do espaço de trabalho. Autores de apenas texto e autores com o Uso de Ferramentas desativado ainda podem usar um revisor elegível. Um modelo herdado sem suporte exibe `Indisponível`; escolha um revisor com suporte para habilitar a revisão detalhada.

`Definir Prompt` edita as instruções de revisão, até 4.000 caracteres. `Usar Padrão` restaura o padrão ciente da persona. `Escolher Verificador de Regras` seleciona um verificador MCP compatível já registrado, ou `Nenhum`. Suas conclusões vão de forma privada para o revisor, que decide se são relevantes para este personagem. O verificador não tem garantia de perfil ou idioma validada nesta versão.

`Escolher Modelo de Decisões` salva um registro de decisão de `/providers`. A dispensa da revisão detalhada fica inativa até que cada modelo e rubrica de revisão tenham evidências de qualidade rotuladas. Uma seleção salva não faz solicitações de decisão pagas nesta versão. Prompts personalizados também mantêm a dispensa inativa. Limpar qualquer um dos modelos restaura a herança do revisor ou `Nenhum`; desativar mantém suas escolhas.

A revisão é uma checagem de qualidade opcional. Uma recusa, modelo indisponível, tempo limite esgotado, evidência incompleta ou orçamento de revisão esgotado permite que uma resposta válida ou solicitação de ferramenta independente continue sob as regras normais do aplicativo. Ações rejeitadas anteriormente permanecem bloqueadas. `/kill` e interrupções de acompanhamento descartam o texto retido. Arquivos, voz e postagens remotas recebem revisão de seus argumentos de ferramentas propostos; suas mídias geradas ficam fora da revisão do texto retido. Geração oculta e representação de usuário mantêm seus caminhos existentes. O julgamento do provedor e a utilidade do verificador ainda precisam de avaliação humana. Veja [tratamento de dados de revisão](/pt-BR/features/knowledge/data-handling/#response-drafting-selections).

## Expressões
<!-- anchor: expressions -->

As expressões permitem que suas personas reajam com mais do que palavras. Ela pode usar os emojis e figurinhas do servidor, além de reações que você escolher: um GIF favorito, uma imagem de uma piada interna ou um link para qualquer site. Descreva quando cada expressão combina com a conversa, e ela a enviará no momento certo.

Membros com a permissão `Gerenciar servidor` podem abrir `/expressions manage` para navegar pelas abas `Emojis`, `Figurinhas` e `Personalizadas`.

### Emojis e figurinhas do servidor

Execute `/expressions initialize` para que ela aprenda quando usar cada emoji e figurinha. Os que forem adicionados depois aparecem como não inicializados em `/expressions manage` até você executar o comando novamente. Selecione um e escolha `Editar` para mudar sua descrição e emoção, ou `Limpar Informações` para apagá-las.

### Expressões personalizadas

Na aba `Personalizadas`, abra o menu e escolha `+ Adicionar expressão personalizada`. Dê um nome, uma descrição de quando usar, uma emoção e um link ou arquivo. Ela usa a descrição para decidir quando enviar a expressão, então seja específico: "quando o chat perder a linha" funciona melhor do que "engraçado".

O link pode apontar para qualquer coisa. Ela o publica como foi salvo, e o Discord mostra o conteúdo como faria com qualquer link: um GIF de um site como Tenor é reproduzido como GIF, um link de imagem mostra a imagem e um site mostra seu cartão de prévia. Isso permite usar links em piadas, como o site de um hospital quando o chat perder a linha. Os links precisam começar com `https://`.

Os arquivos podem ser PNG, JPEG, WebP, GIF ou MP4, de até 10 MB.

Cada servidor pode ter até 20 expressões personalizadas por padrão, compartilhadas entre todas as personas. Tanto arquivos quanto links contam; emojis e figurinhas nativos não. No limite, exclua uma expressão antes de adicionar outra. Expressões existentes ainda podem ser usadas e editadas. Bots auto-hospedados podem alterar esse limite em suas configurações de ambiente.

Todas as personas podem usar uma nova expressão personalizada. Para limitar o acesso a personas específicas, selecione a expressão e use `Adicionar Persona`. Remover a última persona da lista libera o acesso para todas novamente.

### Como ela usa as expressões

Com o uso de figurinhas ativado em `/config` > `Plugins`, ela envia no máximo uma expressão por resposta, em uma mensagem própria antes, durante ou depois do texto. Ela não as usa em [canais de roleplay](/pt-BR/features/chatting-personality/chatting-and-triggers/#roleplay-channels). `/expressions manage` mostra quantas vezes as personas usaram cada expressão.

## Ajuste de Geração
<!-- anchor: generation-tuning -->

- `/config` > `Modelos` > `Samplers de Texto e Parâmetros`: parâmetros de amostragem como temperatura e top-p. Temperatura mais alta produz mais variedade.
- `/config` > `Comportamento` > `Comportamento Geral`: grau humanizador de resposta. Ajuste a casualidade com que ela envia mensagens de texto. A configuração se aplica a todo o servidor por padrão ou a uma pessoa individual.
- `/config` > `Comportamento` > `Comportamento Geral`: limite de histórico de mensagens. Aumente-o para um contexto de conversação mais profundo ou diminua-o para economizar tokens.

## Prompt de Sistema
<!-- anchor: system-prompt -->

O prompt do sistema fica acima da persona e molda o `Comportamento Geral`:

- `/config` > `Comportamento` > `Comportamento Geral`: defina uma instrução de sistema personalizada (até 16.000 caracteres).
- `/config` > `Comportamento` > `Comportamento Geral`: escolha entre os prompts predefinidos do sistema.
- `/config` > `Comportamento` > `Comportamento Geral`: redefinir para o padrão. A confirmação mostra o prompt anterior para que você possa restaurá-lo se for apagado acidentalmente.

Quando uma [predefinição SillyTavern](/pt-BR/features/integrations/sillytavern-support/) está ativa, o prompt do sistema substituto integrado é substituído, mas um prompt personalizado definido aqui ainda é enviado.

## Saída Sem Censura
<!-- anchor: uncensored-output -->

TomoriBot não possui filtro de conteúdo próprio: ela não adiciona nenhuma camada de moderação ao modelo e responde com tudo o que o provedor gera. `/nsfw jailbreaks` não habilita recursos ocultos de bot; ele funciona com filtros do lado do provedor que são mais rígidos do que o desejado.

Alterna três técnicas independentes (todas desativadas por padrão):

- **Injeção imediata**: adiciona um bloco de instruções ao contexto para evitar recusas desnecessárias no modelo.
- **Espaços Unicode**: troca espaços normais por espaços Unicode semelhantes para que os filtros de palavras-chave não sejam acionados em frases, aplicadas tanto ao prompt quanto à resposta dela.
- **Sanitizar**: ofusca palavras confidenciais pelo mesmo motivo, tanto em solicitações quanto em respostas.

Nada disso muda o que o modelo pode fazer; eles apenas reduzem a frequência com que um filtro do provedor bloqueia a saída normal. Algumas dessas opções têm restrição de idade; consulte [Comandos com restrição de idade](/pt-BR/features/setup-administration/age-restricted-commands/).

## Aparência & Hora

- `/config` > `Persona` > `Identidade e Personalidade`: como ela se autodenomina.
- `/config` > `Comportamento` > `Comportamento Geral`: o fuso horário do servidor, usado para respostas com reconhecimento de tempo e tarefas agendadas.

---

Procurando controles administrativos e de custos (cotas, listas de permissões, BYOK) em vez de comportamento? Eles vivem em [Moderação de Servidor](/pt-BR/features/setup-administration/server-moderation/).

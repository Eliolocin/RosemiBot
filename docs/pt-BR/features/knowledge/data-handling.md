---
title: "Manuseio de Dados"
sidebar:
  order: 4
---

Exporte, faça backup, importe ou exclua suas configurações, memórias e personas usando comandos de barra Discord. Para termos de serviço e detalhes de privacidade, consulte `/legal terms-of-service` e `/legal privacy-policy`.

:::note
Esta página aborda os controles do usuário no Discord. Em instâncias auto-hospedadas, os backups e restaurações completos do banco de dados são operações do lado do host; consulte [Manutenção e backups](/pt-BR/self-hosting/maintenance/).
:::

## O que ela armazena

### Dados armazenados

- Servidor e memórias pessoais
- Perfis de personalidade, características e exemplos de diálogo
- Definições de configuração do servidor
- Chaves API do provedor criptografado
- Metadados de expressão, regras de acesso de persona e mídia de expressão carregada

### Não armazenado

- Histórico de mensagens Discord (as mensagens não são arquivadas em um log de mensagens persistente)

### Enviado para seu provedor de IA

Sempre que acionado, TomoriBot busca mensagens recentes no canal junto com memórias relevantes como contexto para o modelo. Ela não lê nem processa mensagens fora desses gatilhos.

:::note
O provedor de IA escolhido (Google, OpenRouter, NovelAI,…) processa mensagens de acordo com sua própria política de privacidade. Evite compartilhar credenciais pessoais confidenciais ou dados confidenciais.
:::

### Seleções de Revisão de respostas
<!-- anchor: response-drafting-selections -->

`/config` > `Plugins` > `Revisão de respostas` armazena as escolhas de revisor, modelo de decisões, verificador de regras opcional e prompt para o espaço de trabalho. Quando ativada, as respostas e as solicitações reais de ferramentas são revisadas antes de serem enviadas ou executadas. Um verificador opcional recebe o texto da resposta pendente e envia conclusões consultivas apenas ao revisor. A dispensa por decisão permanece inativa até que haja validação rotulada, e as seleções de decisões salvas não fazem chamadas pagas enquanto faltar calibração. Desativar mantém respostas e ferramentas normais sem solicitações de revisão.

O revisor selecionado recebe a resposta pendente e o contexto já admitido para seu autor: instruções de persona, diálogos representativos, gatilho e alvo da resposta, conversa relevante, relacionamentos visíveis entre participantes, memórias, documentos e resultados reais de ferramentas. Para uma solicitação de ferramenta, o revisor também recebe seu alvo exato e argumentos, incluindo qualquer texto de mensagem, e as definições de ferramentas disponíveis. A revisão não adiciona consulta a perfis privados. Credenciais e argumentos de autenticação são ocultados. As evidências necessárias precisam caber; cobertura incompleta de mídia, argumentos de ferramentas ocultos ou limites de modelo ausentes tornam a revisão indisponível. Uma revisão indisponível mantém as verificações normais do aplicativo; uma ação rejeitada anteriormente permanece bloqueada.

A herança usa o modelo e as credenciais que realmente respondem, incluindo roteamento pessoal, rotação de chaves, substituições e fallback. Um revisor fixado usa o registro do próprio espaço de trabalho e a chave do provedor salva. Seu provedor tem sua própria política de privacidade. Escolhê-lo mantém o provedor de respostas principal inalterado. Respostas pendentes e pacotes de correção duram apenas durante o turno. Apenas diálogos aceitos pelo Discord entram na memória de conversa; a contabilidade de tokens inclui tentativas reais sem sucesso quando o provedor relata o uso. Os diagnósticos contêm metadados e contagens, sem rascunhos, evidências, correções, corpos de resposta do provedor ou chaves.

As exportações de configuração incluem essas definições sem chaves de API ou tokens de autenticação MCP. As importações preservam referências de modelo e verificador apenas quando disponíveis no espaço de trabalho receptor. Registre um equivalente local ou limpe seleções indisponíveis antes de importar. A redefinição de configuração do servidor restaura o estado desativado, herança de revisor, nenhum modelo de decisões, o prompt padrão e nenhum verificador.

## Exporte Seus Dados

Os dados exportáveis são entregues aos seus DMs como um arquivo JSON:

- `/export config`: valores de configuração do servidor (exclui chaves e credenciais API).
- `/export personal config`: configurações de perfil pessoal (privacidade, tags de aparência, nomenclatura).
- `/export memories`: memórias do servidor, com escopo para a persona principal, uma persona ou todas as personas.
- `/export personal memories`: memórias pessoais, com escopo global ou individual.
- `/persona export`: definições completas de personalidade.

A mídia de expressão carregada é armazenada no host do servidor e está fora dessas exportações JSON. Os auto-hosters devem fazer backup do armazenamento de banco de dados e dos ativos de mídia juntos; consulte [backups de mídia personalizados](/pt-BR/self-hosting/safe-migration/#custom-expression-media-backups).

## Importe Seus Dados

Anexe um arquivo exportado para restaurá-lo:

- `/import config`: configuração do servidor (requer Gerenciar Servidor). Escolha quais seções aplicar.
- `/import personal config`: configurações pessoais. Escolha quais seções detectadas serão aplicadas.
- `/import memories`: memórias do servidor (requer Gerenciar Servidor). Mesclar ou substituir e mapear personas.
- `/import personal memories`: memórias pessoais. Mesclar ou substituir e mapear personas.
- `/persona import`: restaurar uma persona. Também importa cartões SillyTavern PNG, cartões JSON e arquivos `.charx` (consulte [Suporte SillyTavern](/pt-BR/features/integrations/sillytavern-support/)).

## Exclua Seus Dados

Estas ações removem ou redefinem permanentemente os dados armazenados:

- `/personal memories`: gerencie ou remova memórias pessoais.
- `/memories`: gerencia ou remove memórias do servidor (requer Gerenciar Servidor).
- `/personal nuke`: exclui permanentemente todos os dados pessoais dos servidores.
- `/nuke`: limpa os dados do servidor, incluindo expressões personalizadas e regras de acesso pessoal. Defina `preserve_personas: true` para manter personas enquanto remove expressões e mídia personalizadas.
- `/reset config`: restaura a configuração do servidor para os padrões do banco de dados.
  - **Preserva**: atribuições de modelos ativos, chaves API, endpoints personalizados, personas, memórias de servidor e integrações.
  - **Limpas**: substituições de canais, regras de acionamento automático, listas negras de usuários e listas brancas de canais.
  - Requer a permissão Gerenciar Servidor em servidores; também disponível em DMs.
- `/reset personal config`: restaura as configurações de perfil pessoal e destaques do canal para os padrões.
  - **Preserva**: identidade do usuário, memórias pessoais, chaves API do provedor salvas, endpoints personalizados e tarefas agendadas.
  - **Clears**: substituições de apelidos, tags de aparência, pronomes, estilo de endereçamento e destaques do canal.
  - Disponível para todos os usuários em servidores e DMs.

Para tabelas exatas de banco de dados e listas de colunas preservadas, consulte [arquitetura de esquema de banco de dados](/en/architecture/subsystems/database-schema/#reset-domain-classifications).

## Optando por Sair

- `/personal config`: controle sua visibilidade, até a invisibilidade total (optando por sair do contexto de memória).
- `/config` > `Permissões`: os gerenciadores de servidores podem desativar os recursos de autoaprendizado e memória.

Consulte [Memória](/pt-BR/features/knowledge/memory/) para gerenciamento diário de memória.

---
title: "Ferramentas & Extensões"
sidebar:
  order: 1
---

Além do bate-papo, o TomoriBot pode chamar ferramentas para pesquisar na web, ler documentos, gerar mídia, definir lembretes e interagir com mensagens do Discord. Ela decide quando usá-los com base na conversa. Esta página aborda ferramentas integradas, como estendê-la com servidores MCP e como manter os prompts simples com o modo de ferramenta deliberada.

Aqui estão alguns exemplos de quais ferramentas permitem uma conversa:

- **1. Verificador de bem-estar**
  ```text
  Every few hours, do a mandatory wellness check on @bau_h.
  Ask them how they feel right now and if they've taken a break from coding recently.
  Track their emotional state over time with {memory_tool} and/or {memory_update_tool} to report back to them later.
  ```
- **2. Notícias semanais de Yuri**
  ```text
  Every Friday, compile the week's notable yuri manga chapters, anime episodes, and community fanart drops using {web_search_tool}.
  Present findings with {voice_message_tool} in a seductive ASMR voice.
  ```
- **3. Polícia do Sono**
  ```text
  If you notice through {message_metadata_tool} that someone is chatting past 2 AM, use {voice_message_tool} to send them a threateningly calm ASMR lullaby telling them to go to bed.
  If they keep talking 10 minutes later, use {manage_message_tool} to delete their message for their own good and remind them that sleep deprivation is a leading cause of their issues.
  ```

## Ferramentas Integradas
<!-- anchor: built-in-tools -->

As ferramentas dependem do provedor ativo e da chamada de ferramenta de suporte do modelo. Muitos são protegidos por um sinalizador de recurso (`/config` > `Permissões`), uma permissão Discord, um recurso de modelo ou uma chave API opcional.

| Ferramenta | Macro de prompt | Requer | O que isso faz |
|---|---|---|---|
| Revise os recursos | `{capabilities_tool}` | - | Verifique as habilidades, comandos ou configurações atuais do bate-papo antes de responder. |
| Criar/atualizar memória de longo prazo | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | Salve ou substitua um fato de servidor estável ou preferência do usuário. |
| Atualizar a memória de curto prazo | `{short_term_memory_tool}` | (não em NovelAI) | Salve a memória de trabalho temporária para o canal ou arco de história atual. |
| Criar/atualizar tarefa | `{task_tool}` / `{task_update_tool}` | - | Agende ou edite lembretes e tarefas próprias (consulte [Tarefas agendadas](/pt-BR/features/capabilities/scheduled-tasks/)). |
| Mensagem entre canais | `{cross_channel_tool}` | (não em NovelAI) | Atuar em outro canal ou thread, com report-back opcional. |
| Criar tópico | `{create_thread_tool}` | `thread_creation_enabled` + permissões de thread | Abra um tópico público e poste sua mensagem inicial. |
| Selecione o figurinha | `{sticker_tool}` | `sticker_usage_enabled` | Adicione um figurinha de servidor correspondente ou uma expressão personalizada a uma resposta. |
| Gerenciar mensagem | `{manage_message_tool}` | `manage_message_enabled` | Fixe, edite ou exclua mensagens recentes (o PIN precisa de `Gerenciar mensagens`). |
| Bloquear/desbloquear usuário | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | Silenciar/bloquear um usuário com escopo pessoal (não toca nas memórias). |
| Interaja com a mensagem recente | `{message_interaction_tool}` | - | Reaja ou envie uma resposta curta a uma mensagem recente. |
| Espiar a foto do perfil | `{profile_picture_tool}` | modelo de visão ou `vision_llm` | Inspecione o avatar de um usuário ou da persona. |
| Ler documento | `{document_tool}` | - | Extraia texto de um PDF ou qualquer arquivo de texto UTF-8: código-fonte (`.py`/`.ts`/`.rs`/…), `.json`, `.yaml`, `.md`, `.txt` e qualquer anexo não binário. |
| Revelar metadados de mensagens | `{message_metadata_tool}` | - | Anote curvas recentes com alças e carimbos de data e hora para uma segmentação precisa. |
| Processar vídeo do YouTube | `{youtube_tool}` | modelo com suporte de vídeo | Analise um link específico do YouTube sob demanda. |
| Analisar imagem | `{image_analysis_tool}` | configurado `vision_llm` | Delegue a compreensão da imagem a um modelo de visão separado. |
| Gerar imagem/imagem de anime | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + provedor capaz | Gere ou edite imagens (consulte [Geração de mídia](/pt-BR/features/capabilities/media-generation/)). |
| Gerar mensagem de voz | `{voice_message_tool}` | Tecla ElevenLabs + voz pessoal + `voice_message_enabled` | Envie uma resposta de voz falada Discord. |

:::note[For prompt authors]
Ao personalizar o prompt do sistema ou as instruções pessoais, faça referência às ferramentas por suas **macros de prompt** da tabela acima, em vez de codificar os nomes das ferramentas, porque as macros se expandem para os nomes corretos no momento da montagem do contexto e degradam normalmente quando uma ferramenta não está disponível. `{pin_tool}` e `{timestamp_refresh_tool}` ainda funcionam como aliases de compatibilidade para `{manage_message_tool}` e `{message_metadata_tool}`. As ferramentas de pesquisa na web e URL abaixo também possuem macros: `{web_search_tool}`, `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}`, `{url_fetch_tool}` e `{url_metadata_tool}`. Eles são resolvidos dinamicamente para o melhor mecanismo disponível, incluindo substituições de guilda MCP.
:::

### Blocos de Prompt Condicionais

O texto do prompt que suporta as macros de ferramentas acima também suporta condicionais com escopo definido:

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

Use `capability:<name>` para uma configuração TomoriBot habilitada ou `tool:<function_name>` quando o texto deve aparecer apenas se essa ferramenta exata estiver disponível para o provedor e modelo ativos. Use `tool_family:url_fetch` quando o leitor de URL incluído ou um substituto de guilda MCP estiver disponível. Prefixe uma condição com `!` para invertê-la. Os blocos podem ser aninhados e conter um `{{else}}`; expressões gerais `and`/`or` não são suportadas.

Os nomes de recursos suportados são `tool_use`, `self_teaching`, `personal_memories`, `emoji_usage`, `sticker_usage`, `web_search`, `manage_message`, `thread_creation`, `image_generation`, `video_generation`, `voice_message`, `user_blocking`, `short_term_memory` e `time_awareness`.

As condições da ferramenta refletem o suporte do provedor/modelo, a configuração do servidor, os back-ends configurados, as substituições do MCP e a lista de permissões atual do modo de ferramenta deliberada. Eles não ignoram nem prevêem verificações de permissão Discord realizadas quando uma ferramenta é executada. Nomes de recursos desconhecidos são avaliados como falsos e registrados; blocos malformados são omitidos. Mensagens brutas de chat, resultados de modelos e resultados de ferramentas nunca são tratados como modelos condicionais.

## Pesquisa na Web & Leitura de URLs
<!-- anchor: web-search--url-reading -->

O modelo vê uma única ferramenta `web_search(query, category)` unificada. Atrás dele, um despachante encaminha cada chamada através de uma cadeia de mecanismos e retorna o primeiro sucesso:

Brave → SearXNG → DuckDuckGo

- **Brave** é executado primeiro quando uma chave Brave API é configurada (configure-a com `/providers`); adiciona pesquisa de imagens, vídeos e notícias. ⚠️ Defina um limite de uso de US$ 5 no painel do Brave para evitar cobranças surpresa.
- O DuckDuckGo é o padrão quando nenhuma chave está configurada. Ele abrange apenas pesquisas de texto. Quando o DuckDuckGo limita a taxa do bot ou exibe uma verificação de bot, a pesquisa falha e ela publica um aviso sugerindo o Brave.
- SearXNG e Crawl4AI são servidores auto-hospedados opcionais que adicionam mais categorias e buscas de páginas renderizadas pelo navegador; consulte [Auto-hospedagem](/pt-BR/self-hosting/).

Para ler uma página específica, ela usa `fetch_url`. Não está disponível em NovelAI.

## Servidores MCP
<!-- anchor: mcp-servers -->

Servidores [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) estendem as capacidades dela com ferramentas externas que você mesmo registra.

### Adicionando um MCP online

Use o endpoint HTTPS direto de um provedor compatível com MCP Streamable HTTP ou SSE:

1. Obtenha o endpoint MCP e os requisitos de autenticação com o provedor.
2. Abra `/config` > Plugins > Servidores MCP e escolha `+ Adicionar MCP`.
3. Cole o endpoint em `URL`, insira o token Bearer em `Token de Autenticação` se necessário e escolha o `Tipo de Servidor` desejado. **Propósito Geral** fica selecionado por padrão.

### Adicionando um servidor Smithery

Servidores hospedados no Smithery têm endereços terminados em `.run.tools`. Cole esse endereço em `URL` e sua chave de API do Smithery em `Token de Autenticação`. O TomoriBot envia a chave apenas para a API do Smithery em `api.smithery.ai`, nunca para o endereço do servidor em si. O Smithery então encaminha cada chamada de ferramenta para o servidor, portanto, o Smithery vê todas as solicitações e resultados de ferramentas. Os registros salvos antes do retorno deste suporte voltam a funcionar sem alterações.

O TomoriBot mantém uma conexão do Smithery por endereço de servidor no primeiro namespace da sua conta do Smithery (o Smithery cria um namespace se você não tiver nenhum) e a reutiliza, evitando o acúmulo de conexões ao adicionar, testar e reconectar. O TomoriBot nunca exclui conexões. Versões anteriores do TomoriBot criavam uma nova conexão a cada reconexão, então sua conta pode ter várias conexões não utilizadas para o mesmo servidor; você pode removê-las no painel do Smithery.

Alguns servidores exigem que você faça login no serviço que eles encapsulam. Tentar adicionar um servidor desse tipo falhará com uma mensagem informando que a autorização é necessária, e o TomoriBot nunca exibe o link de login no Discord. Abra o painel do Smithery, conclua o login para a conexão cujo nome começa com `tomoribot-` e adicione o servidor novamente. A conexão e a listagem de ferramentas devem ser concluídas em até 15 segundos.

Desativar um registro selecionado para pesquisa ou leitura de URL restaura a seleção integrada do TomoriBot; mantê-lo ativado impede a troca automática. Os nomes de ferramentas salvos descrevem a última descoberta realizada, portanto, não comprovam que a conexão ainda esteja funcionando.

As respostas são interrompidas em 8 MiB durante o download. Catálogos grandes de ferramentas ou resultados volumosos podem deixar um plugin indisponível ou fazer uma chamada de ferramenta falhar. Para conexões SSE, o limite abrange todo o fluxo de resposta, incluindo atualizações sucessivas. Solicite ao provedor resultados menores, paginação ou links de arquivos quando uma ferramenta retornar documentos grandes ou mídias incorporadas.

Se um servidor não precisar de autenticação, deixe `Token de Autenticação` em branco. Seu token de autenticação é criptografado em repouso e nunca é exibido novamente. Abra a mesma página de Configuração para inspecionar o estado configurado, ativar ou desativar um servidor, ou remover um com confirmação explícita. A remoção o desconecta imediatamente e libera um slot. Cada linha salva também mostra os nomes das ferramentas delimitadas de sua última descoberta bem-sucedida. `Nenhuma descoberta` é um resultado conhecido de zero ferramentas; `Descoberta desconhecida` identifica uma linha legada ou um servidor que ainda não possui um snapshot bem-sucedido. Abrir a interface de gerenciamento de MCP apenas lê os metadados salvos e não entra em contato com o servidor remoto.

### Servidores MCP Locais

Servidores MCP locais são suportados apenas em instâncias de hospedagem própria: o bot público hospedado exige HTTPS e bloqueia endereços locais/privados. Se você executa sua própria instância, veja [Configuração: Servidor MCP Local](/pt-BR/self-hosting/local-endpoints/setup-local-mcp/).

:::danger[Adicione apenas servidores MCP em que você confia]
Um servidor MCP malicioso pode injetar prompts nela com instruções ocultas, exfiltrar dados que os usuários passam para suas ferramentas ou retornar resultados prejudiciais/falsos que ela retransmitirá para o seu servidor. Trate servidores MCP como extensões de navegador; em caso de dúvida, não adicione. Sempre revise as ferramentas descritas de um MCP antes de adicioná-lo.
:::

## Modo de Ferramenta Deliberada
<!-- anchor: deliberate-tool-mode -->

Cada ferramenta declarada aumenta o tamanho do prompt. O `Modo de Ferramenta Deliberado` mantém as declarações fora dos turnos normais de chat, a menos que a mensagem precise de uma ferramenta de tarefa; isso reduz o prompt e ajuda modelos pequenos ou locais a responder mais rápido. A seleção de figurinhas continua disponível para expressão espontânea quando o uso de figurinhas e ferramentas está ativado e o provedor oferece suporte. As restrições de DM, imitação e roleplay continuam valendo. Desative o uso de figurinhas para impedir respostas com figurinhas. Quando chega o prazo de atualização da memória de curto prazo, sua ferramenta de manutenção também fica disponível sem um pedido do usuário.

- Ela primeiro verifica a mensagem quanto à intenção da ferramenta. Os gatilhos integrados cobrem solicitações comuns (lembretes, pesquisa na web, atualizações de memória, mensagens entre canais, geração de imagem/vídeo/voz, análise de mídia, criação de threads, ações de mensagens). Perguntas sobre seu modelo atual, ferramentas, configurações ou por que um recurso não está disponível expõem a revisão de recursos e o acesso à documentação oficial juntos. O texto de acompanhamento também funciona, como “faça isso de novo, mas com mais raiva” após uma solicitação de mensagem de voz.
- Os gerenciadores de servidor podem adicionar frases de acionamento personalizadas literais com `/server trigger add`, por exemplo, mapeando `pic`, `img` ou `pfp` para geração de imagem.
- Os gatilhos integrados leem frases em inglês. Outros idiomas alcançam as mesmas ferramentas através da lista de palavras-chave de cada idioma. A lista de todos os idiomas enviados é verificada em cada mensagem, seja qual for a configuração do idioma, portanto, um servidor bilíngue funciona nos dois idiomas.
- Frases personalizadas em japonês, chinês ou coreano também correspondem a palavras mais longas, porque esses idiomas não separam as palavras com espaços. Uma frase que termina em `*` corresponde a qualquer palavra que comece com ela: `remind*` abrange `reminder` e `reminding`.

### Controles

- `/server dtm`: gerenciadores de servidores alternam.
- `/personal config`: os próprios usuários o substituem.
- Com um canal de registro de pensamentos configurado (`/server thought-logs`), as chamadas de ferramenta no modo deliberado bem-sucedidas são registradas lá junto com o acionador que expôs a ferramenta.

O Modo Deliberado de Ferramentas apenas decide quais ferramentas serão *mostradas* ao modelo, mas o modelo ainda precisa escolher chamar uma. Em `/help`, escolha `Comportamento` e depois `Modo de Ferramenta Deliberado` para o resumo Discord.

:::note
`Modo de Ferramenta Deliberado` (esta seção) não está relacionado a `Modo de Gatilho Deliberado`, que controla como *ela* é acionada; consulte [Bate-papo e acionadores](/pt-BR/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode). Ambos são abreviados como "DTM" em Discord.
:::

## Atualizações Estruturadas de Informações do Usuário

TomoriBot pode atualizar automaticamente seu perfil e preferências de nomenclatura de persona quando você pergunta diretamente no chat (como "me chame de capitão" ou "meus pronomes são eles/eles"):

| Preferência | Escopo | Efeito |
|---|---|---|
| Apelido, prefixo, sufixo | Por pessoa | Somente a persona ativa se dirige a você com esse nome ou cargo. |
| Identidade de gênero, pronomes, estilo de endereçamento, fuso horário | Global | Cada persona usa o mesmo valor em todos os servidores. |

- **Remover um título**: pedir a ela para parar de usar um título (como “pare de me chamar de Mestre”) o libera para aquela persona.
- **Privacidade**: níveis de privacidade restritivos bloqueiam novas adições e edições, ao mesmo tempo que permitem limpar os dados existentes.
- **Permissões**: os gerenciadores de servidores podem alternar atualizações automáticas usando `Atualizações de Info do Usuário` em `/config` > `Permissões`. Você sempre pode editar seu perfil manualmente com `/personal config`.

Para esquemas de parâmetros de ferramentas e layout de armazenamento de banco de dados, consulte [arquitetura do sistema de ferramentas](/en/architecture/subsystems/tool-system/#structured-user-info-updates).

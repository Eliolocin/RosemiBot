---
title: "Personalização"
sidebar:
  order: 3
---

TomoriBot pode lembrar detalhes pessoais, nomes personalizados e credenciais de provedor de IA que acompanham você em todos os servidores que você compartilha com ela. Você pode gerenciar essas configurações com os comandos `/personal` sem alterar nenhuma configuração compartilhada do servidor.

## Memórias Pessoais

Fatos que ela aprende ou lembra sobre você o seguem entre os servidores. O gerenciamento deles (adicionar, remover, exportar ou limpar contexto) é abordado na página [Memória](/pt-BR/features/knowledge/memory/#personal-vs-server-memories).

## Perfil e Nomes com Reconhecimento de Persona

Configure como TomoriBot endereça e se refere a você nos servidores em `/personal config` > `Perfil`.

### Detalhes do perfil

Em `/personal config` > `Perfil` > Preferências Gerais, a seção **Sobre você** armazena três preferências independentes e opcionais:

- **Identidade de gênero**: sua descrição de gênero.
- **Pronomes**: seus pronomes preferidos.
- **Estilo de endereçamento**: escolhe a variante de nomenclatura masculina, feminina ou neutra da persona. Neutro é o padrão.

TomoriBot nunca infere um campo de outro. Os campos em branco são limpos e omitidos do contexto de prompt. Os campos de perfil bruto são expostos à IA somente quando seu nível de privacidade está definido como `Nenhum`.

A seção **Interface** permite definir o deslocamento numérico UTC (-12 a +14) ou corresponder ao padrão do servidor. TomoriBot armazena apenas esse deslocamento numérico, nunca uma localização geográfica ou fuso horário da IANA.

### Herança de nomenclatura

Em `/personal config` > `Perfil` > Preferências Gerais ou Preferências específicas da Persona, você pode definir um apelido, prefixo ou sufixo:

- **Escopo global**: aplica-se a todas as personas, a menos que seja substituído.
- **Escopo da persona**: aplica-se apenas a uma linhagem de persona específica nos servidores.

Os nomes são resolvidos do mais específico para o menos específico:

1. **Preferência de persona**: apelido personalizado definido para essa persona.
2. **Preferência global**: apelido personalizado definido para todas as personas.
3. **Nome de exibição Discord**: o nome de exibição do seu servidor ativo.

Deixar seu apelido global em branco permite que TomoriBot siga seu nome de exibição Discord automaticamente, incluindo alterações futuras. Salvar um apelido global personalizado congela esse valor até que você o apague.

Prefixos e sufixos herdam da mesma maneira. Por exemplo, um prefixo de um nível e um sufixo de outro podem ser combinados em `Master Mirri-san`. Para impedir que uma persona use um título que ela mesma gera, pergunte diretamente no chat (“pare de me chamar de Mestre”); que suprime o título dessa persona, deixando outras personas intocadas.

Os gerenciadores de servidor configuram padrões de personalidade para todo o servidor em `/config` > `Persona` > `Identidade e Personalidade`. Quando o recurso `Atualizações de Info do Usuário` está ativado, as personas também podem atualizar os detalhes do seu perfil quando solicitado durante a conversa.

## Seus próprios provedores
<!-- anchor: your-own-providers -->

Os provedores pessoais permitem que suas próprias solicitações usem suas próprias chaves e modelos API em vez dos padrões do servidor. Isso é traga sua própria chave (BYOK) no nível do usuário individual.

Dois escopos estão disponíveis:

- **Padrão do servidor**: credenciais e modelos compartilhados configurados em `/providers` e `/model` pelos gerenciadores de servidores. Aplica-se a todos no servidor.
- **Substituição pessoal**: credenciais e modelos configurados em `/personal providers` e `/personal config`. Aplica-se apenas às suas solicitações em todos os servidores onde você usa TomoriBot.

### Configurar

1. Execute `/personal providers` para salvar um provedor (sua chave API é criptografada). Salvar um provedor permite que seu texto pessoal seja substituído imediatamente pelo modelo padrão desse provedor.
2. Execute `/personal config` > `Modelos` > Alternar modelos para selecionar um modelo diferente para sua substituição de texto pessoal.
3. Volte para `/personal providers` sempre que precisar atualizar credenciais, gerenciar endpoints personalizados ou adicionar registros de modelos personalizados.

Mudar um recurso do padrão do servidor para uma substituição pessoal mostra um prompt de confirmação antes de salvar. A atualização de credenciais de um provedor que você já usa ignora a confirmação.

O atributo de registros de pensamentos muda usando sua chave pessoal para você. Você pode ajustar os parâmetros do seu modelo pessoal (temperatura, top-p, limites de token) em `/personal config` > `Modelos` > Amostradores e parâmetros. Para registrar endpoints personalizados privados, consulte [Endpoints personalizados](/pt-BR/features/setup-administration/providers-and-models/#custom-endpoints).

### Tratamento de erros e fallback

Se uma solicitação falhar ao usar seu provedor pessoal, as dicas de erro direcionarão você para seus comandos pessoais (`/personal providers`, `/personal config`) em vez das configurações do servidor.

Quando cada modelo em sua rota de texto pessoal falha, TomoriBot pode retornar ao modelo de texto padrão do servidor em vez de falhar silenciosamente. Os substitutos do servidor são executados com base nas credenciais do servidor, são contabilizados na cota de texto do servidor e exibem um botão `Secundário Usado` com detalhes.

Você pode desativar o fallback do servidor em `/personal config` > `Modelos` > Fallbacks em `Fallback com o Modelo do Servidor`. A configuração abrange toda a conta e está habilitada por padrão.

:::note[BYOK-required servers]
Um servidor pode exigir que os membros forneçam suas próprias chaves API por meio do modo Usuário BYOK ([Moderação de Servidor](/pt-BR/features/setup-administration/server-moderation/#user-byok-bring-your-own-key)). Quando ativadas, suas mensagens exigem um provedor pessoal configurado antes que TomoriBot responda e as rotas pessoais com falha não retornem às credenciais do servidor.
:::

## Outras Configurações Pessoais

Use `/personal config` para personalizar recursos adicionais:

- **Aparência** (`Perfil` > `Aparência`): salve tags de aparência no estilo booru usadas sempre que uma [geração de imagem](/pt-BR/features/capabilities/media-generation/image-generation/#tag-customization) fizer referência a você. Envie uma caixa vazia para limpá-los.
- **Controles de privacidade** (`Privacidade` > `Controles de Privacidade`): escolha seu nível de visibilidade (`Nenhum`, `Parcial` ou `Completo`) ou alterne o compartilhamento de memória de curto prazo entre servidores.
- **Modos de resposta** (`Avançado` > `Modos de Resposta`): alterne sua substituição pessoal para [Modo de disparo deliberado](/pt-BR/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode).
- **Personificação** (`Avançado` > `Personificação`): defina um prompt reutilizável usado quando alguém invoca `/impersonate user` para você.

## Destaque pessoal
<!-- anchor: personal-spotlight -->

O Personal Spotlight restringe quais personas você pode acionar em um canal específico e, opcionalmente, atribui uma persona substituta de acionamento automático para suas mensagens nesse canal. O escopo é seu e de um canal: não afeta mais ninguém no servidor.

Para configurar um Spotlight em `/personal config` > `Avançado` > Spotlight Pessoal:

1. Selecione uma duração em horas (insira `0` para mantê-lo ativo até ser removido manualmente).
2. Escolha o canal de destino.
3. Selecione as personas que você deseja permitir em seu destaque.
4. Opcionalmente, escolha uma dessas personas como sua **persona pessoal de acionamento automático** (a resposta padrão para suas mensagens nesse canal). As menções explícitas ainda podem ter como alvo qualquer pessoa permitida. Pressione `Salvar Destaque` para pular a configuração de uma persona de acionamento automático.

### Regras em destaque

- O Spotlight apenas restringe o acesso: você não pode acionar personas excluídas da sua lista de destaque.
- Ele respeita as permissões pessoais no nível do servidor configuradas em `/moderation`.
- As transferências de proxy de persona são restritas às personas incluídas em sua lista de destaque.

Gerencie ou remova destaques em `/personal config` > `Avançado` > Destaque pessoal (desmarque as entradas para removê-los; os holofotes cronometrados expiram automaticamente). Em `/help`, escolha `Avançado` > `Destaque Pessoal` para um resumo rápido.

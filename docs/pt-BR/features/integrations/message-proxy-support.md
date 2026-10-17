---
title: "Suporte a Proxy de Mensagens"
description: "Escolha um serviço de proxy de mensagens compatível do Discord e permita que a TomoriBot acompanhe com segurança suas republicações verificadas por webhook."
sidebar:
  order: 3
---

O suporte a proxy de mensagens permite que a TomoriBot acompanhe mensagens que um bot externo do Discord exclui e republica por meio de um webhook.

## Escolha um serviço

Execute `/personal message-proxy service:pluralkit` ou `/personal message-proxy service:pluralbuddy`. Escolha `service:none` (exibido como Desligado) para desativar o tratamento de proxy. Esta é uma configuração pessoal na conta do Discord que envia as mensagens originais e acompanha essa conta em todos os servidores.

Depois que a TomoriBot vir a primeira mensagem verificada de um alter, use `/personal config identity:` para editar o perfil dele e `/personal memories identity:` para editar as memórias dele. O preenchimento automático inclui identidades salvas de ambos os serviços mesmo enquanto o tratamento de proxy estiver desligado. A interface da conta, a privacidade e as configurações de modelo permanecem na conta hospedeira. Um apelido definido na TomoriBot permanece até ser removido; caso contrário, o nome de exibição do serviço é atualizado em mensagens verificadas. Consulte [Suporte ao PluralKit](/pt-BR/features/integrations/pluralkit-support/) para obter detalhes sobre membros e biografias.

## O que a verificação de segurança significa

A Tomori nunca atribui a identidade de um webhook com base no nome ou avatar dele. O serviço selecionado deve verificar o ID de republicação, a conta hospedeira e um ID estável de alter. O PluralKit também identifica a mensagem original exata, de modo que a TomoriBot pode transferir sua decisão de gatilho e alvo de resposta. O PluralBuddy não fornece esse ID original. A TomoriBot usa uma mensagem recente do mesmo canal e conta hospedeira como uma correspondência de melhor esforço. Se a republicação chegar após a espera original ou se várias mensagens originais se sobrepuserem, ela poderá ser ignorada ou causar uma segunda resposta. Uma verificação com falha ou conflitante nunca cria uma identidade.

É por isso que o Tupperbox não é oferecido atualmente como opção. Sua documentação pública descreve a delegação de mensagens, mas não uma API pública autoritativa de atestação de mensagens que a TomoriBot possa usar com segurança.

## Pequeno atraso na mensagem

Quando um serviço é selecionado, a Tomori aguarda brevemente antes de processar cada mensagem comum de servidor da sua conta. Isso dá tempo para o serviço excluir e republicar a mensagem. Mensagens sem proxy continuam após a espera. Republicações do PluralKit herdam a decisão de gatilho e o alvo de resposta originais. O PluralBuddy usa o conteúdo da republicação verificada e a correspondência de melhor esforço com uma mensagem recente.

Quem usa hospedagem própria pode ajustar esse mecanismo com `MESSAGE_PROXY_WAIT_MS`. As configurações de transporte do serviço permanecem separadas, como o tempo limite da API do PluralKit e o token opcional. As consultas de mensagens do PluralBuddy exigem credenciais de aplicativo OAuth em `PLURALBUDDY_CLIENT_ID` e `PLURALBUDDY_CLIENT_SECRET`. Usuários individuais não precisam fornecer tokens. O adaptador atual consulta apenas `pluralbuddy.app`; instâncias auto-hospedadas do PluralBuddy não são suportadas.

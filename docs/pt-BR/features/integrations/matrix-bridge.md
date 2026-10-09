---
title: "Bridge Matrix"
sidebar:
  order: 1
---

Conecte uma sala Matrix a um canal Discord para que as pessoas possam conversar em ambas as plataformas. As mensagens enviadas do Matrix aparecem em Discord como mensagens de webhook e TomoriBot responde diretamente na sala Matrix.

Para hospedagem de appservice e arquitetura de implantação, consulte [Arquitetura de ponte matricial](/en/architecture/integrations/matrix/bridge/).

## Configuração

1. Convide a conta do bot Matrix para uma sala Matrix não criptografada.
2. Copie o ID interno da sala (na maioria dos clientes: `Room Settings` > `Avançado` > `Internal Room ID`, formatado como `!abc:matrix.org`).
3. Execute `/matrix link` no canal Discord que você deseja fazer a ponte e cole o ID da sala.

Após a adesão do bot, ele publica uma confirmação no Matrix, mas você deve completar o link de Discord usando `/matrix link`. Para desconectar um canal em ponte posteriormente, execute `/matrix unlink`.

## Usando pelo Matrix

- Converse normalmente quando a sala estiver vinculada. As mensagens da matriz são retransmitidas para o canal Discord.
- TomoriBot responde de volta à sala Matrix.
- Os comandos de texto Matrix suportados são `/kill` e `/refresh`.

## Limitações Atuais

- Nenhum comando de barra do Matrix (além de `/kill` e `/refresh`).
- Sem mensagens diretas ou lembretes de espera baseados em DM.
- Os avatares Matrix não são visíveis para os recursos de visão do bot.
- A fixação de mensagens não está disponível.
- Emojis personalizados e formatação complexa não são renderizados de maneira confiável; incorpora retransmissão como texto simples.
- As memórias pessoais dos usuários do Matrix recorrem às memórias atribuídas ao servidor.

## Observações

- Se o bot não ingressar automaticamente, convide a conta do bot Matrix manualmente e execute novamente o `/matrix link`.
- A criptografia de matriz não pode ser desativada após a criação da sala: uma sala criptografada deve ser substituída por uma sala nova não criptografada.
- Para desvincular um canal, use `/matrix unlink`.
- Se um problema não estiver listado acima, relate-o no servidor de suporte com `/support discord`.

Em `/help`, escolha `Plug-ins` e depois `Matrix` para o passo a passo interativo em Discord.

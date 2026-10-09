---
title: "Comandos com Restrição de Idade"
sidebar:
  order: 3
---

A TomoriBot mantém sua categoria de comandos `/nsfw` somente para adultos atrás da restrição de idade integrada do Discord,
oculta até você optar por participar. Esta página explica como acessá-la e onde ela funciona.

## Ativando Comandos com Restrição de Idade

1. Em Discord, abra `User Settings` > `Privacy & Safety`.
2. Ative `Allow access to age-restricted commands in apps`. Você deve ter 18 anos ou mais.
3. Execute comandos com restrição de idade em canais marcados como `Age-Restricted Channel`. Para marcar um canal, clique com o botão direito nele, selecione `Edit Channel` e ative `Age-Restricted Channel` (requer permissão para gerenciar canais).

Se um comando for restrito e o canal não estiver marcado com restrição de idade, Discord não exibirá nem permitirá a execução do comando.

## O Que Está Restrito

- **Configurações de conteúdo NSFW**: `/nsfw jailbreaks` ativa/desativa contornos para filtros de conteúdo
  excessivamente rígidos *do lado do provedor* (a TomoriBot em si não adiciona restrições de segurança próprias). Veja
  [Ajuste de Comportamento](/pt-BR/features/chatting-personality/behavior-tweaking/#saída-sem-censura).

A geração de imagem e vídeo é controlada separadamente pelo provedor configurado e pelas
configurações de capacidade do servidor; elas não são restringidas pela categoria de comandos `/nsfw`.

Conteúdo com restrição de idade é apenas para usuários adultos; use com responsabilidade e siga as
[Diretrizes da Comunidade](https://discord.com/guidelines) do Discord. Em `/help`, escolha `Comportamento`, depois `Comandos Restritos por Idade`, para o mesmo
guia no Discord.

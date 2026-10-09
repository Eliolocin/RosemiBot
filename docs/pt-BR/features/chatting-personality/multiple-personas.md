---
title: "Múltiplas Personas"
# Keyword-rich <title> targeting "AI companion Discord" queries; replaces
# Starlight's default "{title} | TomoriBot" for this page only. H1 and sidebar
# keep the plain title. The homepage title bets on "AI agent" + "roleplay";
# this page carries the "companion" keyword instead.
head:
  - tag: title
    content: "TomoriBot | AI Companions & Personas for Your Discord Server"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "Execute múltiplos companheiros de IA em um servidor Discord. Personas personalizadas com seus próprios avatares, gatilhos e estilos de fala."
sidebar:
  order: 2
---

A personalidade da TomoriBot fica em uma persona: nome, avatar, traços, jeito de falar e comportamento. Você pode usar várias personas ao mesmo tempo, cada uma como um personagem distinto com suas próprias palavras-gatilho e avatar de webhook. Esta página explica o comportamento das personas. Para fatos e memórias, veja [Memória](/pt-BR/features/knowledge/memory/).

## Criando uma Persona

- `/persona create`: construa uma persona personalizada do zero.
- `/persona generate`: faça com que a IA gere uma persona a partir de um prompt e uma imagem (requer um provedor que ofereça suporte a saída estruturada). Você também pode fornecer uma predefinição TomoriBot ou placa SillyTavern existente (consulte [Suporte SillyTavern](/pt-BR/features/integrations/sillytavern-support/)).
- `/persona default`: mude para um dos caracteres padrão integrados.
- `/persona export` e `/persona import`: faça backup ou compartilhe arquivos pessoais. A importação suporta a adição de um personagem como alter persona com seus próprios gatilhos e avatar de webhook.
- `/persona remove`: exclua uma alter persona.

## Personas alter

As personas alter permitem que vários personagens convivam em um servidor:

- Cada alter tem personalidade, palavras-gatilho e avatar de webhook próprios, então cada personagem publica com seu nome e imagem no mesmo canal.
- Vários alters podem responder à mesma mensagem, até o limite definido em `/config` > `Comportamento` > `Comportamento de Gatilho`.
- Responder diretamente a uma mensagem de webhook continua a conversa com aquela persona.
- Adicione alters com `/persona import`, escolhendo a opção de alter, e gerencie-os com `/persona` e `/persona remove`.

Para detalhes sobre o direcionamento das respostas e a identidade dos webhooks, veja a [arquitetura de múltiplas personas](/en/architecture/subsystems/multi-persona/).

## Moldando a Personalidade

Ajuste a aparência, fala e comportamento de uma persona:

### Atributos
<!-- anchor: attributes -->

Abra `/config` > `Persona` > `Identidade e Personalidade` para definir traços de personalidade ou detalhes físicos (como `friendly`, `red hair` ou `ends sentences with *Nya~*`).

### Diálogos de Exemplo
<!-- anchor: sample-dialogues -->

Abra `/config` > `Persona` > `Identidade e Personalidade` para ensinar seu estilo de falar por exemplo usando os espaços reservados `{user}` e `{bot}`:

- `{user}`: substituído pelo nome de exibição ou apelido do usuário real.
- `{bot}`: substituído pelo nome de sua personalidade atual.

```text
{user}: What's your favorite hobby?
{bot}: Fufu~ I like knitting tiny clothes for tiny plushies~♥
```

Dicas para exemplos de diálogos eficazes:

- Escreva trocas naturais que mostrem em vez de contar.
- Demonstre o tom e o vocabulário que você deseja que ela use.
- Adicione variedade a vários exemplos para que ela generalize bem.

### Nome e Avatar

Abra `/config` > `Persona` > `Identidade e Personalidade` para definir como ela se chama e fazer upload de sua foto de perfil.

Você também pode definir um prompt de sistema personalizado em `/config` > `Comportamento` > `Comportamento Geral`; consulte [Ajustes de comportamento](/pt-BR/features/chatting-personality/behavior-tweaking/).

### Hábitos de nomenclatura

Os gerentes de servidor podem abrir `/config` > `Persona` > Naming Habits para definir como uma persona se dirige aos membros:

- Configure prefixos, sufixos e termos de endereço masculinos, femininos e neutros separados.
- Personas diferentes podem se dirigir ao mesmo usuário com títulos diferentes (como uma chamando-o de “Capitão” e outra chamando-o de “Senpai”).
- As substituições pessoais acompanham cada usuário nos servidores; consulte [Personalização](/pt-BR/features/knowledge/personalization/).

## Sprites (Avatares de Emoção)
<!-- anchor: sprites-emotion-avatars -->

Sprites são avatares alternativos para os quais uma persona muda durante uma conversa para refletir emoções (como `happy`, `mad` ou `embarrassed`).

Ao responder, ela escolhe o sprite que corresponde à sua emoção. Para usar um, ela inicia a linha de resposta com `PersonaName (label):`, e Discord entrega essa mensagem com o avatar do sprite correspondente. Se nenhum sprite couber, ela responde com seu avatar padrão.

Gerencie sprites em `/config` > `Persona` > Sprites (requer Gerenciar Servidor):

- **Adicionar ou substituir**: selecione a persona, forneça um rótulo, carregue uma imagem (PNG, JPG ou GIF) e, opcionalmente, escreva instruções de uso descrevendo quando exibi-la.
- **Editar**: atualize o rótulo, a imagem ou as instruções de um sprite existente.
- **Excluir**: remova sprites que você não deseja mais.
- **Exportar e importar**: compartilhe ou faça backup do pacote de sprites completo da persona como um arquivo.

A alternância `Salvar como Identidade` exibe o autor da mensagem como `Label (Persona)` em Discord, útil para caracteres com múltiplas formas.

Substituir o avatar de uma persona padrão limpa seus sprites integrados, porque eles representam o personagem original. Sprites que você mesmo adicionou permanecem intactos. A execução de `/persona default` restaura os sprites integrados.

## Escolha de Persona por Canal

Para escolher qual persona responderá a você em um canal específico sem alterar as configurações de todo o servidor, use o Personal Spotlight; consulte [Personalização](/pt-BR/features/knowledge/personalization/#personal-spotlight).

---
title: "Tarefas Agendadas"
sidebar:
  order: 2
---

Defina lembretes para você mesmo ou agende anúncios recorrentes sem sair do chat. Pergunte diretamente ao bot e ela criará a programação para você. As tarefas agendadas pertencem à persona ativa.

Os lembretes notificam o usuário alvo quando eles são acionados, enquanto as autotarefas são ações que a persona realiza por conta própria no horário agendado.

## Criando uma Tarefa

Diga a ela o que agendar no chat:

```text
remind me to submit the report at 14:30
every Friday at 8pm, post a reminder that game night is starting
```

Ela analisa o tempo solicitado e a recorrência. Os lembretes enviam ping ao usuário alvo quando eles são acionados. As tarefas são ações silenciosas que a persona realiza quando chega a hora.

## Fusos Horários

Horários absolutos (como "às 14h30" ou "na sexta-feira às 20h") usam o fuso horário do servidor (`/config` > `Comportamento` > `Comportamento Geral`) por padrão. Se você definir seu próprio fuso horário com `/personal config`, o bot converterá sua hora local automaticamente. "lembre-me às 9h" significa 9h, mesmo que o servidor esteja em outro fuso horário. Os tempos relativos (como "em 2 horas") não dependem de fusos horários e são sempre seguros.

Quando um lembrete é direcionado a um usuário cujo fuso horário pessoal é diferente do do servidor, a confirmação mostra os dois relógios: o horário do servidor e o horário local do destino. Se um horário estiver rotulado incorretamente, corrija-o com uma mensagem de acompanhamento ou `/scheduled-task edit`.

## Gerenciando Tarefas

Dois comandos de barra permitem revisar e ajustar programações existentes:

- `/scheduled-task edit`: altera o conteúdo de uma tarefa, o próximo horário de acionamento, o intervalo de recorrência ou o alvo do lembrete. Defina o intervalo como `0` para tornar uma tarefa recorrente única.
- `/scheduled-task remove`: exclua um lembrete ou tarefa.

Ambos os comandos abrem um seletor listando suas programações existentes por pessoa, horário, canal e recorrência.

Um servidor pode conter até 100 lembretes e tarefas pendentes por vez. Quando estiver cheio, a TomoriBot avisará você em vez de adicionar outro; remova os antigos com `/scheduled-task remove` para liberar espaço.

## Como Funciona a Entrega

Os lembretes só são marcados como concluídos após a entrega ser bem-sucedida. Se a entrega for interrompida, TomoriBot tenta novamente automaticamente sem alterar a programação recorrente.

Se a entrega falhar repetidamente e atingir o limite de novas tentativas, TomoriBot publicará um aviso com o conteúdo agendado e o ID da tarefa. Lembretes de usuário com falha enviam ping ao alvo para que o lembrete não seja perdido, enquanto tarefas automáticas com falha não enviam ping. As programações únicas são então removidas, enquanto as programações recorrentes permanecem ativas para a próxima ocorrência e podem ser gerenciadas com `/scheduled-task edit` ou `/scheduled-task remove`.

---

Para obter mais recursos, consulte [Ferramentas e extensões](/pt-BR/features/capabilities/tools-and-extensions/).

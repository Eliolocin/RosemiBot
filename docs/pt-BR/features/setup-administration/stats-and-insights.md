---
title: "Estatísticas & Insights"
sidebar:
  order: 4
---

TomoriBot rastreia métricas de interação para que você possa inspecionar tendências de atividades, modelar uso de tokens, personas populares e chamadas de ferramentas ou renderizar cartões de resumo de infográficos compartilháveis.

## Painéis de Texto

Três comandos abrem um painel interativo com guias:

- `/stats personal`: visualize suas próprias estatísticas de uso.
- `/stats persona`: visualize as estatísticas de uso de uma pessoa específica neste servidor.
- `/stats server`: visualize estatísticas de todo o servidor de todos os membros e personas.

Cada painel inclui guias para Visão Geral, Personas, Modelos e Custo, Ferramentas e Comandos, Expressão, Pessoas Favoritas e Placares de Líderes.

A maioria dos subcomandos permite especificar uma janela de período (como 7 dias, 30 dias ou o tempo todo). As estatísticas pessoais podem ter como escopo o servidor atual ou todos os servidores onde você usa TomoriBot.

Painéis de texto são mensagens públicas duráveis controladas pelo invocador. Eles permanecem interativos até serem dispensados ou excluídos, e outros membros não podem manipular os controles do painel.

:::note
As contagens de tokens refletem o uso relatado pelo provedor, quando disponível (uma estimativa baseada em caracteres é usada apenas para provedores que omitem métricas de token). Os valores de custo definem o preço desses tokens de acordo com as taxas de lista do catálogo de modelos, portanto, podem diferir de sua fatura real devido ao cache imediato, descontos de fornecedores ou cotas de nível gratuito.
:::

## Cartões de Infográfico Compartilháveis

Execute `/stats generate` para renderizar um cartão de imagem de resumo sofisticado que você pode compartilhar diretamente no chat:

- **Personal Wrapped**: resume sua atividade pessoal e personas favoritas.
- **Afinidade de Persona**: destaca as estatísticas de uma persona específica e os principais parceiros de conversa neste servidor.
- **Tabela de classificação do servidor**: exibe a atividade de todo o servidor e a classificação dos membros.

Os usuários com nível de privacidade definido como `Completo` em `/personal config` não podem gerar cartões de estatísticas pessoais.

Para obter detalhes sobre como os cartões são compostos e renderizados, consulte o [subsistema de infográfico de estatísticas](/en/architecture/subsystems/stats-infographic/).

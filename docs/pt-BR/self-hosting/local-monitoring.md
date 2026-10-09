---
title: Monitoramento Local com Grafana
sidebar:
  order: 7
---

Monitore sua instância TomoriBot local com painéis Grafana pré-construídos para rastrear o uso de memória, tamanhos de cache, consumo de token e tráfego de comando.

Inicie TomoriBot e Grafana juntos:

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

Este comando:
- Inicia TomoriBot e PostgreSQL (com o banco de dados exposto na porta 15432)
- Inicia o Grafana na porta 3000 com uma fonte de dados PostgreSQL pré-configurada
- Provisiona o painel Visão geral do TomoriBot
- Conecta todos os serviços em uma rede interna Docker

Abra o Grafana em [http://localhost:3000](http://localhost:3000):
- **Nome de usuário**: `admin`
- **Senha**: definida via `GRAFANA_PASSWORD` em `.env` (o padrão é `admin` quando não definido)

## O dashboard provisionado

O painel Visão geral do TomoriBot é carregado automaticamente sem configuração manual. Seus painéis exibem memória de processo, contagens de entrada de cache, erros por hora, uso de token por modelo, atividade horária, comandos principais, localidades de usuário, uma nuvem de emoções e predefinições e modelos ativos.

Cada painel consulta tabelas padrão presentes em todas as instalações, permitindo que o mesmo layout de painel funcione localmente e em ambientes de nuvem.

Certos painéis requerem configurações de tempo de execução específicas ou suporte de host:

| Painel | Precisa |
|---|---|
| Memória de processo, entradas de cache | Linhas `metric_samples` gravadas em cada `CACHE_METRICS_INTERVAL_MS`. O coletor é executado somente quando `RUN_ENV=production`, portanto, uma instância de desenvolvimento não exibe dados aqui. |
| Erros por hora por tipo | `ERROR_DB_LOGGING_ENABLED` (habilitado por padrão). Uma linha plana durante um incidente pode indicar que o disjuntor do banco de dados está aberto, em vez de os erros terem cessado. |
| Memória do host e níveis de troca, pressão do host (PSI) e taxa de troca | Um host Linux. Eles são `/proc/meminfo`, `/proc/pressure/*`, `/proc/swaps` e `/sys/block/zram0`, portanto permanecem vazios no macOS e no Windows. A série zram requer um dispositivo de troca zram configurado; hosts sem zram ainda relatam métricas gerais de memória e pressão. |

## Editando e salvando alterações

Os painéis permanecem editáveis na interface Grafana para depuração ao vivo. Como as reinicializações do contêiner redefinem as edições do painel de volta aos arquivos do disco, exporte o JSON do painel modificado e salve-o em `docker/grafana/dashboards/` para manter suas alterações.

Para adicionar um novo painel, coloque sua definição JSON em `docker/grafana/dashboards/`. Direcione a fonte de dados PostgreSQL com o uid fixo `tomoribot-postgres`: as fontes de dados sem um uid explícito recebem identificadores gerados aleatoriamente, o que faz com que os painéis que usam uids incompatíveis renderizem painéis em branco.

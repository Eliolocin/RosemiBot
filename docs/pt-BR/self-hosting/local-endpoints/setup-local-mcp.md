---
title: "Configuração: Servidor MCP Local"
sidebar:
  order: 6
---

Conecte TomoriBot a servidores Model Context Protocol ([MCP](https://modelcontextprotocol.io/)) em execução em sua máquina local ou rede privada para fornecer ferramentas locais personalizadas.

Para servidores HTTPS remotos, consulte [Ferramentas e extensões](/pt-BR/features/capabilities/tools-and-extensions/#mcp-servers). Os endpoints MCP locais exigem uma instância auto-hospedada:

:::caution[Self-hosting only]
Os servidores locais MCP são suportados apenas em instâncias auto-hospedadas. O bot hospedado público requer HTTPS e bloqueia endereços locais/privados para segurança, portanto, não pode acessar um servidor em `localhost` ou sua LAN.
:::

## 1. Execute um servidor MCP local

Inicie um servidor MCP que expõe um transporte HTTP/SSE em uma porta local. Por exemplo, muitos servidores MCP são executados via Node:

```sh
npx -y <some-mcp-server> --port 3000
```

O comando exato depende do servidor que você está executando. Observe o URL e o caminho de transporte impresso (geralmente `http://localhost:3000/sse`).

## 2. Registre-o no Discord

Abra `/config` > `Plug-ins` > Servidores MCP, escolha `+ Adicionar MCP`, defina o campo `URL do Servidor` para seu endpoint local e mantenha `Tipo de Servidor` em sua configuração `Propósito Geral` padrão:

```text
http://localhost:3000/sse
```

Deixe `Token de Autenticação (Opcional)` em branco: os servidores locais não requerem tokens de autenticação.

## 3. Gerencie-o

Abra a página Config e escolha `Remover` na linha do servidor. A confirmação cancela o registro, desconecta-o imediatamente e libera um slot.

## Segurança

:::danger[Only add MCP servers you trust]
Até mesmo um servidor local que você mesmo executa pode se comportar mal se seu código não for confiável. Um servidor MCP malicioso pode injetar imediatamente o modelo, exfiltrar dados passados para suas ferramentas ou retornar resultados prejudiciais que o TomoriBot irá retransmitir. Revise o que um servidor MCP faz antes de conectá-lo.
:::

Para o fluxo MCP online e detalhes completos de segurança, consulte [Ferramentas e Extensões](/pt-BR/features/capabilities/tools-and-extensions/#mcp-servers).

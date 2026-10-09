---
title: "Configuración: Servidor MCP local"
sidebar:
  order: 6
---

Conecte los servidores TomoriBot a Model Context Protocol ([MCP](https://modelcontextprotocol.io/)) que se ejecutan en su máquina local o red privada para proporcionar herramientas locales personalizadas.

Para servidores HTTPS remotos, consulte [Herramientas y extensiones](/es-419/features/capabilities/tools-and-extensions/#mcp-servers). Los puntos finales locales MCP requieren una instancia autohospedada:

:::caution[Self-hosting only]
Los servidores locales MCP solo se admiten en instancias autohospedadas. El bot alojado públicamente requiere HTTPS y bloquea direcciones locales/privadas por seguridad, por lo que no puede llegar a un servidor en `localhost` o su LAN.
:::

## 1. Ejecuta un servidor MCP local

Inicia un servidor MCP que exponga un transporte HTTP/SSE en un puerto local. Por ejemplo, muchos servidores MCP se ejecutan a través de Node:

```sh
npx -y <some-mcp-server> --port 3000
```

El comando exacto depende del servidor que esté ejecutando. Tenga en cuenta la URL y la ruta de transporte que imprime (comúnmente `http://localhost:3000/sse`).

## 2. Regístralo en Discord

Abre `/config` > `Plugins` > Servidores MCP, elija `+ Agregar MCP`, configure el campo `URL del servidor` en su punto final local y mantenga `Tipo de servidor` en su configuración predeterminada de `Uso general`:

```text
http://localhost:3000/sse
```

Deja `Token de autenticación (opcional)` en blanco: los servidores locales no requieren tokens de autenticación.

## 3. Adminístralo

Abre la página de configuración y elija `Quitar` en la fila del servidor. Al confirmarlo se da de baja, se desconecta inmediatamente y se libera una ranura.

## Seguridad

:::danger[Only add MCP servers you trust]
Incluso un servidor local que usted mismo ejecute puede comportarse mal si su código no es de confianza. Un servidor MCP malicioso puede inyectar rápidamente el modelo, filtrar datos pasados a sus herramientas o devolver resultados dañinos que transmitirá TomoriBot. Revisa lo que hace un servidor MCP antes de cablearlo.
:::

Para conocer el flujo en línea-MCP y todos los detalles de seguridad, consulte [Herramientas y extensiones](/es-419/features/capabilities/tools-and-extensions/#mcp-servers).

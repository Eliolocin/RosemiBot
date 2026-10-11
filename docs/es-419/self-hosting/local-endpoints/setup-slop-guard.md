---
title: "Configuración: slop-guard"
sidebar:
  order: 8
aiGenerated: true
---

Ejecuta [slop-guard](https://github.com/eric-tramel/slop-guard), un corrector de prosa basado en reglas, como el verificador de reglas para [Revisión de respuestas](/es-419/features/chatting-personality/behavior-tweaking/#response-drafting). Evalúa cada respuesta retenida en busca de patrones de escritura formulados y pasa el informe al revisor. La comprobación se basa en reglas, por lo que no consume tokens.

slop-guard solo se distribuye como un proceso stdio local. `servers/slop-guard/` empaqueta la versión fijada (`0.5.0`) en un contenedor pequeño que expone las mismas herramientas a través de MCP Streamable HTTP, que es la forma en que TomoriBot se conecta a los servidores MCP.

## Iniciar el servidor

### Opción A: Docker Compose (cuando TomoriBot se ejecuta en Docker)

```sh
docker compose --profile slop-guard up -d
```

El contenedor se une a la red Docker de TomoriBot como `slop-guard`. No publica ningún puerto de host.

### Opción B: Docker independiente (cuando TomoriBot se ejecuta en tu máquina)

Inicia el bot con el corrector en lugar de `bun run dev`:

```sh
bun run launch --slopguard
```

Esto compila la imagen, inicia un contenedor `slop-guard` en `127.0.0.1:8765`, espera a que acepte conexiones y luego ejecuta el bot en modo de observación. El contenedor sigue ejecutándose después de `Ctrl+C`; detenlo con `docker stop slop-guard`. Después de modificar `servers/slop-guard/`, elimina el contenedor anterior (`docker rm -f slop-guard`) para que launch cree uno nuevo a partir de la imagen reconstruida.

## Registrarlo

1. Abre `/config` > Plugins > Servidores MCP y selecciona `+ Añadir MCP`.
2. Establece `URL del servidor` en `http://slop-guard:8765/mcp` (Opción A) o `http://localhost:8765/mcp` (Opción B). Deja `Token de autenticación` vacío.
3. Establece `Tipo de servidor` en `Corrector de prosa`.
4. Abre `/config` > Plugins > Revisión de respuestas y elige `<nombre del servidor> / check_slop` en `Comprobaciones de reglas`.

`Corrector de prosa` mantiene las herramientas del servidor aisladas de la propia Tomori. slop-guard también tiene `check_slop_file`, que lee una ruta de archivo dentro del contenedor; el verificador de reglas nunca la ofrece porque no recibe el texto de respuesta.

Las direcciones locales funcionan porque TomoriBot autoalojado se ejecuta con `RUN_ENV=development` (Compose lo fija). Con `RUN_ENV=production`, TomoriBot rechaza las URL de MCP que se resuelven en direcciones privadas o de bucle invertido.

## Parámetros

| Variable | Predeterminado | Propósito |
|---|---|---|
| `SLOP_GUARD_CONFIG` | reglas empaquetadas | Ruta dentro del contenedor a una configuración de reglas JSONL. Monta el archivo y apunta esta variable hacia él. |
| `SLOP_GUARD_PORT` | `8765` | Puerto de escucha. |
| `SLOP_GUARD_ALLOWED_HOSTS` | `slop-guard:*,localhost:*,127.0.0.1:*` | Valores de encabezado `Host` que acepta el servidor. Añade el nombre de host que pusiste en `URL del servidor` si no está en esta lista; cualquier otro host recibe HTTP 421. |

Las reglas predeterminadas de slop-guard están dirigidas a la prosa generada en documentación y artículos. Las respuestas informales de juego de rol activan algunas de ellas, como las comprobaciones de viñetas o listas de tres elementos, por lo que el informe es meramente consultivo: el revisor decide si una coincidencia es relevante para la persona. Menciona el informe en tu prompt de revisor si deseas que el revisor lo pondere de una manera particular. La herramienta `sg-fit` de slop-guard puede ajustar una configuración de reglas a tus propios ejemplos buenos y malos.

## Actualización

Cambia la versión en `servers/slop-guard/Dockerfile`, reconstruye y envía un mensaje de prueba con Revisión de respuestas activada. Una nueva versión puede cambiar las reglas y el formato del informe que lee el revisor.

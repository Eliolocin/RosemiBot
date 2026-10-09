---
title: "Asistente de instalación"
sidebar:
  label: "Asistente de instalación"
  order: 1
aiGenerated: false
---

:::note
Los usuarios que quieran usar Docker Compose deben omitir este asistente; consulta
[Docker Compose](/es-419/self-hosting/docker-compose/) para la ruta de instalación en contenedores.
:::

`bun run setup` es la ruta de autoalojamiento recomendada para instalaciones locales basadas en Bun. Crea tu `.env`, genera un `CRYPTO_SECRET`, te pide el token de tu bot de Discord, configura PostgreSQL e instala las dependencias exactas de `bun.lock` de forma interactiva, así que solo sigue las indicaciones. Es seguro
volver a ejecutarlo; los valores existentes de `.env` se conservan a menos que elijas reconfigurarlos.

## Obtén el código

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## Elige una ruta

Una vez que ejecutes el comando, elegirás una de dos rutas:

```bash
bun run setup
```


| Ruta | Úsala cuando | Qué hace |
|---|---|---|
| Instalación completa | Quieres la configuración recomendada con extras livianos. | Ejecuta la instalación base y luego intenta los cuatro extras siguientes. |
| Instalación base | Solo quieres el bot mínimo funcional. | Crea/configura `.env`, el token de Discord, PostgreSQL y las dependencias. |



## Qué tener listo

- [Bun](https://bun.sh/) para ejecutar el bot y el propio asistente.
- Un token de bot de Discord con los intents privilegiados `GuildMembers`, `MessageContent` y
  `GuildPresences` habilitados.
- Una base de datos. TomoriBot almacena todo en PostgreSQL. No necesitas configurarla a mano, ya
  que el asistente lo hace por ti: usará PostgreSQL si ya lo tienes instalado, o ejecutará uno por ti
  en [Docker](https://www.docker.com/) si no lo tienes. Solo asegúrate de tener alguno de los dos
  instalado antes de empezar.

:::caution
- El PostgreSQL de Docker incluido solo ejecuta la base de datos en Docker. El bot en sí, las
  copias de seguridad de inicio, `bun run backup` y `restore-backup` siguen ejecutándose mediante Bun
  y las herramientas de cliente de PostgreSQL del host. Si prefieres ejecutar todo en Docker, usa
  [Docker Compose](/es-419/self-hosting/docker-compose/) en su lugar.
:::

Si `psql` falta o el aprovisionamiento falla, el asistente imprime el SQL para ejecutar a mano. De
cualquier forma, TomoriBot inicializa su esquema, semillas, migraciones, `pgcrypto` y el esquema de RAG
automáticamente en el primer arranque.

## Extras de la instalación completa

La instalación completa ejecuta primero la instalación base y luego intenta instalar los extras de
abajo. Si alguno falla, imprime el comando o la guía para terminarlo a mano y continúa:

| Extra | Propósito |
|---|---|
| `pgvector` | Búsqueda vectorial para la memoria de documentos/RAG. |
| `pg_cron` | Limpieza opcional programada de filas de enfriamiento/recordatorio. |
| Recursos del tokenizador | Recursos de tokenizador locales para el sesgo de logit según el modelo. |

Para instalar cualquiera de estos a mano, consulta los
[extras de la instalación manual](/es-419/self-hosting/manual-setup/#extras-opcionales-la-instalación-completa-manual).

## Después de la instalación

```bash
bun run dev                          # solo el bot
bun run launch --searxng --crawl4ai  # bot + servidores locales (ver bun run launch --help)
```

Cuando el bot esté en línea, ejecuta `/setup` en Discord para conectar un proveedor de IA. Un espacio de
trabajo que no tiene su propio proveedor no puede responder, salvo que funcione en modo BYOK de usuario,
en el que el proveedor personal de cada miembro responde en su lugar, así que este es el último paso de
cada ruta de instalación.

## El comando `/setup`
<!-- anchor: the-setup-command -->

`/setup` abre un panel de lista de verificación efímero que solo puede operar la persona que lo ejecutó.
En un servidor requiere Administrar servidor; en un mensaje directo está disponible para el espacio
de trabajo de esa misma persona. Cada fila del panel es un valor en borrador: `Finalizar configuración`
es el único control que escribe algo, así que abrir, editar, cancelar o reiniciar deja intacta cada fila
de la base de datos.

| Paso | Aparece | Qué recopila |
|---|---|---|
| Políticas | Solo con `RUN_ENV=production` | Aceptación de los Términos de servicio y la Política de privacidad, ambos en un solo modal. |
| Proveedor de IA | En todos los entornos | Cómo llegan las respuestas a un modelo. Uno de los tres modos de acceso siguientes. |
| Ajustes iniciales | En todos los entornos | Persona inicial, estilo de respuesta, zona horaria y el prompt de sistema predeterminado del espacio de trabajo. |

Cualquier otro valor de `RUN_ENV` muestra el diseño de dos pasos y ningún texto de políticas. Una
implementación que se ejecuta con `RUN_ENV=production` registra `/legal terms-of-service` y
`/legal privacy-policy` junto a `/legal license`; cualquier otro valor registra solo `/legal license`.

### Modos de acceso al proveedor

- **Proveedor de IA (recomendado)**: elige un proveedor del catálogo y pega su clave de API. La clave se
  valida contra el proveedor y se cifra en el borrador; el panel solo muestra que hay una clave
  almacenada, nunca la clave en sí. Ejecuta `/help`, luego `Configuración` > **Paso 1: Obtén una clave
  de API** para el recorrido específico de cada proveedor.
- **Punto de conexión personalizado (avanzado)**: un área secundaria de dos botones para un endpoint autoalojado
  o proxy. `Configurar conexión` recopila la compatibilidad de API, una etiqueta, la URL y un token de
  autenticación opcional, y comprueba que el endpoint responda. `Configurar modelo de texto` recopila
  el código del modelo, su tamaño de contexto y sus declaraciones de capacidad, y permanece deshabilitado
  hasta que una conexión se valide. Guardar la conexión de nuevo borra la declaración del modelo, porque
  las declaraciones dependen de la compatibilidad de API elegida. Este es el mismo registro que realiza
  `/providers`, hecho dentro del asistente, y no crea ninguna fila antes de `Finalizar configuración`.
- BYOK de usuario (solo servidores, nunca en un mensaje directo): el espacio de trabajo no conserva
  ningún proveedor propio y cada respuesta activada por un miembro resuelve en su lugar un proveedor
  personal. Confírmalo en el modal y luego haz que los miembros registren el suyo con
  `/personal providers`. Consulta
  [Moderación del servidor](/es-419/features/setup-administration/server-moderation/#user-byok-bring-your-own-key).

### Configuración inicial

Un modal de cuatro filas recopila la persona, el estilo de respuesta, el desfase de zona horaria y el
prompt de sistema predeterminado. La zona horaria es opcional y por defecto es UTC. El prompt de sistema
ofrece `Predeterminado incorporado (recomendado)` más cada preajuste del catálogo del espacio de
trabajo: la opción incorporada no almacena ningún texto de prompt, así que sigue el predeterminado
distribuido con el bot, y una opción de preajuste almacena el texto de ese preajuste tal como se lee en
el momento del guardado. Eliminar una persona o un prompt almacenado del catálogo vuelve a abrir el paso
hasta que se elija otro.

### Finalizar y cancelar

Finalizar configuración permanece deshabilitado hasta que cada paso mostrado esté completo. Revalida
los catálogos y el estado del espacio de trabajo, confirma todo el borrador en una sola transacción y
reemplaza el panel con el comprobante. `Cancelar` descarta el borrador y hace expirar cada control del
panel.

Un borrador vive en el proceso del bot, no en la base de datos, así que solo termina cuando se cancela,
se completa o el proceso se reinicia. Se conservan como máximo 200
borradores a la vez; el más antiguo se descarta al llegar al límite. Un control de una sesión que
ya no está disponible no escribe nada.

## Actualización

Usa el comando de actualización con copia de seguridad primero: `bun run update`

Esto ejecuta `bun run backup`, luego
`git pull --rebase --autostash`, luego `bun install --frozen-lockfile`. Agrega `--build` si ejecutas
desde `dist/`, o `--docker` para una implementación con Compose. Los detalles completos están en la
página de [Mantenimiento y copias de seguridad](/es-419/self-hosting/maintenance/).

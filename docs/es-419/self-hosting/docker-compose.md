---
title: "Docker Compose"
sidebar:
  order: 3
---

Docker Compose ejecuta TomoriBot y PostgreSQL juntos en contenedores. Es la tercera opción de instalación junto con el [asistente de configuración](/es-419/self-hosting/setup-wizard/) y la [configuración manual](/es-419/self-hosting/manual-setup/): selecciónela cuando desee ejecutar todo en Docker sin instalar Bun o PostgreSQL en su sistema host. Omite el asistente de configuración interactivo y configura la conexión de la base de datos automáticamente.

:::caution[Host tools for updates]
`bun run update --docker` necesita los hosts Bun y Git para realizar cambios en el código. La copia de seguridad de su base de datos se ejecuta dentro del contenedor de la aplicación. También puede ejecutar copias de seguridad y restauraciones manuales a través de Compose; consulte [Mantenimiento y copias de seguridad](/es-419/self-hosting/maintenance/).
:::

## 1. Obtén el código

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. Valores requeridos de `.env`

Comience desde el archivo de ejemplo:

```sh
cp .env.example .env
```

Establece estas variables requeridas en `.env`:

| Variable | Valor |
|---|---|
| `DISCORD_TOKEN` | Su token de bot Discord (habilite los intents privilegiados `GuildMembers`, `MessageContent` y `GuildPresences`). |
| `CRYPTO_SECRET` | Una clave de cifrado de 32 caracteres que se utiliza para cifrar las claves API almacenadas. |
| `POSTGRES_PASSWORD` | La contraseña de la base de datos. Todos los demás valores de `POSTGRES_*` se configuran automáticamente. |

Genere un valor aleatorio de 32 caracteres para `CRYPTO_SECRET` usando Docker, luego cópielo en `.env`:

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

Genere una contraseña separada para `POSTGRES_PASSWORD`. Puede copiar configuraciones de sintonización opcionales desde `.env.optional.example`.

:::note[Database connection is automatic]
El servicio Compose PostgreSQL se ejecuta en modo de desarrollo (sin SSL) en una red interna Docker. La imagen incluida incluye `pgvector` y `pg_cron`, por lo que la memoria de documentos, la búsqueda de vectores y la limpieza programada funcionan de inmediato. No configure `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER` o `POSTGRES_DB` en `.env`; Compose los configura automáticamente.
:::

En Linux, cree los directorios bind-mount en el host y asigne la propiedad al UID 1001 antes de iniciar los contenedores. Docker crea puntos de montaje faltantes como raíz, lo que impide que el contenedor del bot guarde copias de seguridad, registros o cargas:

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. Compila y ejecuta

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

Para inicios posteriores, `docker compose up` por sí solo es suficiente a menos que cambie el código o las dependencias. Una vez que el bot se conecte a Discord, ejecute `/setup` en cualquier canal del servidor para agregar su clave de proveedor de IA. Consulta el [Inicio rápido](/es-419/introduction/quickstart/) para conocer las opciones de configuración en Discord.

Redacte los pines `RUN_ENV=development` en su definición de servicio para que funcionen los secretos de `.env` y los puntos finales HTTP locales. La comprobación del estado del contenedor informa si el proceso del bot se está ejecutando; no prueba la conectividad de la puerta de enlace Discord. Para conocer las diferencias del modo de producción (`RUN_ENV=production`) (administradores de secretos, restricciones de red y métricas), consulte [Arquitectura de seguridad](/en/architecture/subsystems/security/).

## 4. Servidores locales opcionales (perfiles de Compose)

Ejecuta servidores auxiliares locales opcionales con perfiles de Compose para que solo inicie lo que necesita:

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

Al habilitar SearXNG, configure `SEARXNG_BASE_URL=http://searxng:8080/` en `.env`. De lo contrario, déjelo sin configurar. Establece `SEARXNG_SECRET` en un valor aleatorio independiente para la firma de solicitudes de SearXNG.

Consulta [SearXNG](/es-419/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/es-419/self-hosting/local-endpoints/setup-crawl4ai/) y [Monitoreo local](/es-419/self-hosting/local-monitoring/) para la configuración específica del servidor.

## Mantenimiento, actualización y copias de seguridad.

Utilice `bun run update --docker` para actualizaciones de respaldo en implementaciones de Compose. Para realizar una copia de seguridad o restaurar su base de datos de Compose, consulte [Mantenimiento y copias de seguridad](/es-419/self-hosting/maintenance/). Antes de descargar una nueva versión, revise [Migración segura](/es-419/self-hosting/safe-migration/).

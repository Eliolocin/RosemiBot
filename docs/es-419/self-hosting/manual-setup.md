---
title: "Instalación manual"
sidebar:
  order: 2
aiGenerated: false
---

:::note
Los usuarios que quieran usar Docker Compose deben omitir este asistente; consulta
[Docker Compose](/es-419/self-hosting/docker-compose/) para la ruta de instalación en contenedores.
:::

Este es el procedimiento de instalación manual para usuarios técnicos que prefieren no usar el
asistente guiado. Si quieres la ruta asistida, usa en su lugar el
[asistente de instalación](/es-419/self-hosting/setup-wizard/), ya que crea `.env`, genera un `CRYPTO_SECRET`
seguro, configura PostgreSQL y ejecuta la instalación por ti.

## Requisitos previos

- [Bun](https://bun.sh/)
- PostgreSQL instalado de forma nativa, o ejecutado en un contenedor de Docker (consulta el paso 2)

El esquema de PostgreSQL, `pgcrypto`, las semillas y las migraciones se inicializan automáticamente al
arrancar el bot.

## 1. Instala

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
bun install --frozen-lockfile
```

## 2. Configura

Cree su archivo de entorno a partir del ejemplo y complete los valores requeridos:

```sh
cp .env.example .env
```

Requerida:

- `DISCORD_TOKEN`: su token de bot Discord (habilite los intents privilegiados `GuildMembers`, `MessageContent` y `GuildPresences`).
- `CRYPTO_SECRET`: una clave de cifrado de 32 caracteres (utilizada para cifrar las claves API almacenadas).
- Conexión PostgreSQL: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.

Guarda una copia protegida de tu secreto de cifrado por separado de las copias de seguridad de la base de datos. Las copias de seguridad nuevas no contienen `.env`. Para la rotación, utiliza `CRYPTO_SECRET_V1`, `CRYPTO_SECRET_V2` o cualquier versión posterior con números enteros positivos, con la selección opcional de `CRYPTO_SECRET_CURRENT`. `CRYPTO_SECRET` sigue siendo V1. Los comandos de inicio y mantenimiento cargan la misma fuente: valores de entorno locales en desarrollo, o JSON montado / AWS Secrets Manager en producción. Consulta [Rotación de claves de cifrado](/es-419/self-hosting/maintenance/#rotating-encryption-keys) antes de reemplazar un secreto.

En las fuentes de secretos JSON, las claves maestras deben ser cadenas. `CRYPTO_SECRET_CURRENT` acepta una cadena como `"2"` o un número entero seguro positivo como `2` que nombra una versión disponible.

:::note[No native PostgreSQL?]
Ejecuta solo la base de datos en un contenedor, luego apunte los valores `POSTGRES_*` hacia ella:

```sh
docker run -d --name tomori-db \
  -e POSTGRES_USER=tomori -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=tomori \
  -p 5432:5432 pgvector/pgvector:pg16
```

Luego configure `POSTGRES_HOST=localhost`, `POSTGRES_PORT=5432` y el usuario/contraseña/db arriba. La imagen `pgvector/pgvector` incluye la extensión RAG preinstalada; cámbielo por `postgres:16` si no necesita memoria de documentos/RAG. Esto ejecuta solo la base de datos en Docker y el bot aún se ejecuta en el host Bun. Para un bot y una base de datos completamente en contenedores, utilice [Docker Compose](/es-419/self-hosting/docker-compose/) en su lugar.
:::

El tuning opcional se encuentra en `.env.optional.example`. Copia cualquier valor que desee personalizar (límites, tiempos de espera, alternancia de funciones, URL del servidor local, etc.).

Las cargas de expresiones personalizadas se realizan de forma predeterminada en archivos locales en `data/custom-expressions/`. Mantén ese directorio en un almacenamiento persistente. `EXPRESSION_STORAGE_BACKEND` acepta `local`, `gcs` o `s3`. Los backends en la nube requieren `EXPRESSION_STORAGE_BUCKET` y las credenciales del SDK correspondientes. S3 también usa `AWS_REGION` (`us-east-1` predeterminado) y `S3_ENDPOINT` opcional. GCS utiliza las credenciales predeterminadas de la aplicación. Las expresiones utilizan su propia configuración de depósito; La configuración de almacenamiento de avatar no selecciona un depósito de expresión. Los objetos siguen siendo legibles a través del SDK y se adjuntan como bytes, por lo que no es necesaria una URL de medios publicada públicamente. Conserve las claves de backend, depósito y objeto al restaurar referencias existentes.

`MAX_CUSTOM_EXPRESSIONS_PER_SERVER` limita las expresiones personalizadas por servidor (predeterminado `20`, mínimo `1`). Los enlaces y los archivos subidos comparten el límite entre todas las personas; los emojis y stickers nativos están excluidos. Reinicia el bot después de cambiarlo. Reducir el límite conserva las expresiones existentes y permite editar y eliminar, pero bloquea las adiciones hasta que el recuento caiga por debajo del límite.

## 3. Ejecuta

```sh
bun run dev
```

Cuando veas `TomoriBot up and running!`, ve a Discord y ejecuta `/setup` en tu servidor para conectar un
proveedor de IA e inicializar el bot. El comando abre un panel de lista de verificación guiada, y no se
escribe nada hasta que presiones `Finalizar configuración`; consulta
[El comando `/setup`](/es-419/self-hosting/setup-wizard/#el-comando-setup) para los pasos y la
[Guía rápida](/es-419/introduction/quickstart/) para el lado dentro de Discord.

Usa `bun run launch` en lugar de `bun run dev` si quieres que los servidores locales opcionales (SearXNG, Crawl4AI,
TTS/STT local) se inicien junto al bot:

```sh
bun run launch --searxng --crawl4ai
bun run launch --help        # see all flags
```

## Extras opcionales (la "instalación completa" manual)
<!-- anchor: optional-extras-the-manual-full-install -->

La ruta Instalación completa del [asistente de instalación](/es-419/self-hosting/setup-wizard/) agrega
cuatro extras livianos encima de la instalación base. Ninguno es necesario para ejecutar el bot, pero
cada uno desbloquea una función. Si estás instalando a mano, agrega el que quieras:

### `pgvector` : memoria de documentos/RAG

RAG (subidas de documentos y recuerdo entre canales) almacena incrustaciones en una columna `vector`, lo
que necesita la extensión [pgvector](https://github.com/pgvector/pgvector). Instálala para tu versión
mayor de PostgreSQL:

```sh
# Debian/Ubuntu, e.g. for PostgreSQL 16
sudo apt-get install -y postgresql-16-pgvector
```

Luego habilítala una vez en tu base de datos. Conéctate con `psql` usando los valores `POSTGRES_*` de tu
`.env`; te pedirá `POSTGRES_PASSWORD`:

:::note[Windows]
No existe un paquete de pgvector prediseñado para PostgreSQL nativo en Windows. Instalarlo implica
compilarlo desde el código fuente contra tu versión exacta de PostgreSQL con Visual Studio C++ y `nmake`
(consulta las [instrucciones para Windows](https://github.com/pgvector/pgvector#windows) de pgvector). La
ruta más simple en Windows es ejecutar la base de datos en el contenedor `pgvector/pgvector` que se
muestra arriba en [Configura](#2-configura), que incluye la extensión preinstalada.
:::

```sh
# Native / host psql (substitute your own POSTGRES_USER and POSTGRES_DB):
psql -h localhost -p 5432 -U tomori -d tomodb

# Or, if the database runs in the Docker container from step 2:
docker exec -it tomori-db psql -U tomori -d tomori
```

Una vez conectado, ejecuta:

```sql
CREATE EXTENSION vector;
```

Sin pgvector el bot sigue funcionando, pero las funciones de RAG quedan completamente no disponibles.
Esta extensión también se requiere en la base de datos de destino antes de restaurar una copia de
seguridad; consulta [Migración segura](/es-419/self-hosting/safe-migration/) para más detalles.

### `pg_cron` : trabajos de limpieza programados

`pg_cron` impulsa el mantenimiento periódico opcional de la base de datos (limpieza de filas de
enfriamiento/recordatorio). Docker Compose de este repositorio ya lo configura.

:::caution[No es necesario para recordatorios ni activadores]
`pg_cron` es puramente de mantenimiento, ya que solo limpia filas obsoletas. La entrega de
recordatorios y los activadores aleatorios se ejecutan en la propia aplicación, así que esas funciones
funcionan con o sin `pg_cron`.
:::

Para un PostgreSQL autogestionado, encuentra tu archivo de configuración activo:

```sql
SHOW config_file;
```

Habilita la extensión en `postgresql.conf`; agrégala a `shared_preload_libraries` si ya lista otras
bibliotecas:

```ini
shared_preload_libraries = 'pg_cron'   # e.g. 'pg_stat_statements,pg_cron'
cron.database_name = 'your_dbname'
```

Reinicia PostgreSQL y luego:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### Recursos del tokenizador : sesgo de logit según el modelo

El sesgo de logit (penalizaciones de repetición de emojis/palabras) necesita recursos de tokenizador
locales:

```sh
bun run setup:tokenizers
```

Algunas familias (por ejemplo, Gemma) están restringidas y requieren un
[token de HuggingFace](https://huggingface.co/settings/tokens) después de aceptar su licencia:

```sh
# Windows (PowerShell)
$env:HF_TOKEN="hf_xxx"; bun run setup:tokenizers

# macOS/Linux
HF_TOKEN=hf_xxx bun run setup:tokenizers
```

Sin este paso, el sesgo de logit se deshabilita silenciosamente y todo lo demás funciona con
normalidad.

El respaldo seguro de `fetch_url` y el respaldo de `web_search` de DuckDuckGo se ejecutan dentro del proceso, por lo que ninguno necesita una instalación adicional.

## Mantenimiento, actualización y copias de seguridad

Una vez instalado, los scripts del lado del host (`bun run update`, `bun run backup`,
`bun run restore-backup`, `bun run nuke-db`, `bun run rotate-keys`, …) y los procedimientos de
actualización y copia de seguridad viven todos en la página de
[Mantenimiento y copias de seguridad](/es-419/self-hosting/maintenance/). Si estás por descargar una
nueva versión, comienza con [Migración segura](/es-419/self-hosting/safe-migration/).

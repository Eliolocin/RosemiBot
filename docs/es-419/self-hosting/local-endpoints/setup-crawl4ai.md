---
title: "Configuración: Crawl4AI"
sidebar:
  order: 4
---

Represente páginas web con mucho JavaScript en Markdown limpio para TomoriBot utilizando un servidor local [Crawl4AI](https://github.com/unclecode/crawl4ai).

La herramienta `fetch_url` incorporada utiliza el motor liviano `safe_http` de forma predeterminada. Crawl4AI agrega un navegador Playwright sin cabeza opcional que ejecuta scripts del lado del cliente y extrae el contenido de la página antes de devolver Markdown al bot.

Debido a que Crawl4AI sigue redireccionamientos fuera del cliente HTTP protegido de TomoriBot, solo se admite donde se permite la recuperación de redes privadas. Fuera de producción (`RUN_ENV` != `production`), la recuperación de red privada se habilita automáticamente. En entornos de producción, es necesario configurar `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`.

:::caution[Lo que TomoriBot puede y no puede comprobar]
TomoriBot rechaza una URL cuyo nombre de host no se resuelve, o se resuelve en una dirección de metadatos en la nube, antes de pedirle a Crawl4AI que la abra. No puede controlar lo que hace el navegador a continuación: Crawl4AI vuelve a resolver el nombre, sigue las redirecciones y carga imágenes y scripts por su cuenta. El bloqueo de metadatos siempre activo de TomoriBot no cubre esas solicitudes.

La imagen fijada (`unclecode/crawl4ai:0.9.4`) envía su navegador a través de su propio proxy, que bloquea las direcciones privadas, de bucle invertido y de metadatos en cada solicitud y redirección. Deja `CRAWL4AI_ALLOW_INTERNAL_URLS` sin configurar: establecerlo en `true` desactiva ese proxy, metadatos incluidos.
:::

Crawl4AI 0.9.4 necesita un token de API antes de aceptar conexiones desde fuera de su propio contenedor. Genera uno (por ejemplo, `openssl rand -hex 32`) y configúralo como `CRAWL4AI_TOKEN` en `.env` para cada ruta de configuración a continuación. Sin él, el contenedor se inicia pero TomoriBot no puede alcanzarlo y recurre a `safe_http`.

Elige una ruta de instalación:

### Opción A: Docker Compose (cuando TomoriBot se ejecuta en Docker)

Utilice esta ruta si ejecuta TomoriBot con la pila Docker Compose del repositorio. Primero, configure `CRAWL4AI_BASE_URL=http://crawl4ai:11235/`, `CRAWL4AI_TOKEN` y `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http` en `.env`. Fuera de la producción no es necesario optar por una red privada; solo agregue `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` si ejecuta esta pila con `RUN_ENV=production`.

Luego, comienza con:

```sh
docker compose --profile fetch-crawl4ai up -d
```

Esto inicia la pila Compose con el contenedor Crawl4AI en la red Docker de TomoriBot. Compose pasa `CRAWL4AI_TOKEN` al contenedor como `CRAWL4AI_API_TOKEN`, y TomoriBot lo envía como un token bearer. El puerto 11235 se publica solo en `127.0.0.1` para depuración local; TomoriBot se conecta a través de la red de Docker.

Si ejecuta TomoriBot directamente con `bun run dev`, utilice la ruta independiente a continuación.

Si también quieres SearXNG, encadena los perfiles:

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

---

### Opción B: Docker independiente (cuando se ejecuta `bun run dev`)

Primero, configure `CRAWL4AI_BASE_URL=http://localhost:11235/`, `CRAWL4AI_TOKEN` y `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http` en `.env` para que el bot se conecte al puerto del contenedor publicado en `127.0.0.1`. Fuera de la producción no es necesario optar por una red privada; solo agregue `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` si ejecuta `RUN_ENV=production`.

Luego, en lugar de ejecutar TomoriBot directamente con `bun run dev`, use `bun run launch --crawl4ai`. Esto maneja el ciclo de vida del contenedor automáticamente y espera a que el servidor esté en buen estado antes de iniciar el bot. Se detiene con un error si falta `CRAWL4AI_TOKEN`:

```sh
bun run launch --crawl4ai
```

Si también quieres SearXNG:

```sh
bun run launch --searxng --crawl4ai
```

Si prefiere administrar el contenedor usted mismo, mantenga `CRAWL4AI_BASE_URL=http://localhost:11235/` en `.env` y ejecute:

PowerShell:

```powershell
docker run -d --name crawl4ai -p 127.0.0.1:11235:11235 --shm-size=3g `
  -e CRAWL4AI_API_TOKEN=<your-token> unclecode/crawl4ai:0.9.4
```

Intento (Linux/macOS):

```bash
docker run -d --name crawl4ai -p 127.0.0.1:11235:11235 --shm-size=3g \
  -e CRAWL4AI_API_TOKEN=<your-token> unclecode/crawl4ai:0.9.4
```

Usa el mismo valor para `<your-token>` que `CRAWL4AI_TOKEN` en `.env`.

Luego ejecute `bun run dev` una vez que el contenedor esté en buen estado (`docker ps` muestra `(healthy)`).

---

### Opción C: Sin servidor de representación del navegador

Deja `CRAWL4AI_BASE_URL` sin configurar. La herramienta `fetch_url` utiliza el motor `safe_http` protegido.

---

## Orden de salida

TomoriBot analiza el estado del servidor en la primera llamada a `fetch_url` después del inicio y almacena en caché el resultado durante 60 segundos. Si el contenedor no está listo cuando se activa la primera sonda, el robot lo considera no disponible durante el siguiente minuto.

Para Docker independiente, inicie su contenedor Crawl4AI antes de iniciar TomoriBot. `bun run launch --crawl4ai` ya hace esto por usted.

### Configuración por primera vez

1. Inicia el contenedor y espere hasta que muestre `(healthy)` en `docker ps`:
   ```powershell
   docker ps
   ```
2. Configura `CRAWL4AI_BASE_URL` en `.env` usando el valor de su ruta de configuración anterior.
3. Inicia TomoriBot (`bun run dev` o `docker compose up`).

### Actualización desde `latest`

Un contenedor `crawl4ai` existente conserva la imagen a partir de la cual se creó, por lo que `docker start` no lo actualiza. Elimínalo una vez y luego vuelve a usar tu ruta de instalación:

```powershell
docker rm -f crawl4ai
```

Con Compose, `docker compose --profile fetch-crawl4ai up -d` recrea el contenedor a partir de la imagen fijada.

### Regresar después de un reinicio

Si el contenedor ya existe desde una ejecución anterior, use `docker start` en lugar de `docker run` para evitar un conflicto de nombres:

```powershell
# Start an existing container
docker start crawl4ai

# Confirm healthy before starting TomoriBot
docker ps
```

Luego inicie TomoriBot como de costumbre. Al reiniciar `bun run dev` se restablece el caché de estado en memoria, por lo que siempre que el contenedor esté listo primero, el motor correcto se activará inmediatamente.

---

## Inyección de galletas

Crawl4AI admite la inyección de cookies a nivel del navegador, por lo que el navegador sin cabeza parece haber iniciado sesión al buscar una página. Esto es útil para sitios que requieren una sesión para ver el contenido (por ejemplo, noticias de pago, foros privados, paneles de control con acceso controlado).

El respaldo `safe_http` no admite la inyección de cookies. Las cookies sólo se aplican cuando Crawl4AI está activo.

:::note[Bot detection limits]
La inyección de cookies evita los muros de inicio de sesión, pero no las huellas dactilares del bot. Los sitios con detección agresiva anti-bot (en particular, Twitter/X) detectan a Playwright sin cabeza a través de huellas digitales de Canvas/WebGL y muestran páginas vacías incluso con cookies de sesión válidas. La inyección de cookies funciona bien para sitios que se controlan únicamente mediante autenticación.
:::

### Obteniendo tus galletas

1. Abre su navegador e inicie sesión en el sitio de destino.
2. Abre DevTools (`F12`) > pestaña `Application` > `Storage` > `Cookies` > seleccione el dominio del sitio.
3. Copia el `Value` de cada cookie requerida (normalmente un token de sesión; verifique los nombres de las cookies del sitio).

### Crawl4AI

Configura `CRAWL4AI_COOKIES_JSON` en `.env` como una matriz JSON:

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

Cuando se configura esto, `fetch_url` cambia automáticamente del punto final `/md` a `/crawl` con `browser_config.cookies`. `/md` no admite la inyección de cookies.

### Campos de objetos de cookies

| Campo | Requerida | Descripción |
|---|---|---|
| `name` | Sí | Nombre de la galleta |
| `value` | Sí | Valor de la cookie |
| `domain` | No | Alcance del dominio (por ejemplo, `.x.com`). Recomendado para la corrección. |
| `path` | No | Alcance del camino. El valor predeterminado es `/` si se omite. |

:::caution[Protect session tokens]
Los valores de las cookies son confidenciales, así que trátelos como contraseñas. Otorgan acceso completo a la sesión de su cuenta. No envíe `.env` al control de versiones.
:::

---

## Orden del motor y variables de entorno.

| Variable | Por defecto | Descripción |
|---|---|---|
| `CRAWL4AI_BASE_URL` | desarmada | Habilita Crawl4AI cuando está configurado. Utilice `http://crawl4ai:11235/` de Docker Compose o `http://localhost:11235/` cuando TomoriBot se ejecute directamente en su máquina. |
| `CRAWL4AI_TOKEN` | desarmada | Token bearer obligatorio. Debe coincidir con `CRAWL4AI_API_TOKEN` en el contenedor Crawl4AI, que rechaza conexiones externas sin él. |
| `FETCH_URL_ENGINE_ORDER` | `safe_http` | Lista de motores separados por comas. `safe_http` siempre se añade como respaldo final. Las entradas de Crawl4AI se ignoran cuando no se permite la recuperación en redes privadas (producción sin suscripción voluntaria). |
| `FETCH_URL_TIMEOUT_MS` | `15000` | Tiempo de espera de solicitud por motor para Crawl4AI y otros motores de búsqueda de URL. |
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | Máximo de caracteres devueltos por una llamada de recuperación antes de que se requiera la continuación. |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | Opción de inscripción solo para producción. Fuera de producción (`RUN_ENV`! = `production`), la protección SSRF se relaja automáticamente, por lo que las recuperaciones locales/privadas/internas y el envío de Crawl4AI funcionan sin configuración. Configura `true` solo para permitir recuperaciones de redes privadas en una implementación de producción confiable. |
| `FETCH_URL_FILTER_MODE` | `fit` | Modo de filtro Crawl4AI `/md`. `fit` mantiene las rebajas más limpias para uso de LLM; `fetch_url(..., raw=true)` lo anula por solicitud. |

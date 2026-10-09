---
title: "Configuración: SearXNG"
sidebar:
  order: 3
---

Agrega búsqueda web privada y autohospedada a TomoriBot usando [SearXNG](https://docs.searxng.org/).

La herramienta `web_search` consulta una cadena de respaldo del motor: Brave, SearXNG y DuckDuckGo. La ejecución de una instancia local de SearXNG proporciona una fuente de búsqueda autohospedada cuando un proveedor externo alcanza límites de velocidad o falla, y permite categorías de búsqueda especializadas: `science`, `it`, `files` y `music`.

Elige una ruta de instalación:

### Opción A: Docker Compose (cuando TomoriBot se ejecuta en Docker)

Utilice esta ruta si ejecuta TomoriBot con la pila Docker Compose del repositorio. Luego ejecute con el perfil `searxng`:

```sh
docker compose --profile searxng up -d
```

Configura `SEARXNG_BASE_URL=http://searxng:8080/` en `.env` antes de iniciar este perfil. El bot usa esa dirección para llegar al servicio `searxng`. Deja la variable sin configurar cuando el perfil esté desactivado.

Si ejecuta TomoriBot directamente con `bun run dev`, utilice la ruta independiente a continuación.

Establece `SEARXNG_SECRET` en `.env` en un valor aleatorio separado para la clave de firma del contenedor.

---

### Opción B: Docker independiente (cuando se ejecuta `bun run dev`)

Primero, configure `SEARXNG_BASE_URL=http://localhost:8080/` en `.env` para que el bot sepa dónde conectarse.

Luego, en lugar de ejecutar TomoriBot directamente con `bun run dev`, use `bun run launch --searxng`. Esto maneja el ciclo de vida del contenedor automáticamente y espera a que el contenedor esté en buen estado antes de iniciar el bot:

```sh
bun run launch --searxng
```

Si prefiere administrar el contenedor usted mismo, mantenga `SEARXNG_BASE_URL=http://localhost:8080/` en `.env`. Primero cree la imagen del repositorio para que cargue la configuración de búsqueda JSON y sustituya la clave de firma:

```sh
docker build -t tomoribot-searxng:latest -f servers/searxng/Dockerfile servers/searxng
```

Luego ejecútelo:

PowerShell:

```powershell
docker run -d --name searxng -p 8080:8080 `
  --tmpfs /etc/searxng `
  tomoribot-searxng:latest
```

Intento (Linux/macOS):

```bash
docker run -d --name searxng -p 8080:8080 \
  --tmpfs /etc/searxng \
  tomoribot-searxng:latest
```

Luego ejecute `bun run dev` una vez que el contenedor esté en buen estado (`docker ps` muestra `(healthy)`). Sin `SEARXNG_SECRET` en el entorno del contenedor, la imagen genera una clave de firma efímera.

---

### Opción C: Sin SearXNG

Deja `SEARXNG_BASE_URL` sin configurar. La cadena vuelve a caer hasta `Brave → DuckDuckGo`.

Cuando no se configura ningún servidor SearXNG, el esquema `web_search` ensamblado ya no anuncia categorías exclusivas de SearXNG. Las categorías comunes (`text`, `image`, `video`, `news`) aún aparecen cuando Brave está configurado, y la búsqueda de solo texto aparece cuando solo está disponible el respaldo integrado de DuckDuckGo.

---

## Ajuste del resultado de la imagen

Los resultados de las imágenes SearXNG están validados por HEAD, opcionalmente comprimidos y publicados como archivos adjuntos Discord: UX idéntico a las imágenes de Brave. Si todas las URL candidatas no superan la validación, SearXNG devuelve una lista de texto de enlaces de imágenes en lugar de un error total.

| Variable | Por defecto | Descripción |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3` (máximo 10) | Cuántas imágenes válidas se envían a Discord. Anulado por el argumento `count` del LLM. |
| `SEARXNG_IMAGE_POOL` | `10` | Grupo de URL candidatas cuando el LLM no especifica `count`. Cuando se especifica `count`, el grupo es `count × 3` (con un límite de 30) para absorber fallas de protección de vínculos activos. |
| `WEB_SEARCH_TIMEOUT_MS` | — | Tiempo de espera de solicitud por motor. |

*(Consulta `.env.optional.example` para conocer todos los sintonizables).*

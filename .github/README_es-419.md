### [English](../README.md) | [日本語](README_ja.md) | [繁體中文](README_zh-TW.md) | [简体中文](README_zh-CN.md) | Español | [Português (Brasil)](README_pt-BR.md) | [Tiếng Việt](README_vi.md)

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

> [!NOTE]
> Este README es una breve descripción general. Para la documentación completa y actualizada (guías de configuración, tutoriales de funciones, información de proveedores y más) visita **[docs.tomoribot.app](https://docs.tomoribot.app/)**.

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="../assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

Un asistente de inteligencia artificial personal y sistema de juegos de rol para Discord con autoalojamiento y personalizable, que incluye memoria, múltiples personas, uso de herramientas, multimodalidad y soporte para API o modelos locales.

<p align="center">
  <strong><a href="https://tomoribot.app/">Sitio web oficial</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">Invitar a TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Servidor de Discord</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">Últimos lanzamientos</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">Reportar un error</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">Solicitar una función</a>
  <br />
  <br />

[![GitHub Stars](https://img.shields.io/github/stars/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/forks)
[![GitHub Issues](https://img.shields.io/github/issues/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/pulls)
[![License](https://img.shields.io/github/license/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE)


  </p>

  




<!-- PROJECT LOGO -->
![TomoriBot Banner](../assets/img/tomobanner.png)
[![Bun][Bun.sh]][Bun-url][![Discord.js][Discord.js]][Discord-url][![TypeScript][TypeScript.js]][TypeScript-url][![PostgreSQL][PostgreSQL.org]][PostgreSQL-url]

  
</div>

<!-- ABOUT THE PROJECT -->
## Acerca del proyecto

TomoriBot es un asistente de inteligencia artificial personal y sistema de juegos de rol gratuito y de código abierto para Discord con autoalojamiento, inspirado en SillyTavern y en el descontinuado Clyde de Discord. Se puede usar como un asistente práctico, un compañero personalizable y un compañero de rol para ti en mensajes directos, o para todos en tu servidor de Discord. 

TomoriBot soporta memoria a largo plazo, comportamiento con múltiples personas, herramientas web y MCP, generación de medios en el chat, más de 200 comandos de barra en Discord, y múltiples proveedores, incluyendo proxies personalizados y el autoalojamiento de tus propios modelos para todo, desde la generación de texto hasta la de video.

### Primeros pasos

Puedes [invitar a la TomoriBot pública](https://discord.com/oauth2/authorize?client_id=841644102059556915) a tu servidor de Discord, o [configurar el autoalojamiento de tu propia instancia](#autoalojamiento) si prefieres un control total sobre tu privacidad y claves de API. TomoriBot utiliza las mejores prácticas de seguridad y cifrado para mantener los datos a salvo, pero el autoalojamiento garantiza que todos los datos permanezcan completamente en tu dispositivo. 

Después de agregarla a tu servidor usando cualquiera de los métodos anteriores, ejecuta el comando de barra `/setup` para ver las instrucciones. Luego puedes simplemente decir su nombre (o mencionarla) para recibir una respuesta. 

## Demostración de funciones


![Screenshots 1](../assets/img/scs/1.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/capabilities/tools-and-extensions/">Conversación impulsada por inteligencia artificial agentic</a></h3>
<p align="center">TomoriBot tiene MUCHAS herramientas que le permiten ir más allá de solo chatear, como buscar en la web, establecer tareas y recordatorios recurrentes, utilizar los emotes y stickers de tu servidor, y opciones de memoria como RAG y memoria a corto plazo que le permiten recordar el contexto entre canales y servidores.</p>

<br />


![Screenshots 2](../assets/img/scs/2.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/capabilities/media-generation/">Entrada y salida multimodal completa</a></h3>
<p align="center">TomoriBot puede procesar imágenes, audio y video enviados
  directamente en Discord y generarlos a cambio usando tus propios puntos de enlace de modelos locales o mediante claves de API, todo lo cual está cifrado dentro de una base de datos persistente. ¡Puedes encontrar flujos de trabajo de ComfyUI listos para usar en <code>assets/comfyui-workflows/</code> y servidores locales de inferencia de audio en <code>servers/</code>!</p>

<br />

![Screenshots 3](../assets/img/scs/3.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/chatting-personality/multiple-personas/">Soporte para múltiples personas</a></h3>
<p align="center">La personalidad, el comportamiento y el avatar de TomoriBot en el servidor se pueden cambiar, crear y exportar fácilmente para otros como personas (similar a las tarjetas de personajes de inteligencia artificial compartibles). Importa e incluso transforma tus tarjetas favoritas de SillyTavern a través del comando de barra <code>/persona generate</code>. Puedes tener una cantidad ilimitada de personas diferentes en un solo servidor, cada una con sus propias memorias y agendas. También puedes organizar que trabajen entre sí para realizar tareas en tu servidor (o simplemente para bromear entre ellas).</p>

<br />


![Screenshots 4](../assets/img/scs/4.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/command-reference/">Más de 200 comandos nativos para configuración</a></h3>
<p align="center">Todo se puede gestionar a través de los comandos de barra nativos de Discord y la interfaz de usuario interactiva. ¡Administra por completo las personas, los mensajes, ajusta los parámetros del modelo, configura servidores de herramientas MCP, ajusta permisos, configura la memoria, establece límites de cuota para los miembros del servidor y mucho más! También puedes preguntarle directamente a TomoriBot qué puede hacer y cuáles son sus comandos de barra. Actualmente, se está desarrollando un panel web para una gestión aún más fácil.</p>

<br />


![Screenshots 6](../assets/img/scs/6.png)

<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/integrations/sillytavern-support/">Integración con SillyTavern (Beta)</a></h3>
<p align="center">Usa tus preajustes favoritos de SillyTavern directamente en Discord a través de TomoriBot, que ajusta su prompt por completo; simplemente suelta el archivo .json a través de <code>st-preset</code>. Los nuevos grupos de casillas de verificación nativos de Discord para los modales hacen que sea fácil activar y desactivar nodos como en SillyTavern. También puedes importar tarjetas de personajes de SillyTavern directamente a través del comando de barra <code>/persona import</code>, o puedes modificarlas primero con <code>/persona generate</code>.</p>

![Screenshots 5](../assets/img/scs/5.png)
<h3 align="center"><a href="https://docs.tomoribot.app/es-419/features/">¡Muchas más funciones, y sumando!</a></h3>
<p align="center">Un montón de funciones divertidas que son fáciles de configurar, que van desde prácticos saludos automáticos para los nuevos miembros del servidor y el movimiento entre canales, hasta cosas graciosas como suplantaciones de usuarios para hacer algunas bromas. Constantemente se están desarrollando nuevas funciones, así que reporta cualquier error a través de los issues de GitHub o del servidor oficial de Discord (o para compartir sugerencias divertidas).</p>

## Recursos útiles

- [Lista completa de proveedores soportados](https://docs.tomoribot.app/es-419/features/setup-administration/providers-and-models/#supported-providers)
- [Cómo ejecutar modelos locales](https://docs.tomoribot.app/es-419/self-hosting/local-endpoints/)
- [Seguridad y modelos de amenazas](https://docs.tomoribot.app/en/wiki/threat-models/)
- [Hoja de ruta oficial de TomoriBot](https://github.com/users/Bredrumb/projects/1/views/1)
- [Macros de herramientas para personalización de prompts](https://docs.tomoribot.app/es-419/features/capabilities/tools-and-extensions/)

<!-- GETTING STARTED -->
## Autoalojamiento

Elige una ruta de instalación:

- **A. Configuración local de Bun (Recomendado):** requiere Bun y PostgreSQL o Docker para la base de datos.
- **B. Configuración de Docker Compose:** solo requiere Docker para ejecutar el bot y la base de datos, pero los scripts de mantenimiento en el host aún necesitan las herramientas del host.

La ruta recomendada para la mayoría de los usuarios que optan por el autoalojamiento es el asistente de configuración local de Bun. Su ruta de **Instalación completa** predeterminada crea `.env`, genera un `CRYPTO_SECRET` seguro, te pide el token de bot de Discord, configura PostgreSQL, ejecuta `bun install --frozen-lockfile` y luego intenta configurar la base de datos liviana y los extras del asistente de inteligencia artificial.

### A. Configuración local de Bun

1. **Clona el repositorio**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   ```

2. **Ejecuta el asistente de configuración** (más información en la **[guía del Asistente de configuración](https://docs.tomoribot.app/es-419/self-hosting/setup-wizard/)**)
   ```sh
   bun run setup
   ```

3. **Inicia TomoriBot**
    ```sh
    bun run dev
    ```

Una vez que veas `TomoriBot up and running!`, ejecuta el comando de barra `/setup` en Discord.

### B. Configuración de Docker Compose

Docker Compose compila y ejecuta TomoriBot junto con PostgreSQL. No utiliza el asistente de configuración.

**Variables `.env` requeridas para Docker Compose:**
- `DISCORD_TOKEN` - Tu token de bot de Discord
- `CRYPTO_SECRET` - Clave de cifrado de 32 caracteres
- `POSTGRES_PASSWORD` - Contraseña de la base de datos (las otras configuraciones de la base de datos se configuran automáticamente)

Para Docker Compose, comienza desde `.env.example`, luego agrega `POSTGRES_PASSWORD` si aún no lo has establecido. Los valores opcionales de ajuste de Docker o del tiempo de ejecución todavía se pueden copiar desde `.env.optional.example`.

```sh
# Compila e inicia TomoriBot y su base de datos
docker compose up --build
```

Para inicios posteriores, `docker compose up` es suficiente, a menos que hayas cambiado el código o las dependencias.

### C. Servidores locales opcionales

TomoriBot soporta servidores locales opcionales junto a cualquiera de las rutas de instalación para mejorar sus herramientas y agregar monitoreo local: SearXNG para la búsqueda web, Crawl4AI para la obtención de páginas renderizadas en el navegador, y servidores de voz locales para texto a voz y voz a texto.

**Con la configuración local de Bun (A)**, usa `bun run launch` en lugar de `bun run dev`, ejemplos de ejecuciones:

```sh
# Con los contenedores Docker de SearXNG y Crawl4AI
bun run launch --searxng --crawl4ai

# Con un servidor local de texto a voz después de seguir los documentos de configuración de voz
bun run launch --qwen3tts
bun run launch --voxcpm2
bun run launch --cosyvoice3

# Ver todas las banderas disponibles
bun run launch --help
```

Banderas disponibles: `--searxng`, `--crawl4ai`, `--qwen3tts`, `--chatterbox`, `--irodoritts`, `--voxcpm2`, `--fishs2`, `--cosyvoice3`, `--moss`, `--whisperx`, `--help`

**Ctrl+C** detiene el bot y cualquier proceso de servidor de Python. Los contenedores de Docker (`--searxng`, `--crawl4ai`) se dejan en ejecución intencionalmente; detenlos manualmente con `docker stop searxng` / `docker stop crawl4ai` cuando hayas terminado.

**Con Docker Compose (B)**, los servidores locales son opcionales y se activan mediante perfiles de Compose en su lugar:

```sh
# + Búsqueda web SearXNG (metabúsqueda con autoalojamiento)
docker compose --profile searxng up

# + Obtención de páginas renderizadas en el navegador Crawl4AI
docker compose --profile fetch-crawl4ai up

# + Ambos a la vez
docker compose --profile searxng --profile fetch-crawl4ai up
```

Consulta las guías a continuación para obtener todos los detalles de configuración:

- **[Búsqueda web SearXNG](https://docs.tomoribot.app/es-419/self-hosting/local-endpoints/setup-searxng/)** - Una instancia de metabúsqueda con autoalojamiento para evitar los límites de API de los motores individuales en la herramienta `web_search`.
- **[Crawl4AI](https://docs.tomoribot.app/es-419/self-hosting/local-endpoints/setup-crawl4ai/)** - Un servidor de renderizado de navegador para obtener y procesar páginas web pesadas en JavaScript para la herramienta `fetch_url`.
- **[Texto a voz](https://docs.tomoribot.app/es-419/self-hosting/local-endpoints/text-to-speech/)** / **[Voz a texto](https://docs.tomoribot.app/es-419/self-hosting/local-endpoints/speech-to-text/)** - Servidores de voz en Python para los mensajes de voz de TomoriBot; su entorno virtual debe configurarse una vez de antemano.

### Actualizar TomoriBot

Para actualizar tu instancia con autoalojamiento a la última versión, primero detén el bot (para que la copia de seguridad y cualquier migración se ejecuten en una base de datos inactiva) y luego ejecuta el actualizador, que primero realiza una copia de seguridad:

```sh
bun run update
```

El comando ejecuta esta secuencia y se detiene inmediatamente si falla algún paso:

1. **`bun run backup`** - realiza una copia de seguridad completa de la base de datos en `/backups/` *antes* de tocar cualquier código. Si la copia de seguridad falla, la actualización se cancela dejando tu implementación completamente intacta.
2. **`git pull --rebase --autostash`**
3. **`bun install --frozen-lockfile`**

Luego, reinicia TomoriBot con `bun run dev` o `bun run launch`

Banderas útiles:

| Bandera | Efecto |
|---|---|
| `--build` | También ejecuta `bun run build` después de instalar las dependencias |
| `--docker` | Ruta de Docker Compose: reemplaza el paso 3 con `docker compose build` + `docker compose up -d` |
| `--skip-backup` | Omite la copia de seguridad previa a la actualización (no recomendado) |
| `--yes` | Omite el mensaje de confirmación antes de comenzar |

Consulta la **[Documentación de mantenimiento](https://docs.tomoribot.app/es-419/features/command-reference/)** completa para obtener más detalles sobre todos los scripts del host.

<!-- AFTER SETUP -->
### Después de invitar / Configuración

#### Comandos básicos

- `/setup` - Configuración inicial del bot para tu servidor
- `/config` - Múltiples formas de ajustar a TomoriBot
- `/personal memories` - Administra tus memorias personales
- `/memories` - Administra memorias del servidor, documentos y la memoria a corto plazo
- `/moderation` - Administra el acceso de miembros, la lista negra de usuarios, las restricciones de canal, de personas y de roles

Consulta la **[Referencia de comandos](https://docs.tomoribot.app/es-419/features/command-reference/)** completa para ver todos los comandos de barra.

#### Interacción de chat

Simplemente menciona al bot en un servidor o usa las palabras de activación configuradas para iniciar una conversación:
```
@TomoriBot hola, ¿qué pasa?
```

¡O envíale un mensaje directo a TomoriBot y dile hola!

<!-- CONTRIBUTING -->
## Contribuir

¡Las contribuciones a TomoriBot se agradecen enormemente! Por favor, revisa los siguientes recursos antes de abrir un pull request:

- **[Documentación de contribuciones](https://docs.tomoribot.app/en/contributing/)**: Guías completas paso a paso para agregar comandos de barra, herramientas, manejadores de eventos, nuevos proveedores de inteligencia artificial y configuraciones regionales.
- **[Pautas de contribución](CONTRIBUTING.md)**: Reglas del repositorio que cubren ramas, controles de calidad y el alcance de las contribuciones que son bienvenidas sin discusión previa.

<!-- LEGAL -->
## Legal y licencia

### Para los usuarios de la instancia oficial alojada de TomoriBot
- **[Términos de servicio](https://docs.tomoribot.app/es-419/legal/terms-of-service/)** - Reglas y pautas para el uso del bot
- **[Política de privacidad](https://docs.tomoribot.app/es-419/legal/privacy-policy/)** - Cómo manejamos tus datos

Estos documentos también están accesibles en Discord utilizando los comandos de barra `/legal terms-of-service` y `/legal privacy-policy`.

### Para los usuarios que optan por el autoalojamiento o usan bifurcaciones
Tú controlas tus propios datos y eres responsable de que tu implementación cumpla con los términos bajo la [**Licencia Pública General de GNU Affero v3.0**](https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE).

<!-- CONTACT -->
## Contacto y enlaces

**Sitio web oficial**: [https://tomoribot.app](https://tomoribot.app/)

**Enlace del proyecto**: [https://github.com/Bredrumb/TomoriBot](https://github.com/Bredrumb/TomoriBot)

**Correo electrónico**: bredrumb@gmail.com

**Discord**: [Servidor de soporte oficial](https://discord.gg/bjCfHm9QsB)

<!-- SUPPORT -->
## Apoyar el proyecto

Si TomoriBot te parece útil y quieres apoyar su desarrollo continuo, ¡considera dejar una ⭐ en GitHub o dar tu apoyo a través de Ko-fi!

<p align="left">

  &nbsp;
  <a href="https://ko-fi.com/bredrumb">
    <img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi">
  </a>
</p>

<!-- MARKDOWN LINKS & IMAGES -->
[TypeScript.js]: https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Bun.sh]: https://img.shields.io/badge/Bun-f472b6?style=for-the-badge&logo=bun&logoColor=white
[Bun-url]: https://bun.sh/
[Discord.js]: https://img.shields.io/badge/Discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white
[Discord-url]: https://discord.js.org/
[PostgreSQL.org]: https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white
[PostgreSQL-url]: https://www.postgresql.org/
[Google.ai]: https://img.shields.io/badge/Google%20AI-4285F4?style=for-the-badge&logo=google&logoColor=white
[Google-url]: https://ai.google.dev/

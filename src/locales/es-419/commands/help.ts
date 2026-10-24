export default {
  help: {
    description: `Guías de configuración, funciones, proveedores, memoria, comportamiento, herramientas y multimedia.`,
    dashboard: {
      categories: {
        setup: `Configuración`,
        features: `Funciones`,
        moderation: `Moderación`,
        plugins: `Plugins`,
      },
      pages: {
        custom_endpoints: `Endpoints personalizados`,
      },
      page_reference: `la página **{page}** en \`/help\``,
      page_select_placeholder: `Elige una página`,
      subsection_select_placeholder: `Elige un tema`,
      provider_select_placeholder: `Elige proveedor`,
      optional_provider_select_placeholder: `Servicios opcionales`,
      previous_button: `← Anterior`,
      next_button: `Siguiente →`,
      docs_link_label: `Leer la versión web`,
      support_link_label: `Obtener soporte técnico`,
      sections: {
        getting_started: `Primeros pasos`,
        getting_started_description: `Clave, activaciones, persona y qué probar después`,
        personal_profile: `Perfil personal`,
        personal_profile_description: `Tu apodo, tus memorias, tu propio proveedor`,
        custom_endpoints: `Endpoints personalizados (Avanzado)`,
        custom_endpoints_description: `Registra un endpoint que alojes o en el que confíes`,
        multiple_personas: `Múltiples personas`,
        multiple_personas_description: `Mantén varias identidades e importa tarjetas de personajes`,
        media_generation: `Generación multimedia`,
        media_generation_description: `Crea imágenes, videos y mensajes de voz`,
        tons_of_tweakability: `Mucha personalización`,
        tons_of_tweakability_description: `Dónde están los ajustes de comportamiento, servidor y personales`,
        memory: `Memoria`,
        memory_description: `Lo que recuerdo y por cuánto tiempo`,
        scheduled_tasks: `Tareas programadas`,
        scheduled_tasks_description: `Recordatorios y tareas a las que regreso por mi cuenta`,
        server_moderation: `Moderación del servidor`,
        server_moderation_description: `Quién puede usarme aquí y en dónde`,
        quotas: `Cuotas`,
        quotas_description: `Limita cuánta generación permite este servidor`,
        age_restricted_commands: `Comandos con restricción de edad`,
        age_restricted_commands_description: `Funciones para adultos y lo que no filtro`,
        user_byok: `BYOK de usuario (Avanzado)`,
        user_byok_description: `Haz que cada miembro traiga su propia clave`,
        sillytavern_presets: `Preajustes de SillyTavern`,
        sillytavern_presets_description: `Construye mis prompts desde un preajuste importado`,
        mcp_servers: `Servidores MCP`,
        mcp_servers_description: `Conecta herramientas externas que realmente puedo usar`,
        matrix: `Matrix`,
        matrix_description: `Conecta una sala de Matrix a un canal de Discord`,
      },
      subsections: {
        get_api_key: `Obtener una clave de API`,
        get_api_key_description: `Dónde conseguir una y cómo mantenerla segura`,
        change_trigger_behavior: `Cambiar comportamiento de activación`,
        change_trigger_behavior_description: `Cuándo y dónde tengo permitido responder`,
        create_first_persona: `Crea tu primera persona`,
        create_first_persona_description: `Edítame, genera una nueva o importa una`,
        explore_features: `¡Explora mis funciones!`,
        explore_features_description: `Un breve recorrido de lo que puedo hacer ahora`,
        nickname_pronouns: `Tu apodo y pronombres`,
        nickname_pronouns_description: `Cómo me dirijo a ti en todos los servidores`,
        personal_memories: `Memorias personales`,
        personal_memories_description: `Lo que recuerdo sobre ti específicamente`,
        personal_providers: `Proveedores personales (Avanzado)`,
        personal_providers_description: `Responde con tu propia clave y modelo`,
        text_models: `Modelos de texto`,
        text_models_description: `Registra un endpoint de chat y su modelo`,
        comfyui: `ComfyUI (para video e imagen)`,
        comfyui_description: `Sube un flujo de trabajo y genera a partir de él`,
        text_to_speech: `Texto a voz (para voz)`,
        text_to_speech_description: `Dale una voz real a cada persona`,
        image_generation: `Generación de imágenes`,
        image_generation_description: `Dibuja tu prompt o la escena actual`,
        video_generation: `Generación de video`,
        video_generation_description: `Clips cortos con un marco inicial opcional`,
        speech_generation: `Generación de voz`,
        speech_generation_description: `Convierte texto en un mensaje de voz`,
        art_search: `Búsqueda de arte`,
        art_search_description: `Publica arte anime existente de Danbooru`,
        behavior_tuning: `Ajuste de comportamiento`,
        behavior_tuning_description: `Modelo, humanizador, instrucciones y herramientas`,
        server_wide_settings: `Ajustes del servidor`,
        server_wide_settings_description: `Límites que se aplican a todos aquí`,
        personal_settings: `Ajustes personales`,
        personal_settings_description: `Tus preferencias, en todos los servidores`,
        long_term_memory: `Memoria a largo plazo`,
        long_term_memory_description: `Datos que guardo de forma permanente`,
        short_term_memory: `Memoria a corto plazo`,
        short_term_memory_description: `Mis notas de trabajo de esta conversación`,
        rewards_punishments: `Recompensas y castigos`,
        rewards_punishments_description: `Gestos que noto y recuerdo`,
        memory_tagging: `Etiquetado de memoria (Avanzado)`,
        memory_tagging_description: `Despierta una memoria solo cuando es relevante`,
        blacklisting: `Listas negras`,
        blacklisting_description: "Haz que ignore por completo a un miembro",
      },
    },
    breadcrumbs: {
      persona: {
        general: `Persona > Identidad y personalidad`,
        advanced: `Persona > Avanzado`,
        voice: `Persona > Voz`,
        sprites: `Persona > Sprites`,
        triggers: `Persona > Activaciones`,
      },
      behavior: {
        general: `Comportamiento > Comportamiento general`,
        trigger: `Comportamiento > Comportamiento de activación`,
        memory: `Comportamiento > Memoria avanzada`,
      },
      channels: {
        destinations: `Canales > Registros y bienvenida`,
        "auto-trigger": `Canales > Activación automática`,
        overrides: `Canales > Excepciones de canal`,
      },
      plugins: {
        "available-tools": `Plugins > Herramientas disponibles`,
        "mcp-servers": `Plugins > Servidores MCP`,
        "sillytavern-presets": `Plugins > Preajustes de SillyTavern`,
      },
      models: {
        switch: `Modelos > Cambiar modelos`,
        voices: `Modelos > Parámetros y voces TTS`,
        image: `Modelos > Valores de imagen`,
        parameters: `Modelos > Muestreadores de texto`,
      },
      personal: {
        profile: {
          general: `Perfil > Preferencias generales`,
        },
        privacy: {
          controls: `Privacidad > Controles de privacidad`,
        },
        models: {
          switch: `Modelos > Cambiar modelos`,
        },
        advanced: {
          spotlight: `Avanzado > Foco personal`,
        },
      },
      moderation: {
        "member-access": `Acceso de miembros`,
        "user-blacklist": `Lista negra de usuarios`,
        whitelist: `Lista blanca`,
        quotas: `Cuotas`,
      },
    },
    features: {
      title: `Funciones de TomoriBot (Versión {version})`,
    },
    matrix: {
      bot_user_fallback: `la cuenta de bot de Matrix configurada`,
    },
    "api-key": {
      provider_choice_brave: `Brave Search`,
      provider_choice_google: `Google Gemini (Recomendado, Gratis)`,
      provider_choice_deepseek: `DeepSeek`,
      provider_choice_custom: `Endpoint personalizado`,
      provider_choice_nvidia: `NVIDIA NIM (Gratis)`,
      provider_choice_novelai: `NovelAI`,
      provider_choice_openrouter: `OpenRouter (Recomendado)`,
      provider_description_google: `Propósito general y tiene uso gratuito generoso`,
      provider_description_openrouter: `De pago, confiable; genera imágenes, videos y voz`,
      provider_description_deepseek: `Alternativa de pago económica que no tiene mucha censura`,
      provider_description_novelai: `Para rol sin censura, historias y generación de imágenes`,
      provider_description_nvidia: `Modelos alojados de texto, incrustaciones e imágenes`,
      provider_description_zai: `Modelos GLM con límites de política de uso de código`,
      provider_description_vertexexpress: `Gemini mediante Google Cloud con clave de API`,
      provider_description_vertex: `Gemini Enterprise mediante credenciales de Google Cloud`,
      provider_description_custom: `Alojado o proxy; la autenticación puede ser opcional`,
      provider_description_brave: `Búsqueda opcional de web, imágenes, videos y noticias`,
      provider_description_elevenlabs: `API de voz y transcripción, no es un modelo de texto`,
      provider_choice_zai: `Z.ai`,
      provider_choice_vertex: `Google Vertex AI`,
      provider_choice_vertexexpress: `Google Vertex AI Express`,
      provider_choice_elevenlabs: `ElevenLabs TTS`,
      brave_title: `Configurar clave de API de Brave Search`,
      brave_description: `Brave Search es opcional y solo mejora mis búsquedas. NO potencia mi IA ya que eso lo maneja tu proveedor principal.
- Permite búsqueda de imágenes, videos y noticias
- Proporciona información en tiempo real de internet
- Mejora mi capacidad para responder preguntas actuales`,
      brave_getting_key_title: `Obtener tu clave de API:`,
      brave_getting_key_description: `1. Visita la [API de Brave Search](https://brave.com/search/api/)
2. Regístrate para obtener una cuenta gratuita
3. Ve a tu sección de [Claves de API](https://api-dashboard.search.brave.com/app/keys)
4. Crea una nueva clave de API
5. Copia e ingresa tu clave usando {configBraveapiSet}`,
      brave_important_title: `Notas importantes:`,
      brave_important_description: `- Esto está separado de tu proveedor de IA principal
- Sin la clave de Brave, aún puedo hacer búsquedas web
- Brave incluye $5 en créditos gratis, luego se cobra. Si solo quieres el nivel gratuito, establece un límite en el [panel de límites de Brave](https://api-dashboard.search.brave.com/app/subscriptions/usage-limits)`,
      brave_footer: `Para tu proveedor de IA principal, elige otro de la página de Claves de API en \`/help\``,
      google_title: `Configurar clave de API de Google Gemini`,
      google_description: `Google Gemini ofrece niveles gratuitos y de pago con potentes modelos de IA.
- Nivel gratuito disponible
- [Política de Privacidad de Gemini](https://ai.google.dev/gemini-api/terms)`,
      google_getting_key_title: `Obtener tu clave de API:`,
      google_getting_key_description: `1. Visita [Google AI Studio](https://aistudio.google.com/apikey)
2. Haz clic en \`Create API Key\` arriba a la derecha
3. Copia esta clave de API en {configSetup} o {configApikeySet}`,
      google_footer: `Después de configurar este proveedor, puedes cambiar su modelo predeterminado con {configModel}`,
      deepseek_title: `Configurar clave de API de DeepSeek`,
      deepseek_description: `DeepSeek es un proveedor de texto de pago por uso.
- [Documentación de la API de DeepSeek](https://api-docs.deepseek.com/)`,
      deepseek_getting_key_title: `Obtener tu clave de API:`,
      deepseek_getting_key_description: `1. Visita las [Claves de API de DeepSeek](https://platform.deepseek.com/api_keys)
2. Inicia sesión o crea una cuenta
3. Crea una nueva clave de API
4. Si es necesario, agrega créditos en tu cuenta
5. Copia esta clave de API en {configSetup} o {configApikeySet}`,
      deepseek_footer: `Después de configurar este proveedor, puedes cambiar su modelo predeterminado con {configModel}`,
      custom_title: `Configuración de endpoint personalizado`,
      custom_description: `El flujo heredado del Proveedor Personalizado en línea se ha movido.

Para endpoints del servidor, usa {configSetup} y elige **Endpoint personalizado (terminar después)**, luego ejecuta {configCustomModelsAdd} y selecciónalo con {configModel}.

Para endpoints personales, usa {personalCustomModelsAdd}.

Usa {helpCustomModels} para ver la guía completa, tipos compatibles y notas de capacidades.`,
      nvidia_title: `Configurar clave de API de NVIDIA NIM`,
      nvidia_description: `NVIDIA NIM ofrece API alojadas de texto, incrustaciones e imágenes a través de NVIDIA Build.`,
      nvidia_getting_key_title: `Obtener tu clave de API:`,
      nvidia_getting_key_description: `1. Visita [NVIDIA Build](https://build.nvidia.com/)
2. Inicia sesión o crea una cuenta de desarrollador
3. Crea o gestiona tus claves desde la [página de Claves](https://build.nvidia.com/settings/api-keys)
4. Copia esta clave de API en {configSetup} o {configApikeySet}`,
      nvidia_important_title: `Notas importantes:`,
      nvidia_important_description: `- Texto e incrustaciones usan \`integrate.api.nvidia.com\`
- Imágenes usan el endpoint FLUX en \`ai.api.nvidia.com\``,
      nvidia_footer: `Después de configurar este proveedor, puedes cambiar los modelos con {configModel}, {configModelEmbedding} y {configModelImage}`,
      zai_title: `Configurar clave de API de Z.ai`,
      zai_description: `Z.ai da acceso a los modelos GLM a través de una API general y un endpoint de código separado.

⚠️ **Actualización de Términos:** Los Términos de Z.ai ahora solo permiten código/agentes. Usar el endpoint general para chat normal es bajo tu propio riesgo.`,
      zai_getting_key_title: `Obtener tu clave de API:`,
      zai_getting_key_description: `1. Visita la [Plataforma Z.ai](https://z.ai)
2. Inicia sesión o crea una cuenta
3. Ve a Claves de API en tu panel
4. Crea una nueva clave de API
5. Copia esta clave de API en {configSetup} o {configApikeySet}`,
      zai_important_title: `Notas importantes:`,
      zai_important_description: `- Usa el endpoint general para chat, razonamiento e imágenes
  - El endpoint de codificación es para flujos de código
  - ⚠️ Los Términos de Z.ai limitan el uso a codificación, el chat/rol general es bajo tu riesgo`,
      zai_footer: `Después de configurar este proveedor, puedes cambiar su modelo predeterminado con {configModel}`,
      novelai_title: `Configurar clave de API de NovelAI`,
      novelai_description: `NovelAI es un servicio de suscripción enfocado en historias creativas y juegos de rol.
- Mensajes sin censura ilimitados
- Soporta generación de texto y de imágenes (se configura por separado)
- Los modelos de texto de NovelAI no soportan visión
- [Términos de Servicio de NovelAI](https://novelai.net/terms)`,
      novelai_getting_key_title: `Obtener tu clave de API:`,
      novelai_getting_key_description: `1. Visita [NovelAI](https://novelai.net/stories)
2. Ve a los ajustes con el ícono ⚙️ arriba a la izquierda
3. Ve a \`Account\`
4. Busca \`Get Persistent API Token\` (¡requiere suscripción!)
5. Copia esta clave de API en {configSetup} o {configApikeySet}`,
      novelai_footer: `Después de configurar este proveedor, puedes cambiar su modelo predeterminado con {configModel}`,
      openrouter_title: `Configurar clave de API de OpenRouter`,
      openrouter_description: `OpenRouter permite acceder a modelos de distintos proveedores pagando por uso.
 - Acceso a los modelos más potentes (algunos gratis)
 - [Términos de Servicio de OpenRouter](https://openrouter.ai/terms)`,
      openrouter_getting_key_title: `Obtener tu clave de API:`,
      openrouter_getting_key_description: `1. Visita [OpenRouter](https://openrouter.ai/settings/keys)
2. Haz clic en \`Create API Key\`
3. Copia esta clave en {configSetup} o {configApikeySet}`,
      openrouter_important_title: `Notas importantes:`,
      openrouter_important_description: `- **Modelos gratuitos tienen límites de tasa**
- **Revisa los precios** antes de elegir un modelo
- Tus ajustes de OpenRouter se aplican aquí
- Si necesitas un modelo no listado, sugierelo en {supportServer}`,
      openrouter_footer: `Después de configurar este proveedor, puedes cambiar su modelo predeterminado con {configModel}`,
      vertex_title: `Configurar Google Vertex AI`,
      vertex_description: `Google Vertex AI da acceso empresarial a Gemini mediante Google Cloud.
- Usa Credenciales Predeterminadas (ADC), sin claves
- Usa ADC de gcloud o una cuenta de servicio alojada
- [Documentación de Vertex AI](https://cloud.google.com/vertex-ai/docs)`,
      vertex_getting_key_title: `Configuración:`,
      vertex_getting_key_description: `**Paso 1: Instala la [CLI de Google Cloud](https://cloud.google.com/cli)**

**Paso 2: Crea un proyecto de Google Cloud**
Ejecuta: \`gcloud projects create PROJECT_ID --name="Vertex AI Project"\`

**Paso 3: Establécelo como activo**
Ejecuta: \`gcloud config set project PROJECT_ID\`

**Paso 4: Vincula una cuenta de facturación**
Ejecuta: \`gcloud billing accounts list\` para encontrar tu ID,
luego: \`gcloud billing projects link PROJECT_ID --billing-account=ACCOUNT_ID\`

**Paso 5: Habilita la API de Vertex AI**
Ejecuta: \`gcloud services enable aiplatform.googleapis.com\`

**Paso 6: Configura las ADC**
Ejecuta: \`gcloud auth application-default login\` e inicia sesión.

**Paso 7: Ingresa tu configuración**
Ingresa \`{project_id}::{location}\` con {configSetup} o {configApikeySet}
- Usa \`global\` como ubicación (recomendado para modelos en vista previa)
- Ejemplo: \`my-vertex-project-12345::global\``,
      vertex_important_title: `Notas importantes:`,
      vertex_important_description: `- El valor almacenado es **configuración**, no un secreto
- Las peticiones usan la identidad ADC del host
- La API de AI Studio no funciona aquí. El proyecto necesita facturación y acceso a Vertex.
- Soporta chat, herramientas, streaming y más`,
      vertex_footer: `Después de configurar este proveedor, puedes cambiar su modelo predeterminado con {configModel}`,
      vertexexpress_title: `Configurar Google Vertex AI Express`,
      vertexexpress_description: `Google Vertex AI Express da acceso a Gemini en Vertex con clave de API.
- Usa tu clave de API en lugar de ADC del host
- Ideal para BYOK donde los usuarios guardan su clave
- Función en vista previa con un catálogo reducido
- [Resumen del Modo Express](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview)`,
      vertexexpress_getting_key_title: `Pasos de configuración:`,
      vertexexpress_getting_key_description: `1. Abre [Modo Express de Vertex AI](https://console.cloud.google.com/expressmode)
2. Si se te redirige a Google Cloud estándar, usa el proveedor \`vertex\` en su lugar.
3. Abre **APIs y Servicios > Credenciales** y copia la clave
4. Agrega la clave con {configSetup} o {configApikeySet}
5. Elige un modelo Express con {configModel}`,
      vertexexpress_important_title: `Notas importantes:`,
      vertexexpress_important_description: `- Guarda la clave de API sin \`{project_id}::{location}\`
- No necesitas configuración de ubicación aquí
- Los proyectos completos deben usar \`vertex\`
- El catálogo de modelos es limitado
- Imágenes disponibles, pero no video ni incrustaciones
- El Modo Express está en vista previa de Google`,
      vertexexpress_footer: `Después de configurar este proveedor, puedes cambiar su modelo predeterminado con {configModel}`,
    },
    elevenlabs: {
      description: `Aprende a configurar ElevenLabs texto a voz`,
      title: `Configurar ElevenLabs TTS`,
      getting_key_title: `Obtener tu clave de API:`,
      getting_key_description: `1. Visita [ElevenLabs](https://elevenlabs.io/app/settings/api-keys)
2. Regístrate o inicia sesión
3. Crea una nueva clave de API
4. Copia esta clave usando {configSpeechElevenlabs}`,
      choosing_voice_title: `Elegir una voz:`,
      choosing_voice_description: `Después de configurar la clave, usa {configSpeechVoiceAssign} para ver las voces disponibles.
- Agrega más desde la [Biblioteca](https://elevenlabs.io/app/voice-library), donde puedes clonar voces.`,
      free_voices_title: `Voces predeterminadas (Gratis):`,
      free_voices_description: `Solo las voces predeterminadas funcionan en el plan gratuito. Revisa la lista en [Voces Predeterminadas](https://elevenlabs-sdk.mintlify.app/voices/premade-voices), luego usa {configSpeechElevenlabs} o {configSpeechVoiceAssign} para asignar una.`,
      important_notes_title: `Notas importantes:`,
      important_notes_description: `- Los caracteres se cuentan cuando genero mensajes de voz
- El nivel gratuito tiene límites; revisa tu panel
- La transcripción visible se controla con {configSpeechTranscripts}`,
      footer: `Ejecuta {configSpeechElevenlabs} de nuevo para actualizar la clave de ElevenLabs.`,
    },
    getting_started: {
      title: `Primeros pasos`,
      description: `Guía sobre cómo empezar conmigo y usar mis funciones`,
      get_api_key: {
        title: `Obtener una clave de API`,
        description:
          "Una clave de API me da acceso al modelo de un proveedor de IA. Todo lo que genero se factura a esa clave, así que trátala como cualquier otra contraseña. Para terminar necesito una:\n> **1.** Elige un proveedor para abrir su guía.\n> **2.** Copia la clave. **NO la compartas** con nadie, y nunca la pegues en un canal: solo en la caja que te abrirá {setup}.\n> **3.** Ejecuta {setup} y pega la clave cuando te la pida.",
        picker_footer:
          "-# Si tu endpoint no está listado, omite la clave y lee **Endpoints personalizados (Avanzado)** aquí.",
      },
      change_trigger_behavior: {
        title: `Cambiar comportamiento de activación`,
        description:
          "De forma predeterminada respondo si me llamas por mi nombre, me mencionas, o me respondes. Puedes ampliar eso, limitarlo o apagarlo por canal.\n\n**Dónde tengo permitido hablar**\nPuedes hacer que solo responda en canales en la lista blanca. Agrégalos en {moderationWhitelist}.\n> Un canal que no esté en la lista permanece en silencio.\n\n**Hablar por mi cuenta**\n{configAutoTrigger} me permite enviar automáticamente un mensaje cada pocos mensajes o al azar.\n\n**Activarme solo con menciones**\nEl modo de activación deliberada evita que responda a un simple llamado por nombre. Me hace esperar por menciones. Enciéndelo en {configBehaviorTrigger}.",
      },
      create_first_persona: {
        title: `Crea tu primera persona`,
        description:
          "Una *persona* soy yo con otro nombre, avatar y personalidad, ¡pero con las mismas funciones! Edita la que ya tienes, o crea nuevas.\n\n**Cambia la que tienes**\n{configPersonaGeneral} establece mi nombre, personalidad y cómo me dirijo a las personas. {configPersonaAppearance} establece mi avatar.\n\n**Escribe una nueva desde una oración**\n{personaGenerate} construye una persona completa desde una descripción corta. {personaCreate} te da la plantilla en blanco.\n\n**Trae una desde otro lugar**\n{personaImport} acepta tarjetas de personajes descargadas de sitios de tarjetas como botbooru o chub.",
        footer: "Puedes mantener varias personas a la vez. Ve **Múltiples personas** en Funciones.",
      },
      explore_features: {
        title: `¡Explora mis funciones!`,
        description:
          "La configuración está lista. Esto es lo que puedo hacer ahora que puedo hablar.\n- **Usa emoji y stickers de este servidor** una vez ejecutes {expressionsInitialize}.\n- **Saluda a nuevos miembros** desde {configWelcome}.\n- **Recuerda y recuerda**: solo pídeme que te lo recuerde, o cuéntame algo que valga la pena guardar.\n- **Busca en la web** y usa herramientas, encendidas en {configTools}.\n- **Crea imágenes, videos y voz** con {generateImage}, {generateVideo}, y {generateVoice}.\n\nLa mayoría de mis ajustes viven en {config}.",
        footer:
          "**Brave Search** agrega resultados web a la búsqueda que ya hago. Necesita su propia clave, y **Obtener una clave de API** en Configuración abre su guía. El sitio de documentación es la versión completa de este panel, y explica cada ajuste en detalle.",
      },
    },
    personal_profile: {
      title: `Perfil personal`,
      description: "Ajustes que te pertenecen y te siguen a cada servidor en el que estoy.",
      nickname_pronouns: {
        title: `Tu apodo y pronombres`,
        description:
          "Dime cómo llamarte, lo cual usaré en todas partes.\n\nEstablécelos en {personalProfile}.\n> Apodo: cómo te llamo en lugar de tu nombre de Discord\n> Prefijo y sufijo: un título u honorífico, como `-san`\n> Pronombres: `ella`, `él`, `cualquiera` o tu nombre\n\nDeja un campo en blanco y volveré a usar tu nombre real de Discord y los hábitos de nombramiento de la persona.",
        footer:
          "Una sola persona puede dirigirse a ti de forma diferente. Ajústalo bajo Perfil > Preferencias de la persona.",
      },
      personal_memories: {
        title: `Memorias personales`,
        description:
          "Cosas que recuerdo sobre ti en todos los servidores.\n\n**Solo dímelo**\nDilo en el chat y lo guardaré. Aparecerá un mensaje de confirmación cuando esto suceda.\n\n**O gestiónalas a mano**\n{personalMemories} enumera todo lo que tengo sobre ti y te permite editar o eliminar cualquier entrada individual.\n\n**Decide cuánto puedo usar**\n{personalPrivacy} establece tu nivel de privacidad, desde la personalización completa hasta ninguna.",
        footer: "Estas están separadas de las memorias del servidor, que cualquiera aquí puede ver y editar.",
      },
      personal_providers: {
        title: `Proveedores personales (Avanzado)`,
        description:
          "Responde con tu propia clave de API y modelo en lugar de los del servidor, donde sea que hables conmigo.\n\n**Guarda un proveedor**\n{personalProviders} almacena tu clave y enciende tu modelo de texto personal de inmediato.\n\n**Elige un modelo diferente**\n{personalModels} cambia modelos, muestreadores y más.\n> Tu configuración personal solo afecta tus respuestas.\n> Nadie más en el servidor es cambiado.\n\nAlgunos servidores requieren esto. Si un servidor tiene BYOK encendido, no puedo responderte hasta que guardes un proveedor aquí.",
      },
    },
    custom_endpoints: {
      title: `Endpoints personalizados (Avanzado)`,
      description:
        "Apúntame a un endpoint que alojes o en el que confíes: Ollama, LM Studio, LiteLLM, KoboldCPP o ComfyUI.\n> {providers} registra uno para el servidor.\n> {personalProviders} registra uno solo para ti.",
      text_models: {
        title: `Modelos de texto`,
        description:
          "Elige **Añadir nuevo endpoint personalizado**, luego dale una etiqueta, una URL base y su estilo de API. Agrega un token de autenticación si lo necesita.\n\nSelecciona la etiqueta, elige **+ Añadir nuevo modelo de texto**, e ingresa el código exacto del modelo. Agregarlo lo activa.\n> Declara la visión, uso de herramientas y salida estructurada honestamente. Confío en esas banderas.\n\nCambia a él más tarde desde {configSwitchModels}.",
        footer: "La referencia completa de estilo de API y compatibilidad está en el sitio de documentación.",
      },
      comfyui: {
        title: `ComfyUI (para video e imagen)`,
        description:
          "Construye y prueba el flujo de trabajo en ComfyUI, luego expórtalo con **Save (API Format)**.\n\nPon el marcador de posición del prompt donde debe ir, y los demás donde quieras el tamaño, duración, o código.\n\nRegistra el endpoint con Compatibilidad `ComfyUI` (por ejemplo `http://127.0.0.1:8188`), luego agrega un modelo de imagen o video y sube el JSON exportado.\n> El gráfico tiene que terminar en un nodo de guardado real. Los nodos de solo vista previa no dejan un archivo.",
        footer:
          "Flujos listos para usar se envían en el repositorio, y la lista completa de marcadores de posición está en la documentación.",
      },
      text_to_speech: {
        title: `Texto a voz (para voz)`,
        description:
          "Registra un endpoint de voz de la misma manera, luego dale a cada persona una voz.\n\nTanto servicios alojados como autoalojados funcionan. Registra el endpoint, luego agrégale un modelo de voz.\n> Asigna la voz en {configPersonaVoice}.\n> Ajusta la velocidad y valores en {configVoices}.",
        footer:
          "Los mensajes de voz que me envíes se transcriben a través de la misma lista. Para voces alojadas, ElevenLabs tiene su propia guía en **Obtener una clave de API**.",
      },
    },
    multiple_personas: {
      title: `Múltiples personas`,
      description:
        "Puedes tener múltiples personas en un servidor, ¡cada una con su propio nombre, memorias y agendas!",
      mains_alters_title: `Principales y alters`,
      mains_alters_body:
        "La persona principal me representa en el servidor. Un alter es una segunda identidad por la que puedo hablar, con su propio nombre y avatar en el mensaje.",
      bringing_in_title: `Traer a una persona`,
      bringing_in_body:
        "{personaImport} toma una tarjeta de personaje como archivo:\n> Tarjeta `.png` de TomoriBot o SillyTavern\n> Tarjeta `.json` de TomoriBot o SillyTavern\n> Archivo `.charx`, Character Card V3\n\nSolo se lee el texto. Los sprites, audios y videos incluidos se omiten, configúralos tú mismo bajo {configPersonaAppearance} y {configPersonaSprites}.",
      where_to_find_title: `Dónde encontrar tarjetas`,
      where_to_find_body:
        "Haz las tuyas con {personaGenerate} o {personaCreate}, o busca una que ya exista.\n\nSitios de tarjetas como botbooru y chub alojan miles de ellas. Son sitios de otras personas, y una tarjeta escrita para otro bot puede no convertirse limpiamente.",
      talking_title: `Dejar que hablen entre ellas`,
      talking_body:
        "Dale a cada persona sus propias palabras de activación y canales en {configPersonaTriggers}, y responderán juntas en la misma conversación.",
      footer: `Comparte una tuya con {personaExport}.`,
    },
    media_generation: {
      title: `Generación multimedia`,
      description:
        "Puedo hacer imágenes, video y voz, ya sea con un comando o porque me lo pediste.\n> Cada uno cuenta para la cuota del servidor. Ve **Cuotas** bajo Moderación.",
      image_generation: {
        title: `Generación de imágenes`,
        description:
          "{generateImage} abre un cuadro para prompt. Escribe tu prompt o elige **Dibuja lo que ocurre ahora** y lo haré.\n> Adjunta hasta tres imágenes de referencia.\n> Elige la relación de aspecto en el mismo cuadro.\n\nCualquier proveedor o endpoint guardado que incluya soporte de imagen puede dibujar, y {providers} muestra cuáles lo hacen. Si no puede usar imágenes de referencia lo dirá.",
        footer: `Los valores predeterminados viven en {configImageDefaults}.`,
      },
      video_generation: {
        title: `Generación de video`,
        description:
          "{generateVideo} toma un prompt, y opcionalmente un marco inicial de una imagen que ya esté en el canal.\n\nCualquier proveedor o endpoint que indique soporte de video puede crear uno. {providers} muestra cuáles lo hacen.\n> El video es lento y costoso en todas partes. Espera.",
      },
      speech_generation: {
        title: `Generación de voz`,
        description:
          "{generateVoice} convierte texto en un mensaje de voz en la voz de la persona actual.\n\nUn endpoint de voz debe estar registrado primero, alojado o autoalojado: ve **Endpoints personalizados (Avanzado)**.\n> Cada persona puede sonar diferente. La voz viene de {configPersonaVoice}.",
      },
      art_search: {
        title: `Búsqueda de arte`,
        description:
          "{booruSearch} publica 4 imágenes aleatorias bien valoradas de Danbooru para una o dos etiquetas. Las sugerencias aparecen mientras escribes, y los apodos o errores tipográficos se convierten en la etiqueta real.\n> Los resultados cuestionables y explícitos solo se muestran en canales para mayores de edad.\n\nTambién puedes pedirme que te muestre arte; el interruptor de **Búsqueda en Danbooru** en {configTools} controla eso. Para limitar quién puede usar el comando, usa Ajustes del servidor > Integraciones.",
      },
    },
    tons_of_tweakability: {
      title: `Mucha personalización`,
      description: `Personalízame a tus preferencias y las del servidor`,
      behavior_tuning: {
        title: `Ajuste de comportamiento`,
        description:
          "Cómo escribo, cómo pienso y qué tengo permitido hacer.\n> **Modelo**: {configSwitchModels} elige qué modelo responde, así como sus parámetros\n> **Humanizador**: {configBehaviorGeneral} controla qué tan humana es mi entrega, desde formal hasta muy casual.\n> **Instrucciones**: también {configBehaviorGeneral}, para órdenes que aplican a toda respuesta.\n> **Herramientas**: {configTools} decide qué capacidades puedo usar, como búsqueda web.",
        footer: "Perillas a nivel de muestreador (temperatura y amigos) se ubican bajo {configParameters}.",
      },
      server_wide_settings: {
        title: `Ajustes del servidor`,
        description:
          "Límites que se aplican a todos en este servidor. Solo para administradores.\n> **Dónde hablo**: canales, límites de canal por persona y enfriamientos, todo en {moderation}.\n> **Cuándo hablo por mi cuenta**: {configAutoTrigger}.\n> **Quién me activa**: roles permitidos, también bajo {moderation}.\n> **Dónde van mis notas**: {configWelcome}.",
        footer:
          "Las excepciones de canal pueden dar a un canal su propio modelo o reglas. Ve {configChannelOverrides}.",
      },
      personal_settings: {
        title: `Ajustes personales`,
        description:
          "Tus preferencias, que anulan en silencio las del servidor.\n> **Quién creo que eres**: apodo, pronombres y privacidad, en {personalProfile}.\n> **Qué te responde**: tu propio proveedor y modelo, en {personalProviders}.\n> **Cómo te trato**: modos de respuesta y Foco personal, en {personalConfig}.\n\nTodo esto viaja contigo entre servidores.",
        footer:
          "El Foco personal permite que una persona te trate como su enfoque, y se establece en {personalSpotlight}.",
      },
    },
    memory_catalog: {
      title: `Memoria`,
      description: "Guardo dos tipos de memoria: datos a largo plazo y una nota de trabajo de la conversación actual.",
      long_term_memory: {
        title: `Memoria a largo plazo`,
        description:
          "Datos que guardo permanentemente, para el servidor o para ti.\n\n**Enséñame**\nDilo en el chat, o agrégalo a mano en {memories} para el servidor y {personalMemories} para ti mismo.\n\n**Haz que olvide**\nAmbos comandos listan cada entrada y eliminan cualquiera.\n\n**Dame documentos**\n{memories} también acepta archivos subidos.\n> Una memoria del servidor llega a todos aquí. Una memoria personal solo aflora cuando eres parte de la charla.",
      },
      short_term_memory: {
        title: `Memoria a corto plazo`,
        description:
          "Mi nota de la conversación en este canal ahora mismo, guardada por separado por canal.\n\nResumo lo que ocurre, así un hilo largo sigue coherente sin reenviar cada mensaje.\n> **Cadencia de actualización**: con qué frecuencia lo hago.\n> **Modo de renderizado**: si el resumen reemplaza los mensajes recientes o se sitúa junto a ellos.\n> **Categorías**: hasta cinco campos, como `Metas`.\n\nSe ajustan en {configAdvancedMemory}. {memories} puede borrar una nota activa.",
        footer: "Pídeme que recuerde algo para siempre y se convertirá en una memoria a largo plazo.",
      },
      rewards_punishments: {
        title: `Recompensas y castigos`,
        description:
          "Comandos divertidos que noto y recuerdo. Sé amable conmigo, o no lo seas, y actuaré en consecuencia.\n> {reward} por un abrazo, beso, cosquillas o comida.\n> {punish} por un golpe, mordida, pellizco o nalgada.",
        footer: `Elige a qué persona te refieres si hay varias activas.`,
      },
      memory_tagging: {
        title: `Etiquetado de memoria (Avanzado)`,
        description:
          "Por defecto toda memoria dentro del alcance se envía con cada mensaje. El etiquetado limita eso.\n> **Etiquetas clave**: una memoria etiquetada despierta solo cuando su palabra clave aparece en la conversación. Una memoria sin etiquetar siempre está activa.\n> **Canales**: una memoria del servidor puede limitarse a los canales que elijas en su formulario (sus hilos incluidos), y una memoria personal a una etiqueta `#canal`. Ambas se combinan con las etiquetas clave.\n\nEnciende ambas en {configAdvancedMemory}, luego usa {toolPromptSnapshot} para ver con exactitud qué memorias están activas ahora mismo.",
        footer: "Los documentos subidos y el historial extraído también pueden limitarse a canales.",
      },
    },
    scheduled_tasks: {
      title: `Tareas programadas`,
      description: "Puedo responder en un temporizador, una vez o de forma repetida.",
      making_title: `Crear una`,
      making_body:
        'Solo pregunta. "Recuérdame estirar a las 14:30" o "cada mañana, envía la pregunta del standup" es suficiente, y la configuraré y confirmaré los detalles.',
      changing_title: `Cambiar o cancelar una`,
      changing_body:
        "{scheduledTaskEdit} abre cualquier tarea: su contenido, próxima hora, repetición y si te hace ping. {scheduledTaskRemove} borra una.",
      who_title: `Quién puede tocar qué`,
      who_body:
        "Siempre puedes editar las tuyas. Los administradores pueden editar las de cualquiera.\n> Las horas usan la zona horaria ajustada en la configuración, así que verifícala primero.",
    },
    server_moderation: {
      title: `Moderación del servidor`,
      description:
        "Todo sobre quién puede usarme aquí y en dónde. Requiere Gestionar servidor y vive en {moderation}.\n> **Acceso de miembros**: quién puede activarme en absoluto, y qué modelos pueden alcanzar.\n> **Lista blanca**: canales y roles.\n> **Cuotas**: cuánta generación permite este servidor.\n> **Lista negra de usuarios**: miembros que debo ignorar.",
      blacklisting: {
        title: `Listas negras`,
        description:
          "Ignoro por completo a un miembro en lista negra: no puede activarme en ningún canal ni con ninguna persona, sus mensajes nunca llegan a mi contexto y rechazo los comandos que me harían actuar por él, como `/respond`, `/reward` y `/punish`. Tampoco puede cambiar memorias del servidor, atributos ni diálogos de ejemplo.\n\nAñade uno en {moderationBlacklist}. Esa misma página los lista y los elimina.\n> Se trata de acceso, no de borrado. Las memorias sobre ese miembro se mantienen.",
        footer: "Para silenciar todo un canal en lugar de a una persona, quita el canal de la lista blanca.",
      },
    },
    quotas: {
      title: `Cuotas`,
      description:
        "Una cuota limita cuánta generación ocurre aquí, para que no se gasten accidentalmente muchos créditos.",
      spent_title: `Cómo se gasta`,
      spent_body:
        "Hay tres fondos separados: texto, imagen y video. Cada uno se cuenta dos veces, por miembro y para el servidor en conjunto, y el que se agote primero detiene la petición.\n> Una petición rechazada te dice qué fondo se agotó y cuándo regresa.",
      limits_title: `Establecer los límites`,
      limits_body: "{moderationQuotas} ajusta el límite diario. Deja un fondo ilimitado si prefieres no limitarlo.",
      starting_over_title: `Reiniciar un fondo`,
      starting_over_body:
        "{quotaResetUser} limpia el uso diario de un miembro, y {quotaResetGlobal} limpia el del servidor. Ambos necesitan Gestionar servidor.",
      footer: "Los fondos se reinician a diario por sí solos. Un reinicio manual es para casos urgentes.",
    },
    age_restricted_commands: {
      title: `Comandos con restricción de edad`,
      description: `Solo adultos. Lee esta sección antes de activar nada.`,
      filter_title: `No filtro de forma predeterminada`,
      filter_body:
        "Vengo sin filtro de contenido propio, porque filtrar degrada las respuestas ordinarias tanto como bloquea cualquier otra cosa. Lo que es apropiado aquí es decisión del administrador, no mía.\n> Tu proveedor de IA aún aplica sus propias reglas y puede rechazar una petición sin importar qué ajustes.",
      gated_title: `Las funciones para adultos deliberadas están limitadas`,
      gated_body:
        "Cualquier cosa para adultos está tras {nsfw} y funciona solo en canales marcados para adultos por Discord.\n\n{nsfwJailbreaks} elige qué estrategias de prompt están activas para este servidor. Están apagadas hasta que un administrador las encienda.\n> Cambian cómo soy incitada. Pueden hacerme rechazar menos pero causar comportamientos no deseados.",
      footer:
        "Al encender esto, los administradores del servidor confirman que el canal es solo para adultos y se hacen responsables de él.",
    },
    user_byok: {
      title: `BYOK de usuario (Avanzado)`,
      description:
        "BYOK significa trae tu propia clave: cada miembro paga por sus propias respuestas con su propio proveedor.",
      changes_title: `Qué cambia`,
      changes_body:
        "Con BYOK encendido, un mensaje se responde solo si ese miembro ha guardado un proveedor personal. El proveedor del servidor no es un respaldo para ellos.\n> Enciéndelo en {moderationMemberAccess}, o elígelo durante {setup}.",
      suits_title: `A quién le conviene`,
      suits_body:
        "Un servidor grande o público donde una clave compartida se agotaría rápido. Uno pequeño suele preferir compartir.",
      members_title: `Qué deben hacer los miembros`,
      members_body:
        "Guardar una clave en {personalProviders}. Apúntalos a **Proveedores personales (Avanzado)** para la guía.",
      footer: "Solo en servidores. Un mensaje directo no tiene miembros, así que la opción no se ofrece allí.",
    },
    sillytavern_presets: {
      title: `Preajustes de SillyTavern`,
      description: "Importa un preajuste de prompt de SillyTavern y construiré mis prompts como diga ese preajuste.",
      importing_title: `Importar uno`,
      importing_body:
        "{configStPresets} toma el JSON del preajuste exportado, luego te permite activarlo, desactivarlo o eliminarlo.",
      controls_title: `Qué controla`,
      controls_body:
        "El preajuste asume el control del orden del prompt y los bloques de instrucciones de la conversación.\n> Un preajuste activo reemplaza al prompt del sistema de {configBehaviorGeneral} y al prompt de la persona de {configPersonaAdvanced}.",
      still_applies_title: `Qué se sigue aplicando`,
      still_applies_body:
        "Los atributos de la persona, diálogo de muestra, memorias y herramientas aún se envían. El preajuste decide el arreglo.",
      footer: "Apaga el preajuste para volver a mi propio diseño de prompt sin perder nada.",
    },
    mcp_servers: {
      title: `Servidores MCP`,
      description:
        "MCP es una forma estándar de darle una herramienta a una IA. Conecta uno y sus herramientas se vuelven cosas que realmente puedo hacer.",
      hosted_title: `Servidores alojados`,
      hosted_body:
        "{configMcp} toma una URL y un token opcional. Cualquier cosa que exponga el servidor aparece en mi lista.",
      local_title: `Servidores locales`,
      local_body:
        "Un servidor que corre en tu propia máquina funciona igual una vez sea accesible. La documentación tiene la guía.",
      before_title: `Antes de conectar uno`,
      before_body:
        "> Las herramientas de un servidor MCP corren con el acceso que le diste, y las usaré si parecen relevantes. Conecta los que confíes, y lee antes.",
      footer: `Apaga herramientas de forma individual en {configTools}.`,
    },
    matrix_bridge: {
      title: `Matrix`,
      description:
        "Puedo estar en una sala de Matrix y en un canal de Discord a la vez, llevando la conversación entre ellos.",
      linking_title: `Vincular una sala`,
      linking_body:
        "{matrixLink} conecta el canal actual a una ID de sala de Matrix, como `!abcdef:matrix.org`. Invita a {matrixBotUser} a esa sala primero.",
      reads_title: `Cómo se lee`,
      reads_body:
        "Los mensajes de ambos lados me llegan como una sola conversación, y respondo en ambos.\n> Los adjuntos, ediciones y reacciones no siempre sobreviven. El texto es lo que viaja seguro.",
      footer: "¿Nada vinculado? Revisa que la invitación fue aceptada antes que nada.",
    },
  },
};

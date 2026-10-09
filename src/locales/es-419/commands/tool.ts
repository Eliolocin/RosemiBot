export default {
  tool: {
    description: `Acciones de utilidad para el contexto de la conversación, prompts y diagnósticos.`,
    estimate: {
      description: `Estima el uso y los costos`,
      cost: {
        description: `Estima los costos de API para proveedores de IA de pago`,
        title: `Costos de API estimados`,
        embed_description: `Aquí hay costos estimados **MUY APROXIMADOS** por activación en un canal de Discord al usar proveedores de IA de pago. Los costos se estiman usando ejemplos de costos de **{provider}** (Entrada: {inputPrice}/M tokens, Salida: {outputPrice}/M tokens)`,
        current_context_description: `Costo estimado **solo para tu contexto actual**. Los tokens de entrada se miden por la API del proveedor usando tu configuración actual y el historial reciente del canal en el modelo **{model}** de **{provider}**. Los tokens de salida siguen siendo estimados. Precios usados: Entrada {inputPrice}/M, Salida {outputPrice}/M.`,
        current_context_estimated_description: `Costo estimado **solo para tu contexto actual**. **{provider}** (modelo **{model}**) no tiene una API de conteo de tokens en vivo, por lo que los tokens de entrada se **aproximan a partir del conteo de caracteres** (~4 caracteres por token) sobre tu configuración actual y el historial reciente del canal. La precisión varía según el idioma, y escrituras más densas como el japonés se tokenizan más alto que esta estimación. Los tokens de salida también son estimados. Precios usados: Entrada {inputPrice}/M, Salida {outputPrice}/M.`,
        current_input_title: `Tokens de entrada medidos (contexto actual)`,
        current_input_estimated_title: `Tokens de entrada estimados (contexto actual)`,
        current_input_value: `**Entrada:** {inputTokens} tokens
**Costo de entrada solamente:** ~{inputCost} por activación`,
        current_output_typical_title: `Salida estimada: típica`,
        current_output_persona_average_title: `Salida estimada: promedio de la persona`,
        current_output_band_value: `**Estimación de salida:** {outputTokens} tokens
**Costo estimado de salida:** ~{outputCost} por activación`,
        average_total_cost_title: `Costo total promedio por activación`,
        average_total_cost_value: `**Estimación total:** {totalTokens} tokens
~{costPerMessage} por activación (~{costPer100} por 100 activaciones)`,
        current_footer: `Los recuentos de tokens de entrada son medidos por el proveedor solo para aquellos con soporte de conteo en vivo. Los recuentos de tokens de salida son estimados. La banda "Promedio de la persona" combina las respuestas de los diálogos de ejemplo de la persona y los turnos recientes de la persona en este canal. Vuelve a una estimación típica cuando ninguna fuente está disponible.`,
        current_estimated_footer: `Este proveedor no tiene una API de conteo en vivo, por lo que los tokens de entrada se aproximan a partir del conteo de caracteres. Trátalos como una cifra aproximada, especialmente para contextos en japonés o con mucho JSON. Los tokens de salida también se estiman. La banda "Promedio de la persona" combina las respuestas de los diálogos de ejemplo de la persona y sus turnos recientes en este canal. Vuelve a una estimación típica cuando ninguna fuente está disponible.`,
        no_cost_provider_description: `El proveedor actual no tiene costos`,
        unavailable_description: `La estimación de costos en vivo no está disponible para el proveedor actual (**{provider}**).`,
        fallback_notice_title: `Conteo en vivo no disponible`,
        fallback_notice_value: `El conteo de tokens en vivo del proveedor no se pudo usar para tu configuración actual, por lo que esta vista es una estimación de respaldo aproximada.`,
        minimum_scenario_title: `Escenario mínimo (uso ligero)`,
        minimum_scenario_value: `**Contexto:** 1 usuario con 0 memorias, 1 párrafo de persona, las conversaciones son de menos de una oración por mensaje
**Tokens:** {inputTokens} entrada + {outputTokens} salida`,
        average_scenario_title: `Escenario promedio (uso moderado)`,
        average_scenario_value: `**Contexto:** 3 usuarios con 10 memorias cada uno, ~16 párrafos de persona (incluye atributos y diálogos), las conversaciones son de 1-2 oraciones por mensaje
**Tokens:** {inputTokens} entrada + {outputTokens} salida`,
        maximum_scenario_title: `Escenario máximo (uso intenso)`,
        maximum_scenario_value: `**Contexto:** 5 usuarios con 25 memorias cada uno, ~31 párrafos de persona (incluye atributos y diálogos), las conversaciones son de 2 párrafos por mensaje
**Tokens:** {inputTokens} entrada + {outputTokens} salida`,
        breakdown_title: `¿Qué afecta el costo?`,
        breakdown_value: `**Tokens de entrada (contexto enviado a la IA):**
- Párrafos de la persona (incluye atributos y diálogos de ejemplo)
- Memorias del servidor y personales
- Herramientas habilitadas (si las hay)
- Estados de usuario y recordatorios
- Historial reciente de conversación (incluye imágenes, videos, stickers, emojis, embeds si el proveedor lo admite)
- Emojis del servidor (10 constantes)

**Tokens de salida (respuesta de la IA):**
- La longitud de la respuesta varía según la complejidad de la consulta
- Preguntas más detalladas = respuestas más largas = mayor costo

**Consejos para reducir costos:**
Tengo funciones integradas para ayudar a reducir los costos de abusadores o spammers en tu servidor, pero aquí hay algunos consejos adicionales:
- Usa menos párrafos para la persona (atributos y diálogos)
- Mantén las memorias concisas
- Usa proveedores de IA gratuitos (nivel gratuito de Google Gemini)
- Limita los canales de activación automática`,
        footer: `¡Los proveedores gratuitos como Google Gemini (nivel gratuito) y algunos modelos de OpenRouter no tienen costo! NovelAI ofrece uso ilimitado con una suscripción. Abre \`/help\` en Configuración, luego Paso 1: Obtener una clave de API, para obtener más información.`,
      },
    },
    delete: {
      description: `Elimina turnos u otro contenido del canal.`,
      turn: {
        description: `Elimina el turno de la última persona del canal.`,
        regenerate_description: `Si es verdadero, vuelve a activar la persona después de eliminar.`,
        select_persona_description: `Si es verdadero, elige qué turno de persona eliminar.`,
        no_permission_title: `Permiso denegado`,
        no_permission_description: `Este comando requiere el permiso de Gestionar servidor o debe usarse en un canal de RP designado.`,
        already_running_title: `Ya se está eliminando`,
        already_running_description: `Ya hay una eliminación en curso para este canal. Por favor, espera.`,
        no_persona_found_title: `Turno de persona no encontrado`,
        no_persona_found_description: `No se pudo encontrar un bloque contiguo de mensajes de persona en el historial reciente.`,
        deleting_title: `⏳ Eliminando turno`,
        deleting_description: `Eliminando {count} mensaje(s) de **{persona_name}**...`,
        success_title: `✅ Turno eliminado`,
        success_description: `Se eliminaron {count} mensaje(s) de **{persona_name}**.`,
        success_regenerate_description: `Se eliminaron {count} mensaje(s) de **{persona_name}**. Volviendo a activar...`,
        partial_title: `⚠️ Eliminación parcial`,
        partial_description: `Se eliminaron {deleted_count}/{total_count} mensaje(s) de **{persona_name}**. Algunos mensajes no se pudieron eliminar.`,
        partial_no_manage_messages_description: `Se eliminaron {deleted_count}/{total_count} mensaje(s) de **{persona_name}**. No pude eliminarlos todos porque me falta el permiso de **Gestionar mensajes**.`,
        bot_no_delete_title: `No se pueden eliminar los mensajes`,
        bot_no_delete_description: `No tengo el permiso de **Gestionar mensajes** en este canal, y tampoco pude eliminar ningún mensaje a través de la alternativa de webhook. Por favor, concédeme el permiso de **Gestionar mensajes** o asegúrate de que mi webhook esté disponible.`,
        bot_failed_delete_description: `Encontré un error inesperado al intentar eliminar los mensajes.`,
      },
    },
    prompt: {
      description: `Inspecciona los prompts que TomoriBot envía al modelo.`,
      snapshot: {
        description: `Vuelca el prompt exacto del LLM para una persona en un archivo para depuración.`,
        persona_description: `Persona para la instantánea. Por defecto es la persona principal.`,
        format_description: `Formato de salida para el archivo de instantánea.`,
        fetch_tools_description: `Si es verdadero, añade las definiciones de herramientas a la instantánea (solo JSON).`,
        text_option: `Texto`,
        json_option: `JSON`,
        no_permission_title: `Permiso denegado`,
        no_permission_description: `Necesitas el permiso de **Gestionar servidor**, o el propietario del servidor debe habilitarlo para los miembros a través de \`/moderation\`.`,
        persona_not_found_title: `Persona no encontrada`,
        persona_not_found_description: `Esa persona ya no existe en este servidor. Elige una de la lista.`,
        dm_title: `Instantánea del prompt`,
        dm_description: `Aquí está la instantánea del prompt de la persona **{persona_name}** (formato: {format}).`,
        dm_txt_headers_note: `Los encabezados \`=== Title (/command) ===\` y \`== SubTitle ==\` en el archivo TXT son anotaciones que muestran qué comando de configuración controla cada sección. **No** son parte del prompt real enviado al LLM. "Sin etiquetar" significa que fue reorganizado o es parte de un st-preset personalizado.`,
        dm_hint_try_json: `Ejecuta el comando nuevamente con \`format: JSON\` para el formato sin procesar.`,
        dm_hint_try_text: `Ejecuta el comando nuevamente con \`format: Text\` para un formato más legible.`,
        dm_tools_txt_note: `Las definiciones de herramientas se omiten del formato TXT, por favor vuelve a ejecutar con \`format: JSON\` y \`fetch_tools: true\` para incluirlas.`,
        dm_config_heading: `**Configuración de muestreo / solicitud** (coincide con lo que el adaptador del proveedor enviaría en tiempo de ejecución):`,
        dm_truncated_note: `El historial de chat superaba el presupuesto del modelo, así que los {count} intercambios más antiguos se han omitido, tal como sucedería en una respuesta real.`,
        dm_failed_title: `No se pudo enviar el MD`,
        dm_failed_description: `No pude enviar un MD. Tu instantánea se adjunta aquí en su lugar. Habilita los MD de los miembros del servidor para recibir futuras instantáneas por MD.`,
        success_title: `Instantánea enviada`,
        success_description: `La instantánea del prompt ha sido enviada a tus Mensajes Directos.`,
        no_personas_title: `No se encontraron personas`,
        no_personas_description: `No se encontraron personas para este servidor.`,
        build_failed_title: `Instantánea fallida`,
        build_failed_description: `Falló la creación de la instantánea del prompt. Por favor, inténtalo de nuevo.`,
        guild_only_title: `Solo servidor`,
        guild_only_description: `Este comando solo se puede usar en un canal de servidor.`,
        dm_tools_filtering_note: `Las definiciones de herramientas en instantáneas JSON se filtran para el último turno visible cuando el modo de herramientas deliberado está activo. Las instantáneas a posteriori pueden no reconstruir perfectamente el contexto transitorio de herramientas retenidas, pero ya no vuelcan la caja de herramientas completa cuando el turno en vivo habría limitado o suprimido herramientas.`,
      },
    },
    visualize: {
      missing_permissions_title: `Permisos faltantes`,
      missing_permissions_description: `Necesito permiso para ver este canal, leer el historial de mensajes, enviar mensajes y adjuntar archivos antes de poder generar una imagen de escena aquí.`,
      cooldown_active: `Los administradores de este servidor han configurado un tiempo de enfriamiento. Por favor, espera **{seconds}** segundos antes de usar \`/generate image\` en el modo **Dibujar lo que está pasando ahora** nuevamente. Este enfriamiento se comparte con los desencadenantes de mensajes y otros comandos manuales.`,
      channel_not_whitelisted: `Este servidor tiene restricciones de lista blanca activas. \`/generate image\` en el modo **Dibujar lo que está pasando ahora** solo puede usarse en canales permitidos por miembros con roles permitidos, y solo con personas permitidas en este canal.`,
      persona_access_blocked: `Tus permisos de lista blanca actuales y la configuración de enfoques personales no dejan ninguna persona disponible para \`/generate image\` en el modo **Dibujar lo que está pasando ahora** en este canal.`,
      no_backend_title: `Sin backend de imágenes disponible`,
      no_backend_description: `No pude encontrar un backend de imágenes utilizable para este servidor en este momento. Configura **{current_provider}** con un modelo de imagen válido, o agrega una clave opcional de NovelAI si quieres usar el renderizador de NovelAI en su lugar.`,
      planner_unavailable_title: `Sin modelo de planificación disponible`,
      planner_unavailable_description: `No pude encontrar un modelo de salida estructurada para el proveedor actual, por lo que no puedo planificar una imagen de escena en este momento.`,
      planner_failed_title: `Planificación de escena fallida`,
      planner_failed_description: `No pude convertir el contexto reciente del canal en un plan de imagen: {error}`,
      success_title: `Imagen de escena publicada`,
      success_description: `Planifiqué la toma desde el contexto reciente del canal y publiqué la imagen en este canal.`,
      modal: {
        title: `Imagen de escena`,
        prompt_label: `Dirección extra (opcional)`,
        prompt_description: `Agrega cualquier corrección, estado de ánimo o detalle que desees que respete el planificador`,
        prompt_placeholder: `ej. enfócate en la lluvia, hazlo más suave, muestra a ambos claramente`,
        setting_label: `Preajuste de toma`,
        setting_description: `Elige el preajuste de encuadre/estilo para esta imagen de escena rápida`,
        setting_storybeat_label: `Ritmo de la historia`,
        setting_storybeat_description: `Encuadre cinematográfico amplio para la escena inmediata`,
        setting_character_label: `Enfoque en personaje`,
        setting_character_description: `Encuadre más cercano alrededor del personaje principal o orador`,
        setting_snapshot_label: `Instantánea cuadrada`,
        setting_snapshot_description: `Composición cuadrada equilibrada para el momento actual`,
        setting_vertical_label: `Fondo de teléfono`,
        setting_vertical_description: `Encuadre vertical alto con silueta más fuerte`,
        backend_label: `Backend de imágenes`,
        backend_description: `Elige qué renderizador debe generar la imagen de la escena`,
        backend_current_label: `Proveedor actual`,
        backend_current_description: `Usa el flujo normal de generación de imágenes de {provider} y estilo de prompt`,
        backend_novelai_label: `NovelAI`,
        backend_novelai_description: `Convierte la escena en etiquetas estilo NovelAI y usa la herramienta de imagen de NovelAI`,
        persona_label: `Persona remitente`,
        persona_description: `Elige qué persona publica la imagen generada`,
      },
    },
  },
};
